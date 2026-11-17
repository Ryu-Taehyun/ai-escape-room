// 팀 공유 인벤토리 (I): 방별로 찾은 단서와 열쇠
import type { SessionState } from '../types';

interface Props {
  state: SessionState;
  onClose: () => void;
}

export default function InventoryPanel({ state, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel inventory" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>🎒 팀 인벤토리</h2>
          <button onClick={onClose}>닫기 (I)</button>
        </div>
        {state.inventory.length === 0 && <p className="muted">아직 아무것도 찾지 못했습니다. 방 안의 반짝이는 물건을 조사해 보세요.</p>}
        {state.rooms.map((room) => {
          const items = state.inventory.filter((i) => i.slot === room.slot);
          if (items.length === 0) return null;
          const keys = items.filter((i) => i.kind === 'key');
          const clues = items.filter((i) => i.kind === 'clue');
          return (
            <section key={room.slot} className="inv-room">
              <h3>
                {room.slot + 1}. {room.name}{' '}
                <small>
                  단서 {room.clues.filter((c) => c.found).length}/{room.clues.length}
                </small>
              </h3>
              {keys.map((k) => (
                <div key={k.ref_id} className={`inv-item key ${k.used ? 'used' : ''}`}>
                  🔑 <b>{k.name}</b> {k.used ? '(사용함)' : '(미사용 — 문에서 E)'} <small>by {k.obtained_by}</small>
                </div>
              ))}
              {clues.map((c) => (
                <div key={c.ref_id} className="inv-item">
                  🔎 <b>{c.name}</b> — {c.text} <small>by {c.obtained_by}</small>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
