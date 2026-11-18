import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api/client';
import { GameSocket } from '../api/socket';
import { EscapeEngine } from '../game/engine';
import type { EngineRoom, InteractTarget } from '../game/engine';
import { GameAudio, type SfxName } from '../game/audio';
import { glyphBandDataURL, noiseDataURL } from '../game/textures';
import { COPY, themeKind } from '../game/themeCopy';
import MiniMap from '../components/MiniMap';
import PuzzleModal from '../components/PuzzleModal';
import ClueDoc, { type ClueDocData } from '../components/ClueDoc';
import InventoryPanel from '../components/InventoryPanel';
import MiniGameModal from '../components/minigames/MiniGameModal';
import AdminPanel from '../components/AdminPanel';
import ChatPanel from '../components/ChatPanel';
import type { ChatMessage, RemotePlayer, SessionRoom, SessionState, Vec3 } from '../types';
import { formatTime } from '../utils';

interface Props {
  sessionId: string;
  playerName: string;
  onExit: () => void;
}

/** 마우스 고정을 풀고 여는 창 (한 번에 하나). 단서·문은 창 없이 바로 처리한다. */
type Modal = { kind: 'puzzle' | 'minigame'; slot: number } | { kind: 'map' | 'inventory' | 'admin' } | null;

interface Toast {
  key: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

const NOISE = noiseDataURL(180, 0.55);
const GLYPHS = glyphBandDataURL();
const GRIT = noiseDataURL(160, 0.1);
const MUTE_KEY = 'escape-muted';
let msgSeq = 0;

const toEngineRooms = (s: SessionState): EngineRoom[] =>
  s.rooms.map((r) => ({
    slot: r.slot,
    name: r.name,
    status: r.status,
    is_final: r.is_final,
    has_puzzle: r.has_puzzle,
    puzzle_solved: r.puzzle_solved,
    clues: r.clues.map((c) => ({ id: c.id, label: c.label, object: c.object, pos: c.pos, found: c.found })),
    minigame: r.minigame ? { type: r.minigame.type, title: r.minigame.title, key_obtained: r.minigame.key_obtained, key_used: r.minigame.key_used } : null,
  }));

function objectiveSummary(room: SessionRoom): string {
  const parts = [`🔎 ${room.clues.filter((c) => c.found).length}/${room.clues.length}`];
  if (room.has_puzzle) parts.push(room.puzzle_solved ? '🔓 암호' : '🔒 암호');
  if (room.minigame) parts.push(room.minigame.key_used ? '🔑 사용' : room.minigame.key_obtained ? '🔑 보유' : '🎮 시험');
  return parts.join('  ');
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Game({ sessionId, playerName, onExit }: Props) {
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [players, setPlayers] = useState<Record<string, RemotePlayer>>({});
  const [myId, setMyId] = useState('');
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSlot, setCurrentSlot] = useState(0);
  const [myPos, setMyPos] = useState<Vec3>([0, 1.6, 2.5]);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [focus, setFocus] = useState<InteractTarget | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [clueDoc, setClueDoc] = useState<ClueDocData | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [scare, setScare] = useState<'' | 'blackout' | 'rumble'>('');
  const [muted, setMuted] = useState(loadMuted);

  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EscapeEngine | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const deadlineRef = useRef(0);
  const posRef = useRef<Vec3>([0, 1.6, 2.5]);
  const expiredFetchRef = useRef(false);
  const statusRef = useRef<SessionState['status']>('playing');
  const stateRef = useRef<SessionState | null>(null);
  const modalRef = useRef<Modal>(null);
  const busyRef = useRef(false);
  const docTimer = useRef<number>();
  const toastTimer = useRef<number>();
  const scareTimer = useRef<number>();
  modalRef.current = modal;

  const kind = themeKind(state?.theme.style.decor);
  const copy = COPY[kind];

  const sound = useCallback((name: SfxName) => audioRef.current?.sfx(name), []);

  const pushMsg = useCallback((name: string, text: string, system = false) => {
    setMessages((m) => [...m.slice(-80), { id: String(++msgSeq), name, text, system }]);
  }, []);

  const showToast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    window.clearTimeout(toastTimer.current);
    setToast({ key: Date.now(), text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const applyState = useCallback((s: SessionState) => {
    setState(s);
    stateRef.current = s;
    statusRef.current = s.status;
    deadlineRef.current = Date.now() + s.remaining_seconds * 1000;
    setRemaining(s.remaining_seconds);
    expiredFetchRef.current = false;
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyState(await api.getSession(sessionId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sessionId, applyState]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- 타이머 ----
  useEffect(() => {
    const id = window.setInterval(() => {
      if (statusRef.current !== 'playing') return;
      const rem = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
      setRemaining(rem);
      if (rem === 0 && !expiredFetchRef.current) {
        expiredFetchRef.current = true;
        refresh();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // ---- WebSocket 협동 ----
  useEffect(() => {
    const sock = new GameSocket(sessionId, playerName);
    socketRef.current = sock;
    const offs = [
      sock.on('_open', () => setConnected(true)),
      sock.on('_close', () => setConnected(false)),
      sock.on('welcome', (m) => {
        setMyId(m.player_id);
        setPlayers(Object.fromEntries((m.players as RemotePlayer[]).map((p) => [p.id, p])));
        sock.send({ type: 'move', position: posRef.current, rotation: 0, slot: 0 });
      }),
      sock.on('player_joined', (m) => setPlayers((p) => ({ ...p, [m.player.id]: m.player }))),
      sock.on('player_left', (m) =>
        setPlayers((p) => {
          const next = { ...p };
          delete next[m.player_id];
          return next;
        }),
      ),
      sock.on('player_moved', (m) =>
        setPlayers((p) => (p[m.player_id] ? { ...p, [m.player_id]: { ...p[m.player_id], position: m.position, rotation: m.rotation, slot: m.slot } } : p)),
      ),
      sock.on('chat', (m) => pushMsg(m.name, m.text, m.player_id === 'system')),
      sock.on('room_cleared', (m) => pushMsg('', `🎉 ${m.by} 님이 "${m.room_name}" 클리어!`, true)),
      sock.on('state_changed', () => refresh()),
      sock.on('content_updated', () => refresh()),
    ];
    sock.connect();
    return () => {
      offs.forEach((off) => off());
      sock.close();
      socketRef.current = null;
    };
  }, [sessionId, playerName, refresh, pushMsg]);

  // ---- 사운드 (테마별) ----
  useEffect(() => {
    if (!state) return;
    const a = new GameAudio(kind);
    a.setMuted(muted);
    audioRef.current = a;
    return () => {
      a.dispose();
      if (audioRef.current === a) audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, !!state]);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* 저장 불가 환경 */
    }
  }, [muted]);

  useEffect(() => {
    const t = state?.status === 'playing' && remaining > 0 && remaining < 300 ? 1 - remaining / 300 : 0;
    audioRef.current?.setTension(t);
  }, [remaining, state?.status]);

  // ---- 상호작용: 단서·문은 창 없이 즉시 처리 ----
  const inspect = useCallback(
    async (t: InteractTarget) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const r = await api.inspectClue(sessionId, t.slot, t.id!, playerName);
        applyState(r.state);
        sound('clue');
        window.clearTimeout(docTimer.current);
        setClueDoc({ key: `${t.slot}:${t.id}:${Date.now()}`, label: r.clue.label, text: r.clue.text, object: r.clue.object, isNew: r.new });
        docTimer.current = window.setTimeout(() => setClueDoc(null), Math.max(6000, r.clue.text.length * 110));
      } catch (e) {
        showToast((e as Error).message, 'bad');
      } finally {
        busyRef.current = false;
      }
    },
    [sessionId, playerName, applyState, sound, showToast],
  );

  const tryDoor = useCallback(
    async (slot: number) => {
      const room = stateRef.current?.rooms[slot];
      if (!room || room.status === 'cleared' || busyRef.current) return;
      const mg = room.minigame;
      if (mg && mg.key_obtained && !mg.key_used) {
        busyRef.current = true;
        try {
          const r = await api.useKey(sessionId, slot, playerName);
          applyState(r.state);
          sound('key');
          showToast(r.message, 'good');
        } catch (e) {
          showToast((e as Error).message, 'bad');
        } finally {
          busyRef.current = false;
        }
        return;
      }
      const missing: string[] = [];
      if (room.has_puzzle && !room.puzzle_solved) missing.push(copy.needPuzzle);
      if (mg && !mg.key_obtained) missing.push(`🔑 ${mg.reward}`);
      sound('locked');
      showToast(missing.length ? `${copy.doorLocked} — 필요한 것: ${missing.join(', ')}` : copy.doorLocked, 'bad');
    },
    [sessionId, playerName, applyState, sound, showToast, copy],
  );

  const openModal = useCallback(
    (m: Modal) => {
      setClueDoc(null);
      engineRef.current?.unlockPointer();
      if (m && (m.kind === 'puzzle' || m.kind === 'minigame')) sound('open');
      setModal(m);
    },
    [sound],
  );

  /** 창을 닫고 곧바로 조작으로 복귀 (사용자 입력 직후라 마우스 재고정이 허용됨) */
  const closeAndResume = useCallback(() => {
    setModal(null);
    const eng = engineRef.current;
    if (!eng || statusRef.current !== 'playing') return;
    eng.setInputEnabled(true);
    eng.lock().then((ok) => {
      if (!ok) setShowResume(true);
    });
  }, []);

  const handlersRef = useRef({ onInteract: (_t: InteractTarget) => {} });
  handlersRef.current.onInteract = (t: InteractTarget) => {
    if (statusRef.current !== 'playing') return;
    if (t.kind === 'clue') inspect(t);
    else if (t.kind === 'door') tryDoor(t.slot);
    else openModal({ kind: t.kind, slot: t.slot });
  };

  // ---- 3D 엔진 ----
  const worldKey = useMemo(
    () =>
      state
        ? JSON.stringify([
            state.theme.style,
            state.rooms.map((r) => [r.name, r.has_puzzle, r.minigame?.type ?? null, r.clues.map((c) => [c.id, c.label, c.object, c.pos])]),
          ])
        : '',
    [state],
  );

  useEffect(() => {
    if (!worldKey || !state || !containerRef.current) return;
    const engine = new EscapeEngine(containerRef.current, {
      rooms: toEngineRooms(state),
      style: state.theme.style,
      startPosition: posRef.current,
      audio: audioRef.current,
      onInteract: (t) => handlersRef.current.onInteract(t),
      onRoomChange: (slot) => setCurrentSlot(slot),
      onLockChange: (locked) => {
        setPointerLocked(locked);
        if (locked) {
          setStarted(true);
          setShowResume(false);
          audioRef.current?.start();
        }
      },
      onFocusChange: setFocus,
      onScare: (k) => {
        window.clearTimeout(scareTimer.current);
        setScare(k);
        scareTimer.current = window.setTimeout(() => setScare(''), 1800);
      },
      onMove: ({ position, rotation, slot }) => {
        posRef.current = position;
        setMyPos(position);
        socketRef.current?.send({ type: 'move', position, rotation, slot });
      },
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldKey]);

  useEffect(() => {
    if (state) engineRef.current?.setRooms(toEngineRooms(state));
  }, [state]);

  const others = useMemo(() => Object.values(players).filter((p) => p.id !== myId), [players, myId]);
  useEffect(() => {
    engineRef.current?.updateRemotePlayers(others);
  }, [others, worldKey]);

  const ended = state ? state.status !== 'playing' : false;
  const inputBlocked = modal !== null || ended;
  useEffect(() => {
    engineRef.current?.setInputEnabled(!inputBlocked);
  }, [inputBlocked, worldKey]);

  // 마우스 고정이 풀린 채 잠시 지나면(ESC 등) 작은 안내만 표시
  useEffect(() => {
    if (!started || pointerLocked || modal || ended) {
      setShowResume(false);
      return;
    }
    const id = window.setTimeout(() => setShowResume(true), 500);
    return () => window.clearTimeout(id);
  }, [started, pointerLocked, modal, ended]);

  // ---- 단축키 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT') return;
      const cur = modalRef.current;
      if (e.code === 'KeyM' || e.code === 'KeyI') {
        const k = e.code === 'KeyM' ? 'map' : 'inventory';
        if (cur?.kind === k) closeAndResume();
        else if (!cur || cur.kind === 'map' || cur.kind === 'inventory') openModal({ kind: k });
      }
      if (e.code === 'Escape' && cur && cur.kind !== 'admin' && cur.kind !== 'minigame') closeAndResume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openModal, closeAndResume]);

  useEffect(
    () => () => {
      window.clearTimeout(docTimer.current);
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(scareTimer.current);
    },
    [],
  );

  if (error && !state) {
    return (
      <div className="center">
        <p className="error">{error}</p>
        <button onClick={onExit}>로비로</button>
      </div>
    );
  }
  if (!state) return <div className="center">불러오는 중...</div>;

  const room = state.rooms[currentSlot];
  const cleared = state.rooms.filter((r) => r.status === 'cleared').length;
  const modalRoom = modal && 'slot' in modal ? state.rooms[modal.slot] : null;
  const keyCount = state.inventory.filter((i) => i.kind === 'key' && !i.used).length;
  const clueCount = state.inventory.filter((i) => i.kind === 'clue').length;
  const lowTime = state.status === 'playing' && remaining < 300;

  return (
    <div className={`game theme-${kind} ${scare ? `fx-${scare}` : ''} ${lowTime ? 'fx-low' : ''}`} style={{ '--noise': `url(${NOISE})`, '--grit': `url(${GRIT})`, '--glyphs': `url(${GLYPHS})` } as CSSProperties}>
      <div ref={containerRef} className="canvas-wrap" />
      <div className="fx-layer" aria-hidden>
        <div className="fx-grain" />
        <div className="fx-vignette" />
        <div className="fx-flash" />
      </div>

      {pointerLocked && <div className={`crosshair ${focus ? 'on' : ''}`} />}
      {pointerLocked && focus && (
        <div className="focus-tip">
          <kbd>E</kbd> {copy.focusVerb[focus.kind]} <span>· {focus.label}</span>
        </div>
      )}

      {/* HUD */}
      <div className="hud top-left">
        <div className="timer-label">{copy.timerLabel}</div>
        <div className={`timer ${lowTime ? 'warn' : ''}`}>{formatTime(remaining)}</div>
        <div className="hud-room">
          {currentSlot + 1}. {room?.name} {room?.status === 'cleared' ? '✓' : ''}
        </div>
        {room && room.status !== 'locked' && <div className="objective">{objectiveSummary(room)}</div>}
        <div className="hud-progress">
          {state.rooms.map((r) => (
            <i key={r.slot} className={r.status} title={r.name} />
          ))}
        </div>
      </div>
      <div className="hud top-right">
        <div className="code">
          방 코드 <b>{state.id}</b> · {connected ? `${Object.keys(players).length}명 접속` : '연결 끊김'}
        </div>
        <div className="row">
          <button onClick={() => openModal({ kind: 'inventory' })}>
            {kind === 'egypt' ? '📜' : '🗂'} <kbd>I</kbd>
            {clueCount + keyCount > 0 && (
              <span className="badge">
                {clueCount}
                {keyCount > 0 ? ` · 🔑${keyCount}` : ''}
              </span>
            )}
          </button>
          <button onClick={() => openModal({ kind: 'map' })}>
            🗺 <kbd>M</kbd>
          </button>
          <button onClick={() => setMuted((m) => !m)} title={muted ? '소리 켜기' : '소리 끄기'}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button onClick={() => openModal({ kind: 'admin' })} title="관리자">
            🛠
          </button>
          <button onClick={onExit}>나가기</button>
        </div>
      </div>

      {/* 첫 입장 (브라우저 정책상 첫 클릭은 꼭 필요) */}
      {!started && !ended && !modal && (
        <div
          className="intro"
          onClick={() => {
            audioRef.current?.start();
            engineRef.current?.lock();
          }}
        >
          <div className="intro-card">
            <div className="intro-eyebrow">{copy.introEyebrow}</div>
            <h1 className="intro-title">{copy.introTitle}</h1>
            {copy.introLines.map((l, i) => (
              <p key={i} className="intro-line" style={{ animationDelay: `${0.4 + i * 0.9}s` }}>
                {l}
              </p>
            ))}
            <div className="intro-action">{copy.introAction}</div>
            <div className="intro-controls">{copy.controls}</div>
          </div>
        </div>
      )}
      {showResume && <div className="resume-hint">{copy.resumeHint}</div>}
      {scare && copy.scareText && <div className="scare-text">{copy.scareText}</div>}

      {clueDoc && <ClueDoc doc={clueDoc} kind={kind} copy={copy} />}
      {toast && (
        <div key={toast.key} className={`toast toast-${toast.tone}`}>
          {toast.text}
        </div>
      )}

      <ChatPanel messages={messages} connected={connected} onSend={(text) => socketRef.current?.send({ type: 'chat', text })} />

      {modal?.kind === 'map' && (
        <MiniMap rooms={state.rooms} currentSlot={currentSlot} myPos={myPos} myName={playerName} players={others} title={copy.mapTitle} onClose={closeAndResume} />
      )}
      {modal?.kind === 'inventory' && <InventoryPanel state={state} title={copy.inventoryTitle} empty={copy.inventoryEmpty} onClose={closeAndResume} />}
      {modal?.kind === 'puzzle' && modalRoom && (
        <PuzzleModal
          key={modalRoom.slot}
          sessionId={sessionId}
          room={modalRoom}
          playerName={playerName}
          disabled={ended}
          kind={kind}
          copy={copy}
          onClose={closeAndResume}
          onSolved={closeAndResume}
          onState={applyState}
          onSound={sound}
        />
      )}
      {modal?.kind === 'minigame' && modalRoom?.minigame && (
        <MiniGameModal
          key={modalRoom.slot}
          sessionId={sessionId}
          room={modalRoom}
          playerName={playerName}
          disabled={ended}
          kind={kind}
          copy={copy}
          onClose={closeAndResume}
          onDone={closeAndResume}
          onState={applyState}
          onSound={sound}
        />
      )}
      {modal?.kind === 'admin' && <AdminPanel session={state} onClose={closeAndResume} />}

      {ended && modal?.kind !== 'admin' && (
        <div className={`overlay result-overlay ${state.status}`}>
          <div className="panel result">
            <h1>{state.status === 'escaped' ? copy.escapedTitle : copy.failedTitle}</h1>
            {(state.status === 'escaped' ? copy.escapedText : copy.failedText) && <p className="result-text">{state.status === 'escaped' ? copy.escapedText : copy.failedText}</p>}
            <p className="result-stats">
              클리어 {cleared}/{state.room_count} · 단서 {clueCount}개 · 힌트 {state.hints_used}회 · 남은 시간 {formatTime(remaining)}
            </p>
            <button className="primary" onClick={onExit}>
              {copy.toLobby}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
