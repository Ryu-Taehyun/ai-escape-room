// =====================================================================
// EscapeEngine - Three.js 1인칭 방탈출 3D 엔진 (JavaScript)
//
// 월드 좌표계
//   - 방은 x축 방향으로 일렬 배치. slot i 의 중심 = (i * ROOM_SIZE, 0, 0)
//   - 방 크기 ROOM_SIZE x ROOM_SIZE, 방 사이 벽 중앙에 문(폭 DOOR_W)
//   - 다음 방이 'locked' 이면 문이 닫혀 통과 불가
//
// 상호작용 대상 (target.kind)
//   puzzle   : 단말기/제단 (암호 입력)
//   clue     : 방 안의 단서 오브젝트 (반짝이는 것 = 아직 조사 안 함)
//   minigame : 금고/배전반/보물상자 (미니게임 → 열쇠)
//   door     : 닫힌 문 (열쇠 사용 / 클리어 조건 확인)
//
// 조작: 클릭(시점 고정) / WASD 이동 / Shift 달리기 / E 또는 클릭 = 조사 / ESC 해제
// React 쪽 타입 정의는 engine.d.ts
// =====================================================================
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export const ROOM_SIZE = 10;
export const MINIGAME_POS = [-1.6, -1.8]; // 방 중심 기준 미니게임 오브젝트 위치 [x, z]
export const PUZZLE_POS = [0, -3.7];
const HALF = ROOM_SIZE / 2;
const WALL_H = 4;
const WALL_T = 0.2;
const DOOR_W = 2;
const DOOR_H = 2.6;
const PLAYER_R = 0.35;
const EYE_H = 1.6;
const SPEED = 3.5;
const INTERACT_DIST = 3;
const MOVE_SEND_MS = 80;

const STATUS_COLOR = { locked: 0x555555, unlocked: null, cleared: 0x33ff66 };

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function hashColor(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.7, 0.55);
}

function makeLabel(text, { color = '#ffffff', bg = 'rgba(0,0,0,0.6)', width = 2.6 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 44px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 56, 490);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(width, (width * canvas.height) / canvas.width, 1);
  return sprite;
}

function findTarget(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData.target) return o.userData.target;
  return null;
}

export class EscapeEngine {
  /**
   * @param {HTMLElement} container
   * @param {import('./engine').EngineOptions} options
   */
  constructor(container, options) {
    this.container = container;
    this.rooms = options.rooms.map((r) => ({ ...r }));
    this.style = options.style;
    this.cb = options;
    this.inputEnabled = true;
    this.keys = new Set();
    this.doors = [];
    this.markers = [];
    this.interactables = [];
    this.occluders = [];
    this.clueObjs = new Map(); // `${slot}:${id}` → { sparkle, mat }
    this.minigameObjs = [];    // slot → { sparkle, mat }
    this.sparkles = [];
    this.flickers = [];
    this.blinkers = [];
    this.remote = new Map();
    this.currentSlot = -1;
    this.focusKey = null;
    this.lastMoveSent = 0;
    this.disposed = false;
    this.exitDoor = null;

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.style.fog);
    this.scene.fog = new THREE.Fog(this.style.fog, 4, 24);

    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.05, 200);
    const start = options.startPosition || [0, EYE_H, 2.5];
    this.camera.position.set(start[0], EYE_H, start[2]);
    this.camera.lookAt(start[0], EYE_H, -HALF);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('lock', () => this.cb.onLockChange?.(true));
    this.controls.addEventListener('unlock', () => {
      this.keys.clear();
      this.cb.onLockChange?.(false);
    });

    this.raycaster = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);

    this._buildWorld();
    this._applyStatuses(true);
    this._bindEvents();

    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this.raf = requestAnimationFrame(this._loop);
    this._emitMove(true);

    // QA/디버깅용: 개발 모드에서만 콘솔에서 window.__escapeEngine 으로 접근
    if (import.meta.env?.DEV) window.__escapeEngine = this;
  }

  // ------------------------------------------------------------------ build
  _buildWorld() {
    const s = this.style;
    const n = this.rooms.length;
    const total = n * ROOM_SIZE;
    const minX = -HALF;
    const maxX = total - HALF;
    const cx = (minX + maxX) / 2;

    const wallMat = new THREE.MeshStandardMaterial({ color: s.wall, roughness: 0.9 });
    const floorMat = new THREE.MeshStandardMaterial({ color: s.floor, roughness: 1 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: s.wall, roughness: 1 });

    this.scene.add(new THREE.AmbientLight(0xffffff, s.ambient ?? 0.25));
    this.scene.add(new THREE.HemisphereLight(s.light, s.floor, 0.2));

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(total, ROOM_SIZE), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, 0);
    this.scene.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(total, ROOM_SIZE), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, WALL_H, 0);
    this.scene.add(ceil);

    const box = (sx, sy, sz, x, y, z, mat = wallMat, occlude = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      this.scene.add(m);
      if (occlude) this.occluders.push(m);
      return m;
    };

    // 외벽
    box(total, WALL_H, WALL_T, cx, WALL_H / 2, -HALF);
    box(total, WALL_H, WALL_T, cx, WALL_H / 2, HALF);
    box(WALL_T, WALL_H, ROOM_SIZE, minX, WALL_H / 2, 0);

    // 방 사이 칸막이 + 문 (문 i = slot i 의 출구)
    const segW = (ROOM_SIZE - DOOR_W) / 2;
    for (let i = 0; i < n - 1; i++) {
      const wx = i * ROOM_SIZE + HALF;
      box(WALL_T, WALL_H, segW, wx, WALL_H / 2, DOOR_W / 2 + segW / 2);
      box(WALL_T, WALL_H, segW, wx, WALL_H / 2, -(DOOR_W / 2 + segW / 2));
      box(WALL_T, WALL_H - DOOR_H, DOOR_W, wx, DOOR_H + (WALL_H - DOOR_H) / 2, 0);

      const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.4, emissive: 0x220000 });
      const door = box(WALL_T * 0.7, DOOR_H, DOOR_W, wx, DOOR_H / 2, 0, doorMat, false);
      door.userData = { index: i, open: false, target: { kind: 'door', slot: i, label: '문' } };
      this.doors.push(door);
      this.interactables.push(door);
    }

    // 끝 벽 + 최종 탈출문
    box(WALL_T, WALL_H, segW, maxX, WALL_H / 2, DOOR_W / 2 + segW / 2);
    box(WALL_T, WALL_H, segW, maxX, WALL_H / 2, -(DOOR_W / 2 + segW / 2));
    box(WALL_T, WALL_H - DOOR_H, DOOR_W, maxX, DOOR_H + (WALL_H - DOOR_H) / 2, 0);
    const exitMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x550000 });
    this.exitDoor = box(WALL_T, DOOR_H, DOOR_W, maxX, DOOR_H / 2, 0, exitMat, false);
    this.exitDoor.userData.target = { kind: 'door', slot: n - 1, label: '탈출문' };
    this.interactables.push(this.exitDoor);
    const exitLabel = makeLabel('EXIT', { color: '#ff5555', width: 1.4 });
    exitLabel.position.set(maxX - 0.3, DOOR_H + 0.4, 0);
    this.scene.add(exitLabel);

    // 방별 조명 / 퍼즐 / 단서 / 미니게임 / 장식 / 이름표
    this.rooms.forEach((room, i) => {
      const x = i * ROOM_SIZE;
      const light = new THREE.PointLight(s.light, 20, 16, 1.6);
      light.position.set(x, WALL_H - 0.5, 0);
      light.userData.base = 20;
      this.scene.add(light);
      this.flickers.push(light);

      if (room.has_puzzle) this._buildPuzzleObject(i, x);
      (room.clues || []).forEach((clue) => this._buildClue(i, x, clue));
      if (room.minigame) this._buildMinigameObject(i, x, room.minigame);
      this._buildDecor(x);

      const label = makeLabel(`${i + 1}. ${room.name}`, { color: s.accent });
      label.position.set(x, 3.2, -HALF + 0.6);
      this.scene.add(label);
    });
  }

  _sparkle(x, y, z, color) {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    m.position.set(x, y, z);
    m.userData.baseY = y;
    this.scene.add(m);
    this.sparkles.push(m);
    return m;
  }

  _buildPuzzleObject(slot, x) {
    const s = this.style;
    const group = new THREE.Group();
    group.position.set(x + PUZZLE_POS[0], 0, PUZZLE_POS[1]);
    const markerMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: s.accent, emissiveIntensity: 1 });

    if (s.decor === 'pillar') {
      const altar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x8a6a35, roughness: 0.8 }));
      altar.position.y = 0.45;
      const tablet = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 0.12), markerMat);
      tablet.position.set(0, 1.45, -0.2);
      group.add(altar, tablet);
    } else {
      const desk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.7), new THREE.MeshStandardMaterial({ color: 0x1c1f22, metalness: 0.5 }));
      desk.position.y = 0.45;
      const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.65, 0.06), markerMat);
      monitor.position.set(0, 1.3, -0.1);
      monitor.rotation.x = -0.15;
      group.add(desk, monitor);
    }
    group.userData.target = { kind: 'puzzle', slot, label: this.style.decor === 'pillar' ? '제단 (암호)' : '보안 단말기 (암호)' };
    this.scene.add(group);
    this.interactables.push(group);
    this.markers[slot] = markerMat;
  }

  _buildClue(slot, x, clue) {
    const [px, pz] = clue.pos || [0, 2];
    const wx = x + clamp(px, -4.4, 4.4);
    const wz = clamp(pz, -4.4, 4.4);
    const group = new THREE.Group();
    const itemMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0x222222, roughness: 0.7 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: this.style.decor === 'pillar' ? 0xb08850 : 0x2a2d31, roughness: 0.9 });
    let topY = 1.2;

    switch (clue.object) {
      case 'board': {
        // 벽에 가까우면 벽 쪽을 바라보도록 세움
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.05), itemMat);
        b.position.y = 1.7;
        if (Math.abs(px) > Math.abs(pz)) b.rotation.y = Math.PI / 2;
        group.add(b);
        topY = 2.35;
        break;
      }
      case 'statue': {
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), stoneMat);
        base.position.y = 0.25;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.1, 10), itemMat);
        body.position.y = 1.05;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), itemMat);
        head.position.y = 1.75;
        group.add(base, body, head);
        topY = 2.15;
        break;
      }
      case 'jar': {
        const j = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.18, 0.6, 12), itemMat);
        j.position.y = 0.3;
        group.add(j);
        topY = 0.9;
        break;
      }
      case 'box': {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), itemMat);
        b.position.y = 0.25;
        group.add(b);
        topY = 0.85;
        break;
      }
      case 'tablet': {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.12), itemMat);
        t.position.y = 0.45;
        group.add(t);
        topY = 1.2;
        break;
      }
      default: {
        // note / book: 받침대 위에 놓인 종이/책
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), stoneMat);
        stand.position.y = 0.4;
        const top =
          clue.object === 'book'
            ? new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.25), itemMat)
            : new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.22), itemMat);
        top.position.y = 0.84;
        group.add(stand, top);
        topY = 1.15;
      }
    }
    group.position.set(wx, 0, wz);
    group.userData.target = { kind: 'clue', slot, id: clue.id, label: clue.label };
    this.scene.add(group);
    this.interactables.push(group);
    const sparkle = this._sparkle(wx, topY, wz, this.style.accent);
    this.clueObjs.set(`${slot}:${clue.id}`, { sparkle, mat: itemMat });
  }

  _buildMinigameObject(slot, x, minigame) {
    const [px, pz] = MINIGAME_POS;
    const group = new THREE.Group();
    group.position.set(x + px, 0, pz);
    const egypt = this.style.decor === 'pillar';
    const bodyMat = new THREE.MeshStandardMaterial({ color: egypt ? 0xc9a227 : 0x4a4f55, metalness: 0.7, roughness: 0.35 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffaa00, emissiveIntensity: 1 });

    if (egypt) {
      // 황금 보물 상자
      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), bodyMat);
      chest.position.y = 0.28;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12, 1, false, 0, Math.PI), bodyMat);
      lid.rotation.z = Math.PI / 2;
      lid.position.y = 0.55;
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 0.05), glowMat);
      lock.position.set(0, 0.45, 0.31);
      group.add(chest, lid, lock);
    } else {
      // 금고 / 배전반
      const safe = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.7), bodyMat);
      safe.position.y = 0.55;
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 16), glowMat);
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0, 0.65, 0.36);
      group.add(safe, dial);
    }
    group.userData.target = { kind: 'minigame', slot, label: `${minigame.title} (미니게임)` };
    this.scene.add(group);
    this.interactables.push(group);
    const sparkle = this._sparkle(x + px, egypt ? 1.1 : 1.45, pz, 0xffcc33);
    this.minigameObjs[slot] = { sparkle, mat: glowMat };
  }

  _buildDecor(x) {
    const s = this.style;
    if (s.decor === 'server') {
      const rackMat = new THREE.MeshStandardMaterial({ color: 0x15181b, metalness: 0.7, roughness: 0.4 });
      // [x오프셋, 벽 방향(+1 = 뒤쪽 벽, -1 = 퍼즐 쪽 벽)]
      const racks = [[-3, 1], [-1.6, 1], [1.6, 1], [3, 1], [-3.2, -1], [3.2, -1]];
      for (const [dx, side] of racks) {
        const rz = side * (HALF - 0.7);
        const rack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.4, 0.9), rackMat);
        rack.position.set(x + dx, 1.2, rz);
        this.scene.add(rack);
        for (let k = 0; k < 4; k++) {
          const ledMat = new THREE.MeshBasicMaterial({ color: k % 2 ? s.accent : s.light });
          const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), ledMat);
          led.position.set(x + dx - 0.35 + k * 0.12, 1.8 - k * 0.3, rz - side * 0.46);
          led.userData = { speed: 2 + Math.random() * 6, phase: Math.random() * 6 };
          this.scene.add(led);
          this.blinkers.push(led);
        }
      }
    } else if (s.decor === 'pillar') {
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 0.9 });
      for (const [dx, dz] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, WALL_H, 12), pillarMat);
        p.position.set(x + dx, WALL_H / 2, dz);
        this.scene.add(p);
        this.occluders.push(p);
      }
    }
  }

  // ------------------------------------------------------------- status
  /** @param {import('./engine').EngineRoom[]} rooms */
  setRooms(rooms) {
    rooms.forEach((r, i) => {
      if (this.rooms[i]) this.rooms[i] = { ...this.rooms[i], ...r };
    });
    this._applyStatuses(false);
  }

  _applyStatuses(instant) {
    const accent = new THREE.Color(this.style.accent);
    this.doors.forEach((door, i) => {
      const next = this.rooms[i + 1];
      door.userData.open = !!next && next.status !== 'locked';
      if (instant) door.position.y = door.userData.open ? -DOOR_H / 2 - 0.05 : DOOR_H / 2;
    });
    this.rooms.forEach((room, i) => {
      const mat = this.markers[i];
      if (mat) {
        const c = room.puzzle_solved && room.status !== 'cleared' ? 0x33ff66 : STATUS_COLOR[room.status];
        mat.emissive.set(c === null ? accent : c);
      }
      for (const clue of room.clues || []) {
        const obj = this.clueObjs.get(`${i}:${clue.id}`);
        if (!obj) continue;
        obj.sparkle.visible = !clue.found;
        obj.mat.emissive.set(clue.found ? 0x000000 : 0x333333);
      }
      const mg = this.minigameObjs[i];
      if (mg && room.minigame) {
        mg.sparkle.visible = !room.minigame.key_obtained;
        mg.mat.emissive.set(room.minigame.key_used ? 0x33ff66 : room.minigame.key_obtained ? 0x3388ff : 0xffaa00);
      }
    });
    const last = this.rooms[this.rooms.length - 1];
    if (this.exitDoor && last) {
      const escaped = last.status === 'cleared';
      this.exitDoor.material.emissive.set(escaped ? 0x00aa44 : 0x550000);
      this.exitDoor.userData.open = escaped;
    }
  }

  setInputEnabled(enabled) {
    this.inputEnabled = enabled;
    if (!enabled) {
      this.keys.clear();
      if (this.controls.isLocked) this.controls.unlock();
    }
  }

  unlockPointer() {
    if (this.controls.isLocked) this.controls.unlock();
  }

  // ------------------------------------------------------- remote players
  /** @param {import('./engine').RemotePlayerInput[]} players */
  updateRemotePlayers(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let g = this.remote.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.3, 1.0, 4, 10),
          new THREE.MeshStandardMaterial({ color: hashColor(p.id), emissive: hashColor(p.id), emissiveIntensity: 0.25 }),
        );
        body.position.y = 0.8;
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        eye.position.set(0, 1.35, -0.28);
        const label = makeLabel(p.name, { width: 1.4 });
        label.position.y = 2.1;
        g.add(body, eye, label);
        g.position.set(p.position[0], 0, p.position[2]);
        g.userData.dest = new THREE.Vector3();
        this.scene.add(g);
        this.remote.set(p.id, g);
      }
      g.userData.dest.set(p.position[0], 0, p.position[2]);
      g.userData.rotation = p.rotation;
    }
    for (const [id, g] of this.remote) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this._disposeObject(g);
        this.remote.delete(id);
      }
    }
  }

  // --------------------------------------------------------------- input
  _bindEvents() {
    const isTyping = (e) => {
      const t = e.target;
      return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    };
    this._onKeyDown = (e) => {
      if (!this.inputEnabled || isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' && this.controls.isLocked) this._tryInteract();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    // Chromium 은 포인터 락 직후 비정상적으로 큰 movementX/Y 를 보내는 경우가 있어 시점이 튄다 → 무시
    this._onMouseSpike = (e) => {
      if (this.controls.isLocked && (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250)) {
        e.stopImmediatePropagation();
      }
    };
    this._onClick = () => {
      if (!this.inputEnabled) return;
      if (!this.controls.isLocked) this.controls.lock();
      else this._tryInteract();
    };
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.container);

    window.addEventListener('mousemove', this._onMouseSpike, true);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.renderer.domElement.addEventListener('click', this._onClick);
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** 화면 중앙(조준점)에 있는 상호작용 대상. 벽에 가려지면 null */
  _pickTarget() {
    this.raycaster.setFromCamera(this.center, this.camera);
    this.raycaster.far = INTERACT_DIST;
    const hits = this.raycaster.intersectObjects([...this.interactables, ...this.occluders], true);
    for (const hit of hits) {
      const target = findTarget(hit.object);
      if (!target) return null; // 벽/기둥이 먼저 맞음
      if (target.kind === 'door') {
        const door = target.slot < this.doors.length ? this.doors[target.slot] : this.exitDoor;
        if (door?.userData.open) return null; // 열린 문은 상호작용 없음
      }
      return target;
    }
    return null;
  }

  _tryInteract() {
    const target = this._pickTarget();
    if (!target) return;
    this.controls.unlock();
    this.cb.onInteract?.({ ...target });
  }

  // ---------------------------------------------------------------- loop
  _loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    if (this.controls.isLocked && this.inputEnabled) this._move(dt);

    // 문 애니메이션 (바닥으로 내려가며 열림)
    for (const door of this.doors) {
      const target = door.userData.open ? -DOOR_H / 2 - 0.05 : DOOR_H / 2;
      door.position.y += (target - door.position.y) * Math.min(1, dt * 3);
    }

    // 조명 효과
    this.flickers.forEach((l, i) => {
      if (this.style.decor === 'server') {
        l.intensity = Math.random() < 0.02 ? l.userData.base * 0.15 : l.userData.base;
      } else {
        l.intensity = l.userData.base * (0.88 + 0.12 * Math.sin(t * 7 + i * 1.7));
      }
    });
    for (const led of this.blinkers) {
      led.visible = Math.sin(t * led.userData.speed + led.userData.phase) > -0.3;
    }
    // 아직 조사하지 않은 오브젝트 위의 반짝이
    for (const sp of this.sparkles) {
      sp.rotation.y = t * 2;
      sp.position.y = sp.userData.baseY + Math.sin(t * 3) * 0.06;
    }

    // 원격 플레이어 보간
    for (const g of this.remote.values()) {
      g.position.lerp(g.userData.dest, Math.min(1, dt * 10));
      g.rotation.y = g.userData.rotation ?? 0;
    }

    // 조준 중인 대상 표시
    if (this.controls.isLocked) {
      const focus = this._pickTarget();
      const key = focus ? `${focus.kind}:${focus.slot}:${focus.id ?? ''}` : null;
      if (key !== this.focusKey) {
        this.focusKey = key;
        this.cb.onFocusChange?.(focus ? { ...focus } : null);
      }
    } else if (this.focusKey !== null) {
      this.focusKey = null;
      this.cb.onFocusChange?.(null);
    }

    this.renderer.render(this.scene, this.camera);
  }

  _move(dt) {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();

    const dir = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dir.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dir.sub(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dir.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dir.sub(right);
    if (dir.lengthSq() === 0) {
      this._emitMove(false);
      return;
    }
    const speed = SPEED * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.7 : 1);
    dir.normalize().multiplyScalar(speed * dt);

    const pos = this.camera.position;
    const n = this.rooms.length;
    let nx = clamp(pos.x + dir.x, -HALF + PLAYER_R, n * ROOM_SIZE - HALF - PLAYER_R);
    let nz = clamp(pos.z + dir.z, -HALF + PLAYER_R, HALF - PLAYER_R);

    // 칸막이 충돌: 문이 열려 있고 문틀 안쪽일 때만 통과
    const band = PLAYER_R + WALL_T / 2;
    const gap = DOOR_W / 2 - PLAYER_R;
    for (const door of this.doors) {
      const wx = door.userData.index * ROOM_SIZE + HALF;
      if (Math.abs(nx - wx) >= band) continue;
      const passable = door.userData.open && Math.abs(nz) < gap;
      if (passable) continue;
      if (Math.abs(pos.x - wx) < band) {
        nz = clamp(nz, -gap, gap); // 문틀 안에 있으면 옆으로 못 나감
        if (!door.userData.open) nx = pos.x;
      } else {
        nx = pos.x;
      }
    }

    pos.x = nx;
    pos.z = nz;
    pos.y = EYE_H;
    this._emitMove(false);
  }

  _emitMove(force) {
    const pos = this.camera.position;
    const slot = clamp(Math.floor((pos.x + HALF) / ROOM_SIZE), 0, this.rooms.length - 1);
    if (slot !== this.currentSlot) {
      this.currentSlot = slot;
      this.cb.onRoomChange?.(slot);
    }
    const now = performance.now();
    if (!force && now - this.lastMoveSent < MOVE_SEND_MS) return;
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const key = `${pos.x.toFixed(2)},${pos.z.toFixed(2)},${euler.y.toFixed(2)}`;
    if (!force && key === this._lastMoveKey) return;
    this._lastMoveKey = key;
    this.lastMoveSent = now;
    this.cb.onMove?.({ position: [pos.x, pos.y, pos.z], rotation: euler.y, slot });
  }

  // ------------------------------------------------------------- dispose
  _disposeObject(obj) {
    obj.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => {
        m.map?.dispose?.();
        m.dispose?.();
      });
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mousemove', this._onMouseSpike, true);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.renderer.domElement.removeEventListener('click', this._onClick);
    this._resizeObserver?.disconnect();
    this.controls.unlock();
    this.controls.dispose();
    this._disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (import.meta.env?.DEV && window.__escapeEngine === this) window.__escapeEngine = undefined;
  }
}
