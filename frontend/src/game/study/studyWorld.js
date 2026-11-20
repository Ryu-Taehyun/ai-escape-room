// =====================================================================
// StudyWorld — 붉은 서재 테마를 EscapeEngine 에 붙이는 연결부 (리빌딩)
//
// 팀원 프로젝트(붉은 서재)의 장면 모듈을 그대로 가져와 쓰고, 내 프로젝트의 엔진 구조
// (방 N개 일렬 배치 · 서버가 정한 단서 위치 · 협동)에 맞게 배치한다.
//   - 가구·불꽃·샹들리에·창문(비·번개)·시신·핏자국  : furniture / flame / chandelier / window / corpse / bloodTextures
//   - 단서 오브젝트 · 퍼즐 책상 · 미니게임 오브젝트   : studyProps.js
//   - 오래 바라보면 튀어나오는 귀신 액자             : 팀원 main.js 의 updateGhosts 를 엔진 루프용으로 옮김
//   - 조명 풀: 방마다 조명을 두지 않고 3개를 가장 가까운 방들로 옮겨 써서
//              방이 5개여도 셰이더가 계산하는 조명 수가 늘지 않는다 (성능)
// =====================================================================
import * as THREE from 'three';
import * as F from './furniture.js';
import * as P from './studyProps.js';
import * as ST from './studyTextures.js';
import { createChandelier } from './chandelier.js';
import { buildWindow } from './window.js';
import { bloodDecal, wallDecal, createContext, updateAnimations } from './helpers.js';
import { LIGHT_BUS, LIGHT_CONFIG } from './lighting.js';
import { setFlameCamera, updateFlames, resetFlames } from './flame.js';

const HALF = 5;
const WALL_IN = HALF - 0.11; // 벽 안쪽 면
const WALL_TYPES = new Set(['calendar', 'clock', 'portrait', 'board', 'bookshelf', 'tablet']);
const WHISPERS = ['[…뒤에 누가 있어]', '[속삭임: 그 해의 와인…]', '[문 두드리는 소리가 들린다]', '[누군가 네 이름을 불렀다]', '[촛불이 한꺼번에 흔들린다]'];

export class StudyWorld {
  constructor(engine) {
    this.E = engine;
    LIGHT_BUS.blackout = 0;
    LIGHT_BUS.bulbs.length = 0;
    LIGHT_BUS.flashFlicker = 0;
    resetFlames();
    setFlameCamera(engine.camera);
    // 팀원 모듈이 쓰는 컨텍스트. 충돌 상자는 엔진 배열을 그대로 공유한다 (형식이 같음)
    this.ctx = createContext(engine.scene);
    this.ctx.colliders = engine.colliders;
    this.ctx.onLightning = () => engine._onLightning?.();
    this.chandeliers = []; // slot → update 함수 (밝기 계산)
    this.roomUpdaters = []; // slot → [fn]
    this.ghosts = []; // { group, ghost, gaze, done, t }
    this.windowBuilt = false;
    this.pool = [];
    this._ray = new THREE.Raycaster();
  }

  // ------------------------------------------------------------ 공용 배치 도우미
  /** 방 안의 (lx, lz) 가 단서·퍼즐·미니게임·문 통로와 r 이상 떨어져 있나 */
  free(room, lx, lz, r = 1.3, { wall = false } = {}) {
    const taken = (room.clues || []).map((c) => c.pos || [0, 2]);
    if (!wall) taken.push([0, -3.7]); // 벽에 거는 물건은 앞에 놓인 퍼즐 책상과 겹치지 않는다
    if (room.minigame && !wall) taken.push([-1.6, -1.8]);
    if (Math.abs(lz) < 1.6 && Math.abs(lx) > 3.3) return false; // 문 앞 통로
    return taken.every(([x, z]) => Math.hypot(x - lx, z - lz) >= r);
  }

  isCellar(room) {
    return /저장고|지하|와인/.test(room.name || '');
  }

  // ------------------------------------------------------------ 바닥·벽 재질
  wallMat(width) {
    return this.E._mat('st-damask', () => ST.damaskWall(7), [Math.max(0.25, width / 4), 1], { bump: 0.02, rough: 0.85 });
  }
  floorMat(total) {
    return this.E._mat('st-parquet', () => ST.parquet(9), [total / 2, 10 / 2], { bump: 0.02, rough: 0.6 });
  }
  ceilMat(total) {
    return this.E._mat('st-plaster', () => ST.plaster(11), [total / 4, 2.5], { rough: 0.95 });
  }

  /** 지하 저장고는 돌벽·돌바닥을 덧댄다 */
  _cellarShell(x) {
    const E = this.E;
    const stone = E._mat('st-stone', () => ST.cellarStone(13), [2.5, 1], { bump: 0.05, rough: 0.95 });
    const stoneFloor = E._mat('st-stone-f', () => ST.cellarStone(17), [3, 3], { bump: 0.04, rough: 0.9 });
    const add = (w, h, px, py, pz, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), stone);
      m.position.set(px, py, pz);
      m.rotation.y = ry;
      m.userData.noShadow = true;
      E.scene.add(m);
    };
    add(9.8, 4, x, 2, -WALL_IN + 0.005, 0);
    add(9.8, 4, x, 2, WALL_IN - 0.005, Math.PI);
    for (const s of [-1, 1]) {
      const wx = x + s * (WALL_IN - 0.005);
      const ry = -s * Math.PI / 2;
      add(3.9, 4, wx, 2, 3.05, ry);
      add(3.9, 4, wx, 2, -3.05, ry);
      add(2, 1.4, wx, 3.3, 0, ry);
    }
    const f = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 9.8), stoneFloor);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, 0.004, 0);
    f.userData.noShadow = true;
    E.scene.add(f);
  }

  // ------------------------------------------------------------ 조명
  buildRoomLighting(i, x, room) {
    const ceil = new THREE.Vector3(x, 4, 0);
    let upd;
    if (this.isCellar(room)) {
      // 지하: 전선에 매달린 알전구 (밝기 계산은 샹들리에와 같은 규칙)
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      cord.position.set(x, 3.45, 0);
      const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffb070, emissiveIntensity: 1.2 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), bulbMat);
      bulb.position.set(x, 2.85, 0);
      this.E.scene.add(cord, bulb);
      upd = createChandelier(new THREE.Group(), ceil, { room: `r${i}`, light: false });
      const inner = upd;
      upd = (dt) => {
        inner(dt);
        bulbMat.emissiveIntensity = 1.2 * inner.level;
        upd.level = inner.level * 0.75;
      };
      upd.level = 1;
    } else {
      upd = createChandelier(this.E.scene, ceil, { room: `r${i}`, light: false });
    }
    this.chandeliers[i] = upd;
  }

  /** 조명 풀: 현재 방과 양 옆 방에만 실제 점광원을 둔다 */
  buildLightPool() {
    for (let k = 0; k < 3; k++) {
      const l = new THREE.PointLight(LIGHT_CONFIG.bulbColor, 0, 14, 1.7);
      l.position.set(0, 3.0, 0);
      this.E.scene.add(l);
      this.pool.push(l);
    }
  }

  // ------------------------------------------------------------ 퍼즐 / 단서 / 미니게임
  buildPuzzle(slot, x, room) {
    const { group, indicator } = P.lockDesk(this.ctx, x, -3.7, { cellar: this.isCellar(room) });
    return { group, indicator };
  }

  /** 서버가 정한 단서 위치에 오브젝트를 만든다. 벽에 거는 물건은 가까운 벽(앞/뒤)에 붙인다 */
  buildClue(slot, x, clue, lx, lz) {
    const ctx = this.ctx;
    const wx = x + lx;
    const obj = clue.object;
    if (WALL_TYPES.has(obj)) {
      const sgn = lz >= 0 ? 1 : -1;
      const rotY = sgn > 0 ? Math.PI : 0;
      const wz = sgn * WALL_IN;
      let g;
      let topY;
      if (obj === 'calendar') ((g = P.wallCalendar(ctx, wx, 1.65, wz - sgn * 0.0, rotY, clue.text)), (topY = 2.15));
      else if (obj === 'clock') ((g = P.wallClock(ctx, wx, 2.1, wz - sgn * 0.04, rotY, clue.text)), (topY = 2.55));
      else if (obj === 'portrait') {
        g = P.portrait(ctx, wx, 1.75, wz - sgn * 0.03, rotY);
        this.addGhost(g);
        topY = 2.45;
      } else if (obj === 'board') ((g = P.bloodWriting(ctx, wx, 1.9, wz - sgn * 0.02, rotY, clue.text)), (topY = 2.55));
      else if (obj === 'tablet') ((g = P.framedDoc(ctx, wx, 1.6, wz - sgn * 0.02, rotY, clue.label)), (topY = 2.1));
      else ((g = P.bookshelf(ctx, wx, wz - sgn * 0.24, rotY, clue.text)), (topY = 2.6));
      // 벽에 붙은 물건은 앞으로 조금 나온 곳에 반짝이
      return { group: g, topY, glint: [wx, wz - sgn * 0.35], collider: false };
    }
    let g;
    let topY = 1.1;
    switch (obj) {
      case 'phone': {
        const floor = /바닥|떨어/.test(clue.label);
        g = P.phoneOnTable(ctx, wx, lz, floor);
        topY = floor ? 0.45 : 1.0;
        break;
      }
      case 'diary':
        g = P.diaryDesk(ctx, wx, lz, Math.atan2(-lx, -lz));
        topY = 1.15;
        break;
      case 'body':
        g = P.corpse(ctx, wx, lz, 0.3);
        topY = 0.7;
        break;
      case 'book':
        g = P.lectern(ctx, wx, lz, Math.atan2(-lx, -lz));
        topY = 1.45;
        break;
      case 'jar':
        g = P.brokenBottle(ctx, wx, lz);
        topY = 0.45;
        break;
      case 'statue':
        g = P.bust(ctx, wx, lz);
        topY = 1.75;
        break;
      case 'box':
        g = F.chest(ctx, wx, lz, Math.atan2(-lx, -lz));
        topY = 0.85;
        break;
      default:
        g = P.noteOnTable(ctx, wx, lz, clue.label);
        topY = 1.0;
    }
    return { group: g, topY, glint: [wx, lz], collider: false };
  }

  buildMinigame(slot, x, minigame) {
    const ctx = this.ctx;
    const wx = x - 1.6;
    const wz = -1.8;
    if (minigame.type === 'timing') return P.grandfatherClock(ctx, wx, wz, 0);
    if (minigame.type === 'wires') return P.fuseBox(ctx, wx, wz, 0);
    return P.musicBox(ctx, wx, wz);
  }

  /**
   * 조준하기 쉽게: 물체를 감싸는 보이지 않는 상자를 붙인다 (낮은 탁자 위 쪽지도 잘 잡히게).
   * material.visible=false 라 화면·외곽선에는 그려지지 않고 레이캐스트에만 걸린다.
   */
  addHitBox(group, { minTop = 1.1, pad = 0.12 } = {}) {
    const pos = group.position.clone();
    const rot = group.rotation.clone();
    const scl = group.scale.clone();
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    group.position.copy(pos);
    group.rotation.copy(rot);
    group.scale.copy(scl);
    group.updateMatrixWorld(true);
    if (box.isEmpty()) return;
    const wall = box.min.y > 0.5; // 벽에 건 물건은 바닥까지 늘리지 않는다
    const minY = wall ? box.min.y - pad : 0;
    const maxY = Math.max(box.max.y + pad, wall ? 0 : minTop);
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(box.max.x - box.min.x + pad * 2, maxY - minY, Math.max(0.2, box.max.z - box.min.z + pad * 2)),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set((box.min.x + box.max.x) / 2, (minY + maxY) / 2, (box.min.z + box.max.z) / 2);
    hit.userData.noShadow = true;
    hit.userData.hitBox = true;
    group.add(hit);
  }

  // ------------------------------------------------------------ 귀신 액자
  addGhost(group) {
    if (group?.userData.ghost) this.ghosts.push({ group, ghost: group.userData.ghost, gaze: 0, done: false, t: -1 });
  }

  // ------------------------------------------------------------ 장식
  decorate(i, x, room) {
    const ctx = this.ctx;
    const name = room.name || '';
    const before = ctx.updaters.length;
    const cellar = this.isCellar(room);
    const at = (lx, lz, r) => this.free(room, lx, lz, r);
    const atWall = (lx, lz, r) => this.free(room, lx, lz, r, { wall: true });
    if (cellar) this._cellarShell(x);
    else F.rug(ctx, x + 0.3, 0.9, 4.2, 3.0);

    // 벽 액자 (오래 보면 귀신) — 비어 있는 벽 자리 2곳
    if (!cellar) {
      let frames = 0;
      for (const [lx, lz] of [[3.4, 4.9], [-3.6, -4.9], [-1.0, 4.9], [3.6, -4.9]]) {
        if (frames >= 2 || !atWall(lx, lz, 1.4)) continue;
        const sgn = lz > 0 ? 1 : -1;
        const fr = F.frame(ctx, x + lx, 1.85, sgn * (WALL_IN - 0.02), sgn > 0 ? Math.PI : 0, 0.62, 0.82, frames ? 0.08 : -0.06);
        this.addGhost(fr);
        frames++;
      }
    }
    // 촛대 (구석)
    for (const [lx, lz] of [[-4.3, 4.3], [4.3, -4.3]]) if (at(lx, lz, 1.2)) F.candelabra(ctx, x + lx, lz);
    F.cobweb(ctx, x + 4.88, 3.95, -4.88, -1, 1);
    F.cobweb(ctx, x - 4.88, 3.95, 4.88, 1, -1, 0.9);
    // 핏자국
    if (at(1.2, 0.4, 1.0)) bloodDecal(ctx, x + 1.2, 0.4, 0.35);
    bloodDecal(ctx, x - 0.6, 2.9, 0.08);
    wallDecal(ctx, x + 4.88, 1.3, -1.6 - (i % 2) * 0.4, -Math.PI / 2, 0.14, { hand: true });
    wallDecal(ctx, x - 2.2, 1.1, WALL_IN, Math.PI, 0.18);

    if (/현관|복도|입구/.test(name)) {
      if (at(3.6, 2.6, 1.3)) F.coveredShape(ctx, x + 3.6, 2.6, 0.4);
      if (at(-3.9, -2.8, 1.2)) F.deadPlant(ctx, x - 3.9, -2.8);
      if (at(3.9, -2.6, 1.2)) F.crate(ctx, x + 3.9, -2.6, 0.5, 0, 0.2);
      F.papers(ctx, x - 1.0, 1.2, 4, 0.6);
    } else if (/서재/.test(name)) {
      if (at(2.4, 4.6, 1.8)) {
        F.fireplace(ctx, x + 2.4, 4.68, Math.PI);
        if (at(2.4, 2.4, 1.3)) F.sofa(ctx, x + 2.4, 2.4, Math.PI);
      }
      for (const [lx, lz] of [[0.2, -4.9], [3.2, -4.9], [-0.6, 4.9]]) {
        if (this.windowBuilt || !atWall(lx, lz, 1.6)) continue;
        const sgn = lz > 0 ? 1 : -1;
        const win = buildWindow(ctx, { x: x + lx, y: 2.0, z: sgn * (WALL_IN - 0.01), rotY: sgn > 0 ? Math.PI : 0 });
        win.userData.open?.(); // 커튼은 걷힌 상태 → 창밖 비·번개가 보인다
        this.windowBuilt = true;
      }
      if (at(-4.2, 0.0 + 2.2, 1.2)) F.cabinet(ctx, x - 4.55, 2.4, Math.PI / 2);
    } else if (/서고|책/.test(name)) {
      for (const [lx, lz] of [[-2.6, 4.66], [2.8, -4.66], [-3.3, -4.66]]) {
        if (atWall(lx, lz, 1.7)) P.bookshelf(ctx, x + lx, lz, lz > 0 ? Math.PI : 0);
      }
      if (at(3.6, 2.0, 1.3)) F.armchair(ctx, x + 3.6, 2.0, -Math.PI / 2 - 0.4);
      F.papers(ctx, x + 0.6, -1.2, 6, 0.9);
    } else if (/집무|시신|핏자국/.test(name)) {
      if (at(3.2, 4.6, 1.8)) F.fireplace(ctx, x + 3.2, 4.68, Math.PI);
      if (at(-3.6, -2.6, 1.3)) F.fallenLamp(ctx, x - 3.6, -2.6, 0.4);
      F.papers(ctx, x - 0.4, 0.2, 7, 1.0);
      if (at(4.5, -3.0, 1.2)) F.cabinet(ctx, x + 4.55, -3.0, -Math.PI / 2);
    } else if (cellar) {
      for (const [lx, lz, empty] of [[-2.4, 4.55, false], [2.6, 4.55, true], [2.9, -4.55, false]]) {
        if (at(lx, lz, 1.9)) P.wineRack(ctx, x + lx, lz, lz > 0 ? Math.PI : 0, { emptySlot: empty });
      }
      for (const [lx, lz] of [[4.2, 2.6], [-4.2, -3.0], [3.9, -2.2]]) if (at(lx, lz, 1.0)) F.crate(ctx, x + lx, lz, 0.55, 0, lx);
      bloodDecal(ctx, x + 0.4, -0.6, 0.45);
    } else {
      if (at(3.4, 2.6, 1.4)) F.sofa(ctx, x + 3.4, 2.6, -Math.PI / 2);
      F.papers(ctx, x, 0.6, 5, 0.8);
    }
    this.roomUpdaters[i] = ctx.updaters.slice(before);
  }

  // ------------------------------------------------------------ 매 프레임
  update(dt, t, slot, playing) {
    const ctx = this.ctx;
    if (LIGHT_BUS.blackout > 0) LIGHT_BUS.blackout = Math.max(0, LIGHT_BUS.blackout - dt);
    // 방에 속하지 않은 공용 updater(창문·불꽃 등)는 항상, 방 장식 updater 는 가까운 방만
    const roomSet = new Set(this.roomUpdaters.flat());
    for (const u of ctx.updaters) {
      if (!roomSet.has(u)) u(dt, t);
    }
    for (let i = 0; i < this.roomUpdaters.length; i++) {
      if (Math.abs(i - slot) > 1) continue;
      for (const u of this.roomUpdaters[i] || []) u(dt, t);
    }
    updateAnimations(ctx, dt);
    updateFlames(t);
    // 조명 풀: 가까운 방 3곳의 샹들리에 위치·밝기로
    const slots = [slot - 1, slot, slot + 1];
    this.pool.forEach((l, k) => {
      const s = slots[k];
      const ch = this.chandeliers[s];
      if (!ch) {
        l.intensity = 0;
        return;
      }
      ch(dt);
      l.position.set(s * 10, 2.95, 0);
      l.intensity = LIGHT_CONFIG.bulbIntensity * 0.65 * (ch.level ?? 1);
    });
    this._updateGhosts(dt, playing);
  }

  /** 팀원 main.js 의 액자 귀신을 엔진용으로: 화면 가운데로 2.5초 바라보면 번쩍 */
  _updateGhosts(dt, playing) {
    const E = this.E;
    let gazed = null;
    if (playing && this.ghosts.some((g) => !g.done)) {
      this._ray.setFromCamera(E.center, E.camera);
      this._ray.far = 5.5;
      const hits = this._ray.intersectObjects([...this.ghosts.map((g) => g.group), ...E.occluders], true);
      if (hits.length) {
        for (const g of this.ghosts) {
          let o = hits[0].object;
          while (o && o !== g.group) o = o.parent;
          if (o) gazed = g;
        }
      }
    }
    for (const g of this.ghosts) {
      if (g.t >= 0) {
        g.t += dt;
        const op = g.t < 0.08 ? g.t / 0.08 : g.t < 0.6 ? 1 : Math.max(0, 1 - (g.t - 0.6) / 0.4);
        g.ghost.visible = op > 0;
        g.ghost.material.opacity = op;
        g.ghost.scale.setScalar(1 + Math.sin(g.t * 60) * 0.02);
        if (op <= 0 && g.t > 0.6) g.t = -1;
        continue;
      }
      if (g.done) continue;
      g.gaze = g === gazed ? g.gaze + dt : Math.max(0, g.gaze - dt);
      if (g.gaze > 2.5) {
        g.done = true;
        g.t = 0;
        E._onGhost?.();
      }
    }
  }

  whisper() {
    return WHISPERS[Math.floor(Math.random() * WHISPERS.length)];
  }

  blackout(sec) {
    LIGHT_BUS.blackout = sec;
  }

  get lightning() {
    return this.ctx.lightning ?? 0;
  }
}
