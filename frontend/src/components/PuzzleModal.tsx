// 단말기(공포: CRT 터미널) / 비문(이집트: 석판) / 번호 자물쇠(붉은 서재) 퍼즐 창
// 정답이면 성공 연출 후 자동으로 닫히고 바로 게임으로 돌아간다.
// 화면은 두 칸으로 나뉜다:
//   왼쪽 '문제' — 지시문, 모은 단서, 답 입력
//   오른쪽 '힌트' — 다른 색의 별도 카드. 남은 힌트 수와 감점(제한 시간 30분마다 1분)을 먼저 보여 주고,
//                   한 번 더 확인해야 시간이 줄어든다 (실수로 시간을 잃지 않게)
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { SessionRoom, SessionState } from '../types';
import type { ThemeCopy, ThemeKind } from '../game/themeCopy';
import type { SfxName } from '../game/audio';
import { formatPenalty, formatTime } from '../utils';

interface Props {
  sessionId: string;
  room: SessionRoom;
  playerName: string;
  disabled: boolean;
  kind: ThemeKind;
  copy: ThemeCopy;
  remaining: number;
  hintPenalty: number; // 힌트 1회당 줄어드는 시간(초)
  timeLimitMin?: number; // 이 게임의 제한 시간(분) — 감점 규칙 안내용
  onClose: () => void;
  onEscape: () => void; // ESC 로 닫기 (재고정 시도 안 함)
  phone?: boolean;
  onSolved: () => void;
  onState: (s: SessionState) => void;
  onSound: (name: SfxName) => void;
}

type Status = 'idle' | 'busy' | 'denied' | 'granted';

export default function PuzzleModal({ sessionId, room, playerName, disabled, kind, copy, remaining, hintPenalty, timeLimitMin, phone = false, onClose, onEscape, onSolved, onState, onSound }: Props) {
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [hints, setHints] = useState<string[]>([]);
  const [shake, setShake] = useState(0);
  const [tries, setTries] = useState<string[]>([]);
  const [confirmHint, setConfirmHint] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [hintError, setHintError] = useState('');
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
        setTries((t) => [answer.trim(), ...t].slice(0, 6));
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

  const hintTotal = room.hint_count ?? 0;
  const hintsLeft = Math.max(0, hintTotal - hints.length);
  const penaltyText = hintPenalty > 0 ? formatPenalty(hintPenalty) : '';

  async function hint() {
    if (hintBusy) return;
    setHintBusy(true);
    setHintError('');
    try {
      const res = await api.hint(sessionId, room.slot, hints.length);
      setHints((h) => [...h, res.hint]);
      onSound('type');
    } catch (err) {
      setHintError((err as Error).message);
    } finally {
      setHintBusy(false);
      setConfirmHint(false);
      inputRef.current?.focus();
    }
  }

  /** 첫 클릭은 확인만 (감점이 있을 때), 두 번째 클릭에서 힌트를 연다 */
  function askHint() {
    if (hintPenalty > 0 && !confirmHint) setConfirmHint(true);
    else hint();
  }

  return (
    <div className={`overlay pz-overlay pz-${kind}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`pz pz-${status} ${shake ? `shake-${shake % 2}` : ''}`}>
        <div className="pz-head">
          <span className="pz-sys">
            {phone ? "휴대폰 잠금 화면" : `${copy.puzzleSystem} ${String(room.slot + 1).padStart(2, '0')}`}
          </span>
          <span className={`pz-timer ${remaining < 300 ? 'warn' : ''}`} title={copy.timerLabel}>
            ⏳ {formatTime(remaining)}
          </span>
          <button type="button" className="pz-close" onClick={onClose}>
            {copy.close} <kbd>ESC</kbd>
          </button>
        </div>

        <div className="pz-body">
          <section className="pz-screen pz-main" aria-label="문제">
            <div className="pz-tab">🔐 문제</div>
            <div className="pz-boot">
              {(phone ? ["잠긴 휴대폰입니다. 방 안의 기록을 대조해 비밀번호를 입력하세요."] : copy.puzzleBoot(room.name)).map((line, i) => (
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

            {message && <div className={`pz-message ${status === 'granted' ? 'good' : 'bad'}`}>{message}</div>}
            {tries.length > 0 && status !== 'granted' && (
              <div className="pz-tries">
                시도한 답 ({tries.length}): {tries.map((t, i) => <s key={i}>{t}</s>)}
              </div>
            )}

            {solved && status !== 'granted' ? (
              <div className="pz-message good">{copy.granted}</div>
            ) : (
              status !== 'granted' && (
                <form className="pz-input" onSubmit={submit}>
                  <span className="pz-prompt">{copy.prompt}</span>
                  <input
                    ref={inputRef}
                    type={phone ? 'password' : 'text'}
                    inputMode={phone ? 'numeric' : 'text'}
                    value={answer}
                    placeholder={copy.inputPlaceholder}
                    disabled={disabled || status === 'busy'}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') onEscape();
                      else if (e.key.length === 1 && kind === 'horror') onSound('type');
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="submit" className="pz-btn primary" disabled={disabled || status === 'busy'}>
                    {phone ? '잠금 해제' : copy.submit}
                  </button>
                </form>
              )
            )}
          </section>

          <aside className={`pz-hintbox ${hints.length ? 'used' : ''}`} aria-label="힌트">
            <div className="hb-head">
              <span className="hb-title">💡 {copy.hintLabel}</span>
              <span className="hb-count" title="사용한 힌트 / 전체 힌트">
                {hints.length}/{hintTotal}
              </span>
            </div>
            <div className="hb-rule">
              {hintPenalty > 0 ? (
                <>
                  1회 사용 시 제한 시간 <b>−{penaltyText}</b>
                  <small>
                    {timeLimitMin ? `${timeLimitMin}분 게임 · ` : ''}제한 시간 30분마다 1분
                  </small>
                </>
              ) : (
                <>힌트를 써도 시간이 줄지 않습니다</>
              )}
            </div>

            <ol className="hb-list">
              {hints.map((h, i) => (
                <li key={i} className="hb-item">
                  <span className="hb-no">{i + 1}</span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
            {!hints.length && <div className="hb-empty">막히면 힌트를 열어 보세요. 단서를 모두 모은 뒤에 쓰는 것이 좋습니다.</div>}
            {hintError && <div className="hb-error">{hintError}</div>}

            {!solved && status !== 'granted' && (
              hintsLeft > 0 ? (
                confirmHint ? (
                  <div className="hb-confirm" role="alertdialog">
                    <p>
                      남은 시간이 <b>{penaltyText}</b> 줄어듭니다. 힌트를 볼까요?
                    </p>
                    <div className="hb-actions">
                      <button type="button" className="hb-btn danger" disabled={disabled || hintBusy} onClick={hint} autoFocus>
                        −{penaltyText} 하고 보기
                      </button>
                      <button type="button" className="hb-btn ghost" onClick={() => setConfirmHint(false)}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="hb-btn" disabled={disabled || hintBusy} onClick={askHint}>
                    {copy.hint} 열기 <small>({hintsLeft}개 남음{penaltyText ? ` · −${penaltyText}` : ''})</small>
                  </button>
                )
              ) : (
                <div className="hb-empty">더 이상 힌트가 없습니다.</div>
              )
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
