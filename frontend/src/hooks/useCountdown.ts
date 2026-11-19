// 서버가 준 remaining_seconds 기준 로컬 카운트다운
import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../types';

export function useCountdown(state: SessionState | null, onExpire: () => void) {
  const [remaining, setRemaining] = useState(0);
  const deadline = useRef(0);
  const fired = useRef(false);
  const status = useRef<SessionState['status']>('waiting');
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (!state) return;
    deadline.current = Date.now() + state.remaining_seconds * 1000;
    status.current = state.status;
    fired.current = false;
    setRemaining(state.remaining_seconds);
  }, [state]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (status.current !== 'playing') return; // 대기 중·종료 후에는 멈춤
      const rem = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setRemaining(rem);
      if (rem === 0 && !fired.current) {
        fired.current = true;
        expireRef.current();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return remaining;
}
