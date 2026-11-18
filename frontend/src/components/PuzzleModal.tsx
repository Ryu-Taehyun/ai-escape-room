// 단말기(공포: CRT 터미널) / 비문(이집트: 석판) 퍼즐 창
// 정답이면 성공 연출 후 자동으로 닫히고 바로 게임으로 돌아간다.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { SessionRoom, SessionState } from '../types';
import type { ThemeCopy, ThemeKind } from '../game/themeCopy';
import type { SfxName } from '../game/audio';

interface Props {
  sessionId: string;
  room: SessionRoom;
  playerName: string;
  disabled: boolean;
  kind: ThemeKind;
  copy: ThemeCopy;
  onClose: () => void;
  onSolved: () => void;
  onState: (s: SessionState) => void;
  onSound: (name: SfxName) => void;
}

type Status = 'idle' | 'busy' | 'denied' | 'granted';

export default function PuzzleModal({ sessionId, room, playerName, disabled, kind, copy, onClose, onSolved, onState, onSound }: Props) {
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [hints, setHints] = useState<string[]>([]);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number>();

  const solved = room.status === 'cleared' || room.puzzle_solved;
  const found = room.clues.filter((c) => c.found);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 350);
    return () => window.clearTimeout(id);
  }, []);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!answer.trim() || status === 'busy' || status === 'granted') return;
    setStatus('busy');
    try {
      const res = await api.submitAnswer(sessionId, room.slot, answer, playerName);
      onState(res.state);
      if (res.correct) {
        setStatus('granted');
        onSound('success');
        const needKey = room.minigame && !room.minigame.key_used;
        setMessage(needKey ? copy.solvedNeedKey(room.minigame!.reward) : copy.granted);
        // 사용자 입력 직후(5초 이내)라 브라우저가 마우스 재고정을 허용한다
        closeTimer.current = window.setTimeout(onSolved, needKey ? 2200 : 1300);
      } else {
        setStatus('denied');
        setMessage(copy.denied);
        onSound('fail');
        setShake((n) => n + 1);
        setAnswer('');
        inputRef.current?.focus();
      }
    } catch (err) {
      setStatus('denied');
      setMessage((err as Error).message);
    }
  }

  async function hint() {
    try {
      const res = await api.hint(sessionId, room.slot, hints.length);
      setHints((h) => [...h, res.hint]);
      onSound('type');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <div className={`overlay pz-overlay pz-${kind}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`pz pz-${status} ${shake ? `shake-${shake % 2}` : ''}`}>
        <div className="pz-head">
          <span className="pz-sys">
            {copy.puzzleSystem} {String(room.slot + 1).padStart(2, '0')}
          </span>
          <button type="button" className="pz-close" onClick={onClose}>
            {copy.close} <kbd>ESC</kbd>
          </button>
        </div>

        <div className="pz-screen">
          <div className="pz-boot">
            {copy.puzzleBoot(room.name).map((line, i) => (
              <p key={i} style={{ animationDelay: `${i * 140}ms` }}>
                {line}
              </p>
            ))}
          </div>
          <p className="pz-desc">{room.description}</p>
          <pre className="pz-question">{room.question}</pre>

          {room.clues.length > 0 && (
            <div className="pz-clues">
              <div className="pz-label">
                {copy.cluesHeader} {found.length}/{room.clues.length}
              </div>
              {found.map((c) => (
                <div key={c.id} className="pz-clue">
                  <b>{c.label}</b> {c.text}
                </div>
              ))}
              {found.length < room.clues.length && <div className="pz-missing">{copy.cluesMissing}</div>}
            </div>
          )}

          {hints.length > 0 && (
            <div className="pz-hints">
              <div className="pz-label">{copy.hintLabel}</div>
              {hints.map((h, i) => (
                <div key={i} className="pz-hint">
                  {h}
                </div>
              ))}
            </div>
          )}

          {message && <div className={`pz-message ${status === 'granted' ? 'good' : 'bad'}`}>{message}</div>}

          {solved && status !== 'granted' ? (
            <div className="pz-message good">{copy.granted}</div>
          ) : (
            status !== 'granted' && (
              <form className="pz-input" onSubmit={submit}>
                <span className="pz-prompt">{copy.prompt}</span>
                <input
                  ref={inputRef}
                  value={answer}
                  placeholder={copy.inputPlaceholder}
                  disabled={disabled || status === 'busy'}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') onClose();
                    else if (e.key.length === 1 && kind === 'horror') onSound('type');
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" className="pz-btn primary" disabled={disabled || status === 'busy'}>
                  {copy.submit}
                </button>
                <button type="button" className="pz-btn" disabled={disabled} onClick={hint}>
                  {copy.hint}
                </button>
              </form>
            )
          )}
        </div>
      </div>
    </div>
  );
}
