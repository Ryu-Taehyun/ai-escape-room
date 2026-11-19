// 미니게임 → 열쇠 획득: 소개 → (서버에서 문제 받기) → 플레이 → 서버 검증 → 결과
// 통과하면 잠시 후 자동으로 닫히고 바로 게임으로 돌아간다.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { MinigameChallenge, SessionRoom, SessionState } from '../../types';
import type { ThemeCopy, ThemeKind } from '../../game/themeCopy';
import type { SfxName } from '../../game/audio';
import SequenceGame from './SequenceGame';
import WiresGame from './WiresGame';
import TimingGame from './TimingGame';

interface Props {
  sessionId: string;
  room: SessionRoom;
  playerName: string;
  disabled: boolean;
  kind: ThemeKind;
  copy: ThemeCopy;
  onClose: () => void;
  onEscape: () => void; // ESC 로 닫기 (재고정 시도 안 함)
  onDone: () => void;
  onState: (s: SessionState) => void;
  onSound: (name: SfxName) => void;
}

const TYPE_LABEL = { sequence: '기억력', wires: '전선 연결', timing: '타이밍' } as const;

export default function MiniGameModal({ sessionId, room, playerName, disabled, kind, copy, onClose, onEscape, onDone, onState, onSound }: Props) {
  const mg = room.minigame!;
  const [challenge, setChallenge] = useState<MinigameChallenge | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const doneTimer = useRef<number>();

  useEffect(() => () => window.clearTimeout(doneTimer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // E / Q 로도 닫기 (키 입력은 브라우저가 마우스 재고정을 허용함)
      if ((e.code === 'KeyE' || e.code === 'KeyQ') && !challenge) onClose();
      if (e.code === 'Escape' && !challenge) onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [challenge, onClose, onEscape]);

  async function start() {
    setBusy(true);
    setResult(null);
    try {
      setChallenge(await api.startMinigame(sessionId, room.slot));
      setAttempt((a) => a + 1);
      onSound('open');
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function finish(res: object) {
    if (!challenge) return;
    try {
      const r = await api.finishMinigame(sessionId, room.slot, challenge.challenge_id, res, playerName);
      setResult({ ok: r.success, text: r.message });
      onState(r.state);
      if (r.success) {
        onSound('key');
        doneTimer.current = window.setTimeout(onDone, 1600);
      } else onSound('fail');
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setChallenge(null);
    }
  }

  const playing = challenge && !result;

  return (
    <div className={`overlay mg-overlay mg-${kind}`}>
      <div className="panel minigame mg-frame">
        <div className="panel-head">
          <h2>
            <small className="mg-kicker">{copy.minigameFrame}</small>
            {mg.title} <small>· {TYPE_LABEL[mg.type]}</small>
          </h2>
          <button onClick={onClose}>{playing ? '포기' : copy.close}</button>
        </div>
        <p className="desc">{mg.description}</p>
        <p className="mg-reward">
          보상 <b>🔑 {mg.reward}</b>
        </p>

        {mg.key_obtained ? (
          <p className="ok">{copy.minigameDone}</p>
        ) : playing ? (
          <div className="mg-stage" key={`${challenge.challenge_id}-${attempt}`}>
            {challenge.type === 'sequence' && <SequenceGame params={challenge.params as never} onDone={finish} />}
            {challenge.type === 'wires' && <WiresGame params={challenge.params as never} onDone={finish} />}
            {challenge.type === 'timing' && <TimingGame params={challenge.params as never} onDone={finish} />}
          </div>
        ) : (
          <button className="primary mg-start" disabled={busy || disabled} onClick={start}>
            {result && !result.ok ? copy.minigameRetry : copy.minigameStart}
          </button>
        )}

        {result && <p className={`mg-result ${result.ok ? 'ok' : 'error'}`}>{result.text}</p>}
      </div>
    </div>
  );
}
