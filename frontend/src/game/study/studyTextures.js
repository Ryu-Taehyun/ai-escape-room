// =====================================================================
// 붉은 서재 테마 전용 절차적 텍스처 (이미지 파일 없음)
//   damaskWall : 검붉은 다마스크 벽지 + 의자 높이 몰딩 + 아래쪽 나무 판벽 (벽 높이 4m 전체 한 장)
//   parquet    : 짙은 헤링본 마루
//   cellarStone: 지하 저장고의 축축한 돌벽
//   plaster    : 얼룩진 천장
//   doorPanel  : 패널이 들어간 오래된 나무 문
// =====================================================================

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grime(g, w, h, R, n, color, maxR) {
  for (let i = 0; i < n; i++) {
    const x = R() * w;
    const y = R() * h;
    const r = 10 + R() * maxR;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** 4m × 4m 벽 한 장 (512×512). 위 72%: 다마스크 벽지 / 몰딩 / 아래: 나무 판벽 */
export function damaskWall(seed = 1) {
  const W = 512;
  const c = canvas(W, W);
  const g = c.getContext('2d');
  const R = rng(seed);
  const split = Math.round(W * 0.72);
  g.fillStyle = '#4a1612';
  g.fillRect(0, 0, W, split);
  // 다마스크 무늬 (세로로 엇갈린 메달리온)
  g.fillStyle = 'rgba(120, 30, 24, 0.55)';
  for (let row = 0; row < 14; row++) {
    for (let col = 0; col < 10; col++) {
      const x = col * 56 + (row % 2) * 28 + 10;
      const y = row * 27 + 10;
      g.beginPath();
      g.ellipse(x, y, 5, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(x, y - 12);
      g.quadraticCurveTo(x + 10, y, x, y + 12);
      g.quadraticCurveTo(x - 10, y, x, y - 12);
      g.strokeStyle = 'rgba(150, 50, 36, 0.45)';
      g.lineWidth = 2;
      g.stroke();
    }
  }
  // 벽지 이음매·변색
  for (let x = 0; x < W; x += 128) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x, 0, 2, split);
  }
  grime(g, W, split, R, 18, 'rgba(10, 2, 0, 0.35)', 70);
  // 흘러내린 물(또는 피) 자국
  for (let i = 0; i < 4; i++) {
    const x = R() * W;
    const len = 40 + R() * 160;
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, 'rgba(30, 4, 2, 0.5)');
    gr.addColorStop(1, 'rgba(30, 4, 2, 0)');
    g.fillStyle = gr;
    g.fillRect(x, 0, 2 + R() * 3, len);
  }
  // 몰딩
  g.fillStyle = '#2a140a';
  g.fillRect(0, split, W, 10);
  g.fillStyle = 'rgba(200, 140, 70, 0.25)';
  g.fillRect(0, split + 1, W, 2);
  // 나무 판벽
  g.fillStyle = '#2c170c';
  g.fillRect(0, split + 10, W, W - split - 10);
  for (let x = 0; x < W; x += 64) {
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 3;
    g.strokeRect(x + 8, split + 22, 48, W - split - 40);
    g.strokeStyle = 'rgba(160, 100, 50, 0.15)';
    g.lineWidth = 1;
    g.strokeRect(x + 10, split + 24, 44, W - split - 44);
  }
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '120,70,30'},${0.05 + R() * 0.08})`;
    g.fillRect(R() * W, split + 12 + R() * (W - split - 12), 30 + R() * 60, 1);
  }
  return c;
}

/** 헤링본 마루 (256×256 반복) */
export function parquet(seed = 2) {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const R = rng(seed);
  g.fillStyle = '#2a160c';
  g.fillRect(0, 0, S, S);
  const bw = 16;
  const bl = 64;
  for (let y = -bl; y < S + bl; y += bw) {
    for (let x = -bl; x < S + bl; x += bl) {
      const shade = 30 + R() * 22;
      g.save();
      g.translate(x + ((y / bw) % 2) * (bl / 2), y);
      g.rotate(Math.PI / 4 * ((Math.floor(y / bw) % 2) ? 1 : -1));
      g.fillStyle = `rgb(${shade + 26}, ${shade}, ${shade * 0.55})`;
      g.fillRect(0, 0, bl, bw - 1);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, bw - 1, bl, 1);
      g.restore();
    }
  }
  grime(g, S, S, R, 10, 'rgba(0,0,0,0.25)', 50);
  return c;
}

/** 축축한 지하 돌벽 (256×256 반복) */
export function cellarStone(seed = 3) {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const R = rng(seed);
  g.fillStyle = '#1a1512';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 32) {
    for (let x = -((y / 32) % 2) * 24; x < S; x += 48) {
      const v = 46 + R() * 26;
      g.fillStyle = `rgb(${v + 6}, ${v}, ${v - 6})`;
      g.fillRect(x + 2, y + 2, 44, 28);
    }
  }
  grime(g, S, S, R, 14, 'rgba(10, 20, 8, 0.35)', 60);
  return c;
}

/** 얼룩진 회반죽 천장 */
export function plaster(seed = 4) {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const R = rng(seed);
  g.fillStyle = '#3a2620';
  g.fillRect(0, 0, S, S);
  grime(g, S, S, R, 16, 'rgba(15, 5, 2, 0.4)', 60);
  return c;
}

/** 패널이 들어간 나무 문 (128×256) */
export function doorPanel(seed = 5, iron = false) {
  const c = canvas(128, 256);
  const g = c.getContext('2d');
  const R = rng(seed);
  if (iron) {
    g.fillStyle = '#2a2826';
    g.fillRect(0, 0, 128, 256);
    for (let y = 16; y < 256; y += 40) for (let x = 12; x < 128; x += 26) {
      g.fillStyle = '#4a4440';
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
    grime(g, 128, 256, R, 12, 'rgba(90, 40, 10, 0.4)', 40);
    return c;
  }
  g.fillStyle = '#3a2012';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 80; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + R() * 0.1})`;
    g.fillRect(R() * 128, 0, 1, 256);
  }
  for (const [y, h] of [[18, 100], [136, 100]]) {
    for (const x of [14, 70]) {
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 4;
      g.strokeRect(x, y, 44, h);
      g.strokeStyle = 'rgba(180, 110, 50, 0.18)';
      g.lineWidth = 1;
      g.strokeRect(x + 3, y + 3, 38, h - 6);
    }
  }
  return c;
}
