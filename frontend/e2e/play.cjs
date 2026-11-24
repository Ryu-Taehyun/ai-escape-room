// =====================================================================
// 화면 자동 테스트 (구성원 4 / QA)
//   1) 백엔드(8000)와 프론트(5173)를 켠다
//   2) npx playwright install chromium   (처음 한 번, 또는 PW_CHROMIUM_PATH=크롬 실행 파일 경로)
//   3) npm run e2e            → 붉은 서재 테마 (기본)
//      npm run e2e -- horror  → 공포 테마
//      npm run e2e -- egypt   → 파라오 테마
// 대기실 → 입장 → 단서(창 없이) → 잠긴 문 → 퍼즐 정답(자동 복귀) → 창에서 ESC(메뉴 안 뜸) → 일시정지 → 계속하기
// → Enter 채팅 → Q 핑 → R 단서 다시 보기 → 인벤토리/지도 → 미니게임 창 순서로 확인한다.
// 결과 스크린샷은 e2e/out/ 에 저장된다.
// =====================================================================
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const THEME = process.argv[2] || 'study';
const DECOR = { study: 'study', horror: 'server', egypt: 'pillar' }[THEME] || 'study';
const FIRST_ANSWER = { study: '4324', horror: '3142', egypt: '1035' }[THEME];

/** 관리자 비밀번호: 환경 변수 → 실행 중인 서버가 쓰는 backend/.env → 기본값 순 */
function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', '.env'), 'utf8');
    const m = env.match(/^ADMIN_PASSWORD=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    /* .env 없음 */
  }
  return 'admin1234';
}
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
  // 느린 컴퓨터 흉내 (CI 처럼 프레임이 느린 환경에서만 나는 문제 재현용): E2E_CPU_THROTTLE=6 → CPU 6배 느리게
  if (process.env.E2E_CPU_THROTTLE) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.E2E_CPU_THROTTLE) });
  }
  // 붉은 서재는 후처리(색보정)까지 확인하도록 그래픽 품질 '중간'으로 (헤드리스는 기본이 '낮음')
  if (THEME === 'study' || process.env.E2E_QUALITY) {
    const q = process.env.E2E_QUALITY || 'medium';
    await page.addInitScript((q) => localStorage.setItem('escape-settings-v1', JSON.stringify({ quality: q })), q);
  }
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
  await page.click(`.tcard-${DECOR}`);
  await page.waitForTimeout(300);
  await shot('00-lobby');
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
  // 느린 컴퓨터에서는 (1) 앞서 떠 있던 다른 알림을 보고 넘어가거나 (2) 알림이 3.4초 뒤 사라져 읽기 전에 없어질 수 있다.
  // → '필요한 것' 이 적힌 알림이 뜰 때까지 한 번에 기다리고, E 키가 빗나갔으면 다시 누른다.
  const doorToast = () =>
    page
      .waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('필요한 것'), null, { timeout: 5000, polling: 100 })
      .then(() => true, () => false);
  let lockedToast = false;
  for (let i = 0; i < 3 && !lockedToast; i++) {
    await page.keyboard.press('KeyE');
    lockedToast = await doorToast();
  }
  check('잠긴 문 알림', lockedToast);

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
  await page.fill('.pz-input input', FIRST_ANSWER);
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
  check('ESC 후 안내 문구 없음', !(await page.$('.resume-hint')));
  // 클릭 없이: 이동 키(W)를 누르는 순간 마우스가 다시 고정되고 그대로 이동
  const before = await page.evaluate(() => window.__escapeEngine.head.position.z);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => window.__escapeEngine.head.position.z);
  check('ESC 후 클릭 없이 W 키로 바로 이어짐', (await locked()) && !(await page.$('.pz')), `이동 ${Math.abs(after - before).toFixed(2)}m`);

  // ESC → 일시정지 메뉴 → 이동 키로 계속
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.panel.pause', { timeout: 5000 });
  await shot('03-pause');
  check('마우스 고정 해제 시 일시정지 메뉴', true);
  await page.keyboard.press('KeyD');
  await page.waitForTimeout(500);
  check('일시정지 메뉴에서 D 키 → 바로 계속', (await locked()) && !(await page.$('.panel.pause')));

  // 일시정지 메뉴 → 계속하기 버튼
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForSelector('.panel.pause', { timeout: 5000 });
  await page.click('.pause-resume');
  await page.waitForTimeout(500);
  check('계속하기 버튼 → 마우스 재고정', (await locked()) && !(await page.$('.panel.pause')));

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

  const tok = (await api('/api/admin/login', { password: adminPassword() })).token;
  check('관리자 로그인', !!tok);

  // 붉은 서재 전용: 3D 세계 · 전용 단서 화면 · 귀신 액자 · 조명 풀
  if (THEME === 'study') {
    const info = await page.evaluate(() => {
      const e = window.__escapeEngine;
      let points = 0;
      e.scene.traverse((o) => o.isPointLight && points++);
      return { ghosts: e.study.ghosts.length, window: e.study.windowBuilt, points, rooms: e.rooms.length, grade: !!e.grade, torch: !!e.torchModel };
    });
    check('붉은 서재: 귀신 액자 배치', info.ghosts >= 2, `${info.ghosts}개`);
    check('붉은 서재: 비 오는 창문(번개)', info.window);
    check('붉은 서재: 조명 수가 방 개수와 무관 (조명 풀)', info.points <= 3 + 2 + info.rooms, `점광원 ${info.points}개 / 방 ${info.rooms}개`);
    check('붉은 서재: 공포 색보정 + 손전등 모델', info.grade && info.torch);
    await page.evaluate(([s, t]) => fetch(`/api/admin/sessions/${s}/rooms/1/unlock`, { method: 'POST', headers: { 'X-Admin-Token': t } }), [sid, tok]);
    await page.waitForTimeout(1500);
    const st3 = await api(`/api/sessions/${sid}`);
    for (const [obj, sel] of [['calendar', '.rv-calendar'], ['phone', '.rv-phone'], ['diary', '.rv-diary']]) {
      const c = st3.rooms[1].clues.find((k) => k.object === obj);
      if (!c) continue;
      const wall = obj === 'calendar';
      const [cx, cz] = c.pos;
      const sgn = cz >= 0 ? 1 : -1;
      // 벽에 건 물건은 벽 앞 1.6m 에서, 바닥·탁자 물건은 1.3m 앞에서 바라본다
      const vz = wall ? sgn * (4.89 - 1.6) : cz + 1.3;
      const yaw = wall ? (sgn > 0 ? Math.PI : 0) : 0;
      await tp(10 + cx, vz, yaw, wall ? 0 : -0.55);
      await page.waitForTimeout(2200);
      // 느린 컴퓨터에서는 순간이동 직후 조준 판정이 한 박자 늦을 수 있다 → 화면이 뜰 때까지 기다리고, 안 뜨면 E 를 다시 누른다
      let shown = false;
      for (let i = 0; i < 3 && !shown; i++) {
        await page.keyboard.press('KeyE');
        shown = await page.waitForSelector(sel, { timeout: 5000 }).then(() => true, () => false);
      }
      check(`붉은 서재: ${obj} 전용 단서 화면`, shown);
      await shot(`07-${obj}`);
    }
    // 귀신 액자: 2.5초 이상 바라보면 튀어나온다
    const fr = await page.evaluate(() => {
      const g = window.__escapeEngine.study.ghosts[0].group;
      const p = g.getWorldPosition(g.position.clone());
      return [p.x, p.z];
    });
    const fs2 = fr[1] >= 0 ? 1 : -1;
    await tp(fr[0], fr[1] - fs2 * 2.2, fs2 > 0 ? Math.PI : 0, 0.1);
    // 게임은 한 프레임에 최대 0.1초씩만 시간을 센다(engine.js) → 프레임이 느린 CI 에서는 '2.5초 바라보기'에
    // 실제 시간이 훨씬 더 걸린다. 정해진 시간 대신 귀신이 나올 때까지 (최대 25초) 기다린다.
    const ghostDone = await page
      .waitForFunction(() => window.__escapeEngine.study.ghosts[0].done, null, { timeout: 25000, polling: 200 })
      .then(() => true, () => false);
    check('붉은 서재: 액자를 오래 보면 귀신', ghostDone);
    await shot('08-ghost');
    // 3D 전경 (서재)
    await tp(10 - 3.5, 3.6, Math.PI * 0.75, -0.12);
    await page.waitForTimeout(1500);
    await shot('09-study-room');
  }

  // 미니게임 창
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
