// 대기실: 방 코드 공유 + 접속자 준비 상태. 모두 준비하면 서버가 자동으로 시작한다.
import { useState } from 'react';
import { DIFFICULTY_LABEL } from '../types';
import type { RemotePlayer, SessionState } from '../types';
import type { ThemeCopy } from '../game/themeCopy';

interface Props {
  state: SessionState;
  players: RemotePlayer[];
  myId: string;
  connected: boolean;
  copy: ThemeCopy;
  onReady: (ready: boolean) => void;
  onStartAlone: () => void;
  onExit: () => void;
}

export default function WaitingRoom({ state, players, myId, connected, copy, onReady, onStartAlone, onExit }: Props) {
  const [copied, setCopied] = useState(false);
  const me = players.find((p) => p.id === myId);
  const readyCount = players.filter((p) => p.ready).length;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(state.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 거부 — 코드는 화면에 그대로 보임 */
    }
  }

  return (
    <div className="overlay waiting-overlay">
      <div className="panel waiting">
        <div className="intro-eyebrow">{copy.introEyebrow}</div>
        <h2>대기실</h2>
        <p className="muted">
          {state.theme.name} · 난이도 {DIFFICULTY_LABEL[state.difficulty ?? 'normal']} · 방 {state.room_count}개 · {state.time_limit_min}분 — 타이머는 시작할 때부터 흐릅니다.
        </p>

        <div className="wr-code">
          <span>방 코드</span>
          <b>{state.id}</b>
          <button onClick={copyCode}>{copied ? '복사됨' : '복사'}</button>
        </div>
        <p className="muted small">친구에게 방 코드를 알려 주면 로비의 "친구 방 참가"로 들어올 수 있습니다.</p>

        <ul className="wr-players">
          {players.map((p) => (
            <li key={p.id} className={p.ready ? 'ready' : ''}>
              <span className="wr-dot" />
              <b>{p.name}</b>
              {p.id === myId && <small>(나)</small>}
              <em>{p.ready ? '준비 완료' : '대기 중'}</em>
            </li>
          ))}
          {players.length === 0 && <li className="muted">{connected ? '접속자를 불러오는 중…' : '서버에 연결하는 중…'}</li>}
        </ul>

        <div className="wr-actions">
          <button className={`primary ${me?.ready ? 'is-ready' : ''}`} disabled={!connected || !me} onClick={() => onReady(!me?.ready)}>
            {me?.ready ? '준비 취소' : '준비 완료'}
          </button>
          {players.length <= 1 && <button onClick={onStartAlone}>혼자 바로 시작</button>}
          <button onClick={onExit}>나가기</button>
        </div>
        <p className="muted small">
          준비 {readyCount}/{players.length} — 모두 준비하면 자동으로 시작합니다.
        </p>
      </div>
    </div>
  );
}
