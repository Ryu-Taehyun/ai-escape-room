// 단서 조사: 서버에 조사 요청 → 내용 표시 + 팀 인벤토리에 추가
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Clue, SessionState } from '../types';

interface Props {
  sessionId: string;
  slot: number;
  clueId: string;
  label: string;
  playerName: string;
  onClose: () => void;
  onState: (s: SessionState) => void;
}

const ICON: Record<string, string> = { note: '📝', board: '📋', book: '📖', tablet: '🪨', statue: '🗿', jar: '🏺', box: '📦' };

export default function ClueModal({ sessionId, slot, clueId, label, playerName, onClose, onState }: Props) {
  const [clue, setClue] = useState<Clue | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .inspectClue(sessionId, slot, clueId, playerName)
      .then((r) => {
        setClue(r.clue);
        setIsNew(r.new);
        onState(r.state);
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, slot, clueId]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel clue" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>
            {ICON[clue?.object ?? 'note'] ?? '🔎'} {label}
          </h2>
          <button onClick={onClose}>닫기 (ESC)</button>
        </div>
        {error && <p className="error">{error}</p>}
        {!clue && !error && <p className="muted">조사하는 중...</p>}
        {clue && (
          <>
            <blockquote className="clue-text">{clue.text}</blockquote>
            <p className={isNew ? 'ok' : 'muted'}>{isNew ? '✨ 새 단서! 팀 인벤토리(I)에 추가되었습니다.' : '이미 팀이 발견한 단서입니다.'}</p>
          </>
        )}
      </div>
    </div>
  );
}
