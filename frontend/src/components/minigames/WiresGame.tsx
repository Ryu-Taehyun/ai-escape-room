// 전선 연결 미니게임: 왼쪽 단자를 클릭한 뒤 같은 색의 오른쪽 단자를 클릭해 연결
import { useEffect, useRef, useState } from 'react';

interface Props {
  params: { left: string[]; right: string[]; time_limit_sec: number };
  onDone: (result: { pairs: [number, number][] }) => void;
}

const ROW = 56;
const W = 320;

export default function WiresGame({ params, onDone }: Props) {
  const { left, right, time_limit_sec } = params;
  const [pairs, setPairs] = useState<Record<number, number>>({}); // left → right
  const [picked, setPicked] = useState<number | null>(null);
  const [remain, setRemain] = useState(time_limit_sec);
  const doneRef = useRef(false);
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;

  const finish = (p: Record<number, number>) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone({ pairs: Object.entries(p).map(([l, r]) => [Number(l), r]) });
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemain((r) => {
        if (r <= 1) {
          window.clearInterval(id);
          finish(pairsRef.current);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clickRight(r: number) {
    if (picked === null) return;
    const next = { ...pairs };
    for (const [l, rr] of Object.entries(next)) if (rr === r) delete next[Number(l)]; // 오른쪽 단자 재사용 방지
    next[picked] = r;
    setPairs(next);
    setPicked(null);
  }

  const height = left.length * ROW;
  const y = (i: number) => i * ROW + ROW / 2;
  const complete = Object.keys(pairs).length === left.length;

  return (
    <div className="mg-wires">
      <p className="muted">
        같은 색끼리 연결하세요. 남은 시간 <b className={remain <= 10 ? 'error' : ''}>{remain}초</b>
      </p>
      <svg width={W} height={height} className="wires-svg">
        {Object.entries(pairs).map(([l, r]) => (
          <line key={l} x1={40} y1={y(Number(l))} x2={W - 40} y2={y(r)} stroke={left[Number(l)]} strokeWidth={6} strokeLinecap="round" />
        ))}
        {left.map((c, i) => (
          <g key={`l${i}`} onClick={() => setPicked(i)} style={{ cursor: 'pointer' }}>
            <rect x={0} y={y(i) - 10} width={30} height={20} fill={c} rx={4} />
            <circle cx={40} cy={y(i)} r={picked === i ? 12 : 9} fill={c} stroke="#fff" strokeWidth={picked === i ? 3 : 1} />
          </g>
        ))}
        {right.map((c, i) => (
          <g key={`r${i}`} onClick={() => clickRight(i)} style={{ cursor: picked === null ? 'default' : 'pointer' }}>
            <circle cx={W - 40} cy={y(i)} r={9} fill={c} stroke="#fff" strokeWidth={1} />
            <rect x={W - 30} y={y(i) - 10} width={30} height={20} fill={c} rx={4} />
          </g>
        ))}
      </svg>
      <div className="row">
        <button onClick={() => setPairs({})}>초기화</button>
        <button className="primary" disabled={!complete} onClick={() => finish(pairs)}>
          전원 연결
        </button>
      </div>
    </div>
  );
}
