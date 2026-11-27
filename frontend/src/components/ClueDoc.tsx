// 조사한 단서를 화면 옆에 문서처럼 띄운다 (게임을 멈추지 않음, 마우스 고정 유지)
//   붉은 서재: 손글씨 편지 + 전용 화면 (휴대폰 잠금화면 · 일기장 · 벽 달력 · 벽시계 · 책장 · 초상화 · 검시 메모)
//              ← 팀원 프로젝트의 전용 화면(phone.js, diary.js, bookshelf.js, calendarView.js)을
//                 '게임을 멈추지 않는 카드' 방식으로 다시 만든 것
//   공포: 찢어진 메모 / 공책 / 화이트보드 / 상자 라벨
//   이집트: 파피루스 / 석판 음각
// 전용 화면용 정보는 단서 글에서 뽑는다 (clueParse) — 형식이 맞지 않으면 일반 문서로 표시.
import type { ReactNode } from 'react';
import type { ClueObject } from '../types';
import type { ThemeCopy, ThemeKind } from '../game/themeCopy';
import { parseBooks, parseCalendar, parseClock, parseDiary, parsePhone, splitStrike } from '../game/clueParse';

export interface ClueDocData {
  key: string;
  label: string;
  text: string;
  object: ClueObject;
  isNew: boolean;
}

/** 전용 화면이 있는 단서 종류 */
export const RICH_OBJECTS: ClueObject[] = ['phone', 'diary', 'calendar', 'clock', 'bookshelf', 'portrait', 'body'];

function variant(kind: ThemeKind, obj: ClueObject): string {
  if (kind === 'vault') return `vault vault-${obj}`;
  if (kind === 'study') {
    if (obj === 'board') return 'bloodwall';
    if (obj === 'box' || obj === 'jar') return 'tag';
    return 'letter';
  }
  if (kind === 'egypt') return ['tablet', 'statue', 'board'].includes(obj) ? 'stone' : 'papyrus';
  if (kind === 'horror') {
    if (obj === 'board') return 'whiteboard';
    if (obj === 'box' || obj === 'jar') return 'tag';
    if (obj === 'book') return 'notebook';
    return 'paper';
  }
  return 'plain';
}

function Struck({ line }: { line: string }) {
  return (
    <>
      {splitStrike(line).map((p, i) => (p.struck ? <s key={i}>{p.text}</s> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function PhoneView({ text }: { text: string }) {
  const p = parsePhone(text);
  return (
    <div className="rv-phone">
      <div className="rv-phone-screen">
        <div className="rv-crack" aria-hidden />
        {p.time && <div className="rv-phone-time">{p.time}</div>}
        {p.sub && <div className="rv-phone-sub">{p.sub}</div>}
        <div className="rv-phone-list">
          {p.items.map((it, i) => (
            <div key={i} className="rv-notif">
              {it.app && <b>{it.app}</b>}
              <span>{it.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DiaryView({ text }: { text: string }) {
  const entries = parseDiary(text);
  return (
    <div className="rv-diary">
      {entries.map((e, i) => (
        <div key={i} className="rv-page">
          {e.date && <div className="rv-date">{e.date}</div>}
          {e.lines.map((l, k) => (
            <p key={k}>
              <Struck line={l} />
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function CalendarView({ text }: { text: string }) {
  const c = parseCalendar(text);
  if (!c) return null;
  const first = new Date(c.year, c.month - 1, 1).getDay();
  const days = new Date(c.year, c.month, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="rv-calendar">
      <div className="rv-cal-head">
        <b>{c.month}월</b>
        <small>{c.year}</small>
      </div>
      <div className="rv-cal-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
          <i key={d}>{d}</i>
        ))}
        {cells.map((d, i) => {
          const marks = c.marks.filter((m) => m.day === d);
          return (
            <span key={i} className={`${i % 7 === 0 ? 'sun' : ''} ${marks.some((m) => m.kind === 'circle') ? 'circle' : ''}`}>
              {d ?? ''}
              {marks.map((m, k) => (
                <em key={k} className={m.kind}>
                  {m.note}
                </em>
              ))}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ClockView({ text }: { text: string }) {
  const t = parseClock(text);
  if (!t) return null;
  const hA = (((t.h % 12) + t.m / 60) / 12) * 360;
  const mA = (t.m / 60) * 360;
  return (
    <svg className="rv-clock" viewBox="-60 -60 120 120" aria-label={`${t.h}시 ${t.m}분`}>
      <circle r="56" className="rim" />
      <circle r="50" className="face" />
      {Array.from({ length: 12 }, (_, i) => (
        <text key={i} x={Math.sin((i + 1) * (Math.PI / 6)) * 40} y={-Math.cos((i + 1) * (Math.PI / 6)) * 40 + 4}>
          {['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'][i]}
        </text>
      ))}
      <ellipse cx="18" cy="18" rx="12" ry="15" className="blood" transform="rotate(30 18 18)" />
      <line y2="-26" transform={`rotate(${hA})`} className="hand h" />
      <line y2="-40" transform={`rotate(${mA})`} className="hand m" />
      <circle r="3" className="pin" />
    </svg>
  );
}

function ShelfView({ text }: { text: string }) {
  const { books } = parseBooks(text);
  if (!books.length) return null;
  return (
    <div className="rv-shelf">
      {books.map((b, i) => (
        <div key={i} className={`rv-book ${b.num ? (b.silver ? 'silver' : 'gold') : ''}`} style={{ height: 120 + ((i * 37) % 4) * 8 }} title={b.title}>
          {b.num && <b>{b.num}</b>}
          <span>{b.title}</span>
        </div>
      ))}
    </div>
  );
}

/** 전용 화면 + 원문(전용 화면에서 이미 보이는 줄은 생략) */
function richBody(doc: ClueDocData): ReactNode | null {
  switch (doc.object) {
    case 'phone':
      return <PhoneView text={doc.text} />;
    case 'diary':
      return <DiaryView text={doc.text} />;
    case 'calendar': {
      const v = <CalendarView text={doc.text} />;
      return parseCalendar(doc.text) ? (
        <>
          {v}
          <div className="doc-text small">{doc.text}</div>
        </>
      ) : null;
    }
    case 'clock':
      return parseClock(doc.text) ? (
        <>
          <ClockView text={doc.text} />
          <div className="doc-text small">{doc.text}</div>
        </>
      ) : null;
    case 'bookshelf': {
      const { books, intro } = parseBooks(doc.text);
      return books.length ? (
        <>
          {intro && <div className="doc-text small">{intro}</div>}
          <ShelfView text={doc.text} />
        </>
      ) : null;
    }
    case 'portrait':
      return (
        <>
          <div className="rv-portrait" aria-hidden />
          <div className="doc-text small">{doc.text}</div>
        </>
      );
    case 'body':
      return (
        <div className="rv-report">
          <div className="rv-report-head">검시 메모 · 1998.11.17</div>
          <div className="doc-text">{doc.text}</div>
        </div>
      );
    default:
      return null;
  }
}

export default function ClueDoc({ doc, kind, copy }: { doc: ClueDocData; kind: ThemeKind; copy: ThemeCopy }) {
  const rich = RICH_OBJECTS.includes(doc.object) ? richBody(doc) : null;
  return (
    <div className={`clue-doc doc-${rich ? `rich rich-${doc.object}` : variant(kind, doc.object)}`} key={doc.key} role="status">
      {kind === 'vault' && <div className="vault-source">{({ tablet: '관제 시스템 / 조회 기록', board: '보안실 / 게시 자료', book: '문서고 / 장부 사본', box: '보관함 / 물품 확인', note: '직원 메모' } as Record<string, string>)[doc.object] ?? '은행 자료'}</div>}
      <div className="doc-label">{doc.label}</div>
      {rich ?? (
        <div className="doc-text">
          {doc.text.split('\n').map((l, i) => (
            <div key={i}>
              <Struck line={l} />
            </div>
          ))}
        </div>
      )}
      <div className={`doc-stamp ${doc.isNew ? 'new' : ''}`}>{doc.isNew ? copy.clueNew : copy.clueOld}</div>
    </div>
  );
}
