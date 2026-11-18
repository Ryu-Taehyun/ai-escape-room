// 조사한 단서를 화면 옆에 문서처럼 띄운다 (게임을 멈추지 않음, 마우스 고정 유지)
//   공포: 찢어진 메모 / 공책 / 화이트보드 / 상자 라벨
//   이집트: 파피루스 / 석판 음각
import type { ClueObject } from '../types';
import type { ThemeCopy, ThemeKind } from '../game/themeCopy';

export interface ClueDocData {
  key: string;
  label: string;
  text: string;
  object: ClueObject;
  isNew: boolean;
}

function variant(kind: ThemeKind, obj: ClueObject): string {
  if (kind === 'egypt') return ['tablet', 'statue', 'board'].includes(obj) ? 'stone' : 'papyrus';
  if (kind === 'horror') {
    if (obj === 'board') return 'whiteboard';
    if (obj === 'box' || obj === 'jar') return 'tag';
    if (obj === 'book') return 'notebook';
    return 'paper';
  }
  return 'plain';
}

export default function ClueDoc({ doc, kind, copy }: { doc: ClueDocData; kind: ThemeKind; copy: ThemeCopy }) {
  return (
    <div className={`clue-doc doc-${variant(kind, doc.object)}`} key={doc.key} role="status">
      <div className="doc-label">{doc.label}</div>
      <div className="doc-text">{doc.text}</div>
      <div className={`doc-stamp ${doc.isNew ? 'new' : ''}`}>{doc.isNew ? copy.clueNew : copy.clueOld}</div>
    </div>
  );
}
