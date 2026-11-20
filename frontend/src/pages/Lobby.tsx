import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api/client';
import { DIFFICULTY_LABEL } from '../types';
import type { Difficulty, GameConfig, RoomBrief, ThemeSummary } from '../types';
import type { JoinInfo } from '../App';
import { glyphBandDataURL, noiseDataURL } from '../game/textures';

interface Props {
  onJoin: (info: JoinInfo) => void;
}

const NAME_KEY = 'escape-player-name';
const TIME_PRESETS = [30, 60, 90, 120];
const MINIGAME_LABEL = { sequence: '기억력', wires: '전선 연결', timing: '타이밍' } as const;
const THEME_META: Record<string, { icon: string; mood: string; tags: string[] }> = {
  study: { icon: '🕯️', mood: '추리 공포', tags: ['1998', '살인사건', '저택'] },
  server: { icon: '☣️', mood: '공포', tags: ['해킹', '바이러스', '어둠'] },
  pillar: { icon: '🏺', mood: '모험', tags: ['파라오', '수수께끼', '보물'] },
  none: { icon: '🚪', mood: '커스텀', tags: ['AI 생성'] },
};
const NOISE = noiseDataURL(200, 0.6);
const GRIT = noiseDataURL(160, 0.1);
const GLYPH_BAND = glyphBandDataURL();

/** 선택한 테마에 따라 바뀌는 로비 문구 */
const LOBBY_COPY: Record<string, { badge: string; sub: string[]; start: string; features: { icon: string; title: string; text: string }[]; log?: string[] }> = {
  study: {
    badge: 'CASE FILE · 1998.11.17 · 23:47',
    sub: ['비가 그치지 않던 밤, 와인 수집가 한도윤이 서재에서 숨진 채 발견됐다.', '그가 남긴 쪽지와 멈춘 시계가, 24년 전 사라진 동업자 J를 가리킨다.'],
    start: '저택에 들어간다',
    features: [
      { icon: '📱', title: '피해자의 휴대폰', text: '잠금화면·통화 기록·메모를 직접 읽어라' },
      { icon: '📖', title: '일기장과 책장', text: '지운 글씨와 금박 숫자 책에 길이 숨어 있다' },
      { icon: '🕰️', title: '멈춘 시계', text: '11시 47분. 그가 쓰러진 순간이 열쇠다' },
      { icon: '🖼️', title: '초상화', text: '액자를 너무 오래 바라보지 마라' },
    ],
  },
  server: {
    badge: '⚠ 격리 프로토콜 가동 중 · 생존자 신호 감지',
    sub: ['정신을 차려 보니 서버실 바닥이었다. 비상등만 붉게 깜빡인다.', '이 건물 안에, 당신 말고 무언가가 있다.'],
    start: '들어간다',
    features: [
      { icon: '🔦', title: '손전등 하나', text: '어둠 속을 비춰 증거를 찾아라. 배터리는 믿을 수 없다' },
      { icon: '🖥', title: '감염된 단말기', text: '흩어진 메모를 조합해 보안 코드를 풀어라' },
      { icon: '⚡', title: '제어 패널', text: '끊어진 전선을 잇고 금고를 열어 카드키를 얻어라' },
      { icon: '👁', title: '그것', text: '불이 꺼지면, 뒤를 보지 마라' },
    ],
    log: ['[03:17:42] 격리 프로토콜 가동', '[03:17:44] 생존자 신호 1건 감지 — 서버실 B-2', '[03:17:45] 출입 통제 해제 실패', '[03:17:51] 미확인 개체 이동 감지'],
  },
  pillar: {
    badge: '𓂀 기원전 1323년 · 봉인된 왕의 무덤',
    sub: ['도굴꾼의 지도는 여기서 끝난다. 등 뒤로 돌문이 내려앉았다.', '횃불이 꺼지기 전에, 신들의 시험을 통과하라.'],
    start: '봉인을 연다',
    features: [
      { icon: '🔥', title: '횃불', text: '흔들리는 불빛 아래 숨겨진 상형문자를 읽어라' },
      { icon: '☥', title: '신성한 비문', text: '파피루스와 석판의 단서로 제단의 답을 새겨라' },
      { icon: '⚖', title: '신의 시험', text: '심판의 저울과 기억의 문양을 넘어 열쇠를 얻어라' },
      { icon: '⏳', title: '모래시계', text: '모래가 다 떨어지면 무덤은 다시 봉인된다' },
    ],
  },
  none: {
    badge: 'ESCAPE ROOM',
    sub: ['단서를 찾고, 미니게임으로 열쇠를 얻고, 제한 시간 안에 빠져나가세요.', 'AI가 만든 방에서 친구와 함께 협동할 수 있습니다.'],
    start: '게임 시작',
    features: [
      { icon: '🔎', title: '단서 탐색', text: '방 곳곳의 물건을 직접 조사해 퍼즐 조각을 모으세요' },
      { icon: '🎮', title: '미니게임', text: '기억력·전선·타이밍 게임을 통과해 열쇠를 얻으세요' },
      { icon: '👥', title: '실시간 협동', text: '방 코드 하나로 친구와 같은 공간에서 탈출하세요' },
      { icon: '🤖', title: 'AI 퍼즐', text: 'AI가 새로운 방과 힌트를 만들어 냅니다' },
    ],
  },
};
const RANDOM_NAMES = ['그림자', '탐정', '도굴꾼', '해커', '모험가', '방랑자', '수집가', '관찰자'];

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(v: string) {
  try {
    localStorage.setItem(NAME_KEY, v);
  } catch {
    /* storage 차단 환경 */
  }
}

const DIFFICULTY_KEY = 'escape.difficulty';
const DIFFICULTY_DESC: Record<Difficulty, string> = {
  easy: '단서가 친절하고 힌트가 많아요 · 힌트 감점 절반',
  normal: '단서를 조합해 규칙을 한 번 적용',
  hard: '함정 단서와 여러 단계 추론 · 힌트 감점 1.5배',
};
function loadDifficulty(): Difficulty {
  try {
    const v = localStorage.getItem(DIFFICULTY_KEY);
    if (v === 'easy' || v === 'normal' || v === 'hard') return v;
  } catch {
    /* 저장 불가 환경 */
  }
  return 'normal';
}

/** 세션에 실제로 배치될 방 (백엔드 select_rooms 와 동일 규칙: 입구·최종 고정, 중간은 순서대로) */
function pickRooms<T>(rooms: T[], count: number): T[] {
  if (rooms.length < 2) return rooms;
  return [rooms[0], ...rooms.slice(1, -1).slice(0, count - 2), rooms[rooms.length - 1]];
}

/** 배경에 떠다니는 입자 (렌더마다 바뀌지 않도록 고정 시드) */
const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: -((i * 7) % 18),
  duration: 12 + ((i * 13) % 14),
  size: 2 + ((i * 5) % 4),
}));

export default function Lobby({ onJoin }: Props) {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [name, setName] = useState(loadName);
  const [themeKey, setThemeKey] = useState('');
  const [roomCount, setRoomCount] = useState(4);
  const [timeMin, setTimeMin] = useState(60);
  const [difficulty, setDifficulty] = useState<Difficulty>(loadDifficulty);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 터치 전용 기기(휴대폰·태블릿)는 키보드·마우스 조작이 불가능하므로 안내
  const touchOnly = typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

  useEffect(() => {
    Promise.all([api.config(), api.themes()])
      .then(([cfg, list]) => {
        setConfig(cfg);
        setRoomCount(cfg.default_rooms);
        setTimeMin(cfg.default_time_min);
        setThemes(list);
        if (list[0]) setThemeKey(list[0].key);
      })
      .catch((e) => setError(`서버에 연결할 수 없습니다: ${e.message} (백엔드가 켜져 있는지 확인하세요)`));
  }, []);

  const selected = themes.find((t) => t.key === themeKey);
  const decor = selected?.style.decor ?? 'none';
  const lc = LOBBY_COPY[decor] ?? LOBBY_COPY.none;

  const route: RoomBrief[] = useMemo(() => {
    if (!selected) return [];
    const rooms = selected.rooms?.length
      ? selected.rooms
      : selected.room_names.map((n) => ({ name: n, has_puzzle: true, clue_count: 0, minigame: null }));
    return pickRooms(rooms, roomCount);
  }, [selected, roomCount]);

  // 게임마다 AI 가 문제를 새로 만들면 방 이름·단서는 시작해야 알 수 있다
  const aiRandom = !!config?.ai_random_rooms;
  const aiLeft = config?.ai_calls_left ?? null;
  const aiLow = aiRandom && aiLeft !== null && aiLeft < roomCount; // 이번 게임을 AI 로 만들 한도가 부족
  const aiShow = aiRandom && !aiLow; // 이번 게임 방을 AI 가 만들 예정 → 기본 방 이름 대신 'AI 생성' 표시
  const minigameCount = route.filter((r) => r.minigame).length;
  const clueCount = route.reduce((n, r) => n + r.clue_count, 0);
  const minPerRoom = Math.round(timeMin / Math.max(1, route.length));

  // 선택한 테마 색을 CSS 변수로 → 배경·버튼·강조색이 테마를 따라감
  const themeVars = {
    '--accent': selected?.style.accent ?? '#7c4dff',
    '--glow': selected?.style.light ?? '#7c4dff',
    '--fog': selected?.style.fog ?? '#0d0f12',
    '--wall': selected?.style.wall ?? '#1a1d22',
    '--noise': `url(${NOISE})`,
    '--grit': `url(${GRIT})`,
    '--glyphs': `url(${GLYPH_BAND})`,
  } as CSSProperties;

  function chooseDifficulty(d: Difficulty) {
    setDifficulty(d);
    try {
      localStorage.setItem(DIFFICULTY_KEY, d);
    } catch {
      /* 저장 불가 환경 */
    }
  }

  function updateName(v: string) {
    setName(v);
    saveName(v);
  }

  const playerName = () => name.trim() || `플레이어${Math.floor(Math.random() * 900 + 100)}`;

  async function create() {
    setBusy(true);
    setError('');
    try {
      const s = await api.createSession(themeKey, roomCount, timeMin, difficulty);
      onJoin({ sessionId: s.id, playerName: playerName() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setError('');
    try {
      await api.getSession(code);
      onJoin({ sessionId: code, playerName: playerName() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`lobby2 decor-${decor}`} style={themeVars}>
      {/* ---------- 움직이는 배경 ---------- */}
      <div className="lobby-bg" aria-hidden>
        <div className="glow glow-a" />
        <div className="glow glow-b" />
        <div className="particles">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              style={{ left: `${p.left}%`, width: p.size, height: p.size, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }}
            />
          ))}
        </div>
        <div className="scanlines" />
        <div className="grain" />
        <div className="vignette" />
      </div>
      {decor === 'server' && (
        <svg className="blood-drips" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden>
          <path d="M0 0H1200V18C1150 22 1140 70 1128 72 1116 74 1112 26 1060 24 1010 22 1000 96 986 98 972 100 968 30 900 26 840 22 836 58 826 60 816 62 806 24 740 22 680 20 676 110 662 112 648 114 640 30 560 26 500 22 496 64 486 66 476 68 466 24 400 22 340 20 330 84 318 86 306 88 300 28 230 24 170 20 164 50 156 52 148 54 140 22 80 20 30 18 24 76 14 78 6 80 2 30 0 24Z" />
        </svg>
      )}
      {decor === 'study' && (
        <>
          <div className="rain" aria-hidden />
          <div className="lightning" aria-hidden />
          <div className="candle-glow left" aria-hidden />
          <div className="candle-glow right" aria-hidden />
        </>
      )}
      {decor === 'pillar' && (
        <>
          <div className="glyph-band top" aria-hidden />
          <div className="torch-glow left" aria-hidden />
          <div className="torch-glow right" aria-hidden />
        </>
      )}

      <div className="lobby-inner">
        {/* ---------- 히어로 ---------- */}
        <header className="hero">
          <div className="hero-badge">{lc.badge}</div>
          <h1 className="hero-title" data-text="AI 방탈출">
            AI 방탈출
          </h1>
          <p className="hero-sub">
            {lc.sub[0]}
            <br />
            {lc.sub[1]}
          </p>
          {lc.log && (
            <div className="sys-log" aria-hidden>
              {lc.log.map((l, i) => (
                <div key={l} style={{ animationDelay: `${0.3 + i * 0.7}s` }}>
                  {l}
                </div>
              ))}
            </div>
          )}
          <div className="features">
            {lc.features.map((f) => (
              <div key={f.title} className="feature">
                <span className="feature-icon">{f.icon}</span>
                <b>{f.title}</b>
                <small>{f.text}</small>
              </div>
            ))}
          </div>
        </header>

        <div className="lobby-grid">
          {/* ---------- 새 게임 ---------- */}
          <section className="glass setup">
            <h2>
              <span className="step">1</span> 플레이어
            </h2>
            <div className="name-row">
              <input value={name} maxLength={20} placeholder="닉네임 입력" onChange={(e) => updateName(e.target.value)} />
              <button
                className="icon-btn"
                title="랜덤 닉네임"
                onClick={() => updateName(`${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}${Math.floor(Math.random() * 90 + 10)}`)}
              >
                🎲
              </button>
            </div>

            <h2>
              <span className="step">2</span> 테마 선택
            </h2>
            <div className="theme-cards">
              {themes.map((t) => {
                const m = THEME_META[t.style.decor] ?? THEME_META.none;
                const games = t.rooms?.filter((r) => r.minigame).length ?? 0;
                const clues = t.rooms?.reduce((n, r) => n + r.clue_count, 0) ?? 0;
                return (
                  <button
                    key={t.key}
                    className={`tcard tcard-${t.style.decor} ${t.key === themeKey ? 'active' : ''}`}
                    style={{ '--c': t.style.accent, '--bg1': t.style.fog, '--bg2': t.style.wall } as CSSProperties}
                    onClick={() => setThemeKey(t.key)}
                  >
                    <span className="tcard-icon">{m.icon}</span>
                    <span className="tcard-body">
                      <strong>{t.name}</strong>
                      <span className="tcard-desc">{t.description}</span>
                      <span className="tags">
                        {m.tags.map((tag) => (
                          <i key={tag}>#{tag}</i>
                        ))}
                      </span>
                      <span className="tcard-stats">
                        {aiShow ? `🚪 방 ${t.room_names.length} · 🎲 문제는 게임마다 AI 생성` : `🚪 방 ${t.room_names.length} · 🔎 단서 ${clues} · 🎮 미니게임 ${games}`}
                      </span>
                    </span>
                    {t.key === themeKey && <span className="tcard-check">✓</span>}
                  </button>
                );
              })}
            </div>

            <h2>
              <span className="step">3</span> 난이도 설정
            </h2>
            {config && (
              <div className="settings">
                <div className="setting">
                  <span className="setting-label">
                    문제 난이도 <b>{DIFFICULTY_LABEL[difficulty]}</b>{' '}
                    <small className="muted">· {DIFFICULTY_DESC[difficulty]}</small>
                  </span>
                  <div className="segmented">
                    {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
                      <button key={d} className={d === difficulty ? 'on' : ''} onClick={() => chooseDifficulty(d)}>
                        {DIFFICULTY_LABEL[d]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting">
                  <span className="setting-label">방 개수</span>
                  <div className="segmented">
                    {Array.from({ length: config.max_rooms - config.min_rooms + 1 }, (_, i) => config.min_rooms + i).map((n) => (
                      <button key={n} className={n === roomCount ? 'on' : ''} onClick={() => setRoomCount(n)}>
                        {n}
                        {n === config.default_rooms && <small>기본</small>}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting">
                  <span className="setting-label">
                    제한 시간 <b>{timeMin}분</b> <small className="muted">· 방당 약 {minPerRoom}분</small>
                  </span>
                  <div className="segmented">
                    {TIME_PRESETS.map((m) => (
                      <button key={m} className={m === timeMin ? 'on' : ''} onClick={() => setTimeMin(m)}>
                        {m === 120 ? '2시간' : `${m}분`}
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    className="time-range"
                    min={config.min_time_min}
                    max={config.max_time_min}
                    step={5}
                    value={timeMin}
                    onChange={(e) => setTimeMin(Number(e.target.value))}
                  />
                </div>
              </div>
            )}

            {/* 탈출 경로 */}
            {route.length > 0 && (
              <div className="route2">
                <div className="route2-head">
                  <span>탈출 경로</span>
                  <small>
                    {aiLow
                      ? '⚠️ 오늘 AI 한도가 부족해 기본 방으로 진행돼요'
                      : aiRandom
                        ? '🎲 게임마다 AI가 새 문제를 만들어요'
                        : `🔎 단서 ${clueCount} · 🎮 미니게임 ${minigameCount}`}
                  </small>
                </div>
                <ol>
                  {route.map((r, i) => {
                    const last = i === route.length - 1;
                    return (
                      <li key={`${r.name}-${i}`} className={last ? 'final' : ''} style={{ animationDelay: `${i * 70}ms` }}>
                        <span className="node">{last ? '🚪' : i + 1}</span>
                        <span className="room-name">{aiShow ? (last ? '최종 탈출 방 · AI 생성' : `${i + 1}번째 방 · AI 생성`) : r.name}</span>
                        {!aiShow && (
                          <span className="room-icons">
                            {r.clue_count > 0 && <i title={`단서 ${r.clue_count}개`}>🔎{r.clue_count}</i>}
                            {r.has_puzzle && <i title="암호">🔐</i>}
                            {r.minigame && <i title={`미니게임: ${MINIGAME_LABEL[r.minigame]}`}>🎮</i>}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <button className="start-btn" disabled={busy || !themeKey} onClick={create}>
              {busy ? (aiShow ? `AI가 이번 게임의 방을 만드는 중... (최대 ${config?.ai_wait_sec ?? 30}초)` : '방을 준비하는 중...') : lc.start}
            </button>
          </section>

          <aside className="side">
            {/* ---------- 협동 참가 ---------- */}
            <section className="glass join">
              <h2>👥 친구 방 참가</h2>
              <p className="muted">친구 화면 오른쪽 위의 6자리 방 코드를 입력하세요.</p>
              <input
                className="code-input"
                value={joinCode}
                maxLength={6}
                placeholder="A1B2C3"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && join()}
              />
              <button className="join-btn" disabled={busy || joinCode.trim().length < 6} onClick={join}>
                참가하기
              </button>
            </section>

            {/* ---------- 플레이 방법 ---------- */}
            <section className="glass howto">
              <h2>📜 플레이 방법</h2>
              <ol>
                <li>
                  <b>✨ 반짝이는 물건 조사</b>
                  <small>E 키로 단서를 모으면 팀 인벤토리(I)에 공유돼요</small>
                </li>
                <li>
                  <b>🔐 단말기·제단의 암호 풀기</b>
                  <small>모은 단서를 조합해 정답을 입력하세요</small>
                </li>
                <li>
                  <b>🎮 미니게임 → 🔑 → 🚪</b>
                  <small>열쇠를 얻어 문에 사용하면 다음 방이 열려요</small>
                </li>
              </ol>
              <div className="keys">
                <kbd>WASD</kbd> 이동 <kbd>E</kbd> 조사 <kbd>I</kbd> 인벤토리 <kbd>M</kbd> 지도
              </div>
            </section>
          </aside>
        </div>

        {touchOnly && (
          <p className="lobby-error device-note">
            📱 이 게임은 <b>키보드와 마우스</b>로 조작하는 PC용 3D 게임입니다. 휴대폰·태블릿에서는 로비만 이용할 수 있어요.
          </p>
        )}
        {error && <p className="lobby-error">⚠️ {error}</p>}
        <footer className="lobby-footer">
          {config && (
            <span>
              AI 모드 <b>{config.ai_provider}</b>
              {config.ai_random_rooms && ' · 🎲 게임마다 새 문제'}
              {aiLeft !== null && ` · 오늘 남은 AI 호출 ${aiLeft}회`}
            </span>
          )}
          <span>React · Three.js · FastAPI · WebSocket</span>
        </footer>
      </div>
    </div>
  );
}
