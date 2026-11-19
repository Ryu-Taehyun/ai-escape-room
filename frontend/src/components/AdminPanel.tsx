// 인게임 관리자 패널: 방 컨셉 편집 / AI 편집 / 세션 관리 / 편집 로그
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/client';
import type { Clue, ClueObject, EditLog, MinigameConfig, MinigameType, RoomDraft, RoomFull, SessionState, ThemeFull, ThemeStyle } from '../types';
import { safeStorage } from '../utils';
import RoomLayoutEditor from './RoomLayoutEditor';

interface Props {
  session: SessionState;
  onClose: () => void;
}

type Tab = 'concept' | 'ai' | 'session' | 'logs';
const TOKEN_KEY = 'escape-admin-token';

export default function AdminPanel({ session, onClose }: Props) {
  const [token, setToken] = useState<string>(() => safeStorage(TOKEN_KEY) ?? '');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<Tab>('concept');
  const [themes, setThemes] = useState<ThemeFull[]>([]);
  const [themeId, setThemeId] = useState<number>(session.theme.id);
  const [msg, setMsg] = useState('');

  const theme = themes.find((t) => t.id === themeId);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      setThemes(await adminApi.themes(token));
    } catch (e) {
      setMsg((e as Error).message);
      if ((e as Error).message.includes('인증')) {
        setToken('');
        safeStorage(TOKEN_KEY, '');
      }
    }
  }, [token]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function login() {
    try {
      const { token: t } = await adminApi.login(password);
      setToken(t);
      safeStorage(TOKEN_KEY, t);
      setMsg('');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg(`✔ ${ok}`);
      await reload();
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    }
  };

  return (
    <div className="overlay">
      <div className="panel admin">
        <div className="panel-head">
          <h2>🛠 관리자 모드</h2>
          <button onClick={onClose}>닫기</button>
        </div>

        {!token ? (
          <div className="row">
            <input
              type="password"
              autoFocus
              placeholder="관리자 비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
            />
            <button className="primary" onClick={login}>
              로그인
            </button>
          </div>
        ) : (
          <>
            <div className="tabs">
              {(
                [
                  ['concept', '방 컨셉 편집'],
                  ['ai', 'AI 편집'],
                  ['session', '세션 관리'],
                  ['logs', '편집 로그'],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
              <select value={themeId} onChange={(e) => setThemeId(Number(e.target.value))}>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-body">
              {tab === 'concept' && theme && <ConceptEditor key={theme.id} theme={theme} token={token} run={run} />}
              {tab === 'ai' && theme && <AiEditor key={theme.id} theme={theme} token={token} run={run} onCreated={setThemeId} />}
              {tab === 'session' && <SessionManager session={session} token={token} run={run} />}
              {tab === 'logs' && <Logs token={token} />}
            </div>
          </>
        )}
        {msg && <p className="muted">{msg}</p>}
      </div>
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

// ---------------------------------------------------------------- 컨셉 편집
function ConceptEditor({ theme, token, run }: { theme: ThemeFull; token: string; run: Run }) {
  const [name, setName] = useState(theme.name);
  const [description, setDescription] = useState(theme.description);
  const [style, setStyle] = useState<ThemeStyle>(theme.style);

  const colorKeys: (keyof ThemeStyle)[] = ['wall', 'floor', 'light', 'fog', 'accent'];

  return (
    <div>
      <h3>테마</h3>
      <label>
        이름 <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        설명 <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="colors">
        {colorKeys.map((k) => (
          <label key={k}>
            {k}
            <input type="color" value={style[k] as string} onChange={(e) => setStyle({ ...style, [k]: e.target.value })} />
          </label>
        ))}
        <label>
          장식
          <select value={style.decor} onChange={(e) => setStyle({ ...style, decor: e.target.value as ThemeStyle['decor'] })}>
            <option value="server">server (공포)</option>
            <option value="pillar">pillar (이집트)</option>
            <option value="none">none</option>
          </select>
        </label>
        <label>
          밝기 {style.ambient.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05} value={style.ambient} onChange={(e) => setStyle({ ...style, ambient: Number(e.target.value) })} />
        </label>
      </div>
      <button className="primary" onClick={() => run(() => adminApi.updateTheme(token, theme.id, { name, description, style }), '테마 저장됨')}>
        테마 저장
      </button>

      <h3>방 (5개 · 세션은 이 중 2~5개 사용)</h3>
      {theme.rooms.map((r) => (
        <RoomEditor key={`${r.id}-${r.updated_at}`} room={r} token={token} run={run} />
      ))}
    </div>
  );
}

const CLUE_OBJECTS: ClueObject[] = ['note', 'board', 'book', 'tablet', 'statue', 'jar', 'box'];
const MINIGAME_TYPES: [MinigameType, string][] = [
  ['sequence', '기억력 (순서 기억)'],
  ['wires', '전선 연결'],
  ['timing', '타이밍'],
];

function RoomEditor({ room, token, run }: { room: RoomFull; token: string; run: Run }) {
  const [d, setD] = useState<RoomDraft>({ ...room, clues: room.clues ?? [], minigame: room.minigame ?? null });
  const set = (k: keyof RoomDraft, v: string) => setD({ ...d, [k]: v });

  const setClue = (i: number, patch: Partial<Clue>) => setD({ ...d, clues: d.clues.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const addClue = () =>
    setD({ ...d, clues: [...d.clues, { id: `clue${Date.now() % 100000}`, label: '새 단서', object: 'note', pos: [0, 2], text: '' }] });
  const removeClue = (i: number) => setD({ ...d, clues: d.clues.filter((_, j) => j !== i) });
  const setMg = (patch: Partial<MinigameConfig>) => setD({ ...d, minigame: { ...(d.minigame as MinigameConfig), ...patch } });

  function save() {
    const body = {
      ...d,
      hints: d.hints.filter((h) => h.trim()),
      clues: d.clues.filter((c) => c.text.trim()),
      minigame: d.minigame ?? undefined,
      remove_minigame: !d.minigame,
      source: 'admin' as const,
    };
    return run(() => adminApi.updateRoom(token, room.id, body), `${d.name} 저장됨`);
  }

  return (
    <details className="room-edit">
      <summary>
        {room.order_idx + 1}. {room.name} <small>[{room.source}] 단서 {room.clues?.length ?? 0} · {room.minigame ? `🎮 ${room.minigame.type}` : '미니게임 없음'}</small>
      </summary>
      <label>
        이름 <input value={d.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label>
        묘사 <textarea value={d.description} onChange={(e) => set('description', e.target.value)} />
      </label>

      <h4>🔐 단말기 암호 (정답을 비우면 암호 없는 방)</h4>
      <label>
        퍼즐 유형
        <select value={d.puzzle_type} onChange={(e) => set('puzzle_type', e.target.value)}>
          {['code', 'cipher', 'math', 'riddle', 'logic', 'none'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        지시문 (정답 정보는 단서에 숨기세요) <textarea value={d.question} onChange={(e) => set('question', e.target.value)} />
      </label>
      <label>
        정답 ('|' 로 복수 정답) <input value={d.answer} onChange={(e) => set('answer', e.target.value)} />
      </label>
      <label>
        힌트 (줄바꿈으로 구분)
        <textarea value={d.hints.join('\n')} onChange={(e) => setD({ ...d, hints: e.target.value.split('\n') })} />
      </label>

      <h4>🔎 단서 오브젝트 ({d.clues.length})</h4>
      <RoomLayoutEditor
        clues={d.clues}
        hasPuzzle={!!d.answer.trim()}
        hasMinigame={!!d.minigame}
        onMove={(i, pos) => setClue(i, { pos })}
      />
      {d.clues.map((c, i) => (
        <div key={i} className="clue-edit">
          <div className="row">
            <input style={{ maxWidth: 90 }} value={c.id} title="id" onChange={(e) => setClue(i, { id: e.target.value })} />
            <input value={c.label} placeholder="이름" onChange={(e) => setClue(i, { label: e.target.value })} />
            <select value={c.object} onChange={(e) => setClue(i, { object: e.target.value as ClueObject })}>
              {CLUE_OBJECTS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            x <input type="number" step={0.1} min={-4.3} max={4.3} style={{ width: 70, flex: 'none' }} value={c.pos[0]}
              onChange={(e) => setClue(i, { pos: [Number(e.target.value), c.pos[1]] })} />
            z <input type="number" step={0.1} min={-4.3} max={4.3} style={{ width: 70, flex: 'none' }} value={c.pos[1]}
              onChange={(e) => setClue(i, { pos: [c.pos[0], Number(e.target.value)] })} />
            <button className="danger" onClick={() => removeClue(i)}>삭제</button>
          </div>
          <textarea value={c.text} placeholder="조사하면 보이는 내용" onChange={(e) => setClue(i, { text: e.target.value })} />
        </div>
      ))}
      <button onClick={addClue}>+ 단서 추가</button>

      <h4>🎮 미니게임 → 🔑 열쇠</h4>
      <label>
        <input type="checkbox" checked={!!d.minigame}
          onChange={(e) => setD({ ...d, minigame: e.target.checked ? { type: 'sequence', title: '미니게임', description: '', reward: '열쇠', difficulty: 2 } : null })} />{' '}
        이 방은 미니게임으로 얻은 열쇠가 있어야 문이 열림
      </label>
      {d.minigame && (
        <div className="row">
          <select value={d.minigame.type} onChange={(e) => setMg({ type: e.target.value as MinigameType })}>
            {MINIGAME_TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <input value={d.minigame.title} placeholder="미니게임 이름" onChange={(e) => setMg({ title: e.target.value })} />
          <input value={d.minigame.reward} placeholder="열쇠 이름" onChange={(e) => setMg({ reward: e.target.value })} />
          난이도
          <input type="number" min={1} max={5} style={{ width: 60, flex: 'none' }} value={d.minigame.difficulty}
            onChange={(e) => setMg({ difficulty: Number(e.target.value) })} />
          <input value={d.minigame.description} placeholder="설명" onChange={(e) => setMg({ description: e.target.value })} />
        </div>
      )}

      <p>
        <button className="primary" onClick={save}>방 저장</button>
      </p>
    </details>
  );
}

// ---------------------------------------------------------------- AI 편집
function AiEditor({ theme, token, run, onCreated }: { theme: ThemeFull; token: string; run: Run; onCreated: (id: number) => void }) {
  const [orderIdx, setOrderIdx] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<RoomDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [concept, setConcept] = useState('');

  async function generate() {
    setBusy(true);
    try {
      setDraft(await adminApi.generateRoom(token, theme.id, orderIdx, prompt));
    } finally {
      setBusy(false);
    }
  }

  const target = theme.rooms.find((r) => r.order_idx === orderIdx);

  return (
    <div>
      <h3>AI로 방 다시 만들기</h3>
      <div className="row">
        <select value={orderIdx} onChange={(e) => setOrderIdx(Number(e.target.value))}>
          {theme.rooms.map((r) => (
            <option key={r.id} value={r.order_idx}>
              {r.order_idx + 1}. {r.name}
            </option>
          ))}
        </select>
        <input placeholder="요청 (예: 거울을 이용한 퍼즐, 난이도 쉽게)" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <button disabled={busy} onClick={generate}>
          {busy ? '생성 중...' : 'AI 생성'}
        </button>
      </div>

      {draft && (
        <div className="draft">
          <p>
            <b>{draft.name}</b> <small>({draft.puzzle_type})</small>
          </p>
          <p>{draft.description}</p>
          <pre className="question">{draft.question}</pre>
          <p>정답: {draft.answer}</p>
          <p>힌트: {draft.hints.join(' / ')}</p>
          <p>🔎 단서 {draft.clues.length}개</p>
          <ul>
            {draft.clues.map((c) => (
              <li key={c.id}>
                <b>{c.label}</b> ({c.object}, [{c.pos.join(', ')}]) — {c.text}
              </li>
            ))}
          </ul>
          <p>🎮 {draft.minigame ? `${draft.minigame.title} (${draft.minigame.type}, 난이도 ${draft.minigame.difficulty}) → 🔑 ${draft.minigame.reward}` : '미니게임 없음'}</p>
          {target && (
            <button
              className="primary"
              onClick={() =>
                run(
                  () => adminApi.updateRoom(token, target.id, { ...draft, minigame: draft.minigame ?? undefined, remove_minigame: !draft.minigame, source: 'ai' }),
                  'AI 초안을 방에 적용했습니다',
                )
              }
            >
              이 초안을 "{target.name}"에 적용
            </button>
          )}
        </div>
      )}

      <h3>새 컨셉(테마) 만들기</h3>
      <p className="muted">이름과 컨셉을 입력하면 AI가 방 5개를 자동 생성합니다. 이후 '방 컨셉 편집'에서 수정하세요.</p>
      <div className="row">
        <input placeholder="테마 이름" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input placeholder="컨셉 (예: 버려진 우주정거장)" value={concept} onChange={(e) => setConcept(e.target.value)} />
        <button
          disabled={!newName.trim()}
          onClick={() =>
            run(async () => {
              const t = await adminApi.createTheme(token, { name: newName, description: concept, style: theme.style, concept_prompt: concept });
              onCreated(t.id);
            }, '새 테마 생성됨 (로비에서 선택 가능)')
          }
        >
          생성
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 세션 관리
function SessionManager({ session, token, run }: { session: SessionState; token: string; run: Run }) {
  return (
    <div>
      <h3>현재 세션 {session.id}</h3>
      <p>
        상태: {session.status} · 힌트 사용 {session.hints_used}회 · 제한 {session.time_limit_min}분
      </p>
      <div className="row">
        {[-5, 5, 10].map((d) => (
          <button key={d} onClick={() => run(() => adminApi.addTime(token, session.id, d), `시간 ${d > 0 ? '+' : ''}${d}분`)}>
            시간 {d > 0 ? '+' : ''}
            {d}분
          </button>
        ))}
        <button className="danger" onClick={() => confirm('세션을 초기화할까요?') && run(() => adminApi.reset(token, session.id), '세션 초기화')}>
          세션 초기화
        </button>
      </div>
      <h3>방 강제 열기</h3>
      <div className="row">
        {session.rooms.map((r) => (
          <button key={r.slot} disabled={r.status !== 'locked'} onClick={() => run(() => adminApi.unlock(token, session.id, r.slot), `${r.slot + 1}번 방 열림`)}>
            {r.slot + 1}. {r.name} {r.status === 'locked' ? '🔒' : '🔓'}
          </button>
        ))}
      </div>
    </div>
  );
}

function Logs({ token }: { token: string }) {
  const [logs, setLogs] = useState<EditLog[]>([]);
  useEffect(() => {
    adminApi.logs(token).then(setLogs).catch(() => setLogs([]));
  }, [token]);
  return (
    <table className="logs">
      <tbody>
        {logs.map((l) => (
          <tr key={l.id}>
            <td>{new Date(l.created_at).toLocaleString()}</td>
            <td>{l.actor}</td>
            <td>
              {l.target_type}#{l.target_id}
            </td>
            <td className="payload">{l.payload.slice(0, 120)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
