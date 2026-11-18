// =====================================================================
// 절차적 텍스처 생성기 (Canvas 2D) — 외부 이미지 파일 없이 사실적인 재질을 만든다.
//   공포: 얼룩진 콘크리트, 더러운 타일, 녹슨 철문, 핏자국, 서버 랙, CRT 화면
//   이집트: 상형문자가 새겨진 사암, 모래 바닥, 돌문, 금박 무늬, 횃불 불꽃
// 모든 함수는 canvas 를 반환하고, 엔진이 THREE.CanvasTexture 로 감싼다.
// =====================================================================
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function noise(ctx, w, h, amount, rand) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function blot(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function crack(ctx, x, y, steps, rand, color = 'rgba(15,15,15,0.55)', width = 1.3) {
  const branches = [];
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = rand() * Math.PI * 2;
  for (let i = 0; i < steps; i++) {
    a += (rand() - 0.5) * 0.9;
    x += Math.cos(a) * 6;
    y += Math.sin(a) * 6;
    ctx.lineTo(x, y);
    if (rand() < 0.07) branches.push([x, y]);
  }
  ctx.stroke();
  for (const [bx, by] of branches) crack(ctx, bx, by, Math.max(3, (steps * 0.35) | 0), rand, color, width * 0.7);
}

function scribbleLine(ctx, x0, x1, y, rand, amp = 5) {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  let x = x0;
  while (x < x1) {
    const w = 3 + rand() * 6;
    ctx.quadraticCurveTo(x + w / 2, y - amp * (0.4 + rand()), x + w, y + (rand() - 0.5) * 2);
    x += w;
    if (rand() < 0.12) {
      x += 6 + rand() * 6; // 단어 사이 공백
      ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
}

// ------------------------------------------------------------------ 공포
export function concreteWall(seed = 1) {
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#676964';
  ctx.fillRect(0, 0, S, S);
  // 아래쪽은 벗겨진 병원풍 녹색 페인트
  const paintTop = S * 0.56;
  ctx.fillStyle = '#3f5048';
  ctx.fillRect(0, paintTop, S, S - paintTop);
  ctx.fillStyle = '#26332d';
  ctx.fillRect(0, paintTop - 7, S, 7);
  for (let i = 0; i < 16; i++) {
    const x = R() * S;
    const y = paintTop + R() * (S - paintTop);
    ctx.fillStyle = '#5c5e59';
    ctx.beginPath();
    ctx.ellipse(x, y, 8 + R() * 46, 5 + R() * 24, R() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(25,35,30,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  for (let i = 0; i < 55; i++) blot(ctx, R() * S, R() * S, 20 + R() * 90, R() < 0.55 ? '#262823' : '#8c8e88', 0.1 + R() * 0.16);
  // 위에서 흘러내린 물때
  for (let i = 0; i < 18; i++) {
    const x = R() * S;
    const len = 80 + R() * S * 0.8;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(45,34,20,0.5)');
    g.addColorStop(1, 'rgba(45,34,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 3 + R() * 22, len);
  }
  // 바닥 쪽 곰팡이
  const g2 = ctx.createLinearGradient(0, S * 0.78, 0, S);
  g2.addColorStop(0, 'rgba(8,12,6,0)');
  g2.addColorStop(1, 'rgba(8,12,6,0.7)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, S * 0.78, S, S * 0.22);
  for (let i = 0; i < 7; i++) crack(ctx, R() * S, R() * S, (18 + R() * 30) | 0, R);
  noise(ctx, S, S, 30, R);
  return c;
}

export function floorTiles(seed = 2) {
  const S = 512;
  const T = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  for (let y = 0; y < S; y += T) {
    for (let x = 0; x < S; x += T) {
      const v = 105 + R() * 35;
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
      ctx.fillRect(x, y, T, T);
      if (R() < 0.25) blot(ctx, x + T / 2, y + T / 2, T * 0.7, '#2a2418', 0.25);
    }
  }
  for (let i = 0; i < 45; i++) blot(ctx, R() * S, R() * S, 15 + R() * 70, '#1c1a14', 0.15 + R() * 0.2);
  for (let i = 0; i < 8; i++) blot(ctx, R() * S, R() * S, 10 + R() * 40, '#5a3412', 0.2);
  ctx.strokeStyle = 'rgba(20,18,14,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = R() * S;
    const y = R() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (R() - 0.5) * 60, y + (R() - 0.5) * 12);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) crack(ctx, R() * S, R() * S, (10 + R() * 20) | 0, R);
  ctx.fillStyle = '#26241f';
  for (let i = 0; i <= S; i += T) {
    ctx.fillRect(i - 2, 0, 4, S);
    ctx.fillRect(0, i - 2, S, 4);
  }
  noise(ctx, S, S, 24, R);
  return c;
}

export function ceilingTiles(seed = 3) {
  const S = 512;
  const P = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  const missing = Math.floor(R() * 4);
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * P;
    const y = Math.floor(i / 2) * P;
    if (i === missing) {
      ctx.fillStyle = '#060606';
      ctx.fillRect(x, y, P, P);
      ctx.strokeStyle = '#151515';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 20, y + 40);
      ctx.bezierCurveTo(x + 90, y + 200, x + 160, y + 20, x + 240, y + 180);
      ctx.stroke();
      continue;
    }
    const v = 135 + R() * 20;
    ctx.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
    ctx.fillRect(x, y, P, P);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < 900; k++) ctx.fillRect(x + R() * P, y + R() * P, 1.5, 1.5);
    if (R() < 0.7) {
      const cx = x + R() * P;
      const cy = y + R() * P;
      const r = 20 + R() * 60;
      blot(ctx, cx, cy, r, '#6b4a1c', 0.45);
      ctx.strokeStyle = 'rgba(90,60,20,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#4b4943';
  for (let i = 0; i <= S; i += P) {
    ctx.fillRect(i - 4, 0, 8, S);
    ctx.fillRect(0, i - 4, S, 8);
  }
  noise(ctx, S, S, 18, R);
  return c;
}

export function hazardStripes(w = 256, h = 64) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const R = mulberry32(9);
  ctx.fillStyle = '#c9a200';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#141414';
  for (let x = -h; x < w + h; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + 24, h);
    ctx.lineTo(x + 24 + h, 0);
    ctx.lineTo(x + h, 0);
    ctx.fill();
  }
  for (let i = 0; i < 20; i++) blot(ctx, R() * w, R() * h, 6 + R() * 20, '#3a2a10', 0.4);
  noise(ctx, w, h, 30, R);
  return c;
}

export function metalDoor(seed = 4) {
  const W = 256;
  const H = 512;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#6a7074');
  g.addColorStop(1, '#43494d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, R() * H, W, 1);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(22, 30, W - 44, 190);
  ctx.strokeRect(22, 250, W - 44, 170);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(25, 33, W - 50, 184);
  ctx.strokeRect(25, 253, W - 50, 164);
  // 경고 문구
  ctx.fillStyle = 'rgba(225,225,220,0.85)';
  ctx.font = 'bold 30px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RESTRICTED', W / 2, 120);
  ctx.font = 'bold 26px "Malgun Gothic", sans-serif';
  ctx.fillText('제한 구역', W / 2, 158);
  ctx.fillStyle = 'rgba(200,20,20,0.85)';
  ctx.fillRect(40, 178, W - 80, 6);
  // 아래 경고 줄무늬
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, H - 70, W, 70);
  ctx.clip();
  ctx.drawImage(hazardStripes(W, 70), 0, H - 70);
  ctx.restore();
  // 녹
  for (let i = 0; i < 30; i++) blot(ctx, R() * W, R() * H, 6 + R() * 34, R() < 0.6 ? '#7a3810' : '#4a2408', 0.25 + R() * 0.3);
  const rg = ctx.createLinearGradient(0, H * 0.7, 0, H);
  rg.addColorStop(0, 'rgba(90,40,10,0)');
  rg.addColorStop(1, 'rgba(90,40,10,0.45)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);
  // 긁힌 자국
  ctx.strokeStyle = 'rgba(220,220,220,0.18)';
  for (let i = 0; i < 40; i++) {
    const x = R() * W;
    const y = R() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (R() - 0.5) * 40, y + (R() - 0.5) * 40);
    ctx.stroke();
  }
  // 손톱으로 긁은 4줄
  ctx.strokeStyle = 'rgba(20,10,10,0.6)';
  ctx.lineWidth = 2;
  const sx = 60 + R() * 120;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(sx + k * 9, 260);
    ctx.lineTo(sx + k * 9 + 14, 400);
    ctx.stroke();
  }
  noise(ctx, W, H, 22, R);
  return c;
}

export function rackFront(seed = 5) {
  const W = 256;
  const H = 512;
  const map = makeCanvas(W, H);
  const glow = makeCanvas(W, H);
  const m = map.getContext('2d');
  const g = glow.getContext('2d');
  const R = mulberry32(seed);
  m.fillStyle = '#121416';
  m.fillRect(0, 0, W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  m.fillStyle = '#25282c';
  m.fillRect(0, 0, 14, H);
  m.fillRect(W - 14, 0, 14, H);
  const colors = ['#33ff66', '#33ff66', '#ffb020', '#ff3030', '#33aaff'];
  for (let u = 0; u < 8; u++) {
    const y = 14 + u * 61;
    m.fillStyle = '#1a1d20';
    m.fillRect(18, y, W - 36, 54);
    m.fillStyle = '#0a0b0c';
    for (let vx = 90; vx < W - 30; vx += 9) for (let vy = y + 8; vy < y + 48; vy += 9) m.fillRect(vx, vy, 5, 5);
    m.fillStyle = 'rgba(220,220,220,0.5)';
    m.fillRect(26, y + 38, 40, 8);
    const leds = 2 + Math.floor(R() * 4);
    for (let l = 0; l < leds; l++) {
      const col = colors[Math.floor(R() * colors.length)];
      const lx = 28 + l * 12;
      const ly = y + 16;
      m.fillStyle = rgba(col, 0.35);
      m.fillRect(lx, ly, 6, 6);
      g.fillStyle = col;
      g.fillRect(lx, ly, 6, 6);
      const gg = g.createRadialGradient(lx + 3, ly + 3, 0, lx + 3, ly + 3, 10);
      gg.addColorStop(0, rgba(col, 0.6));
      gg.addColorStop(1, rgba(col, 0));
      g.fillStyle = gg;
      g.fillRect(lx - 8, ly - 8, 22, 22);
    }
  }
  for (let i = 0; i < 12; i++) blot(m, R() * W, R() * H, 10 + R() * 40, '#000000', 0.3);
  noise(m, W, H, 14, R);
  return { map, glow };
}

export function paper(seed = 6, { blood = false, lined = false } = {}) {
  const W = 256;
  const H = 320;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#e4dcc4');
  g.addColorStop(1, '#c9bd9c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (lined) {
    ctx.strokeStyle = 'rgba(70,100,160,0.35)';
    for (let y = 40; y < H; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(190,60,60,0.4)';
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.lineTo(34, H);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(25,25,45,0.75)';
  ctx.lineWidth = 1.6;
  for (let y = 46; y < H - 40; y += 18) if (R() < 0.85) scribbleLine(ctx, 42, 42 + 120 + R() * 80, y, R, 4);
  ctx.strokeStyle = 'rgba(110,70,30,0.35)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(60 + R() * 140, 80 + R() * 160, 28, 0, Math.PI * 1.7);
  ctx.stroke();
  if (blood) {
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rgba(R() < 0.5 ? '#5a0505' : '#7a0909', 0.7 + R() * 0.3);
      ctx.beginPath();
      ctx.arc(150 + (R() - 0.5) * 140, 200 + (R() - 0.5) * 120, 1 + R() * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.5);
  ctx.lineTo(W, H * 0.48);
  ctx.stroke();
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, 'rgba(60,40,10,0)');
  v.addColorStop(1, 'rgba(60,40,10,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 16, R);
  return c;
}

export function whiteboard(seed = 7) {
  const W = 512;
  const H = 360;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#dfe2df';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 18; i++) blot(ctx, R() * W, R() * H, 30 + R() * 90, '#7c8a96', 0.12);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(30,50,120,0.75)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) scribbleLine(ctx, 40 + R() * 40, 200 + R() * 220, 60 + i * 42, R, 8);
  ctx.strokeRect(300, 70, 140, 80);
  ctx.beginPath();
  ctx.moveTo(220, 110);
  ctx.lineTo(296, 110);
  ctx.lineTo(284, 100);
  ctx.moveTo(296, 110);
  ctx.lineTo(284, 120);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(180,15,15,0.85)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(320, 190);
  ctx.lineTo(450, 320);
  ctx.moveTo(450, 190);
  ctx.lineTo(320, 320);
  ctx.stroke();
  ctx.fillStyle = 'rgba(180,15,15,0.85)';
  ctx.font = 'bold 34px "Malgun Gothic", sans-serif';
  ctx.fillText('믿지 마', 40, 330);
  ctx.strokeStyle = '#8d9398';
  ctx.lineWidth = 14;
  ctx.strokeRect(0, 0, W, H);
  noise(ctx, W, H, 10, R);
  return c;
}

export function cardboard(seed = 8) {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#9b7a4b';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let x = 0; x < S; x += 5) ctx.fillRect(x, 0, 2, S);
  ctx.fillStyle = 'rgba(205,190,145,0.85)';
  ctx.fillRect(0, S / 2 - 22, S, 44);
  ctx.fillStyle = 'rgba(15,15,15,0.8)';
  ctx.font = 'bold 26px "Arial Black", sans-serif';
  ctx.fillText(`EVIDENCE #${100 + Math.floor(R() * 800)}`, 18, 60);
  for (let i = 0; i < 10; i++) blot(ctx, R() * S, R() * S, 10 + R() * 50, '#3a2a12', 0.3);
  noise(ctx, S, S, 18, R);
  return c;
}

export function leather(color = '#4a1f14', seed = 10) {
  const W = 256;
  const H = 320;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) blot(ctx, R() * W, R() * H, 10 + R() * 40, '#000000', 0.18);
  ctx.strokeStyle = 'rgba(210,170,90,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  noise(ctx, W, H, 20, R);
  return c;
}

/** 바닥에 번진 핏자국 (투명 배경) */
export function bloodPool(seed = 11) {
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  const cx = S / 2;
  const cy = S / 2;
  for (let i = 0; i < 26; i++) {
    const x = cx + (R() - 0.5) * 150;
    const y = cy + (R() - 0.5) * 110;
    const r = 25 + R() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(70,4,4,0.75)');
    g.addColorStop(0.7, 'rgba(55,3,3,0.55)');
    g.addColorStop(1, 'rgba(40,2,2,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + R() * 0.5), R() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 끌고 간 자국
  ctx.lineCap = 'round';
  const dir = R() * Math.PI * 2;
  for (let k = 0; k < 5; k++) {
    ctx.strokeStyle = `rgba(60,3,3,${0.18 + R() * 0.2})`;
    ctx.lineWidth = 18 + R() * 24;
    ctx.beginPath();
    ctx.moveTo(cx + (R() - 0.5) * 40, cy + (R() - 0.5) * 40);
    ctx.lineTo(cx + Math.cos(dir) * 240 + (R() - 0.5) * 30, cy + Math.sin(dir) * 240 + (R() - 0.5) * 30);
    ctx.stroke();
  }
  for (let i = 0; i < 160; i++) {
    const a = R() * Math.PI * 2;
    const d = 80 + R() * 160;
    ctx.fillStyle = `rgba(80,5,5,${0.5 + R() * 0.5})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + R() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** 벽에 피로 쓴 글씨 (흘러내림 포함, 투명 배경) */
export function bloodText(text, seed = 12) {
  const W = 1024;
  const H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.font = 'bold 150px "East Sea Dokdo", "Nanum Brush Script", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(${90 + R() * 30},5,5,${0.35 + R() * 0.3})`;
    ctx.fillText(text, W / 2 + (R() - 0.5) * 8, H / 2 - 20 + (R() - 0.5) * 8);
  }
  const width = Math.min(W - 40, ctx.measureText(text).width);
  ctx.lineCap = 'round';
  for (let k = 0; k < 34; k++) {
    const x = W / 2 + (R() - 0.5) * width;
    const y0 = H / 2 + 10 + R() * 30;
    const len = 15 + R() * 90;
    ctx.strokeStyle = `rgba(85,4,4,${0.5 + R() * 0.4})`;
    ctx.lineWidth = 2 + R() * 5;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + (R() - 0.5) * 3, y0 + len);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y0 + len, ctx.lineWidth * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

export function handprint(seed = 13) {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = 'rgba(85,5,5,0.8)';
  ctx.beginPath();
  ctx.ellipse(128, 150, 42, 52, 0, 0, Math.PI * 2);
  ctx.fill();
  const fingers = [
    [-34, -58, -0.35, 52],
    [-12, -78, -0.1, 64],
    [12, -80, 0.05, 66],
    [33, -66, 0.25, 56],
    [-52, 0, -1.1, 46],
  ];
  for (const [dx, dy, rot, len] of fingers) {
    ctx.save();
    ctx.translate(128 + dx, 150 + dy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, -len / 3, 10, len / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // 아래로 끌린 자국
  const g = ctx.createLinearGradient(0, 190, 0, 256);
  g.addColorStop(0, 'rgba(85,5,5,0.6)');
  g.addColorStop(1, 'rgba(85,5,5,0)');
  ctx.fillStyle = g;
  ctx.fillRect(90 + R() * 10, 190, 70, 66);
  return c;
}

export function signPlate(text, kind = 'horror', seed = 14) {
  const W = 512;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  if (kind === 'egypt') {
    ctx.fillStyle = '#b8945d';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) blot(ctx, R() * W, R() * H, 10 + R() * 40, R() < 0.5 ? '#7a5a30' : '#e0c58e', 0.2);
    ctx.strokeStyle = '#6b4a20';
    ctx.lineWidth = 6;
    roundRect(ctx, 14, 14, W - 28, H - 28, 46);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,170,0.5)';
    ctx.lineWidth = 2;
    roundRect(ctx, 18, 18, W - 36, H - 36, 42);
    ctx.stroke();
    ctx.fillStyle = '#3d260d';
    ctx.font = 'bold 44px "Song Myung", "Gowun Batang", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2 + 2, W - 80);
  } else {
    ctx.fillStyle = '#5a6064';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) blot(ctx, R() * W, R() * H, 8 + R() * 36, '#6e3410', 0.35);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = 'bold 46px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2 - 6, W - 60);
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`SECTOR-0${1 + Math.floor(R() * 8)}  //  BIOHAZARD LEVEL 3`, W / 2, H - 18);
    ctx.fillStyle = '#2c2c2c';
    for (const [x, y] of [[12, 12], [W - 12, 12], [12, H - 12], [W - 12, H - 12]]) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  noise(ctx, W, H, 18, R);
  return c;
}

export function exitSign() {
  const W = 256;
  const H = 96;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b8a3a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#eafff0';
  ctx.font = 'bold 40px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EXIT', W / 2 + 26, 48);
  ctx.font = 'bold 22px "Malgun Gothic", sans-serif';
  ctx.fillText('비상구', W / 2 + 26, 80);
  // 달리는 사람 아이콘 (간단)
  ctx.strokeStyle = '#eafff0';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(44, 22, 7, 0, Math.PI * 2);
  ctx.moveTo(40, 32);
  ctx.lineTo(34, 56);
  ctx.lineTo(48, 72);
  ctx.moveTo(34, 56);
  ctx.lineTo(22, 78);
  ctx.moveTo(38, 40);
  ctx.lineTo(54, 48);
  ctx.moveTo(38, 40);
  ctx.lineTo(24, 46);
  ctx.stroke();
  return c;
}

export function woodGrain(seed = 15, base = '#4a3322') {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.1})`;
    ctx.fillRect(0, y + Math.sin(y * 0.05) * 3, S, 1);
  }
  for (let i = 0; i < 10; i++) blot(ctx, R() * S, R() * S, 10 + R() * 40, '#120a04', 0.3);
  noise(ctx, S, S, 16, R);
  return c;
}

/** CRT 화면: 매 프레임 다시 그린다 */
export function drawCRT(ctx, W, H, t, mode, title = '') {
  ctx.fillStyle = mode === 'denied' ? '#1a0202' : '#020b05';
  ctx.fillRect(0, 0, W, H);
  const col = mode === 'granted' ? '#8dffb0' : mode === 'denied' ? '#ff4040' : '#3cff7e';
  ctx.fillStyle = col;
  ctx.font = 'bold 14px "Nanum Gothic Coding", Consolas, monospace';
  ctx.textBaseline = 'top';
  const blink = Math.floor(t * 2) % 2 === 0;
  let lines;
  if (mode === 'granted') lines = ['> ACCESS GRANTED', '> 격리 해제됨', '', '> _'];
  else if (mode === 'firewall') lines = ['> FIREWALL ACTIVE', '> 침투 시도 대기', '', ''];
  else lines = ['> SYSTEM BREACH', `> NODE: ${title}`.slice(0, 26), '> 인증 코드 입력 대기', blink ? '> _' : '>'];
  lines.forEach((l, i) => ctx.fillText(l, 10, 12 + i * 22));
  if (mode === 'firewall') {
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < W; x += 3) {
      const y = H * 0.68 + Math.sin(x * 0.08 + t * 6) * 14 * Math.sin(t * 1.3 + x * 0.01);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 글리치
  if (mode !== 'granted' && Math.random() < 0.08) {
    ctx.fillStyle = 'rgba(255,40,40,0.85)';
    ctx.fillText('INFECTED INFECTED INFECTED', 6 + Math.random() * 20, Math.random() * H);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** 감시 카메라 노이즈 화면 */
export function drawStatic(ctx, W, H) {
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 200;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = 'bold 10px monospace';
  ctx.fillText('CAM 0' + (1 + Math.floor(Date.now() / 3000) % 6) + '  NO SIGNAL', 4, 12);
}

// ------------------------------------------------------------------ 이집트
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const GLYPHS = ['ankh', 'eye', 'bird', 'water', 'reed', 'sun', 'snake', 'scarab', 'feather', 'hand', 'jackal'];

/** 상형문자 하나 그리기 (현재 strokeStyle 사용, 중심 x,y 크기 s) */
export function drawGlyph(ctx, type, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 40, s / 40);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (type) {
    case 'ankh':
      ctx.ellipse(0, -10, 7, 10, 0, 0, Math.PI * 2);
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 20);
      ctx.moveTo(-12, 3);
      ctx.lineTo(12, 3);
      break;
    case 'eye':
      ctx.moveTo(-18, -4);
      ctx.quadraticCurveTo(0, -18, 18, -4);
      ctx.quadraticCurveTo(0, 8, -18, -4);
      ctx.moveTo(4, -5);
      ctx.arc(0, -5, 4, 0, Math.PI * 2);
      ctx.moveTo(-4, 2);
      ctx.lineTo(-6, 16);
      ctx.moveTo(4, 2);
      ctx.quadraticCurveTo(14, 18, 4, 18);
      ctx.moveTo(-18, -12);
      ctx.quadraticCurveTo(0, -24, 18, -12);
      break;
    case 'bird':
      ctx.ellipse(0, 0, 12, 8, -0.3, 0, Math.PI * 2);
      ctx.moveTo(14, -12);
      ctx.arc(10, -12, 4, 0, Math.PI * 2);
      ctx.moveTo(14, -12);
      ctx.lineTo(20, -10);
      ctx.moveTo(-2, 8);
      ctx.lineTo(-4, 20);
      ctx.moveTo(4, 7);
      ctx.lineTo(6, 20);
      ctx.moveTo(-12, 2);
      ctx.lineTo(-20, 8);
      break;
    case 'water':
      for (let r = 0; r < 2; r++) {
        ctx.moveTo(-18, -6 + r * 12);
        for (let k = 0; k < 6; k++) ctx.lineTo(-18 + (k + 1) * 6, (k % 2 ? -6 : -12) + r * 12 + 6);
      }
      break;
    case 'reed':
      ctx.moveTo(0, 20);
      ctx.lineTo(0, -18);
      ctx.moveTo(0, -18);
      ctx.quadraticCurveTo(12, -10, 6, 4);
      break;
    case 'sun':
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.moveTo(3, 0);
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      break;
    case 'snake':
      ctx.moveTo(-18, 10);
      ctx.bezierCurveTo(-10, -10, -2, 20, 6, 0);
      ctx.bezierCurveTo(10, -10, 14, -14, 18, -8);
      ctx.moveTo(18, -8);
      ctx.lineTo(14, -14);
      break;
    case 'scarab':
      ctx.ellipse(0, 4, 10, 13, 0, 0, Math.PI * 2);
      ctx.moveTo(0, -9);
      ctx.arc(0, -12, 5, 0, Math.PI * 2);
      for (const sgn of [-1, 1]) {
        ctx.moveTo(sgn * 9, 0);
        ctx.lineTo(sgn * 18, -6);
        ctx.moveTo(sgn * 10, 8);
        ctx.lineTo(sgn * 19, 12);
      }
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 17);
      break;
    case 'feather':
      ctx.moveTo(0, 20);
      ctx.quadraticCurveTo(4, 0, 0, -20);
      ctx.moveTo(0, -20);
      ctx.quadraticCurveTo(10, -6, 4, 14);
      ctx.moveTo(0, -20);
      ctx.quadraticCurveTo(-8, -4, -2, 14);
      break;
    case 'hand':
      ctx.moveTo(-18, 6);
      ctx.lineTo(10, 6);
      ctx.quadraticCurveTo(18, 6, 18, 0);
      ctx.lineTo(-18, -2);
      ctx.moveTo(10, 0);
      ctx.lineTo(12, -8);
      break;
    case 'jackal':
      ctx.moveTo(-16, 16);
      ctx.lineTo(-14, -2);
      ctx.quadraticCurveTo(-8, -6, 4, -4);
      ctx.lineTo(8, -16);
      ctx.lineTo(10, -8);
      ctx.lineTo(14, -14);
      ctx.lineTo(14, -6);
      ctx.lineTo(20, -2);
      ctx.lineTo(12, 0);
      ctx.lineTo(10, 16);
      break;
    default:
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/** 새긴 상형문자: 그림자 + 하이라이트 두 번 그려 음각처럼 보이게 */
function carveGlyph(ctx, type, x, y, s, paint) {
  if (paint) {
    ctx.strokeStyle = paint;
    ctx.lineWidth = 9;
    drawGlyph(ctx, type, x, y, s);
  }
  ctx.strokeStyle = 'rgba(255,236,190,0.55)';
  ctx.lineWidth = 3;
  drawGlyph(ctx, type, x + 1.5, y + 1.5, s);
  ctx.strokeStyle = 'rgba(70,45,15,0.85)';
  ctx.lineWidth = 3.5;
  drawGlyph(ctx, type, x, y, s);
}

export function sandstoneWall(seed = 21) {
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  const rowH = 128;
  for (let r = 0; r < 4; r++) {
    const off = r % 2 ? 128 : 0;
    for (let x = -off; x < S; x += 256) {
      const v = (R() - 0.5) * 30;
      ctx.fillStyle = `rgb(${190 + v},${155 + v},${100 + v})`;
      ctx.fillRect(x, r * rowH, 256, rowH);
    }
  }
  for (let i = 0; i < 70; i++) blot(ctx, R() * S, R() * S, 15 + R() * 70, R() < 0.5 ? '#7a5a30' : '#ead2a0', 0.1 + R() * 0.12);
  // 상단 프리즈: 연꽃/지그재그 채색 띠
  const colors = ['#2d5f86', '#9b3a22', '#3d7a4a'];
  for (let x = 0; x < S; x += 32) {
    ctx.fillStyle = rgba(colors[(x / 32) % 3], 0.45);
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x + 16, 8);
    ctx.lineTo(x + 32, 40);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(90,60,25,0.7)';
  ctx.fillRect(0, 44, S, 4);
  // 상형문자 두 줄 (세로 칸 구분선 포함)
  const paints = ['rgba(45,95,134,0.35)', 'rgba(155,58,34,0.32)', 'rgba(61,122,74,0.3)', null, null];
  for (let row = 0; row < 2; row++) {
    const cy = 150 + row * 120;
    for (let col = 0; col < 8; col++) {
      const cx = 32 + col * 64;
      carveGlyph(ctx, GLYPHS[Math.floor(R() * GLYPHS.length)], cx, cy, 44, paints[Math.floor(R() * paints.length)]);
      ctx.fillStyle = 'rgba(80,55,20,0.5)';
      ctx.fillRect(cx + 30, cy - 50, 2, 100);
    }
  }
  ctx.fillStyle = 'rgba(80,55,20,0.6)';
  ctx.fillRect(0, 96, S, 3);
  ctx.fillRect(0, 336, S, 3);
  // 줄눈
  ctx.fillStyle = 'rgba(95,70,38,0.75)';
  for (let r = 1; r < 4; r++) ctx.fillRect(0, r * rowH - 1, S, 3);
  // 하단 어두운 띠 + 모래 쌓임
  const g = ctx.createLinearGradient(0, S * 0.85, 0, S);
  g.addColorStop(0, 'rgba(60,40,15,0)');
  g.addColorStop(1, 'rgba(60,40,15,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, S * 0.85, S, S * 0.15);
  for (let i = 0; i < 6; i++) crack(ctx, R() * S, R() * S, (14 + R() * 26) | 0, R, 'rgba(70,45,15,0.6)');
  noise(ctx, S, S, 22, R);
  return c;
}

export function sandFloor(seed = 22) {
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  for (let y = 0; y < S; y += 256) {
    for (let x = 0; x < S; x += 256) {
      const v = (R() - 0.5) * 24;
      ctx.fillStyle = `rgb(${150 + v},${118 + v},${78 + v})`;
      ctx.fillRect(x, y, 256, 256);
    }
  }
  ctx.fillStyle = 'rgba(70,50,25,0.7)';
  ctx.fillRect(0, 254, S, 4);
  ctx.fillRect(254, 0, 4, S);
  for (let i = 0; i < 7; i++) crack(ctx, R() * S, R() * S, (10 + R() * 22) | 0, R, 'rgba(60,40,18,0.6)');
  for (let i = 0; i < 30; i++) blot(ctx, R() * S, R() * S, 40 + R() * 120, '#dcbd85', 0.25 + R() * 0.2);
  ctx.fillStyle = 'rgba(255,235,190,0.35)';
  for (let i = 0; i < 2500; i++) ctx.fillRect(R() * S, R() * S, 1, 1);
  noise(ctx, S, S, 20, R);
  return c;
}

export function roughCeiling(seed = 23) {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#4c3b27';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) blot(ctx, R() * S, R() * S, 10 + R() * 50, R() < 0.5 ? '#2a1f12' : '#6b5538', 0.3);
  for (let i = 0; i < 5; i++) crack(ctx, R() * S, R() * S, 14, R, 'rgba(20,12,5,0.6)');
  noise(ctx, S, S, 24, R);
  return c;
}

export function stoneDoor(seed = 24) {
  const W = 256;
  const H = 384;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#a98552';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) blot(ctx, R() * W, R() * H, 10 + R() * 50, R() < 0.5 ? '#6e4f27' : '#d8bb85', 0.2);
  ctx.strokeStyle = 'rgba(70,45,15,0.8)';
  ctx.lineWidth = 4;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.strokeStyle = 'rgba(255,236,190,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(19, 19, W - 38, H - 38);
  carveGlyph(ctx, 'eye', W / 2, 110, 120, 'rgba(45,95,134,0.4)');
  ctx.strokeStyle = 'rgba(70,45,15,0.85)';
  ctx.lineWidth = 3;
  roundRect(ctx, W / 2 - 34, 190, 68, 160, 30);
  ctx.stroke();
  ['ankh', 'feather', 'scarab'].forEach((g, i) => carveGlyph(ctx, g, W / 2, 225 + i * 48, 36, null));
  for (let i = 0; i < 4; i++) crack(ctx, R() * W, R() * H, 16, R, 'rgba(50,30,10,0.6)');
  noise(ctx, W, H, 20, R);
  return c;
}

export function pillarTex(seed = 25) {
  const W = 256;
  const H = 512;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#c4a26c';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) blot(ctx, R() * W, R() * H, 10 + R() * 50, R() < 0.5 ? '#7a5a30' : '#ead2a0', 0.15);
  const bands = ['#2d5f86', '#9b3a22', '#c99b2e', '#3d7a4a'];
  bands.forEach((b, i) => {
    ctx.fillStyle = rgba(b, 0.55);
    ctx.fillRect(0, 10 + i * 14, W, 10);
  });
  for (let k = 0; k < 4; k++) {
    const x = 32 + k * 64;
    for (let y = 110; y < H - 40; y += 58) carveGlyph(ctx, GLYPHS[Math.floor(R() * GLYPHS.length)], x, y, 36, R() < 0.3 ? 'rgba(155,58,34,0.3)' : null);
  }
  noise(ctx, W, H, 20, R);
  return c;
}

export function goldPattern(seed = 26) {
  const S = 256;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  for (let y = 0; y < S; y += 32) {
    if ((y / 32) % 2 === 0) {
      const g = ctx.createLinearGradient(0, y, 0, y + 32);
      g.addColorStop(0, '#f6d77a');
      g.addColorStop(0.5, '#c9971f');
      g.addColorStop(1, '#8a6210');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = '#1c3a78';
    }
    ctx.fillRect(0, y, S, 32);
  }
  ctx.fillStyle = 'rgba(255,240,180,0.6)';
  for (let y = 31; y < S; y += 32) ctx.fillRect(0, y, S, 2);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(255,255,220,${R() * 0.3})`;
    ctx.fillRect(R() * S, R() * S, 2, 2);
  }
  noise(ctx, S, S, 12, R);
  return c;
}

export function papyrus(seed = 27) {
  const W = 256;
  const H = 320;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#d9c38e';
  ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 6) {
    ctx.fillStyle = `rgba(120,90,40,${0.05 + R() * 0.08})`;
    ctx.fillRect(x, 0, 2, H);
  }
  for (let y = 0; y < H; y += 7) {
    ctx.fillStyle = `rgba(120,90,40,${0.04 + R() * 0.06})`;
    ctx.fillRect(0, y, W, 2);
  }
  ctx.strokeStyle = 'rgba(40,25,10,0.75)';
  for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) {
    ctx.lineWidth = 2.5;
    drawGlyph(ctx, GLYPHS[Math.floor(R() * GLYPHS.length)], 40 + k * 58, 50 + r * 56, 30);
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.7);
  v.addColorStop(0, 'rgba(80,50,10,0)');
  v.addColorStop(1, 'rgba(80,50,10,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  noise(ctx, W, H, 14, R);
  return c;
}

/** 빛나는 비문 석판: map(돌) + glow(금빛 문자) */
export function glyphTablet(seed = 28) {
  const W = 256;
  const H = 320;
  const map = makeCanvas(W, H);
  const glow = makeCanvas(W, H);
  const m = map.getContext('2d');
  const g = glow.getContext('2d');
  const R = mulberry32(seed);
  m.fillStyle = '#3a3128';
  m.fillRect(0, 0, W, H);
  for (let i = 0; i < 30; i++) blot(m, R() * W, R() * H, 10 + R() * 40, '#14100b', 0.3);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  m.strokeStyle = '#a07b2c';
  g.strokeStyle = '#ffcf5a';
  for (const ctx of [m, g]) {
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, W - 28, H - 28);
  }
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
    const type = GLYPHS[Math.floor(R() * GLYPHS.length)];
    m.lineWidth = 3;
    drawGlyph(m, type, 60 + k * 68, 60 + r * 66, 40);
    g.lineWidth = 3;
    drawGlyph(g, type, 60 + k * 68, 60 + r * 66, 40);
  }
  noise(m, W, H, 14, R);
  return { map, glow };
}

export function clay(seed = 29) {
  const S = 128;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#a06a43';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 20; i++) blot(ctx, R() * S, R() * S, 6 + R() * 24, R() < 0.5 ? '#5a3418' : '#c58c5e', 0.3);
  ctx.strokeStyle = 'rgba(30,20,10,0.6)';
  ctx.lineWidth = 2;
  for (let y = 30; y < S; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
  }
  noise(ctx, S, S, 18, R);
  return c;
}

export function flameSprite() {
  const W = 64;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(W / 2, H * 0.72);
  ctx.scale(1, 1.9);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
  g.addColorStop(0, 'rgba(255,255,230,1)');
  g.addColorStop(0.25, 'rgba(255,210,90,0.95)');
  g.addColorStop(0.6, 'rgba(255,110,20,0.45)');
  g.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return c;
}

export function glowSprite() {
  const S = 64;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

// ------------------------------------------------------------------ CSS 용 data URL
export function noiseDataURL(size = 160, alpha = 0.5) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 255 * alpha;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** 로비/UI 장식용 상형문자 띠 */
export function glyphBandDataURL(seed = 31) {
  const W = 512;
  const H = 64;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const R = mulberry32(seed);
  ctx.fillStyle = '#b8935a';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 20; i++) blot(ctx, R() * W, R() * H, 10 + R() * 30, R() < 0.5 ? '#7a5a30' : '#e0c58e', 0.25);
  ctx.fillStyle = 'rgba(80,55,20,0.7)';
  ctx.fillRect(0, 3, W, 3);
  ctx.fillRect(0, H - 6, W, 3);
  for (let k = 0; k < 10; k++) carveGlyph(ctx, GLYPHS[k % GLYPHS.length], 26 + k * 51, H / 2, 32, k % 3 === 0 ? 'rgba(45,95,134,0.35)' : null);
  noise(ctx, W, H, 16, R);
  return c.toDataURL('image/png');
}
