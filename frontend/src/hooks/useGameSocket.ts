// 협동 WebSocket: 접속자·위치·채팅·대기실·핑
import { useCallback, useEffect, useRef, useState } from 'react';
import { GameSocket } from '../api/socket';
import type { ChatMessage, RemotePlayer, Vec3 } from '../types';

let msgSeq = 0;

export interface MarkEvent {
  playerId: string;
  name: string;
  position: Vec3;
}

interface Options {
  sessionId: string;
  playerName: string;
  onStateChanged: () => void;
  onMark: (m: MarkEvent) => void;
  /** 팀원이 결과 화면에서 "다시 하기"를 눌러 새 방을 만들었을 때 */
  onRestart: (sessionId: string, by: string) => void;
  initialPosition: () => Vec3;
}

export function useGameSocket({ sessionId, playerName, onStateChanged, onMark, onRestart, initialPosition }: Options) {
  const socketRef = useRef<GameSocket | null>(null);
  const [players, setPlayers] = useState<Record<string, RemotePlayer>>({});
  const [myId, setMyId] = useState('');
  const [myName, setMyName] = useState(''); // 서버가 정한 이름 (같은 닉네임이 있으면 "이름 (2)")
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const cbs = useRef({ onStateChanged, onMark, onRestart, initialPosition });
  cbs.current = { onStateChanged, onMark, onRestart, initialPosition };

  const pushMsg = useCallback((name: string, text: string, system = false) => {
    setMessages((m) => [...m.slice(-80), { id: String(++msgSeq), name, text, system }]);
  }, []);

  useEffect(() => {
    const sock = new GameSocket(sessionId, playerName);
    socketRef.current = sock;
    const byId = (list: RemotePlayer[]) => Object.fromEntries(list.map((p) => [p.id, p]));
    const offs = [
      sock.on('_open', () => {
        setConnected(true);
        setEverConnected(true);
        cbs.current.onStateChanged(); // 재연결 시 상태 다시 맞춤
      }),
      sock.on('_close', (m) => {
        setConnected(false);
        const why: Record<number, string> = {
          4409: '방 인원이 가득 찼습니다 (최대 8명).',
          4403: '허용되지 않은 주소에서 접속했습니다.',
          4429: '접속 시도가 너무 많습니다. 잠시 후 다시 연결합니다.',
        };
        if (why[m.code]) pushMsg('', why[m.code], true);
      }),
      sock.on('welcome', (m) => {
        setMyId(m.player_id);
        setMyName(m.name ?? '');
        setPlayers(byId(m.players));
        sock.send({ type: 'move', position: cbs.current.initialPosition(), rotation: 0, slot: 0 });
      }),
      sock.on('lobby', (m) => setPlayers((prev) => {
        const next = byId(m.players as RemotePlayer[]);
        // 위치는 기존 값 유지 (lobby 메시지는 준비 상태 갱신용)
        for (const id of Object.keys(next)) if (prev[id]) next[id] = { ...prev[id], ready: next[id].ready };
        return next;
      })),
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
      sock.on('state_changed', () => cbs.current.onStateChanged()),
      sock.on('content_updated', () => cbs.current.onStateChanged()),
      sock.on('mark', (m) => cbs.current.onMark({ playerId: m.player_id, name: m.name, position: m.position })),
      sock.on('restart', (m) => cbs.current.onRestart(m.session_id, m.by)),
    ];
    sock.connect();
    return () => {
      offs.forEach((off) => off());
      sock.close();
      socketRef.current = null;
    };
  }, [sessionId, playerName, pushMsg]);

  const send = useCallback((msg: object) => socketRef.current?.send(msg), []);

  return { players, myId, myName, connected, everConnected, messages, pushMsg, send };
}
