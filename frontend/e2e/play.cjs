// =====================================================================
// 화면 자동 테스트 (구성원 4 / QA)
//   1) 백엔드(8000)와 프론트(5173)를 켠다
//   2) npx playwright install chromium   (처음 한 번, 또는 PW_CHROMIUM_PATH=크롬 실행 파일 경로)
//   3) npm run e2e            → 공포 테마
//      npm run e2e -- egypt   → 이집트 테마
// 대기실 → 입장 → 단서(창 없이) → 잠긴 문 → 퍼즐 정답(자동 복귀) → 창에서 ESC(메뉴 안 뜸) → 일시정지 → 계속하기
// → Enter 채팅 → Q 핑 → R 단서 다시 보기 → 인벤토리/지도 → 미니게임 창 순서로 확인한다.
// 결과 스크린샷은 e2e/out/ 에 저장된다.
// =====================================================================
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const THEME = process.argv[2] || 'horror';
const BASE = process.env.E2E_URL || 'http://localhost:5173';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed += 1;
};

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 'Failed to load resource' 콘솔 메시지는 주소가 없으므로, 실패한 요청은 주소와 함께 따로 기록
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`));
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${THEME}-${n}.png`) });
  const locked = () => page.evaluate(() => !!document.pointerLockElement);
  const tp = (x, z, yaw, pitch) =>
    page.evaluate(([x, z, yaw, pitch]) => {
      const h = window.__escapeEngine.head;
      h.position.set(x, 1.6, z);
      h.rotation.order = 'YXZ';
      h.rotation.set(pitch, yaw, 0);
    }, [x, z, yaw, pitch]);
  const api = (p, body) => page.evaluate(([p, b]) => fetch(p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [p, body]);

  // 로비 → 대기실
  await page.goto(BASE);
  await page.waitForSelector('.tcard');
  if (THEME === 'egypt') await page.click('.tcard >> nth=1');
  await page.fill('.name-row input', 'QA');
  await page.click('.start-btn', { force: true }); // 공포 로비 버튼은 심장 박동 애니메이션 중
  await page.waitForSelector('.panel.waiting', { timeout: 20000 });
  await page.waitForSelector('.wr-players li b');
  await shot('01-waiting');
  check('대기실 표시', true);
  await page.click('.wr-actions .primary'); // 준비 완료 → 혼자라 바로 시작
  await page.waitForSelector('.intro', { timeout: 15000 });
  check('준비 완료 → 게임 시작', true);
  const sid = await page.textContent('.code b');
  await page.waitForTimeout(1500);
  await page.click('.intro');
  await page.waitForTimeout(500);
  check('입장 후 마우스 고정', await locked());

  // 단서 (창 없이)
  const st = await api(`/api/sessions/${sid}`);
  const clue = st.rooms[0].clues[0];
  await tp(clue.pos[0], clue.pos[1] + 1.4, 0, -0.5);
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.clue-doc', { timeout: 8000 });
  check('단서 문서 표시 + 마우스 유지', await locked());
  await shot('02-clue');

  // 잠긴 문 → 알림
  await tp(3.8, 0, -Math.PI / 2, 0);
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.toast', { timeout: 5000 });
  check('잠긴 문 알림', (await page.textContent('.toast')).includes('필요한 것'));

  // 퍼즐 → 오답 → 정답 → 자동 복귀
  await tp(0, -1.8, 0, -0.25);
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.pz');
  check('퍼즐 창에 남은 시간 표시', !!(await page.$('.pz-timer')));
  await page.fill('.pz-input input', 'wrong');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pz-tries');
  check('오답 기록 표시', (await page.textContent('.pz-tries')).includes('wrong'));
  await page.fill('.pz-input input', THEME === 'egypt' ? '1035' : '3142');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
  check('정답 후 창 자동 닫힘 + 마우스 재고정', !(await page.$('.pz')) && (await locked()));

  // 버그 회귀: 상호작용 창에서 ESC → 창만 닫히고 일시정지 메뉴는 뜨지 않아야 함
  await page.waitForTimeout(1500);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.pz');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  check('창에서 ESC → 창 닫힘, 메뉴 안 뜸', !(await page.$('.pz')) && !(await page.$('.panel.pause')));
  check('ESC 후 "클릭하면 계속" 안내', !!(await page.$('.resume-hint')));
  await page.mouse.click(640, 380);
  await page.waitForTimeout(600);
  check('한 번 클릭으로 바로 이어짐', (await locked()) && !(await page.$('.pz')));

  // ESC → 일시정지 메뉴 → 계속하기
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.panel.pause', { timeout: 5000 });
  await shot('03-pause');
  check('마우스 고정 해제 시 일시정지 메뉴', true);
  await page.click('.pause-resume');
  await page.waitForTimeout(500);
  check('계속하기 → 마우스 재고정', (await locked()) && !(await page.$('.panel.pause')));

  // Enter 채팅 (마우스 유지)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.type('hello team');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  check('Enter 채팅 전송 + 마우스 유지', (await page.textContent('.chat-list')).includes('hello team') && (await locked()));

  // Q 핑
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(1200);
  const markCount = await page.evaluate(() => window.__escapeEngine.marks.length);
  check('Q 핑 표시', markCount > 0, `${markCount}개`);
  await shot('04-mark');

  // R 단서 다시 보기
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(400);
  check('R 최근 단서 다시 보기', !!(await page.$('.clue-doc')));

  // 인벤토리 / 지도 (키로 닫으면 바로 복귀)
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(400);
  check('인벤토리 I 로 닫고 복귀', await locked());
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);
  await shot('05-map');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(400);

  // 미니게임 창
  const tok = (await api('/api/admin/login', { password: process.env.ADMIN_PASSWORD || 'admin1234' })).token;
  const st2 = await api(`/api/sessions/${sid}`);
  const mg = st2.rooms.findIndex((r) => r.minigame);
  if (mg >= 0 && tok) {
    await page.evaluate(([s, t, k]) => fetch(`/api/admin/sessions/${s}/rooms/${k}/unlock`, { method: 'POST', headers: { 'X-Admin-Token': t } }), [sid, tok, mg]);
    await page.waitForTimeout(1500);
    await tp(mg * 10 - 1.6, 0.0, 0, -0.5);
    await page.waitForTimeout(2500);
    await page.keyboard.press('KeyE');
    await page.waitForSelector('.mg-frame', { timeout: 6000 });
    await page.click('.mg-start');
    await page.waitForTimeout(900);
    await shot('06-minigame');
    check('미니게임 창', true);
    await page.click('.mg-frame .panel-head button');
    await page.waitForTimeout(500);
    check('미니게임 닫고 복귀', await locked());
  }

  check('콘솔 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
