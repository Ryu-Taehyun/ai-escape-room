import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api/client';
import { EscapeEngine } from '../game/engine';
import type { EngineRoom, InteractTarget } from '../game/engine';
import { GameAudio, type SfxName } from '../game/audio';
import { glyphBandDataURL, noiseDataURL } from '../game/textures';
import { COPY, themeKind, type ThemeKind } from '../game/themeCopy';
import { useSettings } from '../settings';
import { useCountdown } from '../hooks/useCountdown';
import { useGameSocket, type MarkEvent } from '../hooks/useGameSocket';
import MiniMap from '../components/MiniMap';
import MiniStrip, { type MapMark } from '../components/MiniStrip';
import PuzzleModal from '../components/PuzzleModal';
import ClueDoc, { type ClueDocData } from '../components/ClueDoc';
import InventoryPanel from '../components/InventoryPanel';
import ChatPanel from '../components/ChatPanel';
import PauseMenu from '../components/PauseMenu';
import WaitingRoom from '../components/WaitingRoom';
import ResultScreen from '../components/ResultScreen';
import type { SessionRoom, SessionState, Vec3 } from '../types';
import { formatTime } from '../utils';

// 자주 쓰지 않는 큰 화면은 필요할 때만 불러온다
const AdminPanel = lazy(() => import('../components/AdminPanel'));
const MiniGameModal = lazy(() => import('../components/minigames/MiniGameModal'));

interface Props {
  sessionId: string;
  playerName: string;
  onExit: () => void;
  onRestart: (sessionId: string) => void;
}

/** 마우스 고정을 풀고 여는 창 (한 번에 하나). 단서·문은 창 없이 바로 처리한다. */
type Modal = { kind: 'puzzle' | 'minigame'; slot: number } | { kind: 'map' | 'inventory' | 'admin' | 'pause' } | null;

interface Toast {
  key: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

interface Caption {
  key: number;
  text: string;
}

const NOISE = noiseDataURL(180, 0.55);
const GRIT = noiseDataURL(160, 0.1);
const GLYPHS = glyphBandDataURL();
const MARK_MS = 6000;

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

/** 지금 이 방에서 다음에 할 일 (한 문장) */
function nextObjective(room: SessionRoom | undefined, kind: ThemeKind, isLast: boolean): string {
  if (!room) return '';
  const egypt = kind === 'egypt';
  if (room.status === 'locked') return '이 방은 아직 잠겨 있다';
  if (room.status === 'cleared') return isLast ? '탈출구가 열렸다!' : egypt ? '다음 방으로 가는 돌문이 열렸다' : '다음 구역으로 이동하라';
  const found = room.clues.filter((c) => c.found).length;
  const mg = room.minigame;
  if (room.has_puzzle && !room.puzzle_solved) {
    if (found < room.clues.length) return `방을 조사해 단서를 찾아라 (${found}/${room.clues.length})`;
    return egypt ? '제단의 비문에 답을 새겨라' : '단말기에 접속해 암호를 풀어라';
  }
  if (mg && !mg.key_obtained) return `「${mg.title}」에 도전해 ${mg.reward}을(를) 얻어라`;
  if (mg && !mg.key_used) return `문으로 가서 ${mg.reward}을(를) 사용하라`;
  return '문으로 가라';
}

export default function Game({ sessionId, playerName, onExit, onRestart }: Props) {
  const { settings, update, reset } = useSettings();
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState('');
  const [currentSlot, setCurrentSlot] = useState(0);
  const [myPos, setMyPos] = useState<Vec3>([0, 1.6, 2.5]);
  const [myYaw, setMyYaw] = useState(0);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<InteractTarget | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [clueDoc, setClueDoc] = useState<ClueDocData | null>(null);
  const [lastClue, setLastClue] = useState<ClueDocData | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [scare, setScare] = useState<'' | 'blackout' | 'rumble'>('');
  const [stamina, setStamina] = useState({ v: 1, ex: false });
  const [marks, setMarks] = useState<MapMark[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [fps, setFps] = useState(0);
  const [restarting, setRestarting] = useState(false);
  const [hintPenalty, setHintPenalty] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EscapeEngine | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const posRef = useRef<Vec3>([0, 1.6, 2.5]);
  const stateRef = useRef<SessionState | null>(null);
  const modalRef = useRef<Modal>(null);
  const settingsRef = useRef(settings);
  const busyRef = useRef(false);
  const ownUnlockRef = useRef(false); // 우리가 창을 열려고 마우스 고정을 푼 경우
  const timers = useRef<Record<string, number>>({});
  modalRef.current = modal;
  settingsRef.current = settings;

  const kind = themeKind(state?.theme.style.decor);
  const copy = COPY[kind];
  const status = state?.status;

  const later = (name: string, fn: () => void, ms: number) => {
    window.clearTimeout(timers.current[name]);
    timers.current[name] = window.setTimeout(fn, ms);
  };
  useEffect(() => () => Object.values(timers.current).forEach((id) => window.clearTimeout(id)), []);

  const sound = useCallback((name: SfxName) => audioRef.current?.sfx(name), []);
  const showToast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    setToast({ key: Date.now(), text, tone });
    later('toast', () => setToast(null), 3400);
  }, []);
  const pushCaption = useCallback((text: string) => {
    if (!settingsRef.current.captions) return;
    const key = Date.now() + Math.random();
    setCaptions((c) => [...c.slice(-2), { key, text }]);
    window.setTimeout(() => setCaptions((c) => c.filter((x) => x.key !== key)), 4200);
  }, []);

  const applyState = useCallback((s: SessionState) => {
    setState(s);
    stateRef.current = s;
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

  const remaining = useCountdown(state, refresh);

  // ---- 협동 소켓 ----
  const myIdRef = useRef('');
  const nameRef = useRef(playerName); // 서버가 정한 이름 (중복 닉네임이면 "이름 (2)")
  const onMark = useCallback((m: MarkEvent) => {
    const mine = m.playerId === myIdRef.current;
    engineRef.current?.addMark(m.position, m.name, mine ? '#ffd54a' : '#4fc3f7');
    const key = Date.now() + Math.random();
    setMarks((list) => [...list, { key, name: m.name, position: m.position }]);
    window.setTimeout(() => setMarks((list) => list.filter((x) => x.key !== key)), MARK_MS);
  }, []);
  const onTeamRestart = useCallback((sid: string, by: string) => {
    setToast({ key: Date.now(), text: `${by} 님이 같은 설정으로 새 방을 만들었습니다. 함께 이동합니다…`, tone: 'info' });
    window.setTimeout(() => onRestart(sid), 1500);
  }, [onRestart]);
  const { players, myId, myName, connected, everConnected, messages, send } = useGameSocket({
    sessionId,
    playerName,
    onStateChanged: refresh,
    onMark,
    onRestart: onTeamRestart,
    initialPosition: () => posRef.current,
  });
  myIdRef.current = myId;
  nameRef.current = myName || playerName;
  const me = myName || playerName;

  useEffect(() => {
    api.config().then((c) => setHintPenalty(c.hint_penalty_sec ?? 0)).catch(() => {});
  }, []);

  // ---- 사운드 ----
  useEffect(() => {
    if (!state) return;
    const a = new GameAudio(kind);
    a.setVolumes({ master: settingsRef.current.master, ambience: settingsRef.current.ambience, sfx: settingsRef.current.sfx });
    a.setMuted(settingsRef.current.muted);
    a.onCaption = (t) => pushCaption(t);
    audioRef.current = a;
    return () => {
      a.dispose();
      if (audioRef.current === a) audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, !!state]);

  useEffect(() => {
    audioRef.current?.setVolumes({ master: settings.master, ambience: settings.ambience, sfx: settings.sfx });
    audioRef.current?.setMuted(settings.muted);
  }, [settings.master, settings.ambience, settings.sfx, settings.muted]);

  useEffect(() => {
    const t = status === 'playing' && remaining > 0 && remaining < 300 ? 1 - remaining / 300 : 0;
    audioRef.current?.setTension(t);
  }, [remaining, status]);

  // ---- 상호작용: 단서·문은 창 없이 즉시 처리 ----
  const showClue = useCallback((doc: ClueDocData) => {
    setClueDoc(doc);
    setLastClue(doc);
    later('doc', () => setClueDoc(null), Math.max(6000, doc.text.length * 110));
  }, []);

  const inspect = useCallback(
    async (t: InteractTarget) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const r = await api.inspectClue(sessionId, t.slot, t.id!, nameRef.current);
        applyState(r.state);
        sound('clue');
        showClue({ key: `${t.slot}:${t.id}:${Date.now()}`, label: r.clue.label, text: r.clue.text, object: r.clue.object, isNew: r.new });
      } catch (e) {
        showToast((e as Error).message, 'bad');
      } finally {
        busyRef.current = false;
      }
    },
    [sessionId, applyState, sound, showToast, showClue],
  );

  const tryDoor = useCallback(
    async (slot: number) => {
      const room = stateRef.current?.rooms[slot];
      if (!room || room.status === 'cleared' || busyRef.current) return;
      const mg = room.minigame;
      if (mg && mg.key_obtained && !mg.key_used) {
        busyRef.current = true;
        try {
          const r = await api.useKey(sessionId, slot, nameRef.current);
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
    [sessionId, applyState, sound, showToast, copy],
  );

  const openModal = useCallback(
    (m: Modal) => {
      setClueDoc(null);
      if (engineRef.current && pointerLockedRef.current) ownUnlockRef.current = true;
      engineRef.current?.unlockPointer();
      if (m && (m.kind === 'puzzle' || m.kind === 'minigame')) sound('open');
      setModal(m);
    },
    [sound],
  );

  /**
   * 창을 닫고 곧바로 조작으로 복귀 (버튼 클릭·Enter·I/M 키처럼 브라우저가 재고정을 허용하는 입력 직후).
   * Chrome 은 ESC 로 고정을 푼 직후 약 1초간 재고정을 거부하므로 한 번 더 시도하고,
   * 그래도 안 되면 메뉴 없이 그대로 둔다 (다음 클릭으로 바로 이어짐).
   */
  const closeAndResume = useCallback(() => {
    setModal(null);
    const eng = engineRef.current;
    if (!eng || stateRef.current?.status !== 'playing') return;
    eng.setInputEnabled(true);
    eng.lock().then((ok) => {
      if (ok) return;
      window.setTimeout(() => {
        if (modalRef.current || engineRef.current !== eng) return;
        void eng.lock();
      }, 1100);
    });
  }, []);

  /** ESC 로 창 닫기: ESC 는 브라우저가 재고정을 허용하지 않는 키라 시도하지 않는다 (→ 일시정지 메뉴가 뜨던 버그) */
  const closeOnly = useCallback(() => {
    setModal(null);
    if (stateRef.current?.status === 'playing') {
      engineRef.current?.setInputEnabled(true);
    }
  }, []);

  const pointerLockedRef = useRef(false);
  const handlersRef = useRef({ onInteract: (_t: InteractTarget) => {} });
  handlersRef.current.onInteract = (t: InteractTarget) => {
    if (stateRef.current?.status !== 'playing') return;
    if (t.kind === 'clue') inspect(t);
    else if (t.kind === 'door') tryDoor(t.slot);
    else openModal({ kind: t.kind, slot: t.slot });
  };

  // ---- 3D 엔진 (글꼴 로드 → 로딩 화면을 한 번 그린 뒤 생성) ----
  const worldKey = useMemo(
    () =>
      state
        ? JSON.stringify([
            settings.quality,
            state.theme.style,
            state.rooms.map((r) => [r.name, r.has_puzzle, r.minigame?.type ?? null, r.clues.map((c) => [c.id, c.label, c.object, c.pos])]),
          ])
        : '',
    [state, settings.quality],
  );

  useEffect(() => {
    if (!worldKey || !stateRef.current || !containerRef.current) return;
    let cancelled = false;
    let engine: EscapeEngine | null = null;
    setLoading(true);
    const fonts = document.fonts
      ? Promise.all(['150px "East Sea Dokdo"', '44px "Song Myung"', '14px "Nanum Gothic Coding"'].map((f) => document.fonts.load(f).catch(() => []))).then(() => document.fonts.ready)
      : Promise.resolve();
    Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))])
      .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .then(() => {
        if (cancelled || !containerRef.current || !stateRef.current) return;
        const s = stateRef.current;
        const st = settingsRef.current;
        engine = new EscapeEngine(containerRef.current, {
          rooms: toEngineRooms(s),
          style: s.theme.style,
          startPosition: posRef.current,
          audio: audioRef.current,
          quality: st.quality,
          sensitivity: st.sensitivity,
          fov: st.fov,
          motion: st.motion ? 1 : 0.2,
          onStamina: (v, ex) => setStamina({ v, ex }),
          onInteract: (t) => handlersRef.current.onInteract(t),
          onRoomChange: (slot) => setCurrentSlot(slot),
          onLockChange: (locked) => {
            pointerLockedRef.current = locked;
            setPointerLocked(locked);
            if (locked) {
              setStarted(true);
              audioRef.current?.start();
              if (modalRef.current?.kind === 'pause') setModal(null);
            } else if (ownUnlockRef.current) {
              ownUnlockRef.current = false;
            } else if (!modalRef.current && stateRef.current?.status === 'playing') {
              // ESC 등으로 마우스 고정이 풀림 → 일시정지 메뉴
              setModal({ kind: 'pause' });
            }
          },
          onFocusChange: setFocus,
          onScare: (k) => {
            setScare(k);
            later('scare', () => setScare(''), 1800);
          },
          onMark: (position) => send({ type: 'mark', position }),
          onCaption: (text) => pushCaption(text),
          onFps: setFps,
          onMove: ({ position, rotation, slot }) => {
            posRef.current = position;
            setMyPos(position);
            setMyYaw(rotation);
            send({ type: 'move', position, rotation, slot });
          },
        });
        engineRef.current = engine;
        engine.setRooms(toEngineRooms(s));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      engine?.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldKey]);

  useEffect(() => {
    if (state) engineRef.current?.setRooms(toEngineRooms(state));
  }, [state]);
  useEffect(() => engineRef.current?.setSensitivity(settings.sensitivity), [settings.sensitivity, loading]);
  useEffect(() => engineRef.current?.setFov(settings.fov), [settings.fov, loading]);
  useEffect(() => engineRef.current?.setMotion(settings.motion ? 1 : 0.2), [settings.motion, loading]);

  const others = useMemo(() => Object.values(players).filter((p) => p.id !== myId), [players, myId]);
  useEffect(() => {
    engineRef.current?.updateRemotePlayers(others);
  }, [others, loading]);

  const ended = status === 'escaped' || status === 'failed';
  const waiting = status === 'waiting';
  const inputBlocked = modal !== null || ended || waiting;
  useEffect(() => {
    engineRef.current?.setInputEnabled(!inputBlocked);
  }, [inputBlocked, loading]);

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
      if (e.code === 'Escape') {
        // 창이 열려 있으면 닫기만, 창 없이 마우스가 풀린 상태면 일시정지 메뉴
        if (cur) {
          if (cur.kind !== 'admin' && cur.kind !== 'minigame') closeOnly();
        } else if (!pointerLockedRef.current && stateRef.current?.status === 'playing' && startedRef.current) {
          setModal({ kind: 'pause' });
        }
        return;
      }
      if (!cur && pointerLockedRef.current) {
        if (e.code === 'Enter') {
          e.preventDefault();
          engineRef.current?.releaseKeys();
          chatInputRef.current?.focus(); // 마우스 고정은 그대로
        }
        if (e.code === 'KeyR' && lastClueRef.current) {
          const d = lastClueRef.current;
          setClueDoc({ ...d, key: `${d.key}-again-${Date.now()}`, isNew: false });
          later('doc', () => setClueDoc(null), Math.max(6000, d.text.length * 110));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openModal, closeAndResume, closeOnly]);
  const startedRef = useRef(false);
  startedRef.current = started;
  const lastClueRef = useRef<ClueDocData | null>(null);
  lastClueRef.current = lastClue;

  async function restart() {
    if (!state) return;
    setRestarting(true);
    try {
      const s = await api.createSession(state.theme.key, state.room_count, state.time_limit_min);
      send({ type: 'restart', session_id: s.id }); // 같은 방 팀원도 새 방으로
      onRestart(s.id);
    } catch (e) {
      showToast((e as Error).message, 'bad');
      setRestarting(false);
    }
  }

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
  const keyCount = state.inventory.filter((i) => i.kind === 'key' && !i.used).length;
  const clueCount = state.inventory.filter((i) => i.kind === 'clue').length;
  const lowTime = status === 'playing' && remaining < 300;
  const modalRoom = modal && 'slot' in modal ? state.rooms[modal.slot] : null;
  const objective = nextObjective(room, kind, currentSlot === state.rooms.length - 1);

  return (
    <div
      className={`game theme-${kind} ${scare ? `fx-${scare}` : ''} ${lowTime ? 'fx-low' : ''}`}
      style={{ '--noise': `url(${NOISE})`, '--grit': `url(${GRIT})`, '--glyphs': `url(${GLYPHS})` } as CSSProperties}
    >
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
        {objective && <div className="objective">▸ {objective}</div>}
        <div className="hud-progress">
          {state.rooms.map((r) => (
            <i key={r.slot} className={r.status} title={r.name} />
          ))}
        </div>
        {stamina.v < 0.995 && (
          <div className={`stamina ${stamina.ex ? 'ex' : ''}`} title="스태미나">
            <i style={{ width: `${stamina.v * 100}%` }} />
          </div>
        )}
        {lastClue && pointerLocked && !clueDoc && (
          <div className="hud-hint">
            <kbd>R</kbd> 최근 단서 · {lastClue.label}
          </div>
        )}
      </div>
      <div className="hud top-right">
        <div className="code">
          방 코드 <b>{state.id}</b> · {connected ? `${Object.keys(players).length}명 접속` : '연결 끊김'}
        </div>
        <div className="row">
          <button onClick={() => openModal({ kind: 'inventory' })} title="인벤토리 (I)">
            {kind === 'egypt' ? '📜' : '🗂'} <kbd>I</kbd>
            {clueCount + keyCount > 0 && (
              <span className="badge">
                {clueCount}
                {keyCount > 0 ? ` · 🔑${keyCount}` : ''}
              </span>
            )}
          </button>
          <button onClick={() => openModal({ kind: 'map' })} title="지도 (M)">
            🗺 <kbd>M</kbd>
          </button>
          <button onClick={() => openModal({ kind: 'pause' })} title="설정 · 일시정지 (ESC)">
            ⚙ <kbd>ESC</kbd>
          </button>
          <button onClick={() => openModal({ kind: 'admin' })} title="관리자">
            🛠
          </button>
        </div>
      </div>

      {everConnected && !connected && <div className="conn-banner">서버와 연결이 끊겼습니다 — 다시 연결하는 중…</div>}
      {loading && !waiting && (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <div>{kind === 'egypt' ? '무덤 안으로 들어가는 중…' : kind === 'horror' ? '시설에 접속하는 중…' : '방을 준비하는 중…'}</div>
        </div>
      )}

      {/* 첫 입장 (브라우저 정책상 첫 클릭은 꼭 필요) */}
      {!started && status === 'playing' && !modal && !loading && (
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
            <div className="intro-controls">{copy.controls} · Q 핑 · Enter 채팅 · ESC 메뉴</div>
          </div>
        </div>
      )}
      {waiting && (
        <WaitingRoom
          state={state}
          players={Object.values(players)}
          myId={myId}
          connected={connected}
          copy={copy}
          onReady={(ready) => send({ type: 'ready', ready })}
          onStartAlone={() => api.startSession(sessionId).then(applyState).catch((e) => showToast((e as Error).message, 'bad'))}
          onExit={onExit}
        />
      )}

      {scare && copy.scareText && <div className="scare-text">{copy.scareText}</div>}
      {captions.length > 0 && (
        <div className="captions" aria-live="polite">
          {captions.map((c) => (
            <div key={c.key}>{c.text}</div>
          ))}
        </div>
      )}
      {clueDoc && <ClueDoc doc={clueDoc} kind={kind} copy={copy} />}
      {toast && (
        <div key={toast.key} className={`toast toast-${toast.tone}`}>
          {toast.text}
        </div>
      )}

      <ChatPanel
        messages={messages}
        connected={connected}
        inputRef={chatInputRef}
        onSend={(text) => send({ type: 'chat', text })}
        onDone={() => {
          if (!pointerLockedRef.current && stateRef.current?.status === 'playing' && !modalRef.current) engineRef.current?.lock();
        }}
      />
      {started && !ended && <MiniStrip rooms={state.rooms} myPos={myPos} myYaw={myYaw} players={others} marks={marks} />}
      {settings.showFps && <div className="fps">{fps} FPS</div>}

      {modal?.kind === 'pause' && (
        <PauseMenu
          settings={settings}
          copy={copy}
          onChange={update}
          onReset={reset}
          onResume={closeAndResume}
          onAdmin={() => setModal({ kind: 'admin' })}
          onExit={onExit}
        />
      )}
      {modal?.kind === 'map' && (
        <MiniMap rooms={state.rooms} currentSlot={currentSlot} myPos={myPos} myName={me} players={others} marks={marks} title={copy.mapTitle} onClose={closeAndResume} />
      )}
      {modal?.kind === 'inventory' && <InventoryPanel state={state} title={copy.inventoryTitle} empty={copy.inventoryEmpty} onClose={closeAndResume} />}
      {modal?.kind === 'puzzle' && modalRoom && (
        <PuzzleModal
          key={modalRoom.slot}
          sessionId={sessionId}
          room={modalRoom}
          playerName={me}
          disabled={ended}
          kind={kind}
          copy={copy}
          remaining={remaining}
          hintPenalty={hintPenalty}
          onEscape={closeOnly}
          onClose={closeAndResume}
          onSolved={closeAndResume}
          onState={applyState}
          onSound={sound}
        />
      )}
      <Suspense fallback={null}>
        {modal?.kind === 'minigame' && modalRoom?.minigame && (
          <MiniGameModal
            key={modalRoom.slot}
            sessionId={sessionId}
            room={modalRoom}
            playerName={me}
            disabled={ended}
            kind={kind}
            copy={copy}
            onEscape={closeOnly}
            onClose={closeAndResume}
            onDone={closeAndResume}
            onState={applyState}
            onSound={sound}
          />
        )}
        {modal?.kind === 'admin' && <AdminPanel session={state} onClose={closeAndResume} />}
      </Suspense>

      {ended && modal?.kind !== 'admin' && (
        <ResultScreen state={state} remaining={remaining} copy={copy} restarting={restarting} onRestart={restart} onExit={onExit} />
      )}
    </div>
  );
}
