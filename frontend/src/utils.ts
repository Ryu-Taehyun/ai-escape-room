export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function safeStorage(key: string, value?: string): string | null {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === '') sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage 차단 환경 */
  }
  return null;
}

/** 90 → "1분 30초", 120 → "2분", 45 → "45초" */
export function formatPenalty(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m && s ? `${m}분 ${s}초` : m ? `${m}분` : `${s}초`;
}
