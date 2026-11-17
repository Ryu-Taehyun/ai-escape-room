// 닫힌 문: 이 방의 탈출 조건 체크리스트 + 열쇠 사용
import { useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { SessionRoom, SessionState } from '../types';

interface Props {
  sessionId: string;
  room: SessionRoom;
  playerName: string;
  disabled: boolean;
  onClose: () => void;
  onState: (s: SessionState) => void;
}

export default function DoorModal({ sessionId, room, playerName, disabled, onClose, onState }: Props) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mg = room.minigame;
  const found = room.clues.filter((c) => c.found).length;

  async function useKey() {
    setBusy(true);
    try {
      const r = await api.useKey(sessionId, room.slot, playerName);
      setMsg({ ok: true, text: r.message });
      onState(r.state);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const Check = ({ done, children }: { done: boolean; children: ReactNode }) => (
    <li className={done ? 'done' : ''}>
      {done ? '✅' : '⬜'} {children}
    </li>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel door" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>🚪 {room.is_final ? '최종 탈출문' : `${room.slot + 1}번 방 출구`}</h2>
          <button onClick={onClose}>닫기 (ESC)</button>
        </div>
        {room.status === 'cleared' ? (
          <p className="ok">문이 열려 있습니다.</p>
        ) : (
          <>
            <p className="muted">문을 열기 위한 조건</p>
            <ul className="checklist">
              {room.clues.length > 0 && (
                <Check done={found === room.clues.length}>
                  단서 조사 {found} / {room.clues.length} <small>(선택)</small>
                </Check>
              )}
              {room.has_puzzle && <Check done={room.puzzle_solved}>단말기 암호 해제</Check>}
              {mg && <Check done={mg.key_obtained}>미니게임 「{mg.title}」 통과 → 🔑 {mg.reward}</Check>}
              {mg && <Check done={mg.key_used}>문에 열쇠 사용</Check>}
            </ul>
            {mg && mg.key_obtained && !mg.key_used && (
              <button className="primary" disabled={busy || disabled} onClick={useKey}>
                🔑 {mg.reward} 사용
              </button>
            )}
            {!mg && <p className="muted">이 문은 열쇠가 필요 없습니다. 암호를 풀면 자동으로 열립니다.</p>}
          </>
        )}
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      </div>
    </div>
  );
}
