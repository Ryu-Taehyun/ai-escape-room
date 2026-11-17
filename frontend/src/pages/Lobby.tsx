import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { GameConfig, ThemeSummary } from '../types';
import type { JoinInfo } from '../App';

interface Props {
  onJoin: (info: JoinInfo) => void;
}

export default function Lobby({ onJoin }: Props) {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [name, setName] = useState('');
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
      .catch((e) => setError(`서버에 연결할 수 없습니다: ${e.message}`));
  }, []);

  const playerName = name.trim() || `플레이어${Math.floor(Math.random() * 900 + 100)}`;
  const selected = themes.find((t) => t.key === themeKey);

  // 세션에 실제로 배치될 방 미리보기 (백엔드 select_rooms 와 동일 규칙)
  const preview = selected
    ? [selected.room_names[0], ...selected.room_names.slice(1, -1).slice(0, roomCount - 2), selected.room_names.at(-1)!]
    : [];

  async function create() {
    setBusy(true);
    setError('');
    try {
      const s = await api.createSession(themeKey, roomCount, timeMin);
      onJoin({ sessionId: s.id, playerName });
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
      onJoin({ sessionId: code, playerName });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lobby">
      <h1>AI 방탈출</h1>
      <p className="sub">AI가 만든 퍼즐을 풀고 제한 시간 안에 탈출하세요. 친구와 방 코드로 협동할 수 있습니다.</p>

      <section className="card">
        <label>
          닉네임
          <input value={name} maxLength={20} placeholder="닉네임 입력" onChange={(e) => setName(e.target.value)} />
        </label>
      </section>

      <section className="card">
        <h2>새 게임 만들기</h2>
        <div className="theme-grid">
          {themes.map((t) => (
            <button
              key={t.key}
              className={`theme-card ${t.key === themeKey ? 'active' : ''}`}
              style={{ borderColor: t.style.accent, background: `linear-gradient(160deg, ${t.style.fog}, ${t.style.wall})` }}
              onClick={() => setThemeKey(t.key)}
            >
              <strong style={{ color: t.style.accent }}>{t.name}</strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>

        {config && (
          <>
            <label>
              방 개수: <b>{roomCount}개</b>
              <input
                type="range"
                min={config.min_rooms}
                max={config.max_rooms}
                value={roomCount}
                onChange={(e) => setRoomCount(Number(e.target.value))}
              />
            </label>
            <label>
              제한 시간: <b>{timeMin}분</b>
              <input
                type="range"
                min={config.min_time_min}
                max={config.max_time_min}
                step={5}
                value={timeMin}
                onChange={(e) => setTimeMin(Number(e.target.value))}
              />
            </label>
          </>
        )}

        {preview.length > 0 && (
          <ol className="route">
            {preview.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        )}

        <button className="primary" disabled={busy || !themeKey} onClick={create}>
          게임 시작
        </button>
      </section>

      <section className="card">
        <h2>협동 참가</h2>
        <div className="row">
          <input
            value={joinCode}
            maxLength={6}
            placeholder="방 코드 6자리"
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
          />
          <button disabled={busy} onClick={join}>
            참가
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      {config && <p className="muted">AI 모드: {config.ai_provider}</p>}
    </div>
  );
}
