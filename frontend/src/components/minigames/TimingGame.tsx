// 타이밍 미니게임: 움직이는 바늘이 초록 구간에 있을 때 멈추기 (Space 또는 버튼)
import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  params: { rounds: number; required: number; zone_width: number; speed: number };
  onDone: (result: { hits: number }) => void;
}

function randomZone(width: number) {
  const start = 0.1 + Math.random() * (0.8 - width);
  return [start, start + width] as const;
}

export default function TimingGame({ params, onDone }: Props) {
  const { rounds, required, zone_width, speed } = params;
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [zone, setZone] = useState(() => randomZone(zone_width));
  const [pos, setPos] = useState(0);
  const [paused, setPaused] = useState(false);
  const posRef = useRef(0);
  const dirRef = useRef(1);

  // 바늘 왕복 운동
  useEffect(() => {
    if (paused || round >= rounds) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let p = posRef.current + dirRef.current * speed * dt;
      if (p >= 1) { p = 1; dirRef.current = -1; }
      if (p <= 0) { p = 0; dirRef.current = 1; }
      posRef.current = p;
      setPos(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, round, rounds, speed]);

  const stop = useCallback(() => {
    if (paused || round >= rounds) return;
    const hit = posRef.current >= zone[0] && posRef.current <= zone[1];
    const next = [...results, hit];
    setResults(next);
    setPaused(true);
    window.setTimeout(() => {
      if (next.length >= rounds) {
        onDone({ hits: next.filter(Boolean).length });
        setRound(rounds);
        return;
      }
      setRound((r) => r + 1);
      setZone(randomZone(zone_width));
      setPaused(false);
    }, 700);
  }, [paused, round, rounds, zone, results, zone_width, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop]);

  return (
    <div className="mg-timing">
      <p className="muted">
        라운드 {Math.min(round + 1, rounds)} / {rounds} · {required}번 이상 성공해야 합니다. (Space 또는 버튼)
      </p>
      <div className="timing-bar">
        <div className="timing-zone" style={{ left: `${zone[0] * 100}%`, width: `${(zone[1] - zone[0]) * 100}%` }} />
        <div className="timing-needle" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="timing-results">
        {Array.from({ length: rounds }, (_, i) => (
          <span key={i}>{results[i] === undefined ? '⬜' : results[i] ? '✅' : '❌'}</span>
        ))}
      </div>
      <button className="primary big" disabled={paused || round >= rounds} onClick={stop}>
        멈춰!
      </button>
    </div>
  );
}
