// 관리자: 방 평면도 위에서 단서 위치를 드래그해서 배치 (x, z 숫자 입력 대신)
import { useEffect, useRef, useState } from 'react';
import { MINIGAME_POS, PUZZLE_POS } from '../game/engine';
import type { Clue } from '../types';

interface Props {
  clues: Clue[];
  hasPuzzle: boolean;
  hasMinigame: boolean;
  onMove: (index: number, pos: [number, number]) => void;
}

const SIZE = 260;
const SCALE = SIZE / 10; // 방 10m → 260px
const LIMIT = 4.3;
const toPx = (v: number) => (v + 5) * SCALE;
const toWorld = (px: number) => Math.round((px / SCALE - 5) * 10) / 10;

export default function RoomLayoutEditor({ clues, hasPuzzle, hasMinigame, onMove }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  // 드래그 중에는 창 전체에서 포인터를 추적 (원 밖으로 빨리 움직여도 놓치지 않게)
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  useEffect(() => {
    if (drag === null) return;
    const move = (e: PointerEvent) => {
      if (!svgRef.current) return;
      const r = svgRef.current.getBoundingClientRect();
      const x = Math.max(-LIMIT, Math.min(LIMIT, toWorld(((e.clientX - r.left) / r.width) * SIZE)));
      const z = Math.max(-LIMIT, Math.min(LIMIT, toWorld(((e.clientY - r.top) / r.height) * SIZE)));
      onMoveRef.current(drag, [x, z]);
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag]);

  return (
    <div className="layout-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
      >
        <rect x={0} y={0} width={SIZE} height={SIZE} className="le-floor" />
        {/* 배치 가능 범위 */}
        <rect x={toPx(-LIMIT)} y={toPx(-LIMIT)} width={LIMIT * 2 * SCALE} height={LIMIT * 2 * SCALE} className="le-area" />
        {/* 좌우 문 */}
        <rect x={-3} y={toPx(-1)} width={6} height={2 * SCALE} className="le-door" />
        <rect x={SIZE - 3} y={toPx(-1)} width={6} height={2 * SCALE} className="le-door" />
        <text x={6} y={12} className="le-label">뒤 벽 (z = -5)</text>
        {hasPuzzle && (
          <g>
            <rect x={toPx(PUZZLE_POS[0]) - 22} y={toPx(PUZZLE_POS[1]) - 10} width={44} height={20} className="le-fixed" />
            <text x={toPx(PUZZLE_POS[0])} y={toPx(PUZZLE_POS[1]) + 4} textAnchor="middle" className="le-label">단말기</text>
          </g>
        )}
        {hasMinigame && (
          <g>
            <rect x={toPx(MINIGAME_POS[0]) - 14} y={toPx(MINIGAME_POS[1]) - 12} width={28} height={24} className="le-fixed" />
            <text x={toPx(MINIGAME_POS[0])} y={toPx(MINIGAME_POS[1]) + 4} textAnchor="middle" className="le-label">🎮</text>
          </g>
        )}
        {clues.map((c, i) => (
          <g
            key={i}
            transform={`translate(${toPx(c.pos[0])},${toPx(c.pos[1])})`}
            className={`le-clue ${drag === i ? 'drag' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setDrag(i);
            }}
          >
            <circle r={9} />
            <text y={4} textAnchor="middle">
              {i + 1}
            </text>
            <text y={-13} textAnchor="middle" className="le-name">
              {c.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="muted small">번호 원을 끌어서 단서 위치를 옮기세요. 시작 위치는 방 1의 아래쪽(z = 2.5)입니다.</p>
    </div>
  );
}
