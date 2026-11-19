// 기억력 미니게임: 불빛(문양)이 켜지는 순서를 기억해 그대로 누르기
import { useEffect, useState } from 'react';

/** 색약 대응: 색만이 아니라 모양으로도 구분 */
export const SHAPES = ['▲', '●', '■', '◆'];

interface Props {
  params: { symbols: string[]; sequence: number[]; show_ms: number };
  onDone: (result: { input: number[] }) => void;
}

export default function SequenceGame({ params, onDone }: Props) {
  const { symbols, sequence, show_ms } = params;
  const [phase, setPhase] = useState<'ready' | 'show' | 'input'>('ready');
  const [lit, setLit] = useState<number | null>(null);
  const [input, setInput] = useState<number[]>([]);

  // 순서 보여주기
  useEffect(() => {
    if (phase !== 'show') return;
    let i = 0;
    let timer: number;
    const step = () => {
      if (i >= sequence.length) {
        setLit(null);
        setPhase('input');
        return;
      }
      setLit(sequence[i]);
      timer = window.setTimeout(() => {
        setLit(null);
        i += 1;
        timer = window.setTimeout(step, 180);
      }, show_ms);
    };
    timer = window.setTimeout(step, 500);
    return () => window.clearTimeout(timer);
  }, [phase, sequence, show_ms]);

  function press(idx: number) {
    if (phase !== 'input') return;
    const next = [...input, idx];
    setInput(next);
    setLit(idx);
    window.setTimeout(() => setLit(null), 150);
    // 틀리는 즉시, 또는 길이를 다 채우면 제출 (판정은 서버)
    if (next.length === sequence.length || next[next.length - 1] !== sequence[next.length - 1]) {
      window.setTimeout(() => onDone({ input: next }), 250);
    }
  }

  return (
    <div className="mg-sequence">
      <p className="muted">
        {phase === 'ready' && `불빛 ${sequence.length}개의 순서를 기억하세요. 한 번만 보여줍니다.`}
        {phase === 'show' && '잘 보세요...'}
        {phase === 'input' && `순서대로 누르세요 (${input.length} / ${sequence.length})`}
      </p>
      <div className="seq-grid">
        {symbols.map((sym, idx) => (
          <button key={idx} className={`seq-btn ${lit === idx ? 'lit' : ''}`} disabled={phase !== 'input'} onClick={() => press(idx)} aria-label={`${SHAPES[idx]} 버튼`}>
            <span className="seq-sym">{sym}</span>
            <span className="seq-shape">{SHAPES[idx % SHAPES.length]}</span>
          </button>
        ))}
      </div>
      <div className="seq-progress">
        {sequence.map((_, i) => (
          <span key={i} className={i < input.length ? 'on' : ''} />
        ))}
      </div>
      {phase === 'ready' && (
        <button className="primary" onClick={() => setPhase('show')}>
          순서 보기
        </button>
      )}
    </div>
  );
}
