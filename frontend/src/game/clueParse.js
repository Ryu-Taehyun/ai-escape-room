// =====================================================================
// 단서 글(text)에서 전용 화면·3D 모델에 필요한 정보를 뽑아낸다.
//   3D 벽 달력/벽시계/책장 (engine.js)과 조사 화면(ClueDoc.tsx)이 같은 결과를 쓰므로
//   "3D 에서 본 것"과 "조사 화면에서 본 것"이 항상 같다.
// 글 형식이 맞지 않으면 null / 빈 값 → 화면은 일반 문서로 표시된다. (AI·관리자가 쓴 글도 안전)
// =====================================================================

const ROMAN = { 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5, 'ⅰ': 1, 'ⅱ': 2, 'ⅲ': 3, 'ⅳ': 4, 'ⅴ': 5 };

/** "1998년 11월 달력. 3일에 빨간 동그라미: '하은 생일♥'. 17일에는 검게 덧칠한 'J'." */
export function parseCalendar(text) {
  const t = String(text || '');
  const ym = t.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/) || t.match(/(\d{1,2})\s*월/);
  if (!ym) return null;
  const year = ym.length > 2 ? Number(ym[1]) : 1998;
  const month = Number(ym.length > 2 ? ym[2] : ym[1]);
  if (!(month >= 1 && month <= 12)) return null;
  const marks = [];
  const re = /(\d{1,2})\s*일에(?:는)?([^'‘’]*?)['‘]([^'’]+)['’]/g;
  let m;
  while ((m = re.exec(t))) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) continue;
    marks.push({ day, note: m[3], kind: /덧칠|검게|검은/.test(m[2]) ? 'scrawl' : 'circle' });
  }
  return { year, month, marks };
}

/** "바늘은 11시 47분" → { h: 11, m: 47 } */
export function parseClock(text) {
  const m = String(text || '').match(/(\d{1,2})\s*시\s*(\d{1,2})\s*분/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return { h, m: min };
}

/** 줄마다 「제목」, 앞에 Ⅰ Ⅱ Ⅲ(금박) 또는 ⅰ ⅱ(은박) 숫자 */
export function parseBooks(text) {
  const books = [];
  const rest = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*([ⅠⅡⅢⅣⅤⅰⅱⅲⅳⅴ]?)\s*「(.+?)」\s*$/);
    if (m) books.push({ num: m[1] || '', title: m[2], silver: !!m[1] && m[1] === m[1].toLowerCase() && /[ⅰ-ⅴ]/.test(m[1]), order: ROMAN[m[1]] || 0 });
    else if (line.trim()) rest.push(line.trim());
  }
  return { books, intro: rest.join('\n') };
}

/** 첫 줄 "23:47 · 11월 17일 화요일 · 배터리 3%", 나머지 "앱 — 내용" */
export function parsePhone(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { time: '', sub: '', items: [] };
  const head = lines[0].match(/^(\d{1,2}:\d{2})\s*(?:·\s*(.*))?$/);
  const body = head ? lines.slice(1) : lines;
  const items = body.map((l) => {
    const p = l.split(/\s+—\s+/);
    return p.length > 1 ? { app: p[0], text: p.slice(1).join(' — ') } : { app: '', text: l };
  });
  return { time: head ? head[1] : '', sub: head ? head[2] || '' : '', items };
}

/** "11월 2일 · 비" 같은 날짜 줄마다 한 장. ~~지운 글씨~~ 지원 */
export function parseDiary(text) {
  const entries = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\d{1,2}\s*월\s*\d{1,2}\s*일/.test(line)) entries.push({ date: line, lines: [] });
    else {
      if (!entries.length) entries.push({ date: '', lines: [] });
      entries[entries.length - 1].lines.push(line);
    }
  }
  return entries;
}

/** "~~지운~~ 글" → [{text, struck}] */
export function splitStrike(line) {
  const out = [];
  const re = /~~(.+?)~~/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), struck: false });
    out.push({ text: m[1], struck: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), struck: false });
  return out;
}
