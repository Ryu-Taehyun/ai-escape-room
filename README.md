# AI 방탈출 (AI Escape Room)

AI가 만든 퍼즐을 3D 1인칭으로 풀고 제한 시간 안에 탈출하는 협동 방탈출 게임.
방 안을 돌아다니며 **단서를 직접 찾고**, **미니게임으로 열쇠를 얻어** 문을 여는 모험형 진행입니다.

| 영역 | 기술 |
|---|---|
| 프론트엔드 | TypeScript + React 18 (Vite) |
| 3D 엔진 | JavaScript + Three.js (`frontend/src/game/engine.js`) |
| 백엔드 | Python FastAPI + WebSocket |
| DB | SQLite (테마/방 편집, AI 편집 이력, 세션) |
| AI | `mock`(기본, API 키 불필요) / `claude`(키 입력 시) |

---

## 1. 실행 방법

### 백엔드
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
- 처음 실행하면 `backend/escape_room.db` 가 생성되고 공포·이집트 테마가 자동 입력됩니다.
- 이전 버전 DB 가 있어도 **자동으로 업그레이드**됩니다 (새 컬럼 추가 + 수정하지 않은 기본 방은 단서/미니게임 포함 내용으로 갱신).
- API 문서: http://localhost:8000/docs
- 테스트: `pip install -r requirements-dev.txt && pytest -q`

### 프론트엔드
```bash
cd frontend
npm install
npm run dev
```
- http://localhost:5173 접속 (`/api`, `/ws` 는 Vite 프록시가 8000번으로 전달)
- 협동 테스트: 브라우저 창 2개를 열어 한 쪽에서 만든 **방 코드 6자리**를 다른 쪽에서 입력

### 환경 변수 (`.env`)
| 파일 | 키 | 설명 |
|---|---|---|
| `backend/.env` | `AI_PROVIDER` | `mock`(현재) / `claude` |
| | `HINT_PENALTY_SEC` | 힌트 1회당 줄어드는 시간(초), 기본 60 · 0 이면 감점 없음 |
| | `ADMIN_TOKEN_TTL_SEC` | 관리자 로그인 유지 시간(초), 기본 2시간 |
| | `SESSION_KEEP_HOURS` | 이보다 오래된 게임 세션은 서버 시작 시 삭제, 기본 24 |
| | `AI_API_KEY` | 비워둠. 나중에 키를 넣고 `AI_PROVIDER=claude` 로 변경 |
| | `AI_MODEL` | 기본 `claude-sonnet-5-5` |
| | `ADMIN_PASSWORD` | 인게임 관리자 비밀번호 — **반드시 변경** (기본값이면 서버 시작 시 경고, 관리자 로그인 시 안내) |
| | `DATABASE_PATH`, `CORS_ORIGINS` | DB 경로, 허용 프론트 주소 |
| `frontend/.env` | `VITE_API_URL`, `VITE_WS_URL` | 비우면 프록시 사용. 배포 시에만 입력 |

> `.env` 는 `.gitignore` 에 포함되어 있습니다. 저장소에는 `.env.example` 만 올리세요.

### 배포 / 시연용 실행 (서버 하나로)
```bash
cd frontend && npm run build        # frontend/dist 생성
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```
`frontend/dist` 가 있으면 백엔드가 게임 화면까지 함께 제공합니다 → 같은 네트워크의 다른 PC에서 `http://<서버 IP>:8000` 으로 접속.
글꼴은 프로젝트에 포함되어 있어 **인터넷이 없어도** 테마 글꼴이 그대로 나옵니다.

### 보안 / 공정성
- 관리자 로그인: 1분에 5번 틀리면 잠시 차단, 로그인은 2시간 뒤 만료
- 정답 제출: 같은 방에서 30초에 6번 틀리면 잠시 차단 (짧은 숫자 정답 무차별 대입 방지)
- 같은 방에 같은 닉네임이 들어오면 서버가 `이름 (2)` 처럼 번호를 붙입니다

---

## 2. 모험형 진행 방식

각 방은 아래 요소의 조합으로 구성됩니다.

| 요소 | 3D 표시 | 하는 일 |
|---|---|---|
| 🔎 **단서** | 방 곳곳의 메모·화이트보드·석상·항아리 등 (✨ 반짝이 = 아직 조사 안 함) | E로 조사 → 팀 인벤토리에 공유. **퍼즐 정보는 단서에 나뉘어 있어** 직접 찾아야 풀 수 있음 |
| 🔐 **암호** | 단말기(공포) / 제단(이집트) | 단서를 조합해 정답 입력 |
| 🎮 **미니게임** | 금고·배전반(공포) / 황금 상자(이집트) | 통과하면 🔑 **열쇠** 획득 |
| 🚪 **문** | 방 사이 문 / 최종 탈출문 | E로 조건 체크리스트 확인, 🔑 열쇠 사용 |

**방 클리어 조건** = (암호가 있으면 정답) **AND** (미니게임이 있으면 문에 열쇠 사용)

### 미니게임 3종 (서버가 문제를 만들고 결과를 검증)
| type | 이름 | 방법 | 난이도(1~5)에 따라 |
|---|---|---|---|
| `sequence` | 기억력 | 불빛(문양)이 켜지는 순서를 기억해 그대로 누르기 | 순서 길이, 표시 속도 |
| `wires` | 전선 연결 | 제한 시간 안에 같은 색 단자끼리 연결 | 전선 개수, 제한 시간 |
| `timing` | 타이밍 | 왕복하는 바늘이 초록 구간에 있을 때 멈추기 (3라운드) | 구간 폭, 속도, 필요 성공 수 |

실패하면 몇 번이든 다시 도전할 수 있고, 매번 새 문제가 나옵니다.

### 기본 콘텐츠 구성
| 순서 | 공포 | 구성 | 이집트 | 구성 |
|---|---|---|---|---|
| 1 | 정체불명의 서버실 | 단서 3 + 암호 | 파라오의 입구 | 단서 3 + 암호 |
| 2 | 해킹당한 관리자실 | 단서 3 + 암호 + 🎮전선 연결 | 스핑크스의 수수께끼실 | 단서 3 + 암호 |
| 3 | 바이러스 감염 구역 | 단서 3 + 암호 | 오시리스의 심판 홀 | 단서 3 + 암호(가벼운 심장 합 × 무거운 심장 수) + 🎮타이밍 |
| 4 | 폐쇄된 지하 통로 | 단서 2 + 🎮기억력 (암호 없음) | 황금 보물 무덤 | 단서 4 + 암호 |
| 5 | 최종 탈출 통제실 | 단서 3 + 암호 + 🎮타이밍 | 아누비스의 지하 통로 | 단서 3 + 암호 + 🎮기억력 |

---

### 몰입형 연출
| | 공포 (감염된 데이터센터) | 이집트 (파라오의 피라미드) |
|---|---|---|
| 조명 | 손전등(그림자), 깜빡이는 형광등, 붉은 비상등 | 손에 든 횃불, 벽 횃불, 천장 틈 빛줄기 |
| 공간 | 얼룩진 콘크리트, 녹슨 철문, 핏자국·벽 낙서, 서버 랙, 늘어진 케이블 | 상형문자 사암 벽, 돌문, 석상·관·카노푸스 항아리, 모래 더미 |
| 이벤트 | 정전 → 어둠 속 형체가 나타났다 사라짐 | 지진 → 화면 흔들림, 천장에서 모래 낙하 |
| 사운드 | 저주파 드론, 형광등 소음, 멀리서 쿵·속삭임, 발소리, 심장 박동(5분 미만) | 바람, 횃불 타닥임, 돌 갈리는 소리, 발소리 |
| 창 | CRT 터미널, 찢어진 메모, 증거물 파일, 제어 패널, 시설 도면 | 신성한 석판, 파피루스, 탐험 일지, 황금 테두리 시험, 도굴꾼 지도 |

- **1인칭 현실감** (`engine.js` 의 `_move`, `_updateBody`): 출발·정지 관성, 속도에 비례한 걸음 흔들림(위아래·좌우·기울기)과 발 디딤 충격,
  좌우 번갈아 들리는 발소리, 멈춰 있을 때의 숨쉬기, 옆걸음·급회전 시 몸 기울기, 시선을 늦게 따라오는 손전등/횃불,
  문 열림·정전·지진 때의 충격 흔들림(점점 잦아듦), 달릴 때 넓어지는 시야각과 깜짝 놀랄 때 좁아지는 시야
- 텍스처와 사운드는 이미지·음원 파일 없이 코드로 생성합니다 (`game/textures.js`, `game/audio.js`).
- **바로바로 진행**: 단서 조사와 문은 창 없이 처리되어 계속 움직일 수 있고, 암호·미니게임 창은 성공하면 자동으로 닫히며 곧바로 조작으로 돌아갑니다.
  ESC로 창을 닫은 경우에만 브라우저 보안 정책 때문에 화면을 한 번 클릭해야 할 수 있습니다.

---

### 게임 화면 편의 기능
| 기능 | 내용 |
|---|---|
| 대기실 | 방을 만들면 대기실에서 방 코드를 공유하고, 접속자 전원이 **준비 완료**하면 타이머가 시작됩니다 (혼자면 바로 시작 가능) |
| 일시정지 메뉴 (ESC) | 마우스 감도, 시야각, 볼륨(전체·배경음·효과음), 음소거, 화면 흔들림, 그래픽 품질(낮음/중간/높음), 소리 자막, FPS 표시, 조작 안내 |
| 그래픽 품질 | 낮음: 그림자·후처리 끔 / 중간: 그림자 + 바라보는 물건 외곽선 / 높음: + 빛번짐, 공포 테마 색수차 |
| HUD | 다음에 할 일 한 줄 안내, 화면 구석 미니맵(나·팀원·핑), 스태미나, 최근 단서(R) |
| 협동 | Q 핑, 걷는 팀원 캐릭터(손전등 빛), Enter 채팅, 연결 끊김 표시 + 자동 재연결 |
| 결과 화면 | 걸린 시간, 방별 기록, 팀원별 기여(방·단서·열쇠), 같은 설정으로 다시 하기 (**팀원도 함께 새 대기실로 이동**) |
| ESC | 창이 열려 있으면 창만 닫고(한 번 클릭하면 바로 이어짐), 창이 없을 때만 일시정지 메뉴 |
| 접근성 | 미니게임에 색 + 기호 표시(색약 대응), 소리 자막, 흔들림 줄이기, 휴대폰 접속 시 PC 전용 안내 |
| 관리자 | 방 평면도에서 단서를 **드래그해서 배치** |

### 화면 자동 테스트 (QA)
```bash
cd frontend
npx playwright install chromium   # 처음 한 번
npm run e2e                       # 공포 테마 (백엔드·프론트 실행 중이어야 함)
npm run e2e -- egypt              # 이집트 테마
```
대기실 → 입장 → 단서 → 잠긴 문 → 퍼즐(오답·정답·자동 복귀) → 창에서 ESC → 일시정지 → 채팅 → 핑 → 단서 다시 보기 → 인벤토리·지도 → 미니게임까지 20개 항목을 확인하고,
스크린샷을 `frontend/e2e/out/` 에 저장합니다.

---

## 3. 게임 규칙 (구현 완료)

| 항목 | 값 | 구현 위치 |
|---|---|---|
| 방 개수 | 기본 **4**, 최소 2 ~ 최대 5 | `config.py`, `game_logic.select_rooms` |
| 방 구성 | 입구(1번)·최종 방(5번)은 항상 포함, 중간 방을 순서대로 채움 | `select_rooms` |
| 제한 시간 | 30 ~ 120분, 사용자가 로비에서 선택 (5분 단위) | `Lobby.tsx`, `CreateSessionRequest` |
| 타이머 | 서버 기준 (`started_at + 제한 + 관리자 추가 시간`) | `game_logic.remaining_seconds` |
| 진행 | 방 클리어 → 다음 방 문 열림 → 최종 방 클리어 시 탈출 | `game_logic.submit_answer` |
| 정답 판정 | 공백·대소문자 무시, `\|` 로 복수 정답 (`사람\|인간`) | `game_logic.check_answer` |
| 3D | 1인칭 (WASD, 마우스, Shift, E 조사), 잠긴 문 충돌, 벽 너머 조사 불가 | `engine.js` |
| 단서 | 조사 시 팀 인벤토리(I)에 공유, 조사 전에는 내용 비공개 | `game_logic.inspect_clue`, `ClueDoc.tsx`, `InventoryPanel.tsx` |
| 미니게임/열쇠 | 서버가 문제 생성·검증(1회용) → 열쇠 → 문에서 사용 | `minigames.py`, `components/minigames/`, `Game.tsx` (문 상호작용) |
| 지도 (M) | 방별 클리어 ✅ / 진행 가능 🔓 / 잠김 🔒, 내 위치·팀원 위치, 문 상태, 단서 수·암호·열쇠 상태 | `MiniMap.tsx` |
| 협동 | WebSocket: 위치 동기화, 채팅, 클리어/힌트/관리자 알림 | `ws_manager.py`, `socket.ts` |
| 관리자 | 인게임 🛠 버튼 → 컨셉·방·퍼즐·**단서(위치/모양/내용)·미니게임(종류/난이도/열쇠 이름)** 편집, AI 편집, 시간/잠금/초기화, 로그 | `AdminPanel.tsx`, `routers/admin.py` |

> 퍼즐은 **다른 방의 단서에 의존하지 않도록** 설계했습니다. 방 개수에 따라 중간 방이 빠지기 때문입니다.

### 조작
| 키 | 동작 |
|---|---|
| 클릭 | 시점 고정 (게임 시작) |
| WASD / Shift | 이동 / 달리기 |
| E 또는 클릭 | 조준한 대상 조사 (단서·단말기·미니게임·문) |
| Shift | 달리기 (스태미나 소모, 바닥나면 숨이 가빠지고 느려짐) |
| C (누르는 동안) | 웅크리기 — 시점이 낮아지고 발소리가 작아짐 |
| F | 손전등(공포) / 횃불(이집트) 켜기·끄기 |
| 🎥 버튼 | 화면 흔들림 줄이기 (멀미 방지, OS '동작 줄이기' 설정을 기본값으로 따름) |
| Q | 핑 — 바라보는 곳을 팀원 화면·지도에 표시 |
| R | 최근 단서 다시 보기 |
| Enter | 팀 채팅 (마우스 고정 유지) |
| I | 팀 인벤토리 |
| M | 지도 |
| ESC | 일시정지 메뉴 (설정·조작 안내·관리자 모드) |

---

## 4. 폴더 구조와 담당자

```
ai-escape-room/
├── backend/
│   ├── .env / .env.example
│   ├── requirements.txt / requirements-dev.txt
│   ├── app/
│   │   ├── main.py            # FastAPI 진입점                       [2]
│   │   ├── config.py          # 환경변수 + 게임 규칙 상수             [2]
│   │   ├── database.py        # SQLite 스키마/시드                    [2]
│   │   ├── repository.py      # SQL 접근 계층                         [2]
│   │   ├── game_logic.py      # 방 선택, 타이머, 정답, 단서, 열쇠, 클리어 판정 [2]
│   │   ├── minigames.py       # 미니게임 문제 생성/검증               [2]
│   │   ├── ws_manager.py      # WebSocket 협동 (프로토콜 주석 포함)   [2]
│   │   ├── schemas.py         # 요청/응답 모델 (프론트 types.ts 와 대응) [2][3]
│   │   ├── seed_data.py       # 테마·방·퍼즐·단서·미니게임 원본 콘텐츠 [4][1]
│   │   ├── ai_service.py      # AI provider / mock 생성기 / 힌트      [1]
│   │   ├── prompts/*.txt      # 시스템·방 생성·힌트 프롬프트           [1]
│   │   └── routers/           # game.py / admin.py / ws.py            [2]
│   └── tests/test_game.py     # 규칙·흐름·WebSocket·관리자 테스트     [4]
├── frontend/
│   ├── .env / .env.example
│   └── src/
│       ├── game/engine.js     # Three.js 1인칭 엔진 (테마별 공간·조명·이벤트) [3]
│       ├── game/textures.js   # 절차적 텍스처 (콘크리트, 사암, 핏자국 ...) [3]
│       ├── game/audio.js      # Web Audio 합성 배경음·효과음            [3]
│       ├── game/themeCopy.ts  # 테마별 화면 문구                        [4]
│       ├── game/engine.d.ts   # 엔진 타입 선언                        [3]
│       ├── pages/Lobby.tsx    # 테마/방 개수/시간 선택, 방 코드 참가   [3]
│       ├── pages/Game.tsx     # 게임 화면 조립 (HUD, 창, 엔진 연결)     [3]
│       ├── hooks/             # useGameSocket(협동), useCountdown(타이머) [3]
│       ├── settings.ts        # 플레이어 설정 저장                      [3]
│       ├── components/        # PuzzleModal, ClueDoc, MiniMap, MiniStrip, InventoryPanel,
│       │                      # ChatPanel, PauseMenu, WaitingRoom, ResultScreen,
│       │                      # AdminPanel, RoomLayoutEditor           [3]
│   └── e2e/play.cjs           # 화면 자동 테스트                        [4]
│       ├── components/minigames/  # Sequence / Wires / Timing 게임    [3]
│       ├── api/client.ts      # REST 클라이언트                       [3]
│       ├── api/socket.ts      # WebSocket 클라이언트 (자동 재연결)    [3]
│       └── types.ts           # 공용 타입                             [3]
└── README.md
```
[1] AI·프롬프트 · [2] 게임 로직·백엔드 · [3] 프론트엔드 · [4] 콘텐츠 통합·QA

---

## 5. API 요약

### 플레이어
| Method | Path | 설명 |
|---|---|---|
| GET | `/api/config` | 방 개수/시간 범위, AI 모드 |
| GET | `/api/themes` | 테마 목록 |
| POST | `/api/sessions` | `{theme_key, room_count, time_limit_min}` → 세션 생성 |
| GET | `/api/sessions/{id}` | 세션 상태 (남은 시간, 방 상태). 잠긴 방 문제는 비공개 |
| POST | `/api/sessions/{id}/rooms/{slot}/answer` | `{answer, player_name}` |
| POST | `/api/sessions/{id}/rooms/{slot}/hint` | `{level}` → AI 힌트 |
| POST | `/api/sessions/{id}/rooms/{slot}/clues/{clue_id}/inspect` | 단서 조사 → 인벤토리 추가 |
| POST | `/api/sessions/{id}/rooms/{slot}/minigame/start` | 미니게임 문제 받기 |
| POST | `/api/sessions/{id}/rooms/{slot}/minigame/finish` | `{challenge_id, result}` → 성공 시 열쇠 |
| POST | `/api/sessions/{id}/rooms/{slot}/use-key` | 문에 열쇠 사용 → 조건 충족 시 클리어 |

### 관리자 (헤더 `X-Admin-Token`)
| Method | Path | 설명 |
|---|---|---|
| POST | `/api/admin/login` | `{password}` → token |
| GET | `/api/admin/themes` | 정답·힌트 포함 전체 |
| POST | `/api/admin/themes` | 새 컨셉 생성 + AI가 방 5개 자동 생성 |
| PUT | `/api/admin/themes/{id}` | 이름/설명/스타일(색상·장식·밝기) |
| PUT | `/api/admin/rooms/{id}` | 방·퍼즐·`clues`·`minigame` 수정 (`remove_minigame`, `source: admin \| ai`) |
| POST | `/api/admin/ai/generate-room` | AI 초안 생성 (저장 X, 미리보기 후 적용) |
| POST | `/api/admin/sessions/{id}/time` | `{delta_min}` 시간 조정 |
| POST | `/api/admin/sessions/{id}/rooms/{slot}/unlock` | 방 강제 열기 |
| POST | `/api/admin/sessions/{id}/reset` | 세션 초기화 |
| GET | `/api/admin/logs` | 편집 이력 (admin / ai) |

편집 내용은 `content_updated` 메시지로 **진행 중인 모든 세션에 즉시 반영**됩니다 (3D 방 이름표·색상 포함).

### WebSocket `ws://host/ws/{session_id}?name=닉네임`
| 방향 | type | 내용 |
|---|---|---|
| C→S | `move` | `{position:[x,y,z], rotation, slot}` (80ms 간격) |
| C→S | `chat` / `ping` | `{text}` |
| S→C | `welcome` | `{player_id, players}` |
| S→C | `player_joined` / `player_left` / `player_moved` | 팀원 동기화 |
| S→C | `chat` | 채팅 + 시스템 메시지 |
| S→C | `room_cleared` / `hint_used` | 팀 알림 (단서 발견·열쇠 획득은 시스템 chat) |
| S→C | `state_changed` / `content_updated` | 클라이언트가 세션 재조회 |

---

## 6. AI 연동 (구성원 1)

- 현재 `AI_PROVIDER=mock`: 카이사르 암호·수열·수수께끼·색 코드 퍼즐을 규칙 기반으로 생성하며, **퍼즐 정보를 2~3개 단서로 나누고** 50% 확률(최종 방은 항상)로 미니게임을 붙입니다. 힌트는 DB 힌트 → "정답 N글자, ○로 시작" 순.
- 실제 LLM 은 `prompts/generate_room.txt` 의 JSON 형식(단서·미니게임 포함)으로 방을 만들고, 형식이 틀리면 mock 으로 대체됩니다.
- 실제 LLM 연결: `backend/.env` 에서 `AI_PROVIDER=claude`, `AI_API_KEY=...` 입력. 호출이 실패하면 자동으로 mock 으로 대체되어 게임은 멈추지 않습니다.
- 다른 LLM 사용 시 `ai_service.py` 의 `AIProvider.complete()` 만 구현하면 됩니다.
- 프롬프트 수정은 `backend/app/prompts/*.txt` 에서 (코드 수정 불필요).

---

## 7. 2주 일정 제안

| 기간 | [1] AI·프롬프트 | [2] 로직·백엔드 | [3] 프론트 | [4] 콘텐츠·QA |
|---|---|---|---|---|
| 1~2일 | 실행 환경 통일, 코드 리딩, 역할 확정 ||||
| 3~5일 | 프롬프트 튜닝, 퍼즐 유형 확장 | 점수/랭킹, 퍼즐 유형 추가(다단계) | 3D 모델·텍스처, 사운드 | 10개 방 퍼즐 검수, 테스트 케이스 |
| 6~8일 | 실 API 연동, 응답 JSON 검증 | 협동 퍼즐(동시 조작), 재접속 처리 | 지도/HUD 고도화, 모바일 대응 | 통합 시나리오 테스트 |
| 9~11일 | 난이도별 힌트, 비용 제한 | 관리자 인증 강화, 배포 | 연출(문 열림, 탈출 엔딩) | 밸런스(시간·난이도) 조정 |
| 12~14일 | 버그 수정 · 리허설 · 발표 자료 ||||

### 다음에 확장하면 좋은 것
- 단서 사이 의존 (예: 서랍 열쇠로 상자 열기), 숨겨진 단서 (특정 단서를 찾아야 나타남)
- 미니게임 추가 (슬라이드 퍼즐, 빛 반사 등): `minigames.py` 에 type 추가 + `components/minigames/` 에 컴포넌트 추가
- 협동 미니게임 (두 명이 동시에 다른 버튼)
- 관리자 토큰을 DB/JWT 로 (현재는 서버 메모리 → 재시작 시 재로그인)
- 3D 모델(GLTF) 로드: `engine.js` 의 `_buildPuzzleObject`, `_buildDecor` 교체
- 개발 모드에서 브라우저 콘솔 `window.__escapeEngine` 으로 엔진 상태 확인 가능 (QA용)
