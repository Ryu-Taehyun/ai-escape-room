import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { GameSocket } from '../api/socket';
import { EscapeEngine } from '../game/engine';
import type { EngineRoom, InteractTarget } from '../game/engine';
import MiniMap from '../components/MiniMap';
import PuzzleModal from '../components/PuzzleModal';
import ClueModal from '../components/ClueModal';
import DoorModal from '../components/DoorModal';
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

/** 현재 열려 있는 오버레이 (한 번에 하나) */
type Modal =
  | { kind: 'puzzle' | 'minigame' | 'door'; slot: number }
  | { kind: 'clue'; slot: number; id: string; label: string }
  | { kind: 'map' | 'inventory' | 'admin' }
  | null;

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
    minigame: r.minigame ? { title: r.minigame.title, key_obtained: r.minigame.key_obtained, key_used: r.minigame.key_used } : null,
  }));

/** 현재 방의 진행 상황 한 줄 요약 */
function objectiveSummary(room: SessionRoom): string {
  const parts = [`🔎 단서 ${room.clues.filter((c) => c.found).length}/${room.clues.length}`];
  if (room.has_puzzle) parts.push(room.puzzle_solved ? '🔓 암호 해제' : '🔒 암호');
  if (room.minigame) parts.push(room.minigame.key_used ? '🔑 사용 완료' : room.minigame.key_obtained ? '🔑 보유' : '🎮 미니게임');
  return parts.join(' · ');
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
  const [focus, setFocus] = useState<InteractTarget | null>(null);
  const [modal, setModal] = useState<Modal>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<EscapeEngine | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const deadlineRef = useRef(0);
  const posRef = useRef<Vec3>([0, 1.6, 2.5]);
  const expiredFetchRef = useRef(false);
  const statusRef = useRef<SessionState['status']>('playing');

  const pushMsg = useCallback((name: string, text: string, system = false) => {
    setMessages((m) => [...m.slice(-80), { id: String(++msgSeq), name, text, system }]);
  }, []);

  const applyState = useCallback((s: SessionState) => {
    setState(s);
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

  // ---- 타이머 (서버 remaining 기준 로컬 카운트다운) ----
  useEffect(() => {
    const id = window.setInterval(() => {
      if (statusRef.current !== 'playing') return; // 종료되면 타이머 정지
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

  // ---- 3D 엔진: 테마 스타일 / 방 구성(이름·단서·미니게임)이 바뀌면 재생성 (관리자 편집 반영) ----
  const worldKey = useMemo(
    () =>
      state
        ? JSON.stringify([
            state.theme.style,
            state.rooms.map((r) => [r.name, r.has_puzzle, !!r.minigame, r.clues.map((c) => [c.id, c.label, c.object, c.pos])]),
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
      onInteract: (t) => {
        if (t.kind === 'clue') setModal({ kind: 'clue', slot: t.slot, id: t.id!, label: t.label });
        else setModal({ kind: t.kind, slot: t.slot });
      },
      onRoomChange: (slot) => setCurrentSlot(slot),
      onLockChange: setPointerLocked,
      onFocusChange: setFocus,
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

  // ---- 오버레이가 열려 있으면 3D 입력 차단 ----
  const ended = state ? state.status !== 'playing' : false;
  const inputBlocked = modal !== null || ended;
  useEffect(() => {
    engineRef.current?.setInputEnabled(!inputBlocked);
  }, [inputBlocked, worldKey]);

  const open = useCallback((m: Modal) => {
    engineRef.current?.unlockPointer();
    setModal(m);
  }, []);
  const close = useCallback(() => setModal(null), []);
  const modalRef = useRef<Modal>(null);
  modalRef.current = modal;

  // ---- 단축키 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (e.code === 'KeyM') open(modalRef.current?.kind === 'map' ? null : { kind: 'map' });
      if (e.code === 'KeyI') open(modalRef.current?.kind === 'inventory' ? null : { kind: 'inventory' });
      if (e.code === 'Escape' && modalRef.current?.kind !== 'admin' && modalRef.current?.kind !== 'minigame') setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
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

  const FOCUS_VERB = { puzzle: '암호 입력', clue: '조사하기', minigame: '도전하기', door: '살펴보기' } as const;

  return (
    <div className="game">
      <div ref={containerRef} className="canvas-wrap" />
      {pointerLocked && <div className="crosshair">+</div>}
      {pointerLocked && focus && (
        <div className="focus-tip">
          [E] {FOCUS_VERB[focus.kind]} — {focus.label}
        </div>
      )}

      {/* HUD */}
      <div className="hud top-left">
        <div className={`timer ${remaining < 300 ? 'warn' : ''}`}>⏱ {formatTime(remaining)}</div>
        <div>{state.theme.name}</div>
        <div>
          현재: {currentSlot + 1}. {room?.name} {room?.status === 'cleared' ? '✅' : ''}
        </div>
        {room && room.status !== 'locked' && <div className="objective">{objectiveSummary(room)}</div>}
        <div>
          진행: {cleared}/{state.room_count} · 힌트 {state.hints_used}회
        </div>
      </div>
      <div className="hud top-right">
        <div className="code">
          방 코드 <b>{state.id}</b> · {connected ? `🟢 ${Object.keys(players).length}명` : '🔴 연결 끊김'}
        </div>
        <div className="row">
          <button onClick={() => open({ kind: 'inventory' })}>
            🎒 인벤토리 (I) {clueCount + keyCount > 0 && <span className="badge">{clueCount}{keyCount > 0 ? ` · 🔑${keyCount}` : ''}</span>}
          </button>
          <button onClick={() => open({ kind: 'map' })}>🗺 지도 (M)</button>
          <button onClick={() => open({ kind: 'admin' })}>🛠 관리자</button>
          <button onClick={onExit}>나가기</button>
        </div>
      </div>

      {!pointerLocked && !inputBlocked && (
        <div className="click-to-play">
          <h2>클릭하여 시작</h2>
          <p>WASD 이동 · Shift 달리기 · 마우스 시점 · E/클릭 조사 · I 인벤토리 · M 지도 · ESC 커서 해제</p>
          <p className="muted">✨ 반짝이는 물건을 조사해 단서를 모으고, 🎮 미니게임으로 열쇠를 얻어 🚪 문을 여세요.</p>
        </div>
      )}

      <ChatPanel messages={messages} connected={connected} onSend={(text) => socketRef.current?.send({ type: 'chat', text })} />

      {modal?.kind === 'map' && (
        <MiniMap rooms={state.rooms} currentSlot={currentSlot} myPos={myPos} myName={playerName} players={others} onClose={close} />
      )}
      {modal?.kind === 'inventory' && <InventoryPanel state={state} onClose={close} />}
      {modal?.kind === 'puzzle' && modalRoom && (
        <PuzzleModal key={modalRoom.slot} sessionId={sessionId} room={modalRoom} playerName={playerName} disabled={ended} onClose={close} onState={applyState} />
      )}
      {modal?.kind === 'clue' && (
        <ClueModal
          key={`${modal.slot}:${modal.id}`}
          sessionId={sessionId}
          slot={modal.slot}
          clueId={modal.id}
          label={modal.label}
          playerName={playerName}
          onClose={close}
          onState={applyState}
        />
      )}
      {modal?.kind === 'minigame' && modalRoom?.minigame && (
        <MiniGameModal key={modalRoom.slot} sessionId={sessionId} room={modalRoom} playerName={playerName} disabled={ended} onClose={close} onState={applyState} />
      )}
      {modal?.kind === 'door' && modalRoom && (
        <DoorModal key={modalRoom.slot} sessionId={sessionId} room={modalRoom} playerName={playerName} disabled={ended} onClose={close} onState={applyState} />
      )}
      {modal?.kind === 'admin' && <AdminPanel session={state} onClose={close} />}

      {ended && modal?.kind !== 'admin' && (
        <div className="overlay">
          <div className="panel result">
            <h1>{state.status === 'escaped' ? '🎉 탈출 성공!' : '💀 시간 초과'}</h1>
            <p>
              클리어 {cleared}/{state.room_count} · 단서 {clueCount}개 · 힌트 {state.hints_used}회 · 남은 시간 {formatTime(remaining)}
            </p>
            <button className="primary" onClick={onExit}>
              로비로
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
