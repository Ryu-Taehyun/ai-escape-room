// 화면 오른쪽 아래에 항상 보이는 작은 지도: 방 상태, 문, 나·팀원·핑 위치
import { ROOM_SIZE } from '../game/engine';
import type { RemotePlayer, SessionRoom, Vec3 } from '../types';

export interface MapMark {
  key: number;
  name: string;
  position: Vec3;
}

interface Props {
  rooms: SessionRoom[];
  myPos: Vec3;
  myYaw: number;
  players: RemotePlayer[];
  marks: MapMark[];
}

const S = 5; // world unit → px
const HALF = ROOM_SIZE / 2;

export default function MiniStrip({ rooms, myPos, myYaw, players, marks }: Props) {
  const w = rooms.length * ROOM_SIZE * S;
  const h = ROOM_SIZE * S;
  const X = (x: number) => (x + HALF) * S;
  const Y = (z: number) => (z + HALF) * S;
  return (
    <div className="ministrip" aria-hidden>
      <svg width={w + 4} height={h + 4} viewBox={`-2 -2 ${w + 4} ${h + 4}`}>
        {rooms.map((r, i) => (
          <g key={r.slot}>
            <rect x={i * ROOM_SIZE * S} y={0} width={ROOM_SIZE * S} height={h} className={`ms-room ${r.status}`} />
            {i < rooms.length - 1 && <rect x={(i + 1) * ROOM_SIZE * S - 1.5} y={Y(-1)} width={3} height={2 * S} className={rooms[i + 1].status === 'locked' ? 'ms-door locked' : 'ms-door'} />}
          </g>
        ))}
        {marks.map((m) => (
          <circle key={m.key} cx={X(m.position[0])} cy={Y(m.position[2])} r={3.5} className="ms-mark" />
        ))}
        {players.map((p) => (
          <circle key={p.id} cx={X(p.position[0])} cy={Y(p.position[2])} r={3} className="ms-mate" />
        ))}
        <g transform={`translate(${X(myPos[0])},${Y(myPos[2])}) rotate(${(-myYaw * 180) / Math.PI})`}>
          <path d="M0,-6 L4,4 L0,2 L-4,4 Z" className="ms-me" />
        </g>
      </svg>
    </div>
  );
}
