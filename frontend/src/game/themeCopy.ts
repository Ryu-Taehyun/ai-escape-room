// 테마별 화면 문구 (공포 / 이집트 / 기본)
export type ThemeKind = 'study' | 'horror' | 'egypt' | 'neutral';

export function themeKind(decor?: string): ThemeKind {
  return decor === 'study' ? 'study' : decor === 'server' ? 'horror' : decor === 'pillar' ? 'egypt' : 'neutral';
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
  scareText: string;
}

export const COPY: Record<ThemeKind, ThemeCopy> = {
  // 붉은 서재: 팀원 프로젝트의 이야기(1998년, 한도윤, J)를 그대로 가져옴
  study: {
    introEyebrow: 'CASE FILE · 1998.11.17',
    introTitle: '11시 47분, 그의 시계는 멈췄다',
    introLines: [
      '비가 그치지 않던 밤. 사립 탐정인 당신에게 와인 수집가 한도윤의 다급한 전화가 걸려 왔다.',
      '"J가… 24년 전에 사라진 내 동업자가 오늘 밤 나를 죽이러 옵니다. 서재로 와 주세요."',
      '자정 무렵 저택에 도착했을 때, 집 안은 고요했고 문마다 자물쇠가 걸려 있었다.',
      '그가 남긴 단서를 모아 지하를 지나 저택을 빠져나가라. 경찰이 오기 전에.',
    ],
    introAction: '클릭해서 저택에 들어선다',
    controls: 'WASD 이동 · Shift 달리기 · C 웅크리기 · E 조사 · F 손전등 · I 수첩 · M 저택 평면도',
    focusVerb: { puzzle: '자물쇠를 돌린다', clue: '조사한다', minigame: '만져 본다', door: '문고리를 잡는다' },
    puzzleSystem: '놋쇠 번호 자물쇠',
    puzzleBoot: (room) => [room, '차가운 놋쇠 다이얼에 피 묻은 지문이 남아 있다.', '맞는 번호를 맞춰야 열린다.'],
    prompt: '🗝',
    inputPlaceholder: '번호를 맞춘다',
    submit: '돌린다',
    hint: '속삭임',
    close: '물러선다',
    granted: '찰칵 — 자물쇠가 풀렸다',
    denied: '다이얼이 헛돈다 — 어딘가에서 누군가 웃는다',
    solvedNeedKey: (r) => `자물쇠는 풀렸다. 하지만 문은 ${r} 없이는 열리지 않는다.`,
    hintLabel: '속삭임',
    cluesHeader: '수첩에 적은 단서',
    cluesMissing: '아직 조사하지 않은 것이 이 방 어딘가에 있다.',
    clueNew: '수첩에 기록',
    clueOld: '이미 기록함',
    doorLocked: '문이 잠겨 있다. 손잡이가 꿈쩍도 하지 않는다',
    needPuzzle: '번호 자물쇠',
    minigameFrame: '저택의 장치',
    minigameStart: '손을 댄다',
    minigameRetry: '다시 해 본다',
    minigameDone: '이미 열쇠를 손에 넣었다. 문으로 가서 E.',
    inventoryTitle: '탐정 수첩',
    inventoryEmpty: '아직 적은 것이 없다. 반짝이는 물건을 조사해 보자.',
    mapTitle: '한 저택 평면도',
    escapedTitle: '탈출 성공',
    escapedText: '철문 너머로 새벽이 밝아온다. 등 뒤의 저택은 다시 침묵에 잠긴다.',
    failedTitle: '시간 초과',
    failedText: '촛불이 모두 꺼졌다. 어둠 속에서 누군가 네 이름을 불렀다.',
    toLobby: '처음으로',
    timerLabel: '경찰 도착까지',
    scareText: '…뒤에 누가 있어',
  },
  horror: {
    introEyebrow: '경고 — 격리 프로토콜 가동 중',
    introTitle: '눈을 떴다. 서버실 바닥이었다.',
    introLines: [
      '비상등만 붉게 깜빡인다. 손에 쥔 손전등의 배터리는 얼마 남지 않았다.',
      '누군가 시스템을 장악했다. 그리고 이 건물 안에, 우리 말고 무언가가 있다.',
      '증거를 모아 통제실까지 가야 한다. 시간이 다 되면 격리문은 영원히 닫힌다.',
    ],
    introAction: '클릭해서 일어난다',
    controls: 'WASD 이동 · Shift 달리기 · C 웅크리기 · E 조사 · F 손전등 · I 증거물 · M 도면',
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
    controls: 'WASD 이동 · Shift 달리기 · C 웅크리기 · E 조사 · F 횃불 · I 탐험 일지 · M 지도',
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
    scareText: '무덤이 흔들린다…',
  },
  neutral: {
    introEyebrow: 'ESCAPE ROOM',
    introTitle: '방에서 탈출하라',
    introLines: ['단서를 찾아 퍼즐을 풀고 제한 시간 안에 빠져나가세요.'],
    introAction: '클릭해서 시작',
    controls: 'WASD 이동 · Shift 달리기 · C 웅크리기 · E 조사 · F 손전등 · I 인벤토리 · M 지도',
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
    scareText: '',
  },
};
