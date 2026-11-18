import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api/client';
import type { GameConfig, RoomBrief, ThemeSummary } from '../types';
import type { JoinInfo } from '../App';

interface Props {
  onJoin: (info: JoinInfo) => void;
}

const NAME_KEY = 'escape-player-name';
const TIME_PRESETS = [30, 60, 90, 120];
const MINIGAME_LABEL = { sequence: '기억력', wires: '전선 연결', timing: '타이밍' } as const;
const THEME_META: Record<string, { icon: string; mood: string; tags: string[] }> = {
  server: { icon: '☣️', mood: '공포', tags: ['해킹', '바이러스', '어둠'] },
  pillar: { icon: '🏺', mood: '모험', tags: ['고대 이집트', '수수께끼', '보물'] },
  none: { icon: '🚪', mood: '커스텀', tags: ['AI 생성'] },
};
const FEATURES = [
  { icon: '🔎', title: '단서 탐색', text: '방 곳곳의 물건을 직접 조사해 퍼즐 조각을 모으세요' },
  { icon: '🎮', title: '미니게임', text: '기억력·전선·타이밍 게임을 통과해 열쇠를 얻으세요' },
  { icon: '👥', title: '실시간 협동', text: '방 코드 하나로 친구와 같은 공간에서 탈출하세요' },
  { icon: '🤖', title: 'AI 퍼즐', text: 'AI가 새로운 방과 힌트를 만들어 냅니다' },
];
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
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
  const meta = THEME_META[decor] ?? THEME_META.none;

  const route: RoomBrief[] = useMemo(() => {
    if (!selected) return [];
    const rooms = selected.rooms?.length
      ? selected.rooms
      : selected.room_names.map((n) => ({ name: n, has_puzzle: true, clue_count: 0, minigame: null }));
    return pickRooms(rooms, roomCount);
  }, [selected, roomCount]);

  const minigameCount = route.filter((r) => r.minigame).length;
  const clueCount = route.reduce((n, r) => n + r.clue_count, 0);
  const minPerRoom = Math.round(timeMin / Math.max(1, route.length));

  // 선택한 테마 색을 CSS 변수로 → 배경·버튼·강조색이 테마를 따라감
  const themeVars = {
    '--accent': selected?.style.accent ?? '#7c4dff',
    '--glow': selected?.style.light ?? '#7c4dff',
    '--fog': selected?.style.fog ?? '#0d0f12',
    '--wall': selected?.style.wall ?? '#1a1d22',
  } as CSSProperties;

  function updateName(v: string) {
    setName(v);
    saveName(v);
  }

  const playerName = () => name.trim() || `플레이어${Math.floor(Math.random() * 900 + 100)}`;

  async function create() {
    setBusy(true);
    setError('');
    try {
      const s = await api.createSession(themeKey, roomCount, timeMin);
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
        <div className="vignette" />
      </div>

      <div className="lobby-inner">
        {/* ---------- 히어로 ---------- */}
        <header className="hero">
          <div className="hero-badge">
            {meta.icon} {selected ? `${meta.mood} 테마 선택됨` : 'ESCAPE ROOM'}
          </div>
          <h1 className="hero-title" data-text="AI 방탈출">
            AI 방탈출
          </h1>
          <p className="hero-sub">
            단서를 찾고, 미니게임으로 열쇠를 얻고, 제한 시간 안에 빠져나가세요.
            <br />
            AI가 만든 방에서 친구와 함께 협동할 수 있습니다.
          </p>
          <div className="features">
            {FEATURES.map((f) => (
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
                    className={`tcard ${t.key === themeKey ? 'active' : ''}`}
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
                        🚪 방 {t.room_names.length} · 🔎 단서 {clues} · 🎮 미니게임 {games}
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
                    🔎 단서 {clueCount} · 🎮 미니게임 {minigameCount}
                  </small>
                </div>
                <ol>
                  {route.map((r, i) => {
                    const last = i === route.length - 1;
                    return (
                      <li key={`${r.name}-${i}`} className={last ? 'final' : ''} style={{ animationDelay: `${i * 70}ms` }}>
                        <span className="node">{last ? '🚪' : i + 1}</span>
                        <span className="room-name">{r.name}</span>
                        <span className="room-icons">
                          {r.clue_count > 0 && <i title={`단서 ${r.clue_count}개`}>🔎{r.clue_count}</i>}
                          {r.has_puzzle && <i title="암호">🔐</i>}
                          {r.minigame && <i title={`미니게임: ${MINIGAME_LABEL[r.minigame]}`}>🎮</i>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <button className="start-btn" disabled={busy || !themeKey} onClick={create}>
              {busy ? '방을 준비하는 중...' : '▶ 게임 시작'}
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

        {error && <p className="lobby-error">⚠️ {error}</p>}
        <footer className="lobby-footer">
          {config && (
            <span>
              AI 모드 <b>{config.ai_provider}</b>
            </span>
          )}
          <span>React · Three.js · FastAPI · WebSocket</span>
        </footer>
      </div>
    </div>
  );
}
