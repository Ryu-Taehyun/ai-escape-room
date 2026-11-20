// 결과 화면: 방별 걸린 시간, 팀원별 기여, 같은 설정으로 다시 하기
import { DIFFICULTY_LABEL } from '../types';
import type { SessionState } from '../types';
import type { ThemeCopy } from '../game/themeCopy';
import { formatTime } from '../utils';

interface Props {
  state: SessionState;
  remaining: number;
  copy: ThemeCopy;
  onRestart: () => void;
  onExit: () => void;
  restarting: boolean;
}

interface Contribution {
  name: string;
  clues: number;
  rooms: number;
  keys: number;
}

export default function ResultScreen({ state, remaining, copy, onRestart, onExit, restarting }: Props) {
  const escaped = state.status === 'escaped';
  const start = state.started_at ? Date.parse(state.started_at) : null;
  const end = state.ended_at ? Date.parse(state.ended_at) : Date.now();
  const total = start ? Math.max(0, Math.round((end - start) / 1000)) : null;

  // 방별 소요 시간 = 이전 방 클리어(또는 시작) ~ 이 방 클리어
  let prev = start;
  const splits = state.rooms.map((r) => {
    const at = r.cleared_at ? Date.parse(r.cleared_at) : null;
    const sec = at && prev ? Math.max(0, Math.round((at - prev) / 1000)) : null;
    if (at) prev = at;
    return { room: r, sec };
  });

  const byName = new Map<string, Contribution>();
  const get = (name: string) => {
    if (!byName.has(name)) byName.set(name, { name, clues: 0, rooms: 0, keys: 0 });
    return byName.get(name)!;
  };
  for (const item of state.inventory) {
    if (!item.obtained_by) continue;
    if (item.kind === 'clue') get(item.obtained_by).clues += 1;
    else get(item.obtained_by).keys += 1;
  }
  for (const r of state.rooms) if (r.cleared_by) get(r.cleared_by).rooms += 1;
  const team = [...byName.values()].sort((a, b) => b.rooms + b.clues + b.keys - (a.rooms + a.clues + a.keys));
  const clueCount = state.inventory.filter((i) => i.kind === 'clue').length;
  const cleared = state.rooms.filter((r) => r.status === 'cleared').length;

  return (
    <div className={`overlay result-overlay ${state.status}`}>
      <div className="panel result">
        <h1>{escaped ? copy.escapedTitle : copy.failedTitle}</h1>
        <span className={`diff-badge ${state.difficulty ?? 'normal'}`}>난이도 {DIFFICULTY_LABEL[state.difficulty ?? 'normal']}</span>
        {(escaped ? copy.escapedText : copy.failedText) && <p className="result-text">{escaped ? copy.escapedText : copy.failedText}</p>}

        <div className="result-kpis">
          <div>
            <b>{total !== null ? formatTime(total) : '—'}</b>
            <span>걸린 시간</span>
          </div>
          <div>
            <b>
              {cleared}/{state.room_count}
            </b>
            <span>클리어한 방</span>
          </div>
          <div>
            <b>{clueCount}</b>
            <span>찾은 단서</span>
          </div>
          <div>
            <b>{state.hints_used}</b>
            <span>힌트</span>
          </div>
          <div>
            <b>{formatTime(remaining)}</b>
            <span>남은 시간</span>
          </div>
        </div>

        <div className="result-cols">
          <section>
            <h3>방별 기록</h3>
            <ol className="result-splits">
              {splits.map(({ room, sec }) => (
                <li key={room.slot} className={room.status}>
                  <span>
                    {room.slot + 1}. {room.name}
                  </span>
                  <b>{sec !== null ? formatTime(sec) : room.status === 'cleared' ? '—' : '미완료'}</b>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3>팀 기여</h3>
            {team.length === 0 ? (
              <p className="muted">기록이 없습니다.</p>
            ) : (
              <table className="result-team">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>방</th>
                    <th>단서</th>
                    <th>열쇠</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td>{c.rooms}</td>
                      <td>{c.clues}</td>
                      <td>{c.keys}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="row result-actions">
          <button className="primary" disabled={restarting} onClick={onRestart}>
            {restarting ? '준비 중…' : '같은 설정으로 다시 하기'}
          </button>
          <button onClick={onExit}>{copy.toLobby}</button>
        </div>
      </div>
    </div>
  );
}
