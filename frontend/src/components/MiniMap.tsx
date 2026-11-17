import { MINIGAME_POS, PUZZLE_POS, ROOM_SIZE } from '../game/engine';
import type { RemotePlayer, SessionRoom, Vec3 } from '../types';

interface Props {
  rooms: SessionRoom[];
  currentSlot: number;
  myPos: Vec3;
  myName: string;
  players: RemotePlayer[];
  onClose: () => void;
}

const SCALE = 18; // world unit → px
const HALF = ROOM_SIZE / 2;

const STATUS = {
  cleared: { fill: '#1f5f35', icon: '✅', label: '클리어' },
  unlocked: { fill: '#5f5420', icon: '🔓', label: '진행 가능' },
  locked: { fill: '#333', icon: '🔒', label: '잠김' },
} as const;

const toX = (x: number) => (x + HALF) * SCALE;
const toY = (z: number) => (z + HALF) * SCALE;

export default function MiniMap({ rooms, currentSlot, myPos, myName, players, onClose }: Props) {
  const width = rooms.length * ROOM_SIZE * SCALE;
  const height = ROOM_SIZE * SCALE;
  const cleared = rooms.filter((r) => r.status === 'cleared').length;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel map-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>지도</h2>
          <span>
            클리어 {cleared} / {rooms.length}
          </span>
          <button onClick={onClose}>닫기 (M)</button>
        </div>

        <div className="map-scroll">
          <svg width={width + 4} height={height + 4} viewBox={`-2 -2 ${width + 4} ${height + 4}`}>
            {rooms.map((r, i) => {
              const s = STATUS[r.status];
              const x = i * ROOM_SIZE * SCALE;
              return (
                <g key={r.slot}>
                  <rect
                    x={x}
                    y={0}
                    width={ROOM_SIZE * SCALE}
                    height={height}
                    fill={s.fill}
                    stroke={i === currentSlot ? '#fff' : '#111'}
                    strokeWidth={i === currentSlot ? 4 : 2}
                  />
                  <text x={x + 8} y={height - 30} fill="#fff" fontSize={13} fontWeight="bold">
                    {s.icon} {i + 1}. {r.status === 'locked' ? '???' : r.name}
                  </text>
                  <text x={x + 8} y={height - 12} fill="#ddd" fontSize={11}>
                    {s.label}
                    {r.is_final ? ' · 최종' : ''}
                    {r.cleared_by ? ` · by ${r.cleared_by}` : ''}
                  </text>
                  {r.status !== 'locked' && (
                    <text x={x + 8} y={height - 50} fill="#ffd54a" fontSize={11}>
                      🔎 {r.clues.filter((c) => c.found).length}/{r.clues.length}
                      {r.has_puzzle ? (r.puzzle_solved ? ' · 암호✅' : ' · 암호⬜') : ''}
                      {r.minigame ? (r.minigame.key_used ? ' · 🔑✅' : r.minigame.key_obtained ? ' · 🔑보유' : ' · 🎮') : ''}
                    </text>
                  )}
                  {/* 발견한 단서 위치 */}
                  {r.clues.filter((c) => c.found).map((c) => (
                    <circle key={c.id} cx={toX(i * ROOM_SIZE + c.pos[0])} cy={toY(c.pos[1])} r={4} fill="#ffd54a" opacity={0.7} />
                  ))}
                  {r.minigame && r.status !== 'locked' && (
                    <text x={toX(i * ROOM_SIZE + MINIGAME_POS[0])} y={toY(MINIGAME_POS[1]) + 5} fontSize={14} textAnchor="middle">
                      {r.minigame.key_obtained ? '🔑' : '🎮'}
                    </text>
                  )}
                  {/* 퍼즐(단말기) 위치 */}
                  {r.has_puzzle && <rect x={toX(i * ROOM_SIZE + PUZZLE_POS[0]) - 8} y={toY(PUZZLE_POS[1]) - 6} width={16} height={12} fill={r.puzzle_solved ? '#66e08a' : '#e0e0e0'} />}
                  {/* 문 */}
                  {i < rooms.length - 1 && (
                    <rect
                      x={x + ROOM_SIZE * SCALE - 3}
                      y={toY(-1)}
                      width={6}
                      height={2 * SCALE}
                      fill={rooms[i + 1].status === 'locked' ? '#e53935' : '#43a047'}
                    />
                  )}
                </g>
              );
            })}

            {players.map((p) => (
              <g key={p.id} transform={`translate(${toX(p.position[0])},${toY(p.position[2])})`}>
                <circle r={6} fill="#4fc3f7" stroke="#000" />
                <text y={-10} textAnchor="middle" fill="#4fc3f7" fontSize={11}>
                  {p.name}
                </text>
              </g>
            ))}

            <g transform={`translate(${toX(myPos[0])},${toY(myPos[2])})`}>
              <circle r={8} fill="#ff5252" stroke="#fff" strokeWidth={2} />
              <text y={-12} textAnchor="middle" fill="#fff" fontSize={12} fontWeight="bold">
                {myName} (나)
              </text>
            </g>
          </svg>
        </div>

        <div className="legend">
          <span>✅ 클리어</span>
          <span>🔓 진행 가능</span>
          <span>🔒 잠김</span>
          <span><i className="dot me" /> 현재 위치</span>
          <span><i className="dot mate" /> 팀원</span>
          <span><i className="sq" /> 단말기</span>
          <span><i className="dot clue" /> 찾은 단서</span>
          <span>🎮 미니게임 · 🔑 열쇠</span>
        </div>
      </div>
    </div>
  );
}
