// 미니게임 → 열쇠 획득 흐름: 소개 → (서버에서 문제 받기) → 플레이 → 서버 검증 → 결과
import { useState } from 'react';
import { api } from '../../api/client';
import type { MinigameChallenge, SessionRoom, SessionState } from '../../types';
import SequenceGame from './SequenceGame';
import WiresGame from './WiresGame';
import TimingGame from './TimingGame';

interface Props {
  sessionId: string;
  room: SessionRoom;
  playerName: string;
  disabled: boolean;
  onClose: () => void;
  onState: (s: SessionState) => void;
}

const TYPE_LABEL = { sequence: '기억력', wires: '전선 연결', timing: '타이밍' } as const;

export default function MiniGameModal({ sessionId, room, playerName, disabled, onClose, onState }: Props) {
  const mg = room.minigame!;
  const [challenge, setChallenge] = useState<MinigameChallenge | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  async function start() {
    setBusy(true);
    setResult(null);
    try {
      setChallenge(await api.startMinigame(sessionId, room.slot));
      setAttempt((a) => a + 1);
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
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setChallenge(null);
    }
  }

  const playing = challenge && !result;

  return (
    <div className="overlay">
      <div className="panel minigame" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>
            🎮 {mg.title} <small>({TYPE_LABEL[mg.type]})</small>
          </h2>
          <button onClick={onClose}>{playing ? '포기' : '닫기'}</button>
        </div>
        <p className="desc">{mg.description}</p>
        <p>
          보상: <b>🔑 {mg.reward}</b>
        </p>

        {mg.key_obtained ? (
          <p className="ok">
            이미 열쇠를 얻었습니다. {mg.key_used ? '(사용 완료)' : '문으로 가서 E를 눌러 사용하세요.'}
          </p>
        ) : playing ? (
          <div className="mg-stage" key={`${challenge.challenge_id}-${attempt}`}>
            {challenge.type === 'sequence' && <SequenceGame params={challenge.params as never} onDone={finish} />}
            {challenge.type === 'wires' && <WiresGame params={challenge.params as never} onDone={finish} />}
            {challenge.type === 'timing' && <TimingGame params={challenge.params as never} onDone={finish} />}
          </div>
        ) : (
          <button className="primary" disabled={busy || disabled} onClick={start}>
            {result && !result.ok ? '다시 도전' : '도전 시작'}
          </button>
        )}

        {result && <p className={result.ok ? 'ok' : 'error'}>{result.text}</p>}
      </div>
    </div>
  );
}
