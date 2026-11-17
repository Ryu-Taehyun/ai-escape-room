"""초기 테마/방 데이터 (DB가 비어 있을 때 삽입, 기존 DB는 seed 방만 자동 갱신).

방 하나의 구성
- question / answer : 단말기(제단) 퍼즐. answer 가 비어 있으면 퍼즐 없는 방
- clues             : 방 안에 흩어진 조사 오브젝트. 퍼즐 정보는 단서에 나뉘어 있음 (모험형)
    id     : 방 안에서 고유한 문자열
    label  : 3D 오브젝트 이름 (조준 시 표시)
    object : note | board | book | tablet | statue | jar | box   (3D 모양)
    pos    : [x, z] 방 중심 기준 좌표 (-4.3 ~ 4.3, 문 앞 |z|<1.2 & |x|>4 은 피할 것)
    text   : 조사하면 보이는 내용
- minigame          : null 이거나 {type, title, description, reward, difficulty}
    type   : sequence(기억력) | wires(전선 연결) | timing(타이밍)
    통과하면 reward 이름의 열쇠를 얻고, 문에서 열쇠를 사용해야 방이 클리어됨

방 클리어 조건 = (퍼즐이 있으면 정답) AND (미니게임이 있으면 열쇠 사용)
퍼즐은 다른 방 단서에 의존하지 않는다. (세션마다 2~5개 방을 골라 쓰기 때문)
"""

THEMES = [
    {
        "key": "horror",
        "name": "공포 - 감염된 데이터센터",
        "description": "정체불명의 해커가 장악한 데이터센터. 바이러스가 퍼지기 전에 통제실까지 도달해 탈출하라.",
        "style": {
            "wall": "#2b2f33",
            "floor": "#15171a",
            "light": "#ff4040",
            "fog": "#050607",
            "accent": "#00ff9c",
            "ambient": 0.12,
            "decor": "server",
        },
        "rooms": [
            {
                "name": "정체불명의 서버실",
                "description": "윙윙거리는 서버 랙 사이로 붉은 경고등이 깜빡인다. 보안 단말기가 코드를 요구한다.",
                "puzzle_type": "code",
                "question": "보안 단말기: '전원 LED 색상의 숫자를 부팅 순서대로 입력하시오. (4자리)'\n방 안을 조사해 색상별 숫자와 부팅 순서를 알아내야 한다.",
                "answer": "3142",
                "hints": ["방 안에 숫자가 적힌 단서가 2개, 순서가 적힌 단서가 1개 있습니다.", "빨강(3) → 초록(1) → ..."],
                "clues": [
                    {"id": "memo", "label": "찢어진 메모", "object": "note", "pos": [-3.0, 2.0],
                     "text": "피 묻은 메모 조각: '…빨강은 3, 초록은 1…'"},
                    {"id": "sticker", "label": "랙 측면 스티커", "object": "box", "pos": [2.6, 2.4],
                     "text": "관리 스티커: 'PWR LED — 파랑 = 4, 노랑 = 2'"},
                    {"id": "board", "label": "화이트보드", "object": "board", "pos": [-4.3, -2.6],
                     "text": "번진 글씨: '부팅 순서 — 빨강 → 초록 → 파랑 → 노랑'"},
                ],
                "minigame": None,
            },
            {
                "name": "해킹당한 관리자실",
                "description": "모니터마다 해커의 메시지가 떠 있다. 출입문은 보안 카드키 없이는 열리지 않는다.",
                "puzzle_type": "cipher",
                "question": "관리자 PC 로그인: 해커가 남긴 암호문을 해독한 영어 단어를 입력하라.",
                "answer": "HELP",
                "hints": ["모니터의 암호문과 해커 수첩의 규칙을 함께 보세요.", "K를 3칸 앞으로 되돌리면 H"],
                "clues": [
                    {"id": "postit", "label": "모니터 포스트잇", "object": "note", "pos": [-2.4, 2.6],
                     "text": "포스트잇: '해커가 남긴 암호문 = KHOS'"},
                    {"id": "notebook", "label": "해커의 수첩", "object": "book", "pos": [2.8, -1.8],
                     "text": "수첩: '모든 알파벳을 3칸씩 뒤로 밀었다. 되돌릴 수 있을까?'"},
                    {"id": "drawer", "label": "책상 서랍", "object": "box", "pos": [-3.6, -2.2],
                     "text": "관리자 메모: '출입문은 보안 카드키로만 열린다. 배전반 전선이 끊겨서 카드키 발급기가 멈췄다.'"},
                ],
                "minigame": {"type": "wires", "title": "끊어진 배전반 복구", "reward": "보안 카드키", "difficulty": 2,
                             "description": "같은 색 전선끼리 연결해 카드키 발급기 전원을 복구하라."},
            },
            {
                "name": "바이러스 감염 구역",
                "description": "감염 로그가 쉬지 않고 출력된다. 확산 예측치를 입력해야 격리문이 열린다.",
                "puzzle_type": "math",
                "question": "격리문 콘솔: '목표 시점의 예상 감염 파일 수를 입력하시오.'\n로그, 연구 노트, 벽의 경고문을 확인하라.",
                "answer": "64",
                "hints": ["시작 수, 증가 규칙, 목표 시간이 각각 다른 단서에 있습니다.", "1에서 시작해 2배씩 6번"],
                "clues": [
                    {"id": "log", "label": "감염 로그 출력물", "object": "note", "pos": [-2.8, 2.4],
                     "text": "로그: '00:00 — 최초 감염 파일 1개 확인'"},
                    {"id": "research", "label": "연구원 노트", "object": "book", "pos": [3.0, 2.0],
                     "text": "연구 노트: '이 바이러스는 1시간마다 감염 파일 수를 정확히 2배로 늘린다.'"},
                    {"id": "warning", "label": "벽의 경고문", "object": "board", "pos": [4.3, -2.6],
                     "text": "경고문: '격리문은 최초 감염 후 6시간 시점의 예측치로 잠겨 있다.'"},
                ],
                "minigame": None,
            },
            {
                "name": "폐쇄된 지하 통로",
                "description": "물이 고인 통로 끝에 녹슨 철문이 있다. 배수구 옆에 낡은 금고가 보인다.",
                "puzzle_type": "none",
                "question": "",
                "answer": "",
                "hints": ["금고(미니게임)에서 열쇠를 얻어 문에 사용하세요."],
                "clues": [
                    {"id": "graffiti", "label": "벽의 낙서", "object": "board", "pos": [-4.3, 2.6],
                     "text": "낙서: '비상구 열쇠는 배수구 옆 금고 안에 있다.'"},
                    {"id": "dial", "label": "금고 다이얼 자국", "object": "box", "pos": [-2.6, -2.6],
                     "text": "다이얼에 긁힌 자국: '불빛이 켜지는 순서를 기억해라. 한 번만 보여준다.'"},
                ],
                "minigame": {"type": "sequence", "title": "녹슨 금고 열기", "reward": "녹슨 비상구 열쇠", "difficulty": 2,
                             "description": "금고 불빛이 켜지는 순서를 기억해 똑같이 입력하라."},
            },
            {
                "name": "최종 탈출 통제실",
                "description": "모든 출입문을 제어하는 메인 콘솔. 방화벽을 뚫고 인증 코드를 입력하면 탈출이다.",
                "puzzle_type": "code",
                "question": "메인 콘솔: '최종 인증 코드를 입력하시오.'\n콘솔 매뉴얼과 방 안의 표지판을 조사하라.",
                "answer": "58",
                "hints": ["매뉴얼의 규칙을 비상구 표지판의 단어에 적용하세요.", "E=5, X=24, I=9, T=20"],
                "clues": [
                    {"id": "manual", "label": "콘솔 매뉴얼", "object": "book", "pos": [-2.8, 2.2],
                     "text": "매뉴얼: '인증 코드 = 출구 단어의 각 알파벳 순번(A=1, B=2 …)의 합'"},
                    {"id": "sign", "label": "비상구 표지판", "object": "board", "pos": [4.3, 2.6],
                     "text": "초록색 표지판에 크게 적혀 있다: 'EXIT'"},
                    {"id": "scrap", "label": "구겨진 쪽지", "object": "note", "pos": [2.6, -2.0],
                     "text": "쪽지: '방화벽부터 뚫어야 마스터 키가 나온다. 첫 글자 E는 5야, 나머지는 네가 계산해.'"},
                ],
                "minigame": {"type": "timing", "title": "방화벽 해킹", "reward": "마스터 키", "difficulty": 2,
                             "description": "움직이는 신호가 초록 구간에 들어올 때 정확히 멈춰라."},
            },
        ],
    },
    {
        "key": "egypt",
        "name": "이집트 - 파라오의 피라미드",
        "description": "도굴꾼의 지도를 따라 들어온 피라미드. 신들의 시험을 통과해 아누비스의 통로로 빠져나가라.",
        "style": {
            "wall": "#c9a66b",
            "floor": "#9c7a45",
            "light": "#ffc46b",
            "fog": "#2a1d0f",
            "accent": "#ffd700",
            "ambient": 0.3,
            "decor": "pillar",
        },
        "rooms": [
            {
                "name": "파라오의 입구",
                "description": "거대한 석판 문 앞의 제단. 입구 곳곳에 상형문자가 새겨져 있다.",
                "puzzle_type": "code",
                "question": "제단의 석판: '입구에 새겨진 모든 상형문자의 값을 더해 숫자로 새겨라.'",
                "answer": "1035",
                "hints": ["기호별 값은 석판에, 기호 개수는 벽화와 모자이크에 있습니다.", "1000 + 30 + 5"],
                "clues": [
                    {"id": "legend", "label": "해석 석판", "object": "tablet", "pos": [-2.8, 2.4],
                     "text": "석판: '연꽃 = 1000, 말발굽 = 10, 막대 = 1'"},
                    {"id": "mural", "label": "벽화", "object": "board", "pos": [-4.3, -2.6],
                     "text": "벽화: 태양 아래 연꽃 1송이가 피어 있다."},
                    {"id": "mosaic", "label": "바닥 모자이크", "object": "jar", "pos": [2.6, 2.0],
                     "text": "모자이크: 말발굽 3개와 막대 5개가 나란히 새겨져 있다."},
                ],
                "minigame": None,
            },
            {
                "name": "스핑크스의 수수께끼실",
                "description": "스핑크스 석상이 길을 막고 있다. 대답하지 못한 자는 돌아갈 수 없다.",
                "puzzle_type": "riddle",
                "question": "스핑크스: '나의 수수께끼의 답을 말하라.'\n방 안의 석상과 벽화를 조사하라.",
                "answer": "사람|인간|human|man",
                "hints": ["아침·점심·저녁은 하루가 아니라 일생입니다.", "노인의 세 번째 발은 지팡이"],
                "clues": [
                    {"id": "sphinx", "label": "스핑크스 석상", "object": "statue", "pos": [-2.6, 2.2],
                     "text": "석상에 새겨진 글: '아침에는 네 발, 점심에는 두 발, 저녁에는 세 발로 걷는 것은?'"},
                    {"id": "mural", "label": "일생의 벽화", "object": "board", "pos": [4.3, 2.6],
                     "text": "벽화: 기어가는 아기 → 걷는 청년 → 지팡이를 짚은 노인"},
                    {"id": "papyrus", "label": "파피루스", "object": "note", "pos": [2.4, -2.2],
                     "text": "파피루스: '답은 이 방에 들어온 자들 자신 안에 있다.'"},
                ],
                "minigame": None,
            },
            {
                "name": "오시리스의 심판 홀",
                "description": "심장의 무게를 다는 거대한 저울. 저울을 균형 잡아야 깃털 열쇠가 내려온다.",
                "puzzle_type": "logic",
                "question": "심판의 비문: '바칠 심장들의 무게 합을 새겨라.'\n저울, 깃털, 벽의 율법을 조사하라.",
                "answer": "4",
                "hints": ["깃털 무게보다 작은 심장만 고르세요.", "3 + 1"],
                "clues": [
                    {"id": "hearts", "label": "저울 위의 심장들", "object": "jar", "pos": [-2.6, 2.4],
                     "text": "네 개의 심장 항아리에 무게가 적혀 있다: 7, 3, 9, 1"},
                    {"id": "feather", "label": "마아트의 깃털", "object": "statue", "pos": [2.8, 2.2],
                     "text": "깃털 받침대: '진리의 깃털 무게 = 4'"},
                    {"id": "law", "label": "벽의 율법", "object": "board", "pos": [-4.3, -2.6],
                     "text": "율법: '깃털보다 가벼운 심장만을 모두 합하여 바쳐라.'"},
                ],
                "minigame": {"type": "timing", "title": "심판의 저울 균형", "reward": "마아트의 깃털 열쇠", "difficulty": 2,
                             "description": "흔들리는 저울 바늘이 중앙(초록)에 올 때 멈춰 균형을 맞춰라."},
            },
            {
                "name": "황금 보물 무덤",
                "description": "금·은·동 상자 세 개. 각 상자에 새겨진 문구 중 진실은 단 하나뿐이다.",
                "puzzle_type": "logic",
                "question": "무덤의 제단: '보물이 든 상자의 재질을 말하라. (금/은/동)'",
                "answer": "동|동상자|bronze",
                "hints": ["보물이 각 상자에 있다고 가정하고 참인 문장 개수를 세어 보세요.", "참인 문장이 정확히 1개인 경우"],
                "clues": [
                    {"id": "gold", "label": "금 상자", "object": "box", "pos": [-2.8, 2.4],
                     "text": "금 상자 문구: '보물은 여기 없다.'"},
                    {"id": "silver", "label": "은 상자", "object": "box", "pos": [0.0, 2.8],
                     "text": "은 상자 문구: '보물은 금 상자에 있다.'"},
                    {"id": "bronze", "label": "동 상자", "object": "box", "pos": [2.8, 2.4],
                     "text": "동 상자 문구: '보물은 여기 없다.'"},
                    {"id": "curse", "label": "저주의 비문", "object": "tablet", "pos": [-4.0, -2.4],
                     "text": "비문: '세 상자의 말 중 진실은 오직 하나. 틀린 상자를 여는 자는 저주받으리라.'"},
                ],
                "minigame": None,
            },
            {
                "name": "아누비스의 지하 통로",
                "description": "자칼 머리의 신 아누비스가 지키는 마지막 문. 출구의 빛이 새어 들어온다.",
                "puzzle_type": "math",
                "question": "아누비스의 문: '수수께끼의 답을 숫자로 새겨라.'",
                "answer": "30",
                "hints": ["이름의 글자 수 × 면의 수", "6 × 5"],
                "clues": [
                    {"id": "anubis", "label": "아누비스 석상", "object": "statue", "pos": [-2.6, 2.4],
                     "text": "석상의 글: '나의 이름의 글자 수 × 피라미드의 면의 수'"},
                    {"id": "nameplate", "label": "이름판", "object": "tablet", "pos": [2.8, 2.2],
                     "text": "이름판: 'A N U B I S'"},
                    {"id": "model", "label": "피라미드 모형", "object": "jar", "pos": [-3.0, -2.4],
                     "text": "모형 바닥의 글: '보이지 않는 밑면도 면이다.'"},
                ],
                "minigame": {"type": "sequence", "title": "아누비스의 기억 시험", "reward": "아누비스의 열쇠", "difficulty": 3,
                             "description": "신성한 문양이 빛나는 순서를 기억해 그대로 눌러라."},
            },
        ],
    },
]
