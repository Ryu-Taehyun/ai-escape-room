export interface CalendarMark {
  day: number;
  note: string;
  kind: 'circle' | 'scrawl';
}
export interface CalendarInfo {
  year: number;
  month: number;
  marks: CalendarMark[];
}
export interface BookInfo {
  num: string;
  title: string;
  silver: boolean;
  order: number;
}
export function parseCalendar(text: string): CalendarInfo | null;
export function parseClock(text: string): { h: number; m: number } | null;
export function parseBooks(text: string): { books: BookInfo[]; intro: string };
export function parsePhone(text: string): { time: string; sub: string; items: { app: string; text: string }[] };
export function parseDiary(text: string): { date: string; lines: string[] }[];
export function splitStrike(line: string): { text: string; struck: boolean }[];
