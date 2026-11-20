// =====================================================================
// 붉은 서재 테마의 상호작용 오브젝트 (리빌딩에서 새로 만든 부분)
//   팀원 프로젝트의 가구(furniture.js)·시신(corpse.js)·달력(calendarTexture.js)을 재사용하고,
//   단서 글에서 뽑은 정보(clueParse.js)로 벽시계 바늘·달력 표시·책 제목을 그린다.
// 모든 함수는 월드 좌표 (x, z) 와 방향 rotY(로컬 +z 가 방 안쪽)를 받아 scene 에 배치한 Group 을 돌려준다.
// 수가 많은 책·와인병은 InstancedMesh 로 한 번에 그린다 (팀원 버전 대비 그리기 호출 수 감소).
// =====================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as F from './furniture.js';
import { addCollider, mat, bloodDecal, dragDecal, textPlane, handPrintMesh } from './helpers.js';
import { drawCalendar } from './calendarTexture.js';
import { buildCorpse } from './corpse.js';
import { parseBooks, parseCalendar, parseClock } from '../clueParse.js';

const WOOD = mat(0x3e2416, { roughness: 0.6 });
const DARK = mat(0x22140c, { roughness: 0.55 });
const BRASS = mat(0x9a7838, { metalness: 0.85, roughness: 0.32 });
const PAPER = mat(0xd8ccb0, { roughness: 0.9 });

function place(ctx, g, x, z, rotY = 0, y = 0) {
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  ctx.scene.add(g);
  return g;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 회전 없는 충돌 상자 (rotY 가 90° 단위일 때 가로·세로를 바꿔 준다) */
function collide(ctx, x, z, w, d, rotY) {
  const along = Math.abs(Math.sin(rotY)) > 0.5;
  addCollider(ctx, x, z, along ? d : w, along ? w : d);
}

/** 손글씨 종이 텍스처 */
function handwrittenPaper(lines, { w = 256, h = 320, blood = false } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = '#e6dcc2';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80, 60, 40, 0.18)';
    for (let y = 40; y < h; y += 26) {
      g.beginPath();
      g.moveTo(14, y);
      g.lineTo(w - 14, y);
      g.stroke();
    }
    g.fillStyle = '#2a1a10';
    g.font = '22px "Nanum Pen Script", cursive';
    lines.slice(0, 10).forEach((l, i) => g.fillText(l.slice(0, 16), 18, 34 + i * 26));
    if (blood) {
      g.fillStyle = 'rgba(120, 0, 0, 0.7)';
      g.beginPath();
      g.arc(w * 0.75, h * 0.8, 22, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// ------------------------------------------------------------------ 퍼즐: 번호 자물쇠 책상
/** 책상 위 놋쇠 번호 자물쇠 함. indicator 재질 색으로 잠김/열림 표시 */
export function lockDesk(ctx, x, z, { cellar = false } = {}) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.08, 0.85, 3, 0.02), WOOD)).position.y = 0.8;
  for (const [lx, lz] of [[-0.72, -0.35], [0.72, -0.35], [-0.72, 0.35], [0.72, 0.35]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.78, 10), DARK);
    leg.position.set(lx, 0.39, lz);
    g.add(leg);
  }
  // 자물쇠 함
  const lockBox = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.3, 0.36, 3, 0.03), cellar ? mat(0x2a2624, { metalness: 0.7, roughness: 0.4 }) : mat(0x3a1c10, { roughness: 0.5 }));
  lockBox.position.set(0, 0.99, -0.05);
  g.add(lockBox);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.02), BRASS);
  plate.position.set(0, 0.99, 0.135);
  g.add(plate);
  for (let i = 0; i < 4; i++) {
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 16), mat(0x1a120a, { metalness: 0.4, roughness: 0.5 }));
    dial.rotation.z = Math.PI / 2;
    dial.position.set(-0.165 + i * 0.11, 0.99, 0.155);
    g.add(dial);
    const digit = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ map: canvasTex(32, 32, (c) => {
      c.fillStyle = '#e8d8a8';
      c.fillRect(0, 0, 32, 32);
      c.fillStyle = '#2a1a0a';
      c.font = 'bold 26px serif';
      c.textAlign = 'center';
      c.fillText(String((i * 3 + 1) % 10), 16, 26);
    }) }));
    digit.position.set(-0.165 + i * 0.11, 0.99, 0.19);
    g.add(digit);
  }
  const indicator = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a10, emissiveIntensity: 1.6 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 10), indicator);
  lamp.position.set(0.25, 1.1, 0.13);
  g.add(lamp);
  // 촛불 + 흩어진 종이
  F.candle(ctx, g, -0.58, 0.84, -0.2, 0.16, 0.026);
  F.candle(ctx, g, -0.48, 0.84, -0.28, 0.1, 0.022);
  const note = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.28), new THREE.MeshStandardMaterial({ map: handwrittenPaper(['번호를…', '잊지 마시오']), roughness: 0.9 }));
  note.rotation.x = -Math.PI / 2;
  note.rotation.z = 0.4;
  note.position.set(0.5, 0.845, 0.15);
  g.add(note);
  place(ctx, g, x, z);
  addCollider(ctx, x, z, 1.6, 0.85);
  return { group: g, indicator };
}

// ------------------------------------------------------------------ 벽에 거는 단서
/** 벽시계: 단서 글의 'N시 M분'으로 바늘을 맞춘다 */
export function wallClock(ctx, x, y, z, rotY, text) {
  const tm = parseClock(text) ?? { h: 11, m: 47 };
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 40), WOOD);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.28, 40), new THREE.MeshStandardMaterial({ roughness: 0.4, map: canvasTex(256, 256, (c) => {
    c.fillStyle = '#e8dcc0';
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#2a1a10';
    c.font = 'bold 26px serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.fillText(['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'][i - 1], 128 + Math.sin(a) * 100, 128 - Math.cos(a) * 100);
    }
    // 피 묻은 손바닥 자국
    c.fillStyle = 'rgba(120, 0, 0, 0.55)';
    c.beginPath();
    c.ellipse(170, 170, 34, 42, 0.5, 0, Math.PI * 2);
    c.fill();
  }) }));
  face.position.z = 0.041;
  g.add(face);
  const hand = (len, w, angle, zz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.008), mat(0x0a0604, { metalness: 0.5 }));
    m.geometry.translate(0, len / 2, 0);
    m.rotation.z = -angle;
    m.position.z = zz;
    g.add(m);
  };
  hand(0.15, 0.022, ((tm.h % 12) + tm.m / 60) / 12 * Math.PI * 2, 0.05);
  hand(0.23, 0.014, (tm.m / 60) * Math.PI * 2, 0.056);
  return place(ctx, g, x, z, rotY, y);
}

/** 벽 달력: 단서 글의 연·월·표시한 날짜를 그대로 그린다 */
export function wallCalendar(ctx, x, y, z, rotY, text) {
  const info = parseCalendar(text) ?? undefined;
  const tex = canvasTex(384, 512, (_g, w, h) => {
    const c = _g.canvas;
    drawCalendar(c, info);
  });
  const g = new THREE.Group();
  const page = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.72), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  page.position.z = 0.012;
  const nail = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), BRASS);
  nail.position.set(0, 0.38, 0.02);
  g.add(page, nail);
  return place(ctx, g, x, z, rotY, y);
}

/** 눈이 긁혀 나간 초상화 (팀원 makePortrait 이식). userData.ghost = 오래 보면 튀어나오는 얼굴 */
export function portrait(ctx, x, y, z, rotY) {
  const tex = canvasTex(256, 320, (g) => {
    g.fillStyle = '#2a1a12';
    g.fillRect(0, 0, 256, 320);
    g.fillStyle = '#4a3428';
    g.beginPath();
    g.ellipse(100, 130, 48, 62, 0, 0, Math.PI * 2);
    g.fill();
    g.fillRect(36, 200, 128, 120);
    g.beginPath();
    g.ellipse(190, 190, 30, 38, 0, 0, Math.PI * 2); // 딸
    g.fill();
    g.fillRect(160, 230, 62, 90);
    g.strokeStyle = '#b01010';
    g.lineWidth = 5;
    for (let i = 0; i < 9; i++) {
      const sx = 60 + ((i * 37) % 160);
      g.beginPath();
      g.moveTo(sx, 105 + (i % 3) * 5);
      g.lineTo(sx + ((i % 2) - 0.5) * 30, 150 + (i % 4) * 6);
      g.stroke();
    }
  });
  const grp = new THREE.Group();
  const frameM = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.1, 0.06, 3, 0.02), mat(0x6a4818, { metalness: 0.55, roughness: 0.45 }));
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  pic.position.z = 0.032;
  const ghost = F.ghostPlane(0.76, 0.96);
  ghost.position.z = 0.036;
  grp.add(frameM, pic, ghost);
  grp.userData.ghost = ghost;
  place(ctx, grp, x, z, rotY, y);
  grp.rotation.z = 0.05;
  return grp;
}

/** 벽에 피로 쓴 글씨. 단서 글 안의 '…' 인용문을 그대로 쓴다 */
export function bloodWriting(ctx, x, y, z, rotY, text) {
  const q = String(text || '').match(/['‘]([^'’]+)['’]/);
  const words = (q ? q[1] : '그 해').split(/(?<=[.!?])\s+/).slice(0, 2);
  const m = textPlane(words, { width: 2.6, height: 1.0, font: 'bold 64px serif' });
  return place(ctx, m, x, z, rotY, y);
}

/** 액자에 넣은 문서 (tablet) */
export function framedDoc(ctx, x, y, z, rotY, label) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.7, 0.04, 2, 0.01), mat(0x3a2412, { roughness: 0.5 })));
  const doc = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.6), new THREE.MeshStandardMaterial({ map: handwrittenPaper([label, '', '……']), roughness: 0.9 }));
  doc.position.z = 0.022;
  g.add(doc);
  return place(ctx, g, x, z, rotY, y);
}

/** 책장 (너비 2.4m, 깊이 0.45m). 단서 글의 「제목」 책은 금박/은박 숫자와 함께 가운데 칸에 꽂힌다 */
export function bookshelf(ctx, x, z, rotY, text = '') {
  const { books } = parseBooks(text);
  const g = new THREE.Group();
  const Wd = 2.4;
  const H = 2.4;
  const D = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(Wd, H, 0.04), DARK);
  back.position.set(0, H / 2, -D / 2);
  g.add(back);
  for (const sx of [-Wd / 2, Wd / 2]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, H, D), DARK);
    side.position.set(sx, H / 2, 0);
    g.add(side);
  }
  const levels = [0.04, 0.62, 1.2, 1.78, 2.36];
  for (const sy of levels) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.04, D), DARK);
    shelf.position.set(0, sy, 0);
    g.add(shelf);
  }
  // 이름 없는 책들: InstancedMesh 하나로
  const bookGeo = new THREE.BoxGeometry(1, 1, 1);
  const inst = new THREE.InstancedMesh(bookGeo, mat(0xffffff, { roughness: 0.7 }), 200);
  const colors = [0x3b1010, 0x1f2a1a, 0x1a1f2e, 0x3a2d14, 0x2a1a24, 0x4a3b2a].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  let seed = Math.abs(Math.round(x * 13 + z * 7)) + 1;
  const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  levels.slice(0, 4).forEach((sy, li) => {
    if (li === 2 && books.length) return; // 가운데 칸은 제목 있는 책
    let bx = -Wd / 2 + 0.06;
    while (bx < Wd / 2 - 0.08 && n < 200) {
      const bw = 0.05 + R() * 0.06;
      const bh = 0.32 + R() * 0.18;
      if (R() < 0.07) {
        bx += bw + 0.08;
        continue;
      }
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), R() < 0.08 ? 0.15 : 0);
      m4.compose(new THREE.Vector3(bx + bw / 2, sy + 0.02 + bh / 2, 0.02), q, new THREE.Vector3(bw, bh, 0.32));
      inst.setMatrixAt(n, m4);
      inst.setColorAt(n, colors[Math.floor(R() * colors.length)]);
      n++;
      bx += bw + 0.005;
    }
  });
  inst.count = n;
  g.add(inst);
  // 제목 있는 책 (팀원 책장 화면의 책등 그리기 방식)
  if (books.length) {
    let bx = -0.1 * books.length;
    const sy = levels[2];
    books.forEach((bk, i) => {
      const marked = !!bk.num;
      const color = marked ? (bk.silver ? '#4a4a52' : '#8a1610') : ['#3a2a1c', '#2a3a1a', '#4a3a2a', '#2e2418', '#22161a'][i % 5];
      const bw = marked ? 0.1 : 0.08;
      const bh = marked ? 0.44 : 0.36 + (i % 3) * 0.02;
      const spine = canvasTex(64, 320, (c) => {
        c.fillStyle = color;
        c.fillRect(0, 0, 64, 320);
        const sh = c.createLinearGradient(0, 0, 64, 0);
        sh.addColorStop(0, 'rgba(0,0,0,.5)');
        sh.addColorStop(0.3, 'rgba(255,255,255,.08)');
        sh.addColorStop(1, 'rgba(0,0,0,.5)');
        c.fillStyle = sh;
        c.fillRect(0, 0, 64, 320);
        c.textAlign = 'center';
        const ink = bk.silver ? '#d8dce4' : '#f2d488';
        let y0 = 46;
        if (marked) {
          c.font = 'bold 38px "Times New Roman", serif';
          c.fillStyle = ink;
          c.fillText(bk.num, 32, 54);
          c.fillRect(10, 66, 44, 2);
          y0 = 98;
        }
        const chars = [...bk.title.replace(/ /g, '')].slice(0, 8);
        const step = Math.min(28, 210 / chars.length);
        c.font = `bold ${Math.round(step * 0.9)}px serif`;
        c.fillStyle = marked ? ink : '#e8d090';
        chars.forEach((ch, k) => c.fillText(ch, 32, y0 + k * step));
      });
      const cover = mat(new THREE.Color(color).getHex());
      const sm = new THREE.MeshStandardMaterial({ map: spine, roughness: 0.55, emissive: marked ? 0x1a0402 : 0x000000 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.32), [cover, cover, cover, cover, sm, cover]);
      b.position.set(bx + bw / 2, sy + 0.02 + bh / 2, 0.04);
      g.add(b);
      bx += bw + 0.012;
    });
  }
  place(ctx, g, x, z, rotY);
  collide(ctx, x, z, Wd, D, rotY);
  return g;
}

// ------------------------------------------------------------------ 바닥·탁자 위 단서
/** 작은 원탁 위에 놓인 물건. 원탁 위 y 를 돌려준다 */
function sideTable(ctx, x, z) {
  const t = F.roundTable(ctx, x, z, 0.3, 0.62);
  return { table: t, top: 0.645 }; // 상판 윗면 (상판 두께 포함)
}

/** 쪽지 (note): 원탁 위 촛불 옆의 종이 */
export function noteOnTable(ctx, x, z, label) {
  const { table, top } = sideTable(ctx, x, z);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.28), new THREE.MeshStandardMaterial({ map: handwrittenPaper([label, '…'], { blood: true }), roughness: 0.9 }));
  paper.rotation.x = -Math.PI / 2;
  paper.rotation.z = 0.5;
  paper.position.set(0.04, top + 0.004, 0.02);
  table.add(paper);
  F.candle(ctx, table, -0.16, top, -0.08, 0.12, 0.024);
  return table;
}

/** 휴대폰 (팀원 makePhone 이식) — 금 간 잠금화면 */
export function phoneOnTable(ctx, x, z, onFloor = false) {
  const tex = canvasTex(128, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#1a2a4a');
    grad.addColorStop(1, '#06080f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#e8eefc';
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.fillText('23:47', 64, 70);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(10, 110 + i * 32, 108, 26);
    }
    g.fillStyle = 'rgba(200,20,20,0.85)';
    g.beginPath();
    g.arc(90, 190, 14, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.beginPath();
      g.moveTo(30, 200);
      g.lineTo(30 + Math.cos(a) * 120, 200 + Math.sin(a) * 120);
      g.stroke();
    }
  });
  const phone = new THREE.Group();
  phone.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.009, 0.155), mat(0x0c0c10, { metalness: 0.6, roughness: 0.3 })));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.145), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9 }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = 0.0052;
  phone.add(screen);
  phone.scale.setScalar(1.6); // 멀리서도 보이게 조금 크게
  if (onFloor) {
    const g = new THREE.Group();
    phone.position.y = 0.01;
    phone.rotation.y = 0.7;
    g.add(phone);
    bloodDecal(ctx, x + 0.25, z - 0.1, 0.25);
    // 바닥 물건은 클릭하기 쉽게 보이지 않는 넓은 판을 깔아 둔다
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.06;
    g.add(hit);
    return place(ctx, g, x, z);
  }
  const { table, top } = sideTable(ctx, x, z);
  phone.position.set(0, top + 0.008, 0);
  phone.rotation.y = 0.4;
  table.add(phone);
  return table;
}

/** 일기장 (diary): 작은 책상 위에 펼쳐진 가죽 일기장 */
export function diaryDesk(ctx, x, z, rotY) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.06, 0.6, 3, 0.02), WOOD);
  top.position.y = 0.76;
  g.add(top);
  for (const [lx, lz] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.74, 8), DARK);
    leg.position.set(lx, 0.37, lz);
    g.add(leg);
  }
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.34), mat(0x3a1a12, { roughness: 0.6 }));
  cover.position.set(0, 0.8, 0);
  g.add(cover);
  for (const s of [-1, 1]) {
    const page = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.32), new THREE.MeshStandardMaterial({ map: handwrittenPaper(s < 0 ? ['11월 2일 · 비', 'J에게서 편지가', '왔다. 24년'] : ['11월 17일', '밤 밤 밤', '문 두드리는'], { blood: s > 0 }), roughness: 0.9 }));
    page.rotation.x = -Math.PI / 2;
    page.rotation.y = s * 0.06;
    page.position.set(s * 0.12, 0.815, 0);
    g.add(page);
  }
  F.candle(ctx, g, 0.42, 0.79, -0.18, 0.14, 0.026);
  bloodDecal(ctx, 0, 0, 0.06, g).position.set(0.2, 0.822, 0.06);
  place(ctx, g, x, z, rotY);
  collide(ctx, x, z, 1.1, 0.6, rotY);
  return g;
}

/** 책 (book): 독서대 위에 펼쳐진 책 */
export function lectern(ctx, x, z, rotY) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.0, 10), DARK);
  post.position.y = 0.5;
  g.add(post);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.05, 16), DARK);
  base.position.y = 0.025;
  g.add(base);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.4), WOOD);
  board.position.set(0, 1.05, 0);
  board.rotation.x = 0.45;
  g.add(board);
  const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.32), new THREE.MeshStandardMaterial({ map: handwrittenPaper(['신문 스크랩', '― 실종 ―', '와인 저장고'], { w: 320, h: 220 }), roughness: 0.9 }));
  pages.position.set(0, 1.07, 0.01);
  pages.rotation.x = -Math.PI / 2 + 0.45;
  g.add(pages);
  place(ctx, g, x, z, rotY);
  addCollider(ctx, x, z, 0.5, 0.5);
  return g;
}

/** 깨진 와인병 (jar): 바닥의 초록 유리 조각 + 쏟아진 와인 */
export function brokenBottle(ctx, x, z) {
  const g = new THREE.Group();
  const glass = mat(0x0f3a18, { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 });
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.22, 12, 1, true), glass);
  neck.rotation.z = Math.PI / 2;
  neck.position.set(0, 0.045, 0);
  g.add(neck);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.07), new THREE.MeshStandardMaterial({ map: canvasTex(64, 48, (c) => {
    c.fillStyle = '#e0d4b0';
    c.fillRect(0, 0, 40, 48);
    c.fillStyle = '#5a1010';
    c.font = 'bold 18px serif';
    c.fillText('19..', 2, 30);
  }), roughness: 0.9 }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(0.18, 0.004, 0.1);
  g.add(label);
  for (let i = 0; i < 9; i++) {
    const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.03 + (i % 3) * 0.012), glass);
    shard.position.set(Math.cos(i * 2.1) * (0.12 + i * 0.03), 0.01, Math.sin(i * 2.1) * (0.1 + i * 0.025));
    shard.rotation.set(i, i * 0.7, i * 1.3);
    g.add(shard);
  }
  const wine = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), mat(0x2a0206, { roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.88 }));
  wine.rotation.x = -Math.PI / 2;
  wine.scale.set(1, 0.6, 1);
  wine.position.y = 0.003;
  g.add(wine);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.7), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.075;
  g.add(hit);
  return place(ctx, g, x, z);
}

/** 석고 흉상 (statue) */
export function bust(ctx, x, z) {
  const g = new THREE.Group();
  const marble = mat(0xd8d0c4, { roughness: 0.35 });
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.0, 16), DARK);
  ped.position.y = 0.5;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), marble);
  chest.scale.set(1.2, 0.8, 0.7);
  chest.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), marble);
  head.scale.set(0.9, 1.15, 1);
  head.position.y = 1.3;
  g.add(ped, chest, head);
  const tear = handPrintMesh(0.08);
  tear.position.set(0.03, 1.28, 0.11);
  g.add(tear);
  place(ctx, g, x, z);
  addCollider(ctx, x, z, 0.45, 0.45);
  return g;
}

/** 시신 (body): 팀원 corpse.js 그대로 + 피웅덩이·끌린 자국 */
export function corpse(ctx, x, z, rotY) {
  const { body } = buildCorpse();
  body.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  const g = new THREE.Group();
  g.add(body);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(0.1, 0.15, 0);
  g.add(hit);
  place(ctx, g, x, z, rotY);
  bloodDecal(ctx, x + Math.cos(rotY) * 0.9, z - Math.sin(rotY) * 0.9, 0.55);
  dragDecal(ctx, x - 2.2, z + 0.6, x - 0.6, z + 0.1, 0.4);
  addCollider(ctx, x, z, 1.4, 0.7);
  return g;
}

// ------------------------------------------------------------------ 미니게임 오브젝트
/** sequence: 원탁 위 오르골 (뚜껑이 열린 채, 작은 무용수가 천천히 돈다) */
export function musicBox(ctx, x, z) {
  const { table, top } = sideTable(ctx, x, z);
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.14, 0.22, 3, 0.015), mat(0x5a1a12, { roughness: 0.4 }));
  box.position.y = top + 0.07;
  table.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.22), mat(0x5a1a12, { roughness: 0.4 }));
  lid.position.set(0, top + 0.2, -0.13);
  lid.rotation.x = -1.2;
  table.add(lid);
  const dancer = new THREE.Group();
  const dm = mat(0xe8e0d0, { roughness: 0.4 });
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.05, 12), dm);
  skirt.position.y = 0.04;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.05, 8), dm);
  torso.position.y = 0.085;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), dm);
  head.position.y = 0.12;
  dancer.add(skirt, torso, head);
  dancer.position.y = top + 0.14;
  table.add(dancer);
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), BRASS);
  crank.rotation.z = Math.PI / 2;
  crank.position.set(0.19, top + 0.07, 0);
  table.add(crank);
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffaa00, emissiveIntensity: 1.6 });
  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), glow);
  gem.position.set(0, top + 0.08, 0.115);
  table.add(gem);
  ctx.updaters.push((dt, t) => (dancer.rotation.y = t * 0.8));
  return { group: table, glowMat: glow, topY: top + 0.45 };
}

/** timing: 괘종시계 (추가 좌우로 흔들림) */
export function grandfatherClock(ctx, x, z, rotY) {
  const g = new THREE.Group();
  const caseM = mat(0x2e180c, { roughness: 0.5 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.62, 2.2, 0.42, 3, 0.02), caseM);
  body.position.y = 1.1;
  g.add(body);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.42, 24, 1, false, 0, Math.PI), caseM);
  crown.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  crown.position.y = 2.2;
  g.add(crown);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshStandardMaterial({ roughness: 0.4, map: canvasTex(128, 128, (c) => {
    c.fillStyle = '#e6d8b4';
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#2a1a10';
    c.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.beginPath();
      c.moveTo(64 + Math.sin(a) * 48, 64 - Math.cos(a) * 48);
      c.lineTo(64 + Math.sin(a) * 56, 64 - Math.cos(a) * 56);
      c.stroke();
    }
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(64, 64);
    c.lineTo(64 - 20, 64 - 30);
    c.moveTo(64, 64);
    c.lineTo(64 + 6, 64 - 50);
    c.stroke();
  }) }));
  face.position.set(0, 1.85, 0.215);
  g.add(face);
  // 추가 보이는 유리창
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 1.0), new THREE.MeshStandardMaterial({ color: 0x0a0604, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.55 }));
  win.position.set(0, 0.95, 0.215);
  g.add(win);
  const pend = new THREE.Group();
  pend.position.set(0, 1.5, 0.12);
  const rod = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.8, 0.01), BRASS);
  rod.position.y = -0.4;
  const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 24), BRASS);
  bob.rotation.x = Math.PI / 2;
  bob.position.y = -0.82;
  pend.add(rod, bob);
  g.add(pend);
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffaa00, emissiveIntensity: 1.6 });
  const gem = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), glow);
  gem.position.set(0, 2.3, 0.22);
  g.add(gem);
  ctx.updaters.push((dt, t) => (pend.rotation.z = Math.sin(t * 2.1) * 0.22));
  place(ctx, g, x, z, rotY);
  addCollider(ctx, x, z, 0.62, 0.5);
  return { group: g, glowMat: glow, topY: 2.65 };
}

/** wires: 오래된 두꺼비집 (전선이 늘어진 철제 함) */
export function fuseBox(ctx, x, z, rotY) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), DARK);
  post.position.y = 0.55;
  g.add(post);
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.6, 0.22, 2, 0.02), mat(0x3a3a34, { metalness: 0.6, roughness: 0.45 }));
  box.position.y = 1.35;
  g.add(box);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.56, 0.02), mat(0x2a2a26, { metalness: 0.6, roughness: 0.5 }));
  door.position.set(-0.36, 1.35, 0.25);
  door.rotation.y = -1.2;
  g.add(door);
  const cols = [0xb02020, 0x2050b0, 0x20a040, 0xd0b020];
  cols.forEach((c, k) => {
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7 + k * 0.1, 6), mat(c, { roughness: 0.6 }));
    wire.position.set(-0.22 + k * 0.15, 0.85 - k * 0.05, 0.12);
    wire.rotation.z = (k - 1.5) * 0.18;
    g.add(wire);
  });
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffaa00, emissiveIntensity: 1.6 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), glow);
  lamp.position.set(0.25, 1.58, 0.12);
  g.add(lamp);
  place(ctx, g, x, z, rotY);
  addCollider(ctx, x, z, 0.7, 0.4);
  return { group: g, glowMat: glow, topY: 1.95 };
}

// ------------------------------------------------------------------ 장식
/** 와인 선반 (팀원 makeRack 을 InstancedMesh 로 다시 작성: 병 45개 → 그리기 1번) */
export function wineRack(ctx, x, z, rotY, { emptySlot = false } = {}) {
  const g = new THREE.Group();
  const rackWood = mat(0x2b1b10);
  const back = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 0.04), rackWood);
  back.position.set(0, 1.1, -0.32);
  g.add(back);
  for (const px of [-1.48, -0.5, 0.5, 1.48]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.66), rackWood);
    s.position.set(px, 1.1, 0);
    g.add(s);
  }
  const bottleGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.32, 10);
  bottleGeo.rotateX(Math.PI / 2);
  const inst = new THREE.InstancedMesh(bottleGeo, mat(0xffffff, { roughness: 0.15, metalness: 0.2 }), 45);
  const colors = [0x0f2414, 0x2a120c, 0x161616].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < 5; r++) {
    const y = 0.15 + r * 0.42;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(3, 0.03, 0.66), rackWood);
    shelf.position.set(0, y - 0.06, 0);
    g.add(shelf);
    for (let c = 0; c < 9; c++) {
      if (emptySlot && r === 2 && c === 4) continue;
      if ((r * 9 + c) % 13 === 5) continue;
      m4.makeTranslation(-1.3 + c * 0.325, y + 0.05, 0);
      inst.setMatrixAt(n, m4);
      inst.setColorAt(n, colors[(r + c) % 3]);
      n++;
    }
  }
  inst.count = n;
  g.add(inst);
  if (emptySlot) {
    const print = handPrintMesh(0.17);
    print.position.set(0, 0.15 + 2 * 0.42 + 0.08, 0.34);
    g.add(print);
  }
  place(ctx, g, x, z, rotY);
  collide(ctx, x, z, 3, 0.7, rotY);
  return g;
}
