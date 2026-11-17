import { useState } from 'react';
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

export default function PuzzleModal({ sessionId, room, playerName, disabled, onClose, onState }: Props) {
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const locked = room.status === 'locked';
  const cleared = room.status === 'cleared';

  async function submit() {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      const res = await api.submitAnswer(sessionId, room.slot, answer, playerName);
      setResult({ ok: res.correct, text: res.message });
      onState(res.state);
      if (res.correct) setAnswer('');
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function hint() {
    setBusy(true);
    try {
      const res = await api.hint(sessionId, room.slot, hints.length);
      setHints((h) => [...h, res.hint]);
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel puzzle" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>
            {room.slot + 1}. {room.name} {room.is_final && <small>(최종)</small>}
          </h2>
          <button onClick={onClose}>닫기 (ESC)</button>
        </div>
        <p className="desc">{room.description}</p>

        {locked ? (
          <p className="error">🔒 아직 잠긴 방입니다. 이전 방을 먼저 클리어하세요.</p>
        ) : (
          <>
            <pre className="question">{room.question}</pre>
            {cleared ? (
              <p className="ok">✅ 클리어 완료{room.cleared_by ? ` (by ${room.cleared_by})` : ''}</p>
            ) : room.puzzle_solved ? (
              <p className="ok">🔓 암호 해제 완료 — {room.minigame ? `문을 열려면 🔑 ${room.minigame.reward}이(가) 필요합니다.` : ''}</p>
            ) : (
              <div className="row">
                <input
                  autoFocus
                  value={answer}
                  placeholder="정답 입력"
                  disabled={disabled || busy}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                    if (e.key === 'Escape') onClose();
                  }}
                />
                <button className="primary" disabled={disabled || busy} onClick={submit}>
                  제출
                </button>
                <button disabled={disabled || busy} onClick={hint}>
                  AI 힌트 ({hints.length})
                </button>
              </div>
            )}
          </>
        )}

        {!locked && room.clues.length > 0 && (
          <div className="found-clues">
            <h3>
              🔎 이 방에서 찾은 단서 {room.clues.filter((c) => c.found).length} / {room.clues.length}
            </h3>
            {room.clues.filter((c) => c.found).map((c) => (
              <div key={c.id} className="inv-item">
                <b>{c.label}</b> — {c.text}
              </div>
            ))}
            {room.clues.some((c) => !c.found) && <p className="muted">아직 조사하지 않은 ✨반짝이는 물건이 방 안에 있습니다.</p>}
          </div>
        )}

        {hints.length > 0 && (
          <ul className="hints">
            {hints.map((h, i) => (
              <li key={i}>💡 {h}</li>
            ))}
          </ul>
        )}
        {result && <p className={result.ok ? 'ok' : 'error'}>{result.text}</p>}
      </div>
    </div>
  );
}
