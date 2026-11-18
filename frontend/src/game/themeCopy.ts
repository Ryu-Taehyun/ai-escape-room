// 테마별 화면 문구 (공포 / 이집트 / 기본)
export type ThemeKind = 'horror' | 'egypt' | 'neutral';

export function themeKind(decor?: string): ThemeKind {
  return decor === 'server' ? 'horror' : decor === 'pillar' ? 'egypt' : 'neutral';
}

export interface ThemeCopy {
  introEyebrow: string;
  introTitle: string;
  introLines: string[];
  introAction: string;
  controls: string;
  focusVerb: Record<'puzzle' | 'clue' | 'minigame' | 'door', string>;
  puzzleSystem: string;
  puzzleBoot: (room: string) => string[];
  prompt: string;
  inputPlaceholder: string;
  submit: string;
  hint: string;
  close: string;
  granted: string;
  denied: string;
  solvedNeedKey: (reward: string) => string;
  hintLabel: string;
  cluesHeader: string;
  cluesMissing: string;
  clueNew: string;
  clueOld: string;
  doorLocked: string;
  needPuzzle: string;
  minigameFrame: string;
  minigameStart: string;
  minigameRetry: string;
  minigameDone: string;
  inventoryTitle: string;
  inventoryEmpty: string;
  mapTitle: string;
  escapedTitle: string;
  escapedText: string;
  failedTitle: string;
  failedText: string;
  toLobby: string;
  timerLabel: string;
  resumeHint: string;
  scareText: string;
}

export const COPY: Record<ThemeKind, ThemeCopy> = {
  horror: {
    introEyebrow: '경고 — 격리 프로토콜 가동 중',
    introTitle: '눈을 떴다. 서버실 바닥이었다.',
    introLines: [
      '비상등만 붉게 깜빡인다. 손에 쥔 손전등의 배터리는 얼마 남지 않았다.',
      '누군가 시스템을 장악했다. 그리고 이 건물 안에, 우리 말고 무언가가 있다.',
      '증거를 모아 통제실까지 가야 한다. 시간이 다 되면 격리문은 영원히 닫힌다.',
    ],
    introAction: '클릭해서 일어난다',
    controls: 'WASD 이동 · Shift 달리기 · E 조사 · F 손전등 · I 증거물 · M 도면',
    focusVerb: { puzzle: '접속한다', clue: '살펴본다', minigame: '만져 본다', door: '문을 연다' },
    puzzleSystem: 'SECURE TERMINAL // NODE',
    puzzleBoot: (room) => ['BIOS v2.3.1 ......... OK', `연결 대상: ${room}`, '경고: 비인가 프로세스 47개 감지', '인증이 필요합니다.'],
    prompt: '>',
    inputPlaceholder: '코드를 입력하라',
    submit: 'ENTER',
    hint: '로그 복구',
    close: '로그아웃',
    granted: 'ACCESS GRANTED',
    denied: 'ACCESS DENIED — 어디선가 경보가 울린다',
    solvedNeedKey: (r) => `인증 완료. 하지만 출입문은 ${r} 없이는 열리지 않는다.`,
    hintLabel: '복구된 로그',
    cluesHeader: '확보한 증거',
    cluesMissing: '아직 살펴보지 않은 것이 이 방 어딘가에 있다.',
    clueNew: '증거 확보',
    clueOld: '이미 확보함',
    doorLocked: '문이 굳게 잠겨 있다',
    needPuzzle: '보안 단말기 인증',
    minigameFrame: '제어 패널',
    minigameStart: '작동시킨다',
    minigameRetry: '다시 시도한다',
    minigameDone: '이미 열쇠를 손에 넣었다. 문으로 가서 E.',
    inventoryTitle: '증거물 파일',
    inventoryEmpty: '아직 아무것도 찾지 못했다. 손전등으로 방을 비춰 봐라.',
    mapTitle: '시설 도면 — 감염 구역',
    escapedTitle: '탈출했다',
    escapedText: '등 뒤에서 격리문이 닫힌다. 문 너머에서 무언가가 긁는 소리가 들린다.',
    failedTitle: '감염 완료',
    failedText: '격리문이 닫혔다. 손전등이 꺼진다. 어둠 속에서 숨소리가 가까워진다.',
    toLobby: '처음으로',
    timerLabel: '격리까지',
    resumeHint: '화면을 클릭하면 계속',
    scareText: '…방금 뭐였지?',
  },
  egypt: {
    introEyebrow: '기원전 1323년 — 봉인된 무덤',
    introTitle: '횃불 하나를 들고 피라미드에 들어섰다.',
    introLines: [
      '도굴꾼의 지도는 여기서 끝난다. 등 뒤로 돌문이 내려앉았다.',
      '벽의 상형문자들이 횃불 아래서 움직이는 듯하다.',
      '신들의 시험을 통과해 아누비스의 통로로 빠져나가라. 모래시계가 다 떨어지기 전에.',
    ],
    introAction: '클릭해서 안으로 들어간다',
    controls: 'WASD 이동 · Shift 달리기 · E 조사 · F 횃불 · I 탐험 일지 · M 지도',
    focusVerb: { puzzle: '비문을 읽는다', clue: '살펴본다', minigame: '시험에 도전한다', door: '돌문을 민다' },
    puzzleSystem: '신성한 비문',
    puzzleBoot: (room) => [room, '먼지를 털어 내자 금빛 문자가 드러났다.', '답을 새겨 넣어야 길이 열린다.'],
    prompt: '☥',
    inputPlaceholder: '답을 새긴다',
    submit: '새기기',
    hint: '신의 계시',
    close: '물러선다',
    granted: '석판이 금빛으로 타오른다',
    denied: '석판이 거부한다 — 천장에서 모래가 쏟아진다',
    solvedNeedKey: (r) => `비문이 풀렸다. 그러나 돌문은 ${r}을(를) 요구한다.`,
    hintLabel: '계시',
    cluesHeader: '일지에 적은 단서',
    cluesMissing: '아직 살펴보지 않은 것이 이 방 어딘가에 있다.',
    clueNew: '일지에 기록',
    clueOld: '이미 기록함',
    doorLocked: '돌문이 꿈쩍도 하지 않는다',
    needPuzzle: '비문의 답',
    minigameFrame: '신의 시험',
    minigameStart: '시험에 임한다',
    minigameRetry: '다시 도전한다',
    minigameDone: '이미 열쇠를 얻었다. 돌문으로 가서 E.',
    inventoryTitle: '탐험 일지',
    inventoryEmpty: '아직 적은 것이 없다. 횃불로 벽과 바닥을 비춰 봐라.',
    mapTitle: '도굴꾼의 지도',
    escapedTitle: '빛을 보았다',
    escapedText: '모래 폭풍 너머로 태양이 보인다. 파라오의 저주를 피했다.',
    failedTitle: '모래에 묻혔다',
    failedText: '모래시계가 멈췄다. 무덤이 다시 봉인된다.',
    toLobby: '처음으로',
    timerLabel: '모래시계',
    resumeHint: '화면을 클릭하면 계속',
    scareText: '무덤이 흔들린다…',
  },
  neutral: {
    introEyebrow: 'ESCAPE ROOM',
    introTitle: '방에서 탈출하라',
    introLines: ['단서를 찾아 퍼즐을 풀고 제한 시간 안에 빠져나가세요.'],
    introAction: '클릭해서 시작',
    controls: 'WASD 이동 · Shift 달리기 · E 조사 · F 손전등 · I 인벤토리 · M 지도',
    focusVerb: { puzzle: '암호 입력', clue: '조사하기', minigame: '도전하기', door: '살펴보기' },
    puzzleSystem: '단말기',
    puzzleBoot: (room) => [room],
    prompt: '›',
    inputPlaceholder: '정답 입력',
    submit: '제출',
    hint: 'AI 힌트',
    close: '닫기',
    granted: '정답!',
    denied: '틀렸습니다',
    solvedNeedKey: (r) => `암호 해제. 문을 열려면 ${r}이(가) 필요합니다.`,
    hintLabel: '힌트',
    cluesHeader: '찾은 단서',
    cluesMissing: '아직 조사하지 않은 물건이 있습니다.',
    clueNew: '새 단서',
    clueOld: '이미 찾은 단서',
    doorLocked: '문이 잠겨 있습니다',
    needPuzzle: '단말기 암호',
    minigameFrame: '미니게임',
    minigameStart: '도전 시작',
    minigameRetry: '다시 도전',
    minigameDone: '이미 열쇠를 얻었습니다.',
    inventoryTitle: '팀 인벤토리',
    inventoryEmpty: '아직 아무것도 찾지 못했습니다.',
    mapTitle: '지도',
    escapedTitle: '탈출 성공!',
    escapedText: '',
    failedTitle: '시간 초과',
    failedText: '',
    toLobby: '로비로',
    timerLabel: '남은 시간',
    resumeHint: '화면을 클릭하면 계속',
    scareText: '',
  },
};
