// =====================================================================
// EscapeEngine - Three.js 1인칭 방탈출 3D 엔진 (JavaScript)
//
// 월드 좌표계
//   - 방은 x축 방향으로 일렬 배치. slot i 의 중심 = (i * ROOM_SIZE, 0, 0)
//   - 방 사이 벽 중앙에 문(폭 DOOR_W). 다음 방이 'locked' 이면 문이 닫혀 통과 불가
//
// 테마 (style.decor)
//   study  → study  : 붉은 서재 (리빌딩: 팀원 프로젝트의 장면 모듈을 game/study/ 로 이식) — 샹들리에·촛불·벽난로,
//                      비 오는 창문과 번개, 오래 보면 튀어나오는 귀신 액자, 정전 + 그림자 형체, 전용 단서 모델
//   server → horror : 손전등, 깜빡이는 형광등, 녹슨 철문, 핏자국, 서버 랙, CRT 단말기, 정전 + 그림자 형체
//   pillar → egypt  : 손 횃불, 벽 횃불, 상형문자 사암, 석상·관·항아리, 모래먼지, 지진 + 모래 낙하
//   none   → neutral: 단순한 방 (AI 로 만든 커스텀 테마)
//
// 상호작용 대상 (target.kind): puzzle | clue | minigame | door
//   엔진은 상호작용 시 포인터 락을 풀지 않는다. 창을 열지 여부는 React(Game.tsx)가 결정.
//
// 조작: 클릭(시점 고정) / WASD / Shift 달리기(스태미나) / C 웅크리기 / E·클릭 조사 / F 손전등(횃불)
// =====================================================================
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';
import * as TX from './textures.js';
import { StudyWorld } from './study/studyWorld.js';
import { createFlashlightModel } from './study/flashlightModel.js';
import { makeGradeShader, GRADE_PRESETS } from './study/grade.js';
import * as ST from './study/studyTextures.js';

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
const SPEED = 3.2;
const BASE_FOV = 72;
const UP = new THREE.Vector3(0, 1, 0);
const INTERACT_DIST = 3;
const MOVE_SEND_MS = 80;

const THEME_CFG = {
  vault: { fog: 0x10221c, density: 0.024, ambient: 0.32, hemi: 0.8, exposure: 1.18, roomLight: 0xffdfae },
  study: { fog: 0x1c0d0b, density: 0.03, ambient: 0.08, hemi: 2.1, exposure: 1.45, roomLight: 0xffb070 },
  horror: { fog: 0x040506, density: 0.072, ambient: 0.05, hemi: 0.05, exposure: 1.25, roomLight: 0xcfe6ff },
  egypt: { fog: 0x1a1108, density: 0.045, ambient: 0.16, hemi: 0.22, exposure: 1.15, roomLight: 0xff9a4a },
  neutral: { fog: null, density: 0.04, ambient: 0.35, hemi: 0.25, exposure: 1.0, roomLight: 0xffffff },
};

const HORROR_WALL_TEXT = ['도망쳐', 'HELP ME', '그것이 보고 있다', '나가지 마', '거의 다 왔어'];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function hashColor(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.6, 0.5);
}

function makeLabel(text, { color = '#ffffff', bg = 'rgba(0,0,0,0.6)', width = 2.6 } = {}) {
  const canvas = TX.makeCanvas(512, 112);
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
    this.vaultCameras = [];
    this.kind = this.style.decor === 'vault' ? 'vault' : this.style.decor === 'study' ? 'study' : this.style.decor === 'server' ? 'horror' : this.style.decor === 'pillar' ? 'egypt' : 'neutral';
    this.cfg = THEME_CFG[this.kind];
    this.cb = options;
    this.audio = options.audio || null;
    // 그래픽 품질: low(그림자·후처리 없음) / medium(그림자·외곽선) / high(+빛번짐·색수차)
    this.quality = options.quality || 'medium';
    // 자동 해상도: FPS 가 떨어지면 렌더 해상도를 낮추고 여유가 생기면 되돌린다 (팀원 프로젝트의 autoQuality 이식)
    this.dynamicRes = options.dynamicRes ?? true;
    this._qTime = 0;
    this._qFrames = 0;
    this._qCooldown = 3;
    this.lowTime = 0;
    this._pulse = 0;
    this.baseFov = options.fov || BASE_FOV;
    this.marks = [];
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this._lastMarkAt = 0;
    this.R = TX.mulberry32(7 + this.rooms.length * 13);

    this.inputEnabled = true;
    this.keys = new Set();
    this.doors = [];
    this.markers = [];       // slot → { kind:'crt'|'tablet'|'plain', ... }
    this.interactables = [];
    this.occluders = [];
    this.colliders = [];
    this.clueObjs = new Map();
    this.minigameObjs = [];
    this.glints = [];
    this.roomLights = [];    // { light, tubes:[mat], base, pattern, flick }
    this.torches = [];       // { light, flames:[sprite], base, phase }
    this.blinkers = [];
    this.staticScreens = [];
    this.swingers = [];
    this.remote = new Map();
    this._canvasCache = new Map();
    this._texCache = new Map();
    this._matCache = new Map();
    this.currentSlot = -1;
    this.focusKey = null;
    this.lastMoveSent = 0;
    this.disposed = false;
    this.exitDoor = null;
    this.handOn = true;
    // ---- 1인칭 몸 상태 (흔들림·관성·스태미나) ----
    this.motion = options.motion ?? 1; // 화면 흔들림 강도 0~1 (멀미 방지 옵션)
    this.vel = new THREE.Vector3();
    this.stamina = 1;
    this.exhausted = false;
    this.staminaCooldown = 0;
    this._lastStamina = 1;
    this._breathAt = 0;
    this.crouch = 0;
    this.bob = 0;
    this.bobAmp = 0;
    this.lastStepSign = 1;
    this.stepDip = 0;
    this.lean = 0;
    this.turnRoll = 0;
    this._prevYaw = null;
    this.trauma = 0;
    this.rumbleUntil = 0;
    this.fovPunch = 0;
    this.fov = options.fov || BASE_FOV;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this.blackoutUntil = 0;
    this.stalkerHideAt = 0;
    this.torchDipUntil = 0;
    this.nextEventAt = 35 + this.R() * 25;
    this._screenTimer = 0;
    this._staticTimer = 0;

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    const fogColor = this.cfg.fog ?? new THREE.Color(this.style.fog).getHex();
    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.FogExp2(fogColor, this.cfg.density);

    // head: 위치 + 시선(마우스). camera 는 head 의 자식으로 흔들림·기울기만 담당한다.
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, w / h, 0.05, 120);
    const start = options.startPosition || [0, EYE_H, 2.5];
    this.head = new THREE.Object3D();
    this.head.position.set(start[0], EYE_H, start[2]);
    this.head.add(this.camera);
    this.scene.add(this.head);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(window.devicePixelRatio, this.quality === 'low' ? 1 : this.quality === 'medium' ? 1.5 : 2);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.cfg.exposure;
    this.renderer.shadowMap.enabled = (this.kind === 'horror' || this.kind === 'study') && this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.controls = new PointerLockControls(this.head, this.renderer.domElement);
    this.controls.pointerSpeed = options.sensitivity ?? 1;
    this.controls.addEventListener('lock', () => this.cb.onLockChange?.(true));
    this.controls.addEventListener('unlock', () => {
      this.keys.clear();
      this.cb.onLockChange?.(false);
    });

    this.raycaster = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);

    if (this.kind === 'study') this.study = new StudyWorld(this);
    this._buildWorld();
    this._buildHandLight();
    this._buildDust();
    if (this.kind === 'horror' || this.kind === 'study') this._buildStalker();
    // 1인칭 손에 든 손전등 모델 (팀원 프로젝트 이식)
    if (this.kind === 'horror' || this.kind === 'study') this.torchModel = createFlashlightModel(this.camera);
    if (this.kind === 'egypt') this._buildSandFall();
    this._finalizeShadows();
    this._applyStatuses(true);
    this._setupComposer(w, h);
    this._bindEvents();

    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this.raf = requestAnimationFrame(this._loop);
    this._emitMove(true);

    // QA/디버깅용: 개발 모드에서만 콘솔에서 window.__escapeEngine 으로 접근
    if (import.meta.env?.DEV) window.__escapeEngine = this;
  }

  // ============================================================ 재질 / 텍스처
  _texture(key, make, repeat = [1, 1], srgb = true) {
    const ck = `${key}|${repeat.join(',')}|${srgb}`;
    if (this._texCache.has(ck)) return this._texCache.get(ck);
    let canvas = this._canvasCache.get(key);
    if (!canvas) {
      canvas = make();
      this._canvasCache.set(key, canvas);
    }
    const t = TX.toTexture(canvas, { repeat, srgb });
    this._texCache.set(ck, t);
    return t;
  }

  _mat(key, make, repeat = [1, 1], { bump = 0, rough = 0.9, metal = 0, color = 0xffffff, transparent = false, emissive } = {}) {
    const ck = `${key}|${repeat.join(',')}|${bump}|${rough}|${metal}|${color}|${transparent}`;
    if (this._matCache.has(ck)) return this._matCache.get(ck);
    const m = new THREE.MeshStandardMaterial({ map: this._texture(key, make, repeat), roughness: rough, metalness: metal, color, transparent });
    if (bump) {
      m.bumpMap = this._texture(key, make, repeat, false);
      m.bumpScale = bump;
    }
    if (emissive) m.emissive = new THREE.Color(emissive);
    this._matCache.set(ck, m);
    return m;
  }

  _plain(color, rough = 0.8, metal = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }

  _wallMat(width) {
    if (this.study) return this.study.wallMat(width);
    const rw = Math.max(0.25, width / (this.kind === 'egypt' ? 5 : 4));
    if (this.kind === 'egypt') return this._mat('sandwall', () => TX.sandstoneWall(21), [rw, 1], { bump: 0.05, rough: 0.95 });
    const color = this.kind === 'neutral' ? new THREE.Color(this.style.wall).getHex() : 0xffffff;
    return this._mat('concrete', () => TX.concreteWall(3), [rw, 1], { bump: 0.035, rough: 0.93, color });
  }

  /** 투명 배경 데칼(핏자국, 글씨 등) */
  _decal(key, make, w, h, { rough = 0.4, opacity = 1 } = {}) {
    const m = new THREE.MeshStandardMaterial({
      map: this._texture(key, make),
      transparent: true,
      opacity,
      depthWrite: false,
      roughness: rough,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.userData.noShadow = true;
    return mesh;
  }

  _box(sx, sy, sz, mat, x, y, z, parent = this.scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  _addCollider(cx, cz, hw, hd) {
    this.colliders.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd });
  }

  // ============================================================ 월드
  _buildWorld() {
    const s = this.style;
    const K = this.kind;
    const n = this.rooms.length;
    const total = n * ROOM_SIZE;
    const minX = -HALF;
    const maxX = total - HALF;
    const cx = (minX + maxX) / 2;

    this.scene.add(new THREE.AmbientLight(K === 'egypt' ? 0xffd8a8 : 0xffffff, this.cfg.ambient));
    this.hemi = K === 'study' ? new THREE.HemisphereLight(0x8e6a5e, 0x2e1812, this.cfg.hemi) : new THREE.HemisphereLight(K === 'egypt' ? 0xffc890 : 0x9fb6c8, K === 'egypt' ? 0x3a2410 : 0x0b0b0b, this.cfg.hemi);
    this.scene.add(this.hemi);
    if (this.study) this.study.buildLightPool();

    // 바닥 / 천장
    const floorMat = this.study
      ? this.study.floorMat(total)
      : K === 'egypt'
        ? this._mat('sandfloor', () => TX.sandFloor(22), [total / 5, 2], { bump: 0.04, rough: 1 })
        : this._mat('tiles', () => TX.floorTiles(2), [total / 2.5, ROOM_SIZE / 2.5], { bump: 0.03, rough: 0.75, color: K === 'neutral' ? new THREE.Color(s.floor).getHex() : 0xffffff });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(total, ROOM_SIZE), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, 0);
    this.scene.add(floor);

    const ceilMat = this.study
      ? this.study.ceilMat(total)
      : K === 'egypt'
        ? this._mat('ceil-stone', () => TX.roughCeiling(23), [total / 4, 2.5], { bump: 0.05, rough: 1 })
        : this._mat('ceil-tiles', () => TX.ceilingTiles(3), [total / 2.4, ROOM_SIZE / 2.4], { rough: 0.95 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(total, ROOM_SIZE), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, WALL_H, 0);
    this.scene.add(ceil);

    const wall = (sx, sy, sz, x, y, z, width) => {
      const m = this._box(sx, sy, sz, this._wallMat(width), x, y, z);
      this.occluders.push(m);
      return m;
    };

    // 외벽
    wall(total, WALL_H, WALL_T, cx, WALL_H / 2, -HALF, total);
    wall(total, WALL_H, WALL_T, cx, WALL_H / 2, HALF, total);
    wall(WALL_T, WALL_H, ROOM_SIZE, minX, WALL_H / 2, 0, ROOM_SIZE);

    // 칸막이 + 문
    const segW = (ROOM_SIZE - DOOR_W) / 2;
    const buildPartition = (wx, isExit, slot) => {
      wall(WALL_T, WALL_H, segW, wx, WALL_H / 2, DOOR_W / 2 + segW / 2, segW);
      wall(WALL_T, WALL_H, segW, wx, WALL_H / 2, -(DOOR_W / 2 + segW / 2), segW);
      wall(WALL_T, WALL_H - DOOR_H, DOOR_W, wx, DOOR_H + (WALL_H - DOOR_H) / 2, 0, DOOR_W);
      const door = this._buildDoor(wx, slot, isExit);
      return door;
    };
    for (let i = 0; i < n - 1; i++) this.doors.push(buildPartition(i * ROOM_SIZE + HALF, false, i));
    this.exitDoor = buildPartition(maxX, true, n - 1);

    // 공포: 벽을 따라 지나가는 배관
    if (K === 'horror') {
      const pipeMat = this._plain(0x4a3c2e, 0.55, 0.6);
      for (const [y, r, z] of [[3.62, 0.09, 4.72], [3.38, 0.05, 4.78], [3.7, 0.07, -4.75]]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, total, 10), pipeMat);
        p.rotation.z = Math.PI / 2;
        p.position.set(cx, y, z);
        this.scene.add(p);
      }
    }

    this.rooms.forEach((room, i) => {
      const x = i * ROOM_SIZE;
      this._buildRoomLighting(i, x, room);
      if (room.has_puzzle) this._buildPuzzleObject(i, x);
      (room.clues || []).forEach((clue) => this._buildClue(i, x, clue));
      if (room.minigame) this._buildMinigameObject(i, x, room.minigame);
      if (K === 'horror') this._decorHorror(i, x, room);
      else if (K === 'egypt') this._decorEgypt(i, x, room);
      else if (K === 'vault') this._decorateVault(i, x);
      else if (K === 'study') this.study.decorate(i, x, room);
      this._buildRoomSign(i, x, room);
    });
  }

  _decorateVault(slot, x) {
    const steel = this._plain(0x586860, 0.38, 0.7);
    const brass = this._plain(0xc09c5e, 0.3, 0.75);
    const charcoal = this._plain(0x172822, 0.55, 0.35);
    const camera = new THREE.Group();
    camera.position.set(x + 3.7, 3.35, -4.45);
    this.scene.add(camera);
    this._box(0.32, 0.25, 0.58, steel, 0, 0, 0, camera);
    this._box(0.20, 0.14, 0.08, charcoal, 0, 0, 0.31, camera);
    this._box(0.05, 0.04, 0.04, new THREE.MeshBasicMaterial({ color: 0xfe644c }), 0.12, 0.04, 0.31, camera);
    this.vaultCameras[slot] = camera;
    // Keep the deposit boxes flush with the rear wall and outside clue positions.
    this._box(5.6, 2.15, 0.12, charcoal, x, 1.65, 4.82);
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 7; column++) {
        const cx = x + (column - 3) * 0.78;
        const cy = 1 + row * 0.66;
        this._box(0.75, 0.62, 0.09, steel, cx, cy, 4.7);
        this._box(0.19, 0.045, 0.06, brass, cx, cy, 4.63);
      }
    }
  }

  _buildDoor(wx, slot, isExit) {
    const K = this.kind;
    const group = new THREE.Group();
    let doorMesh;
    let indicatorMat;
    if (K === 'study') {
      // 붉은 서재: 경첩으로 열리는 나무 문 (마지막 출구는 철문). 문 옆 놋쇠 램프가 잠김(빨강)/열림(초록)
      const mat = this._mat(isExit ? 'st-irondoor' : 'st-door', () => (isExit ? ST.doorPanel(31, true) : ST.doorPanel(29)), [1, 1], { bump: 0.04, rough: isExit ? 0.5 : 0.7, metal: isExit ? 0.6 : 0 });
      const pivot = new THREE.Group();
      pivot.position.set(0, 0, -DOOR_W / 2);
      group.add(pivot);
      doorMesh = this._box(WALL_T * 0.5, DOOR_H, DOOR_W, mat, 0, DOOR_H / 2, DOOR_W / 2, pivot);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), this._plain(0xb08a3a, 0.3, 0.85));
      for (const sx of [-0.08, 0.08]) {
        const k = knob.clone();
        k.position.set(sx, 1.05, DOOR_W - 0.18);
        pivot.add(k);
      }
      const frameMat = this._plain(0x24120a, 0.6);
      this._box(0.3, 0.12, DOOR_W + 0.24, frameMat, wx, DOOR_H + 0.06, 0);
      for (const side of [-1, 1]) this._box(0.3, DOOR_H, 0.12, frameMat, wx, DOOR_H / 2, side * (DOOR_W / 2 + 0.06));
      indicatorMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a10, emissiveIntensity: 1.8 });
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), indicatorMat);
        lamp.position.set(wx + side * 0.17, 1.55, -DOOR_W / 2 - 0.3);
        lamp.userData.noShadow = true;
        this.scene.add(lamp);
      }
      group.userData.pivot = pivot;
    } else if (K === 'egypt') {
      const mat = this._mat('stonedoor', () => TX.stoneDoor(24), [1, 1], { bump: 0.08, rough: 0.95 });
      doorMesh = this._box(WALL_T * 0.9, DOOR_H, DOOR_W, mat, 0, DOOR_H / 2, 0, group);
      // 문 위의 두 보석 눈
      indicatorMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2200, emissiveIntensity: 1.6 });
      for (const z of [-0.45, 0.45]) {
        for (const side of [-1, 1]) {
          const gem = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), indicatorMat);
          gem.position.set(wx + side * 0.13, DOOR_H + 0.25, z);
          this.scene.add(gem);
        }
      }
    } else {
      const mat = K === 'horror' ? this._mat('metaldoor', () => TX.metalDoor(4), [1, 1], { bump: 0.05, rough: 0.55, metal: 0.55 }) : this._plain(0x3a3a3a, 0.4, 0.6);
      doorMesh = this._box(WALL_T * 0.7, DOOR_H, DOOR_W, mat, 0, DOOR_H / 2, 0, group);
      // 경고 줄무늬 문틀 + 키패드
      if (K === 'horror') {
        const stripe = this._mat('hazard', () => TX.hazardStripes(), [1, 1], { rough: 0.7 });
        for (const side of [-1, 1]) {
          this._box(0.06, DOOR_H + 0.1, 0.12, stripe, wx + side * 0.13, (DOOR_H + 0.1) / 2, DOOR_W / 2 + 0.06);
          this._box(0.06, DOOR_H + 0.1, 0.12, stripe, wx + side * 0.13, (DOOR_H + 0.1) / 2, -DOOR_W / 2 - 0.06);
        }
      }
      indicatorMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff1a10, emissiveIntensity: 2.2 });
      for (const side of [-1, 1]) {
        const pad = this._box(0.05, 0.22, 0.14, this._plain(0x222426, 0.5, 0.5), wx + side * 0.13, 1.35, -DOOR_W / 2 - 0.35);
        const led = this._box(0.02, 0.05, 0.08, indicatorMat, wx + side * 0.16, 1.42, -DOOR_W / 2 - 0.35);
        pad.userData.noShadow = led.userData.noShadow = true;
      }
    }
    group.position.set(wx, 0, 0);
    this.scene.add(group);
    const doorLabel = K === 'study' ? (isExit ? '출구 철문' : '나무 문') : isExit ? (K === 'egypt' ? '태양의 문' : '비상 탈출구') : K === 'egypt' ? '돌문' : '보안 철문';
    doorMesh.userData = { target: { kind: 'door', slot, label: doorLabel } };
    this.interactables.push(doorMesh);
    const door = { group, mesh: doorMesh, index: slot, open: false, indicatorMat, isExit, wx, pivot: group.userData.pivot || null };
    group.userData.door = door;

    if (isExit && K === 'horror') {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.34),
        new THREE.MeshBasicMaterial({ map: this._texture('exitsign', () => TX.exitSign()), toneMapped: false }),
      );
      sign.rotation.y = -Math.PI / 2;
      sign.position.set(wx - 0.12, DOOR_H + 0.55, 0);
      sign.userData.noShadow = true;
      this.scene.add(sign);
      const glow = new THREE.PointLight(0x22ff66, 1.5, 4, 2);
      glow.position.set(wx - 0.5, DOOR_H + 0.5, 0);
      this.scene.add(glow);
    }
    return door;
  }

  _buildRoomLighting(i, x, room) {
    const K = this.kind;
    if (K === 'study') {
      this.study.buildRoomLighting(i, x, room);
    } else if (K === 'horror') {
      const patterns = ['flicker', 'buzz', 'dying', 'flicker', 'buzz'];
      const name = room.name || '';
      let pattern = patterns[i % patterns.length];
      if (/지하|통로/.test(name)) pattern = 'dying';
      const light = new THREE.PointLight(this.cfg.roomLight, pattern === 'dying' ? 3 : 7, 13, 1.7);
      light.position.set(x, WALL_H - 0.35, 0);
      this.scene.add(light);
      const tubes = [];
      for (const dx of [-2, 2]) {
        const housing = this._box(1.5, 0.08, 0.32, this._plain(0x9a9a92, 0.6, 0.3), x + dx, WALL_H - 0.05, 0);
        housing.userData.noShadow = true;
        const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfefff, emissiveIntensity: 2.4 });
        const tube = this._box(1.36, 0.05, 0.08, tubeMat, x + dx, WALL_H - 0.11, 0);
        tube.userData.noShadow = true;
        tubes.push(tubeMat);
      }
      this.roomLights.push({ light, tubes, base: light.intensity, pattern, flick: { until: 0, next: this.R() * 3 } });
      // 붉은 비상등 (마지막 방과 일부 방)
      if (room.is_final || i % 2 === 1 || pattern === 'dying') {
        const red = new THREE.PointLight(0xff1a0a, 0, 9, 1.6);
        red.position.set(x + 3.5, 3.3, -4.4);
        this.scene.add(red);
        const domeMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1100, emissiveIntensity: 0 });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
        dome.rotation.x = Math.PI / 2;
        dome.position.set(x + 3.5, 3.3, -4.88);
        dome.userData.noShadow = true;
        this.scene.add(dome);
        this.roomLights[this.roomLights.length - 1].beacon = { light: red, mat: domeMat, phase: this.R() * 6 };
      }
    } else if (K === 'egypt') {
      for (const [dx, z] of [[-2.8, -4.72], [2.8, 4.72]]) this._buildTorch(x + dx, 2.15, z, z > 0 ? -1 : 1);
    } else {
      const light = new THREE.PointLight(new THREE.Color(this.style.light), 16, 16, 1.6);
      light.position.set(x, WALL_H - 0.5, 0);
      this.scene.add(light);
      this.roomLights.push({ light, tubes: [], base: 16, pattern: 'steady', flick: { until: 0, next: 999 } });
    }
  }

  _buildTorch(x, y, z, facing) {
    const bracketMat = this._plain(0x2a1d12, 0.7, 0.4);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.55, 8), this._plain(0x3b2512, 0.9));
    stick.position.set(x, y, z + facing * 0.12);
    stick.rotation.x = facing * 0.35;
    this.scene.add(stick);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.05, 0.12, 10), bracketMat);
    cup.position.set(x, y + 0.3, z + facing * 0.22);
    this.scene.add(cup);
    const flameMat = new THREE.SpriteMaterial({ map: this._texture('flame', () => TX.flameSprite()), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff });
    const flames = [];
    for (let k = 0; k < 2; k++) {
      const f = new THREE.Sprite(flameMat.clone());
      f.scale.set(0.32, 0.6, 1);
      f.position.set(x, y + 0.6, z + facing * 0.24);
      this.scene.add(f);
      flames.push(f);
    }
    const light = new THREE.PointLight(0xff8a3a, 7, 10, 1.7);
    light.position.set(x, y + 0.6, z + facing * 0.45);
    // 저사양: 방마다 횃불 빛은 하나만 (불꽃은 그대로 보임)
    if (this.quality === 'low' && this.torches.length % 2 === 1) light.visible = false;
    this.scene.add(light);
    this.torches.push({ light, flames, base: 7, phase: this.R() * 10 });
  }

  _buildRoomSign(i, x, room) {
    const K = this.kind;
    if (K === 'neutral') {
      const label = makeLabel(`${i + 1}. ${room.name}`, { color: this.style.accent });
      label.position.set(x, 3.2, -HALF + 0.6);
      this.scene.add(label);
      return;
    }
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.55),
      new THREE.MeshStandardMaterial({ map: this._texture(`sign-${i}-${room.name}`, () => TX.signPlate(`${i + 1}. ${room.name}`, K, 40 + i)), roughness: 0.7, metalness: K === 'horror' || K === 'study' ? 0.4 : 0 }),
    );
    plate.position.set(x, 3.15, -HALF + 0.12);
    plate.userData.noShadow = true;
    this.scene.add(plate);
  }

  // ============================================================ 상호작용 오브젝트
  _glint(x, y, z) {
    const color = this.kind === 'egypt' || this.kind === 'study' ? 0xffd27a : this.kind === 'horror' ? 0xcfe8ff : new THREE.Color(this.style.accent).getHex();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._texture('glow', () => TX.glowSprite()), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.set(0.2, 0.2, 1);
    s.position.set(x, y, z);
    s.userData.baseY = y;
    s.userData.phase = this.R() * 10;
    this.scene.add(s);
    this.glints.push(s);
    return s;
  }

  _buildPuzzleObject(slot, x) {
    const K = this.kind;
    if (K === 'study') {
      const { group: desk, indicator } = this.study.buildPuzzle(slot, x, this.rooms[slot]);
      this.study.addHitBox(desk, { minTop: 1.3 });
      desk.userData.target = { kind: 'puzzle', slot, label: '번호 자물쇠' };
      this.markers[slot] = { kind: 'lock', mat: indicator };
      this.interactables.push(desk);
      return;
    }
    const group = new THREE.Group();
    group.position.set(x + PUZZLE_POS[0], 0, PUZZLE_POS[1]);
    if (K === 'egypt') {
      const altar = this._box(1.7, 0.95, 0.95, this._mat('altar', () => TX.sandstoneWall(33), [0.4, 0.3], { bump: 0.05 }), 0, 0.475, 0, group);
      altar.castShadow = true;
      const { map, glow } = TX.glyphTablet(28 + slot);
      const tabMat = new THREE.MeshStandardMaterial({ map: TX.toTexture(map), emissiveMap: TX.toTexture(glow), emissive: 0xffb43a, emissiveIntensity: 1, roughness: 0.8 });
      const tablet = this._box(1.05, 1.25, 0.14, tabMat, 0, 1.55, -0.22, group);
      tablet.rotation.x = -0.08;
      this.markers[slot] = { kind: 'tablet', mat: tabMat };
      this._addCollider(x, PUZZLE_POS[1], 0.85, 0.5);
    } else if (K === 'horror') {
      const desk = this._box(1.5, 0.08, 0.8, this._mat('wood', () => TX.woodGrain(15), [1, 1], { rough: 0.8 }), 0, 0.82, 0, group);
      for (const [lx, lz] of [[-0.68, -0.34], [0.68, -0.34], [-0.68, 0.34], [0.68, 0.34]]) this._box(0.05, 0.8, 0.05, this._plain(0x2a2a2a, 0.5, 0.6), lx, 0.4, lz, group);
      const crt = this._box(0.72, 0.6, 0.62, this._plain(0xb8b29a, 0.6), 0, 1.17, -0.08, group);
      crt.castShadow = true;
      const canvas = TX.makeCanvas(256, 192);
      const ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.42), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      screen.position.set(0, 1.19, 0.231);
      screen.userData.noShadow = true;
      group.add(screen);
      this._box(0.6, 0.03, 0.2, this._plain(0x8f8a78, 0.7), 0, 0.875, 0.26, group);
      const glow = new THREE.PointLight(0x55ff99, 1.4, 3.2, 2);
      glow.position.set(0, 1.2, 0.6);
      group.add(glow);
      this.markers[slot] = { kind: 'crt', canvas, ctx, tex, glow, mode: 'locked', title: this.rooms[slot].name };
      desk.castShadow = true;
      this._addCollider(x, PUZZLE_POS[1], 0.8, 0.45);
    } else {
      const markerMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: this.style.accent, emissiveIntensity: 1 });
      this._box(1.4, 0.9, 0.7, this._plain(0x1c1f22, 0.6, 0.5), 0, 0.45, 0, group);
      this._box(1.0, 0.65, 0.06, markerMat, 0, 1.3, -0.1, group);
      this.markers[slot] = { kind: 'plain', mat: markerMat };
      this._addCollider(x, PUZZLE_POS[1], 0.75, 0.4);
    }
    group.userData.target = { kind: 'puzzle', slot, label: K === 'egypt' ? '신성한 비문' : K === 'vault' ? '금고층 출입 단말기' : K === 'horror' ? '보안 단말기' : '단말기' };
    this.scene.add(group);
    this.interactables.push(group);
  }

  _buildClue(slot, x, clue) {
    const K = this.kind;
    const [px, pz] = clue.pos || [0, 2];
    const lx = clamp(px, -4.4, 4.4);
    const lz = clamp(pz, -4.4, 4.4);
    const wx = x + lx;
    if (K === 'study') {
      const built = this.study.buildClue(slot, x, clue, lx, lz);
      this.study.addHitBox(built.group);
      built.group.userData.target = { kind: 'clue', slot, id: clue.id, label: clue.label };
      this.interactables.push(built.group);
      const glint = this._glint(built.glint[0], built.topY, built.glint[1]);
      this.clueObjs.set(`${slot}:${clue.id}`, { glint });
      return;
    }
    const group = new THREE.Group();
    const seed = slot * 31 + clue.id.length * 7;
    let topY = 1.1;
    let col = [0.3, 0.3];
    const pedestal = (h = 0.78) =>
      K === 'egypt'
        ? this._box(0.55, h, 0.55, this._mat('pedestal', () => TX.sandstoneWall(41), [0.15, 0.2], { bump: 0.05 }), 0, h / 2, 0, group)
        : this._box(0.55, h, 0.42, this._plain(0x2e3134, 0.55, 0.5), 0, h / 2, 0, group);

    switch (clue.object) {
      case 'board': {
        if (K === 'egypt') {
          const slab = this._box(1.3, 1.6, 0.18, this._mat('papyrus-slab', () => TX.stoneDoor(50), [1, 1], { bump: 0.08 }), 0, 0.95, 0, group);
          slab.castShadow = true;
        } else {
          const board = this._box(1.3, 0.9, 0.05, this._plain(0x8d9398, 0.5, 0.4), 0, 1.6, 0, group);
          const face = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 0.82), new THREE.MeshStandardMaterial({ map: this._texture(`wb-${seed}`, () => TX.whiteboard(seed)), roughness: 0.3 }));
          face.position.set(0, 1.6, 0.03);
          group.add(face);
          for (const sx of [-0.55, 0.55]) this._box(0.04, 1.2, 0.04, this._plain(0x55595c, 0.5, 0.6), sx, 0.6, 0, group);
          board.castShadow = true;
        }
        group.rotation.y = Math.atan2(-lx, -lz);
        topY = 2.25;
        col = [0.6, 0.15];
        break;
      }
      case 'statue': {
        if (K === 'egypt') {
          pedestal(0.5);
          const bastMat = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.35, metalness: 0.4 });
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.6, 12), bastMat);
          body.position.y = 0.8;
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), bastMat);
          head.position.y = 1.2;
          group.add(body, head);
          for (const sx of [-0.07, 0.07]) {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 6), bastMat);
            ear.position.set(sx, 1.36, 0);
            group.add(ear);
          }
          const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 16), this._mat('gold', () => TX.goldPattern(26), [1, 1], { rough: 0.3, metal: 0.8 }));
          collar.rotation.x = Math.PI / 2;
          collar.position.y = 1.05;
          group.add(collar);
          topY = 1.6;
        } else {
          // 공포: 얼굴 없는 마네킹
          const skin = new THREE.MeshStandardMaterial({ color: 0xc9bba6, roughness: 0.6 });
          const stand = this._box(0.08, 0.5, 0.08, this._plain(0x222222, 0.5, 0.6), 0, 0.25, 0, group);
          stand.castShadow = true;
          const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), skin);
          torso.position.y = 1.0;
          torso.rotation.z = 0.08;
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin);
          head.position.set(0.04, 1.55, 0);
          head.rotation.z = 0.35;
          group.add(torso, head);
          const stain = this._decal('blood-small', () => TX.handprint(77), 0.25, 0.25);
          stain.position.set(0, 1.0, 0.205);
          group.add(stain);
          topY = 1.9;
        }
        group.rotation.y = Math.atan2(-lx, -lz);
        col = [0.3, 0.3];
        break;
      }
      case 'jar': {
        if (K === 'egypt') {
          const pts = [];
          for (let k = 0; k <= 10; k++) {
            const t = k / 10;
            pts.push(new THREE.Vector2(0.12 + Math.sin(t * Math.PI) * 0.12 - t * 0.04, t * 0.55));
          }
          const jar = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), this._mat('clay', () => TX.clay(29), [2, 1], { rough: 0.85 }));
          const lid = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), this._plain(0x1a1712, 0.5, 0.2));
          lid.position.y = 0.6;
          group.add(jar, lid);
          topY = 0.95;
          col = [0.25, 0.25];
        } else {
          pedestal(0.78);
          const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 16), new THREE.MeshStandardMaterial({ color: 0xbfe8d0, transparent: true, opacity: 0.28, roughness: 0.05 }));
          glass.position.y = 1.0;
          const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.32, 16), new THREE.MeshStandardMaterial({ color: 0x2f6a2a, emissive: 0x3cff5a, emissiveIntensity: 0.35, transparent: true, opacity: 0.75 }));
          liquid.position.y = 0.96;
          const thing = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), this._plain(0x5a4030, 0.9));
          thing.position.set(0.02, 0.98, 0);
          group.add(liquid, thing, glass);
          topY = 1.4;
        }
        break;
      }
      case 'box': {
        if (K === 'egypt') {
          const chest = this._box(0.6, 0.38, 0.42, this._mat('gold', () => TX.goldPattern(26), [1, 1], { rough: 0.35, metal: 0.75 }), 0, 0.19, 0, group);
          chest.castShadow = true;
          topY = 0.75;
        } else {
          const box1 = this._box(0.6, 0.45, 0.45, this._mat(`cardboard-${seed % 3}`, () => TX.cardboard(seed), [1, 1], { rough: 0.95 }), 0, 0.225, 0, group);
          const box2 = this._box(0.45, 0.35, 0.38, this._mat(`cardboard-${(seed + 1) % 3}`, () => TX.cardboard(seed + 1), [1, 1], { rough: 0.95 }), 0.05, 0.625, 0.02, group);
          box2.rotation.y = 0.3;
          box1.castShadow = box2.castShadow = true;
          topY = 1.05;
        }
        group.rotation.y = this.R() * 1.2;
        break;
      }
      case 'tablet': {
        if (K === 'egypt') {
          const tab = this._box(0.62, 0.9, 0.12, this._mat(`tablet-${seed % 4}`, () => TX.glyphTablet(seed).map, [1, 1], { bump: 0.05, rough: 0.9 }), 0, 0.45, 0, group);
          tab.rotation.x = -0.12;
          tab.castShadow = true;
          topY = 1.15;
        } else {
          pedestal(0.78);
          const clip = this._box(0.26, 0.02, 0.34, this._plain(0x6b4a2a, 0.8), 0, 0.8, 0, group);
          const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.3), this._mat(`paper-${seed % 4}`, () => TX.paper(seed), [1, 1], { rough: 0.9 }));
          sheet.rotation.x = -Math.PI / 2;
          sheet.position.y = 0.815;
          group.add(sheet);
          clip.userData.noShadow = true;
          topY = 1.1;
        }
        group.rotation.y = Math.atan2(-lx, -lz);
        break;
      }
      default: {
        // note / book
        if (K === 'egypt') {
          pedestal(0.75);
          const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32), this._mat(`papyrus-${seed % 4}`, () => TX.papyrus(seed), [1, 1], { rough: 0.95 }));
          sheet.rotation.x = -Math.PI / 2;
          sheet.position.y = 0.76;
          const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 10), this._mat(`papyrus-${seed % 4}`, () => TX.papyrus(seed), [1, 1]));
          roll.rotation.z = Math.PI / 2;
          roll.position.set(0, 0.79, -0.17);
          group.add(sheet, roll);
        } else {
          pedestal(0.78);
          if (clue.object === 'book') {
            const book = this._box(0.34, 0.07, 0.25, this._mat(`leather-${seed % 3}`, () => TX.leather(['#3a1a12', '#1d2a3a', '#2a2a1a'][seed % 3], seed), [1, 1], { rough: 0.7 }), 0, 0.815, 0, group);
            book.rotation.y = 0.4;
          } else {
            const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.31), this._mat(`paper-b-${seed % 4}`, () => TX.paper(seed, { blood: true }), [1, 1], { rough: 0.9 }));
            sheet.rotation.x = -Math.PI / 2;
            sheet.rotation.z = 0.3;
            sheet.position.y = 0.785;
            group.add(sheet);
          }
        }
        topY = 1.1;
        group.rotation.y = this.R() * Math.PI;
      }
    }
    group.position.set(wx, 0, lz);
    group.userData.target = { kind: 'clue', slot, id: clue.id, label: clue.label };
    this.scene.add(group);
    this.interactables.push(group);
    this._addCollider(wx, lz, col[0], col[1]);
    const glint = this._glint(wx, topY, lz);
    this.clueObjs.set(`${slot}:${clue.id}`, { glint });
  }

  _buildMinigameObject(slot, x, minigame) {
    const K = this.kind;
    if (K === 'study') {
      const { group: g, glowMat: gm, topY: ty } = this.study.buildMinigame(slot, x, minigame);
      this.study.addHitBox(g);
      g.userData.target = { kind: 'minigame', slot, label: minigame.title };
      this.interactables.push(g);
      const gl = this._glint(x + MINIGAME_POS[0], ty, MINIGAME_POS[1]);
      this.minigameObjs[slot] = { glint: gl, mat: gm };
      return;
    }
    const [px, pz] = MINIGAME_POS;
    const group = new THREE.Group();
    group.position.set(x + px, 0, pz);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffaa00, emissiveIntensity: 1.6 });
    const type = minigame.type || 'sequence';
    let topY = 1.4;
    if (K === 'egypt') {
      const gold = this._mat('gold', () => TX.goldPattern(26), [1, 1], { rough: 0.3, metal: 0.8 });
      if (type === 'timing') {
        // 심판의 저울
        this._box(0.5, 0.12, 0.5, gold, 0, 0.06, 0, group);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 10), gold);
        col.position.y = 0.8;
        group.add(col);
        const beam = new THREE.Group();
        beam.position.y = 1.55;
        const bar = this._box(1.3, 0.05, 0.05, gold, 0, 0, 0, beam);
        bar.castShadow = true;
        for (const sx of [-0.6, 0.6]) {
          const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.04, 16), gold);
          pan.position.set(sx, -0.45, 0);
          const rope = this._box(0.01, 0.45, 0.01, this._plain(0x6b5a30, 0.8), sx, -0.22, 0, beam);
          rope.userData.noShadow = true;
          beam.add(pan);
        }
        group.add(beam);
        this.swingers.push({ obj: beam, amp: 0.12, speed: 0.9 });
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), glowMat);
        gem.position.y = 1.62;
        group.add(gem);
        topY = 1.9;
      } else {
        const chest = this._box(0.95, 0.55, 0.6, gold, 0, 0.275, 0, group);
        chest.castShadow = true;
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.95, 16, 1, false, 0, Math.PI), gold);
        lid.rotation.z = Math.PI / 2;
        lid.rotation.y = Math.PI / 2;
        lid.position.y = 0.55;
        group.add(lid);
        const colors = [0xff3b2f, 0x2f7bff, 0x2fff6b, 0xffd02f];
        colors.forEach((c, k) => {
          const g = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.2 }));
          g.position.set(-0.27 + k * 0.18, 0.4, 0.31);
          group.add(g);
        });
        const lock = this._box(0.15, 0.18, 0.04, glowMat, 0, 0.42, 0.31, group);
        lock.userData.noShadow = true;
        topY = 1.15;
      }
    } else if (K === 'horror') {
      if (type === 'wires') {
        // 배전반
        const cab = this._box(0.95, 1.5, 0.38, this._plain(0x6c7072, 0.5, 0.6), 0, 0.75, 0, group);
        cab.castShadow = true;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.2), new THREE.MeshStandardMaterial({ map: this._texture('hazard', () => TX.hazardStripes()), roughness: 0.7 }));
        face.position.set(0, 1.38, 0.195);
        group.add(face);
        this._box(0.22, 0.22, 0.02, glowMat, 0, 0.95, 0.2, group).userData.noShadow = true;
        for (let k = 0; k < 4; k++) {
          const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6 + k * 0.1, 6), this._plain([0xb02020, 0x2050b0, 0x20a040, 0xd0b020][k], 0.6));
          wire.position.set(-0.3 + k * 0.2, 0.35 - k * 0.05, 0.22);
          wire.rotation.z = (k - 1.5) * 0.15;
          group.add(wire);
        }
        this.sparkObj = { group, next: 0 };
        topY = 1.8;
      } else if (type === 'timing') {
        // 방화벽 해킹 콘솔
        const rack = this._box(0.8, 1.6, 0.6, this._plain(0x16181a, 0.5, 0.6), 0, 0.8, 0, group);
        rack.castShadow = true;
        const canvas = TX.makeCanvas(256, 192);
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
        screen.position.set(0, 1.15, 0.305);
        group.add(screen);
        this._box(0.5, 0.05, 0.05, glowMat, 0, 0.6, 0.31, group).userData.noShadow = true;
        this.markers[`mg${slot}`] = { kind: 'crt', canvas, ctx, tex, mode: 'firewall', title: '' };
        topY = 1.9;
      } else {
        // 낡은 금고
        const safe = this._box(0.9, 1.05, 0.75, this._plain(0x2f3a34, 0.45, 0.7), 0, 0.525, 0, group);
        safe.castShadow = true;
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 20), this._plain(0xa0a0a0, 0.3, 0.9));
        dial.rotation.x = Math.PI / 2;
        dial.position.set(0, 0.62, 0.39);
        group.add(dial);
        const handle = this._box(0.04, 0.22, 0.04, this._plain(0x9a9a9a, 0.3, 0.9), 0.28, 0.6, 0.4, group);
        handle.userData.noShadow = true;
        this._box(0.1, 0.04, 0.02, glowMat, -0.28, 0.85, 0.38, group).userData.noShadow = true;
        topY = 1.4;
      }
    } else {
      this._box(0.9, 1.1, 0.7, this._plain(0x4a4f55, 0.35, 0.7), 0, 0.55, 0, group);
      this._box(0.2, 0.2, 0.05, glowMat, 0, 0.65, 0.36, group);
    }
    group.userData.target = { kind: 'minigame', slot, label: minigame.title };
    this.scene.add(group);
    this.interactables.push(group);
    this._addCollider(x + px, pz, 0.5, 0.42);
    const glint = this._glint(x + px, topY, pz);
    this.minigameObjs[slot] = { glint, mat: glowMat };
  }

  // ============================================================ 테마 장식
  _decorHorror(i, x, room) {
    const R = this.R;
    const name = room.name || '';
    // 서버 랙 (정면 텍스처 + LED 발광맵)
    const side = this._plain(0x121416, 0.45, 0.65);
    const racks = [[-3, 1], [-1.6, 1], [1.6, 1], [3, 1], [-3.2, -1], [3.2, -1]];
    racks.forEach(([dx, s], k) => {
      const { map, glow } = TX.rackFront(i * 10 + k);
      const front = new THREE.MeshStandardMaterial({ map: TX.toTexture(map), emissiveMap: TX.toTexture(glow), emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.5, metalness: 0.5 });
      const mats = [side, side, side, side, s === -1 ? front : side, s === 1 ? front : side];
      const rz = s * (HALF - 0.7);
      const rack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.4, 0.9), mats);
      rack.position.set(x + dx, 1.2, rz);
      this.scene.add(rack);
      this.occluders.push(rack);
      this._addCollider(x + dx, rz, 0.55, 0.45);
      this.blinkers.push({ mat: front, speed: 0.5 + R() * 3, phase: R() * 6 });
    });
    // 천장에서 늘어진 케이블
    const cableMat = this._plain(0x0c0c0c, 0.7);
    for (let k = 0; k < 3; k++) {
      const ax = x - 3 + R() * 6;
      const az = -2.5 + R() * 5;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ax, WALL_H - 0.02, az),
        new THREE.Vector3(ax + 0.4, 2.6 + R() * 0.6, az + 0.3),
        new THREE.Vector3(ax + 0.9 + R(), WALL_H - 0.02, az + 0.6),
      ]);
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.022, 6, false), cableMat);
      this.scene.add(cable);
    }
    if (R() < 0.7) {
      // 끝이 끊어진 채 흔들리는 케이블
      const hang = new THREE.Group();
      hang.position.set(x - 1 + R() * 2, WALL_H, 1 + R() * 1.5);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), cableMat);
      c.position.y = -0.7;
      hang.add(c);
      this.scene.add(hang);
      this.swingers.push({ obj: hang, amp: 0.08, speed: 0.7 + R() });
    }
    // 바닥의 서류
    for (let k = 0; k < 5; k++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.31), this._mat(`paper-floor-${k % 3}`, () => TX.paper(60 + k, { blood: k === 0 }), [1, 1], { rough: 0.95 }));
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = R() * Math.PI * 2;
      p.position.set(x - 4 + R() * 8, 0.006 + k * 0.001, -3.5 + R() * 7);
      p.userData.noShadow = true;
      this.scene.add(p);
    }
    // 바닥 핏자국
    const pool = this._decal(`blood-${i % 3}`, () => TX.bloodPool(11 + i), 2.4, 2.4, { rough: 0.25 });
    pool.rotation.x = -Math.PI / 2;
    pool.rotation.z = R() * Math.PI;
    pool.position.set(x - 2.5 + R() * 5, 0.012, -1.5 + R() * 3);
    this.scene.add(pool);
    // 벽 글씨 (랙 위쪽)
    const text = HORROR_WALL_TEXT[i % HORROR_WALL_TEXT.length];
    const writing = this._decal(`bt-${text}`, () => TX.bloodText(text, 12 + i), 3.4, 0.85, { rough: 0.5 });
    writing.rotation.y = Math.PI;
    writing.position.set(x + (R() - 0.5) * 1.5, 3.05, HALF - 0.115);
    this.scene.add(writing);
    // 출구 쪽 벽의 피 묻은 손자국
    if (i < this.rooms.length) {
      const hand = this._decal('hand', () => TX.handprint(13), 0.45, 0.45, { rough: 0.5 });
      hand.rotation.y = -Math.PI / 2;
      hand.position.set(x + HALF - 0.115, 1.25 + R() * 0.3, -1.4 - R() * 0.8);
      this.scene.add(hand);
    }
    // 쓰러진 의자
    const chair = new THREE.Group();
    const chairMat = this._plain(0x24282b, 0.6, 0.4);
    this._box(0.45, 0.05, 0.45, chairMat, 0, 0, 0, chair);
    this._box(0.45, 0.5, 0.05, chairMat, 0, 0.25, -0.22, chair);
    chair.rotation.set(Math.PI / 2, 0, 0.6);
    chair.position.set(x + 1.5, 0.24, -2.6);
    this.scene.add(chair);
    // 방 이름에 따른 소품
    if (/감염|바이러스/.test(name)) {
      const barrelMat = new THREE.MeshStandardMaterial({ map: this._texture('hazard', () => TX.hazardStripes()), color: 0x8fbf5a, roughness: 0.6, metalness: 0.3 });
      for (const [bx, bz] of [[-0.4, 3.25], [0.35, 3.45], [0.0, 2.7]]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), barrelMat);
        b.position.set(x + bx, 0.45, bz);
        this.scene.add(b);
        this._addCollider(x + bx, bz, 0.3, 0.3);
      }
      const ooze = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshStandardMaterial({ color: 0x1f5a12, emissive: 0x39ff3a, emissiveIntensity: 0.4, roughness: 0.1, transparent: true, opacity: 0.8 }));
      ooze.rotation.x = -Math.PI / 2;
      ooze.position.set(x + 0.2, 0.014, 2.0);
      ooze.userData.noShadow = true;
      this.scene.add(ooze);
      const g = new THREE.PointLight(0x55ff55, 2.2, 5, 2);
      g.position.set(x, 0.5, 2.4);
      this.scene.add(g);
    }
    if (/지하|통로/.test(name)) {
      const water = new THREE.MeshStandardMaterial({ color: 0x0a0c0d, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.85 });
      for (let k = 0; k < 4; k++) {
        const p = new THREE.Mesh(new THREE.CircleGeometry(0.5 + R() * 0.8, 20), water);
        p.rotation.x = -Math.PI / 2;
        p.scale.set(1, 0.6 + R() * 0.6, 1);
        p.position.set(x - 3.5 + R() * 7, 0.01, -3 + R() * 6);
        p.userData.noShadow = true;
        this.scene.add(p);
      }
    }
    if (/통제|관리자/.test(name)) {
      for (let k = 0; k < 3; k++) {
        const canvas = TX.makeCanvas(96, 72);
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: 0xbbbbbb }));
        scr.position.set(x - 2.0 + k * 0.7, 2.1 + (k % 2) * 0.5, -HALF + 0.13);
        scr.userData.noShadow = true;
        this.scene.add(scr);
        this.staticScreens.push({ ctx, tex });
      }
    }
  }

  _decorEgypt(i, x, room) {
    const R = this.R;
    const name = room.name || '';
    const pillarMat = this._mat('pillar', () => TX.pillarTex(25), [2, 1], { bump: 0.06, rough: 0.95 });
    const capMat = this._mat('altar', () => TX.sandstoneWall(33), [0.4, 0.3], { bump: 0.05 });
    for (const [dx, dz] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.45, WALL_H - 0.5, 16), pillarMat);
      p.position.set(x + dx, (WALL_H - 0.5) / 2 + 0.2, dz);
      this.scene.add(p);
      this.occluders.push(p);
      this._box(1.0, 0.2, 1.0, capMat, x + dx, 0.1, dz);
      this._box(1.05, 0.3, 1.05, capMat, x + dx, WALL_H - 0.15, dz);
      this._addCollider(x + dx, dz, 0.48, 0.48);
    }
    // 모래 더미
    const sandMat = this._plain(0xcfae74, 1);
    for (const [dx, dz, sz] of [[-4.3, -1.8, 1.2], [4.2, 2.0, 0.9], [-1.5, 4.4, 1.0]]) {
      const pile = new THREE.Mesh(new THREE.SphereGeometry(sz, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), sandMat);
      pile.scale.set(1, 0.25, 0.8);
      pile.position.set(x + dx, 0, dz);
      this.scene.add(pile);
    }
    // 천장 틈으로 들어오는 빛줄기
    if (i % 2 === 0) {
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.75, WALL_H, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      shaft.position.set(x + 1.2, WALL_H / 2, 0.8);
      this.scene.add(shaft);
    }
    const gold = this._mat('gold', () => TX.goldPattern(26), [1, 1], { rough: 0.3, metal: 0.8 });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.4, metalness: 0.3 });
    const seated = (sx, sz, rotY, scale = 1) => {
      const g = new THREE.Group();
      this._box(0.7, 0.5, 0.9, capMat, 0, 0.25, 0, g);
      this._box(0.55, 0.9, 0.5, capMat, 0, 0.95, -0.15, g);
      this._box(0.45, 0.4, 0.4, capMat, 0, 1.6, -0.15, g);
      const nemes = this._box(0.6, 0.45, 0.5, gold, 0, 1.68, -0.2, g);
      nemes.castShadow = true;
      g.scale.setScalar(scale);
      g.position.set(sx, 0, sz);
      g.rotation.y = rotY;
      this.scene.add(g);
      this._addCollider(sx, sz, 0.45 * scale, 0.5 * scale);
    };
    if (/입구|파라오/.test(name)) {
      seated(x - 2.3, -4.0, 0, 1.15);
      seated(x + 2.3, -4.0, 0, 1.15);
    }
    if (/스핑크스/.test(name)) {
      const g = new THREE.Group();
      this._box(1.4, 0.9, 2.2, capMat, 0, 0.45, 0, g);
      for (const px of [-0.4, 0.4]) this._box(0.3, 0.25, 0.8, capMat, px, 0.12, -1.4, g);
      this._box(0.75, 0.75, 0.7, capMat, 0, 1.3, -0.85, g);
      this._box(0.95, 0.75, 0.6, gold, 0, 1.4, -0.7, g);
      g.position.set(x, 0, 3.4);
      this.scene.add(g);
      this._addCollider(x, 3.2, 0.75, 1.3);
    }
    if (/심판|오시리스/.test(name)) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2.3, 12), new THREE.MeshStandardMaterial({ color: 0xe6e0d0, roughness: 0.7 }));
      body.position.y = 1.15;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), new THREE.MeshStandardMaterial({ color: 0x2c5a3a, roughness: 0.6 }));
      head.position.y = 2.5;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 12), new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.5 }));
      crown.position.y = 2.9;
      g.add(body, head, crown);
      g.position.set(x, 0, 4.25);
      this.scene.add(g);
      this._addCollider(x, 4.25, 0.45, 0.45);
    }
    if (/보물|무덤/.test(name)) {
      const sar = new THREE.Group();
      this._box(2.0, 0.7, 0.8, gold, 0, 0.35, 0, sar).castShadow = true;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.0, 16, 1, false, 0, Math.PI), gold);
      lid.rotation.z = Math.PI / 2;
      lid.rotation.x = -Math.PI / 2;
      lid.position.y = 0.7;
      sar.add(lid);
      sar.position.set(x + 2.6, 0, -2.0);
      this.scene.add(sar);
      this._addCollider(x + 2.6, -2.0, 1.0, 0.4);
      const coinMat = new THREE.MeshStandardMaterial({ color: 0xffcc44, roughness: 0.25, metalness: 0.9 });
      for (const [cx, cz] of [[1.0, -3.0], [-3.0, -0.8]]) {
        const pile = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), coinMat);
        pile.scale.set(1, 0.4, 1);
        pile.position.set(x + cx, 0, cz);
        this.scene.add(pile);
      }
    }
    if (/아누비스/.test(name)) {
      for (const sz of [-2.0, 2.0]) {
        const g = new THREE.Group();
        this._box(0.6, 0.6, 0.6, capMat, 0, 0.3, 0, g);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.3, 12), darkStone);
        body.position.y = 1.25;
        const head = this._box(0.28, 0.3, 0.45, darkStone, 0, 2.05, 0.08, g);
        head.castShadow = true;
        for (const ex of [-0.08, 0.08]) {
          const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 6), darkStone);
          ear.position.set(ex, 2.35, -0.02);
          g.add(ear);
        }
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 6, 16), gold);
        collar.rotation.x = Math.PI / 2;
        collar.position.y = 1.85;
        g.add(body, collar);
        g.position.set(x + 4.1, 0, sz);
        g.rotation.y = -Math.PI / 2;
        this.scene.add(g);
        this._addCollider(x + 4.1, sz, 0.32, 0.32);
      }
    }
    // 카노푸스 항아리
    const jarMat = this._mat('clay', () => TX.clay(29), [2, 1], { rough: 0.85 });
    for (const [dx, dz] of [[-4.3, 4.3], [4.3, -4.3]]) {
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        pts.push(new THREE.Vector2(0.16 + Math.sin(t * Math.PI) * 0.14 - t * 0.05, t * 0.75));
      }
      const jar = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), jarMat);
      jar.position.set(x + dx, 0, dz);
      this.scene.add(jar);
    }
  }

  // ============================================================ 플레이어 / 효과
  _buildHandLight() {
    // 손: 시선을 한 박자 늦게 따라와 빛이 자연스럽게 흔들린다
    this.hand = new THREE.Object3D();
    this.hand.position.copy(this.head.position);
    this.scene.add(this.hand);
    if (this.kind === 'egypt') {
      const l = new THREE.PointLight(0xffa458, 6, 11, 1.7);
      l.position.set(0.35, -0.2, -0.4);
      this.hand.add(l);
      this.handLight = l;
      this.handBase = 6;
      // 손에 든 횃불 불꽃
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._texture('flame', () => TX.flameSprite()), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
      f.scale.set(0.07, 0.14, 1);
      f.position.set(0.36, -0.3, -0.75);
      f.renderOrder = 999;
      this.hand.add(f);
      this.handFlame = f;
    } else {
      const l = new THREE.SpotLight(this.kind === 'study' ? 0xffe6cc : 0xe6efff, this.kind === 'horror' ? 55 : this.kind === 'study' ? 30 : 25, 22, 0.42, 0.55, 1.5);
      l.position.set(0.25, -0.2, 0.1);
      l.target.position.set(0.05, -0.1, -4);
      l.castShadow = this.kind === 'horror' || this.kind === 'study';
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.bias = -0.0006;
      l.shadow.camera.near = 0.2;
      l.shadow.camera.far = 22;
      this.hand.add(l);
      this.hand.add(l.target);
      this.handLight = l;
      this.handBase = l.intensity;
    }
  }

  _buildDust() {
    const n = this.rooms.length;
    const count = (this.kind === 'egypt' ? 700 : 500) * (this.quality === 'low' ? 0.4 : 1);
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = -HALF + Math.random() * n * ROOM_SIZE;
      pos[i * 3 + 1] = 0.2 + Math.random() * (WALL_H - 0.4);
      pos[i * 3 + 2] = -HALF + 0.3 + Math.random() * (ROOM_SIZE - 0.6);
      vel[i * 3] = (Math.random() - 0.5) * 0.06;
      vel[i * 3 + 1] = (Math.random() - 0.6) * 0.03;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: this.kind === 'egypt' ? 0.035 : 0.025,
      color: this.kind === 'egypt' ? 0xffd9a0 : 0xc8ccd0,
      map: this._texture('glow', () => TX.glowSprite()),
      transparent: true,
      opacity: this.kind === 'egypt' ? 0.55 : 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.userData = { vel, noShadow: true };
    this.scene.add(this.dust);
  }

  _buildStalker() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 1 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.45, 4, 10), mat);
    body.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), mat);
    head.position.y = 1.98;
    head.scale.set(0.9, 1.2, 0.9);
    g.add(body, head);
    for (const sx of [-0.27, 0.27]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 1.3, 6), mat);
      arm.position.set(sx, 1.05, 0);
      arm.rotation.z = sx * 0.12;
      g.add(arm);
    }
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a0a, fog: false });
    for (const ex of [-0.055, 0.055]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), eyeMat);
      eye.position.set(ex, 2.0, 0.14);
      g.add(eye);
    }
    g.visible = false;
    this.scene.add(g);
    this.stalker = g;
  }

  _buildSandFall() {
    const count = 400;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new THREE.PointsMaterial({ size: 0.04, color: 0xe8c890, transparent: true, opacity: 0.85, depthWrite: false });
    this.sandFall = new THREE.Points(geo, mat);
    this.sandFall.visible = false;
    this.sandFall.userData = { vel: new Float32Array(count * 3), until: 0, noShadow: true };
    this.scene.add(this.sandFall);
  }

  _finalizeShadows() {
    if (!this.renderer.shadowMap.enabled) return;
    this.scene.traverse((o) => {
      if (!o.isMesh || o.userData.noShadow) return;
      const basic = Array.isArray(o.material) ? false : o.material?.isMeshBasicMaterial;
      if (basic) return;
      o.receiveShadow = true;
      // 작은 소품·평면·인스턴스(책·병)는 그림자를 만들지 않는다 → 그림자 계산량 감소 (팀원 프로젝트 방식)
      if (o.geometry?.type === 'PlaneGeometry' || o.isInstancedMesh || o.material?.transparent) return;
      o.geometry.computeBoundingBox?.();
      const bb = o.geometry.boundingBox;
      if (!bb) return;
      bb.getSize(this._v).multiply(o.getWorldScale(new THREE.Vector3()));
      o.castShadow = Math.max(this._v.x, this._v.y, this._v.z) > 0.35;
    });
  }

  // ============================================================ 상태 반영
  /** @param {import('./engine').EngineRoom[]} rooms */
  setRooms(rooms) {
    rooms.forEach((r, i) => {
      if (this.rooms[i]) this.rooms[i] = { ...this.rooms[i], ...r };
    });
    this._applyStatuses(false);
  }

  _applyStatuses(instant) {
    const accent = new THREE.Color(this.style.accent);
    const allDoors = [...this.doors, this.exitDoor];
    allDoors.forEach((door) => {
      if (!door) return;
      const room = this.rooms[door.index];
      const next = this.rooms[door.index + 1];
      const open = door.isExit ? room?.status === 'cleared' : !!next && next.status !== 'locked';
      if (open && !door.open && !instant) {
        this.audio?.sfx('door');
        this.cb.onCaption?.(this.kind === 'egypt' ? '[돌문이 갈리며 열린다]' : this.kind === 'study' ? '[삐걱 — 낡은 문이 천천히 열린다]' : '[철문이 유압 소리를 내며 열린다]');
        this.addTrauma(this.kind === 'egypt' ? 0.55 : 0.3);
      }
      door.open = open;
      if (instant && door.pivot) door.pivot.rotation.y = open ? 1.45 : 0;
      else if (instant) door.mesh.position.y = open ? -DOOR_H / 2 - 0.05 : DOOR_H / 2;
      door.indicatorMat.emissive.set(open ? 0x22ff55 : 0xff1a10);
    });
    this.rooms.forEach((room, i) => {
      const m = this.markers[i];
      const solved = room.status === 'cleared' || room.puzzle_solved;
      if (m?.kind === 'crt') m.mode = solved ? 'granted' : 'locked';
      if (m?.kind === 'tablet') m.solved = solved;
      if (m?.kind === 'lock') m.mat.emissive.set(solved ? 0x33ff66 : room.status === 'locked' ? 0x331008 : 0xff2a10);
      if (m?.kind === 'plain') m.mat.emissive.set(solved ? 0x33ff66 : room.status === 'locked' ? 0x555555 : accent);
      for (const clue of room.clues || []) {
        const obj = this.clueObjs.get(`${i}:${clue.id}`);
        if (obj) obj.glint.visible = !clue.found;
      }
      const mg = this.minigameObjs[i];
      if (mg && room.minigame) {
        mg.glint.visible = !room.minigame.key_obtained;
        mg.mat.emissive.set(room.minigame.key_used ? 0x33ff66 : room.minigame.key_obtained ? 0x3388ff : this.kind === 'horror' ? 0xff3b10 : 0xffaa00);
      }
    });
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

  /**
   * 포인터 락 재요청. 브라우저 정책상 사용자 입력(클릭, Enter 등) 직후에만 성공한다.
   * @returns {Promise<boolean>}
   */
  lock() {
    if (this.controls.isLocked) return Promise.resolve(true);
    if (!this.inputEnabled) return Promise.resolve(false);
    try {
      const r = this.renderer.domElement.requestPointerLock();
      if (r && typeof r.then === 'function') return r.then(() => true, () => false);
    } catch {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => setTimeout(() => resolve(this.controls.isLocked), 150));
  }

  // ============================================================ 후처리
  _setupComposer(w, h) {
    if (this.quality === 'low') return;
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // 바라보는 물건 외곽선
    const outline = new OutlinePass(new THREE.Vector2(w, h), this.scene, this.camera);
    outline.edgeStrength = 3.2;
    outline.edgeGlow = 0.6;
    outline.edgeThickness = 1.4;
    outline.visibleEdgeColor.set(this.kind === 'egypt' ? 0xffd27a : this.kind === 'study' ? 0xffc27a : 0xcfe8ff);
    outline.hiddenEdgeColor.set(0x222222);
    composer.addPass(outline);
    this.outline = outline;
    if (this.quality === 'high') {
      // 빛번짐: CRT 화면·횃불·비상등
      // 빛번짐은 절반 해상도로 계산 (팀원 프로젝트 방식, 가볍게)
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), this.kind === 'egypt' ? 0.45 : this.kind === 'study' ? 0.3 : 0.6, 0.5, this.kind === 'study' ? 0.9 : 0.82));
      if (this.kind === 'horror') {
        const rgb = new ShaderPass(RGBShiftShader);
        rgb.uniforms.amount.value = 0.0012;
        composer.addPass(rgb);
        this.rgbShift = rgb;
      }
    }
    composer.addPass(new OutputPass());
    // 공포 색보정 (붉은 서재·공포): 채도↓, 붉은 그림자, 비네팅, 필름 노이즈, 심장 박동 맥동
    if (GRADE_PRESETS[this.kind]) {
      this.grade = new ShaderPass(makeGradeShader(GRADE_PRESETS[this.kind]));
      composer.addPass(this.grade);
    }
    this.composer = composer;
  }

  // ============================================================ 핑 (Q)
  _placeMark() {
    const now = performance.now();
    if (now - this._lastMarkAt < 800) return;
    this.head.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.center, this.camera);
    this.raycaster.far = 30;
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    const hit = hits.find((h) => h.object.isMesh && !h.object.userData.isAvatar && !this.stalker?.children.includes(h.object));
    if (!hit) return;
    this._lastMarkAt = now;
    const p = hit.point;
    this.cb.onMark?.([p.x, p.y, p.z]);
  }

  /** 핑 표시 (나 또는 팀원). 6초 뒤 사라짐 */
  addMark(position, name, color = '#ffd54a') {
    const g = new THREE.Group();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._texture('glow', () => TX.glowSprite()), color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    glow.scale.set(0.5, 0.5, 1);
    glow.renderOrder = 998;
    const label = makeLabel(`▼ ${name}`, { color, bg: 'rgba(0,0,0,0.55)', width: 1.1 });
    label.material.depthTest = false;
    label.renderOrder = 999;
    label.position.y = 0.45;
    g.add(glow, label);
    g.position.set(position[0], position[1] + 0.05, position[2]);
    this.scene.add(g);
    // 실제 시각 기준 (백그라운드 탭에서 렌더가 멈췄다 돌아와도 바로 사라지지 않게)
    const now = performance.now() / 1000;
    this.marks.push({ g, glow, until: now + 6, born: now });
    this.audio?.sfx('mark');
  }

  /** 채팅 입력 등으로 키 입력이 끊길 때 눌린 키를 놓은 것으로 처리 */
  releaseKeys() {
    this.keys.clear();
  }

  setSensitivity(v) {
    this.controls.pointerSpeed = clamp(v, 0.1, 3);
  }

  setFov(v) {
    this.baseFov = clamp(v, 55, 100);
  }

  // ============================================================ 원격 플레이어
  /** @param {import('./engine').RemotePlayerInput[]} players */
  updateRemotePlayers(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let g = this.remote.get(p.id);
      if (!g) {
        g = this._makeAvatar(p);
        g.position.set(p.position[0], 0, p.position[2]);
        this.scene.add(g);
        this.remote.set(p.id, g);
      }
      g.userData.dest.set(p.position[0], 0, p.position[2]);
      g.userData.rotation = p.rotation;
    }
    for (const [id, g] of this.remote) {
      if (!seen.has(id)) {
        if (g.userData.light) this._remoteLights = Math.max(0, (this._remoteLights || 1) - 1);
        this.scene.remove(g);
        this._disposeObject(g);
        this.remote.delete(id);
      }
    }
  }

  /** 팀원 캐릭터: 팔다리가 걸음에 맞춰 흔들리고, 손전등(횃불)을 들고 있다. 앞 = -z */
  _makeAvatar(p) {
    const g = new THREE.Group();
    const color = hashColor(p.id);
    const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8c2a8, roughness: 0.7 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.5, 4, 10), cloth);
    torso.position.y = 1.08;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), skin);
    head.position.y = 1.62;
    const limb = (len, r, mat, x, y) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat);
      m.position.y = -len / 2 - r;
      pivot.add(m);
      g.add(pivot);
      return pivot;
    };
    const legL = limb(0.55, 0.075, dark, -0.1, 0.78);
    const legR = limb(0.55, 0.075, dark, 0.1, 0.78);
    const armL = limb(0.45, 0.06, cloth, -0.29, 1.36);
    const armR = limb(0.45, 0.06, cloth, 0.29, 1.36);
    armR.rotation.x = -1.1; // 손전등을 앞으로 든 팔
    g.add(torso, head);
    // 손전등 빛줄기 (보이는 원뿔) + 고사양이면 실제 조명
    const egypt = this.kind === 'egypt';
    const lampColor = egypt ? 0xffa040 : 0xeef4ff;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: lampColor }));
    lamp.position.set(0, -0.62, 0);
    armR.add(lamp);
    if (!egypt) {
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(0.75, 4.5, 18, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.rotation.x = Math.PI; // 꼭짓점이 손 쪽
      beam.position.set(0, -0.62 - 2.25, 0);
      armR.add(beam);
    }
    this._remoteLights = this._remoteLights || 0;
    if (this.quality !== 'low' && this._remoteLights < 3) {
      this._remoteLights += 1;
      const light = egypt ? new THREE.PointLight(0xff9a48, 3, 7, 1.8) : new THREE.SpotLight(0xe6efff, 18, 16, 0.4, 0.5, 1.5);
      light.position.set(0, -0.62, 0);
      armR.add(light);
      if (light.isSpotLight) {
        light.target.position.set(0, -4, 0);
        armR.add(light.target);
      }
      g.userData.light = light;
    }
    const label = makeLabel(p.name, { width: 1.2 });
    label.position.y = 2.05;
    g.add(label);
    g.traverse((o) => (o.userData.isAvatar = true));
    g.userData.dest = new THREE.Vector3();
    g.userData.limbs = { legL, legR, armL, armR };
    g.userData.phase = 0;
    g.userData.speed = 0;
    g.userData.torso = torso;
    g.userData.head = head;
    return g;
  }

  _animateAvatars(dt) {
    for (const g of this.remote.values()) {
      const before = g.position.clone();
      g.position.lerp(g.userData.dest, Math.min(1, dt * 8));
      const moved = before.distanceTo(g.position) / Math.max(dt, 1e-3);
      g.userData.speed += (moved - g.userData.speed) * Math.min(1, dt * 6);
      const sp = g.userData.speed;
      const k = Math.min(1, sp / 3);
      g.userData.phase += dt * sp * 3.2;
      const sw = Math.sin(g.userData.phase) * 0.7 * k;
      const { legL, legR, armL, armR } = g.userData.limbs;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      armL.rotation.x = -sw * 0.8;
      armR.rotation.x = -1.1 + sw * 0.15;
      g.userData.torso.position.y = 1.08 + Math.abs(Math.sin(g.userData.phase)) * 0.04 * k;
      g.userData.head.position.y = 1.62 + Math.abs(Math.sin(g.userData.phase)) * 0.04 * k;
      // 회전은 부드럽게 (최단 경로)
      const target = g.userData.rotation ?? 0;
      let d = target - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += d * Math.min(1, dt * 10);
    }
  }

  // ============================================================ 입력
  _bindEvents() {
    const isTyping = (e) => {
      const t = e.target;
      return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    };
    this._onKeyDown = (e) => {
      if (!this.inputEnabled || isTyping(e)) return;
      this.keys.add(e.code);
      if (!this.controls.isLocked) return;
      if (e.code === 'KeyE' && !e.repeat) this._tryInteract();
      if (e.code === 'KeyF' && !e.repeat) {
        this.handOn = !this.handOn;
        this.audio?.sfx('type');
      }
      if (e.code === 'KeyQ' && !e.repeat) this._placeMark();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    // Chromium 은 포인터 락 직후 비정상적으로 큰 movementX/Y 를 보내는 경우가 있어 시점이 튄다 → 무시
    this._onMouseSpike = (e) => {
      if (this.controls.isLocked && (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250)) e.stopImmediatePropagation();
    };
    this._onClick = () => {
      if (!this.inputEnabled) return;
      if (!this.controls.isLocked) this.lock();
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
    this.composer?.setSize(w, h);
  }

  /** 화면 중앙(조준점)에 있는 상호작용 대상. 벽에 가려지면 null */
  _pickTarget() {
    this.head.updateMatrixWorld(true); // 렌더 전에도 최신 시선 기준으로 판정
    this.raycaster.setFromCamera(this.center, this.camera);
    this.raycaster.far = INTERACT_DIST;
    const hits = this.raycaster.intersectObjects([...this.interactables, ...this.occluders], true);
    this._pickObj = null;
    for (const hit of hits) {
      const target = findTarget(hit.object);
      if (!target) return null;
      let o = hit.object;
      while (o && !o.userData.target) o = o.parent;
      this._pickObj = o;
      if (target.kind === 'door') {
        const door = target.slot < this.doors.length ? this.doors[target.slot] : this.exitDoor;
        if (door?.open) return null;
      }
      return target;
    }
    return null;
  }

  _tryInteract() {
    const target = this._pickTarget();
    if (!target) return;
    this.cb.onInteract?.({ ...target });
  }

  // ============================================================ 루프
  _loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    const playing = this.controls.isLocked && this.inputEnabled;

    if (playing) this._move(dt);
    else {
      this.vel.multiplyScalar(Math.exp(-dt * 10));
      this.bobAmp *= Math.exp(-dt * 6);
      this.lean *= Math.exp(-dt * 6);
    }

    // 이벤트 (공포: 정전, 이집트: 지진)
    if (t > this.nextEventAt) {
      if (playing) this._triggerEvent(t);
      this.nextEventAt = t + (playing ? 45 + this.R() * 40 : 10);
    }

    // 문 (바닥으로 내려가며 열림)
    for (const door of [...this.doors, this.exitDoor]) {
      if (!door) continue;
      if (door.pivot) {
        const rt = door.open ? 1.45 : 0;
        door.pivot.rotation.y += (rt - door.pivot.rotation.y) * Math.min(1, dt * 1.6);
        continue;
      }
      const target = door.open ? -DOOR_H / 2 - 0.05 : DOOR_H / 2;
      door.mesh.position.y += (target - door.mesh.position.y) * Math.min(1, dt * (this.kind === 'egypt' ? 1.2 : 2.5));
    }

    this._updateLights(t, dt);
    this.vaultCameras[this.currentSlot]?.lookAt(this.head.position);
    if (this.study) {
      this.study.update(dt, t, Math.max(0, this.currentSlot), playing);
      this.hemi.intensity = this.cfg.hemi * (this.blackoutUntil > t ? 0.35 : 1) + this.study.lightning * 3.5; // 번개 칠 때 방이 번쩍
    }

    for (const b of this.blinkers) b.mat.emissiveIntensity = 0.6 + 0.8 * (Math.sin(t * b.speed + b.phase) > -0.2 ? 1 : 0.2);
    for (const s of this.swingers) s.obj.rotation.z = Math.sin(t * s.speed) * s.amp;
    for (const gl of this.glints) {
      const p = 0.5 + 0.5 * Math.sin(t * 2.2 + gl.userData.phase);
      gl.material.opacity = this.kind === 'horror' ? 0.1 + 0.6 * p * p : 0.3 + 0.5 * p;
      gl.position.y = gl.userData.baseY + Math.sin(t * 1.5 + gl.userData.phase) * 0.04;
    }

    // 먼지
    const dp = this.dust.geometry.attributes.position;
    const dv = this.dust.userData.vel;
    const maxX = this.rooms.length * ROOM_SIZE - HALF;
    for (let i = 0; i < dp.count; i++) {
      let x = dp.array[i * 3] + dv[i * 3] * dt;
      let y = dp.array[i * 3 + 1] + dv[i * 3 + 1] * dt + Math.sin(t * 0.4 + i) * 0.0008;
      let z = dp.array[i * 3 + 2] + dv[i * 3 + 2] * dt;
      if (y < 0.1) y = WALL_H - 0.2;
      if (y > WALL_H - 0.1) y = 0.2;
      if (x < -HALF) x = maxX;
      if (x > maxX) x = -HALF;
      if (z < -HALF + 0.2 || z > HALF - 0.2) z = (Math.random() - 0.5) * 8;
      dp.array[i * 3] = x;
      dp.array[i * 3 + 1] = y;
      dp.array[i * 3 + 2] = z;
    }
    dp.needsUpdate = true;

    if (this.sandFall?.visible) this._updateSandFall(t, dt);

    // 화면 갱신 (CRT / CCTV)
    this._screenTimer += dt;
    if (this._screenTimer > 0.12) {
      this._screenTimer = 0;
      for (const m of Object.values(this.markers)) {
        if (m?.kind !== 'crt') continue;
        TX.drawCRT(m.ctx, m.canvas.width, m.canvas.height, t, this.blackoutUntil > t && Math.random() < 0.5 ? 'denied' : m.mode, m.title);
        m.tex.needsUpdate = true;
      }
      for (const m of this.markers) if (m?.kind === 'tablet') m.mat.emissiveIntensity = m.solved ? 2.4 : 0.7 + 0.35 * Math.sin(t * 2);
    }
    this._staticTimer += dt;
    if (this._staticTimer > 0.08 && this.staticScreens.length) {
      this._staticTimer = 0;
      for (const s of this.staticScreens) {
        TX.drawStatic(s.ctx, 96, 72);
        s.tex.needsUpdate = true;
      }
    }

    // 배전반 스파크
    if (this.sparkObj && t > this.sparkObj.next) {
      this.sparkObj.next = t + 2 + this.R() * 5;
      const p = this.sparkObj.group.position;
      if (Math.hypot(p.x - this.head.position.x, p.z - this.head.position.z) < 6) {
        this.audio?.sfx('spark');
        this.cb.onCaption?.('[배전반에서 전기가 튄다]');
      }
    }

    // 원격 플레이어
    this._animateAvatars(dt);

    // 핑 표시
    const wall = performance.now() / 1000;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mk = this.marks[i];
      const age = wall - mk.born;
      const pulse = 0.45 + 0.15 * Math.sin(age * 8);
      mk.glow.scale.set(pulse, pulse, 1);
      mk.g.children.forEach((c) => (c.material.opacity = Math.min(1, (mk.until - wall) / 1.2)));
      if (wall > mk.until) {
        this.scene.remove(mk.g);
        mk.g.children.forEach((c) => c.material.dispose());
        this.marks.splice(i, 1);
      }
    }

    // FPS
    this._fpsFrames += 1;
    if (t - (this._fpsAt ?? 0) >= 1) {
      this.cb.onFps?.(Math.round(this._fpsFrames / Math.max(0.001, t - (this._fpsAt ?? t - 1))));
      this._fpsAt = t;
      this._fpsFrames = 0;
    }

    // 조준 대상
    if (this.controls.isLocked) {
      const focus = this._pickTarget();
      const key = focus ? `${focus.kind}:${focus.slot}:${focus.id ?? ''}` : null;
      if (key !== this.focusKey) {
        this.focusKey = key;
        if (this.outline) this.outline.selectedObjects = focus && this._pickObj ? [this._pickObj] : [];
        this.cb.onFocusChange?.(focus ? { ...focus } : null);
      }
    } else if (this.focusKey !== null) {
      this.focusKey = null;
      if (this.outline) this.outline.selectedObjects = [];
      this.cb.onFocusChange?.(null);
    }

    this._updateBody(dt, t, playing);
    if (this.torchModel) {
      this._euler.setFromQuaternion(this.head.quaternion, 'YXZ');
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.torchModel.update(dt, { visible: this.handOn, walking: sp > 0.4, yaw: this._euler.y, pitch: this._euler.x, level: this.handLight ? this.handLight.intensity / this.handBase : 1 });
    }
    // 심장 박동: 시간이 얼마 안 남으면 화면 가장자리가 박동에 맞춰 조여 온다 (팀원 프로젝트)
    if (this.lowTime > 0 && playing) {
      const period = this.lowTime > 1 ? 0.6 : 0.95;
      if (t % period < dt) this._pulse = Math.max(this._pulse, 0.35);
    }
    this._pulse = Math.max(0, this._pulse - dt * 1.2);
    if (this.grade) {
      this.grade.uniforms.time.value = t;
      this.grade.uniforms.pulse.value = Math.max(this._pulse, this.trauma * 0.6);
    }
    // 움직이거나 빠르게 도는 동안엔 외곽선 계산(장면을 한 번 더 그림)을 쉰다 (팀원 프로젝트)
    if (this.outline) this.outline.enabled = Math.hypot(this.vel.x, this.vel.z) < 0.3 && Math.abs(this.turnRoll) < 0.02;
    if (this.dynamicRes) this._autoResolution(dt);
    if (this.rgbShift) this.rgbShift.uniforms.amount.value = 0.0012 + this.trauma * 0.006 + (this.blackoutUntil > t ? 0.004 : 0);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  _updateLights(t, dt) {
    const blackout = this.blackoutUntil > t;
    for (const rl of this.roomLights) {
      let level = 1;
      if (rl.pattern === 'flicker' || rl.pattern === 'dying') {
        const f = rl.flick;
        if (t > f.next) {
          f.until = t + 0.04 + this.R() * (rl.pattern === 'dying' ? 0.5 : 0.15);
          f.next = t + (rl.pattern === 'dying' ? 0.3 + this.R() * 1.5 : 1.5 + this.R() * 5);
        }
        if (t < f.until) level = this.R() < 0.5 ? 0.05 : 0.4;
      } else if (rl.pattern === 'buzz') {
        level = 0.85 + 0.15 * Math.sin(t * 50);
      }
      if (blackout) level = 0;
      rl.light.intensity = rl.base * level;
      for (const m of rl.tubes) m.emissiveIntensity = 2.4 * level;
      if (rl.beacon) {
        const p = Math.max(0, Math.sin(t * 2.2 + rl.beacon.phase));
        const v = (blackout ? 1.6 : 1) * p * p;
        rl.beacon.light.intensity = 6 * v;
        rl.beacon.mat.emissiveIntensity = 3 * v;
      }
    }
    const dip = this.torchDipUntil > t ? 0.25 : 1;
    for (const tc of this.torches) {
      const n = 0.78 + 0.12 * Math.sin(t * 9 + tc.phase) + 0.1 * Math.sin(t * 23 + tc.phase * 2);
      tc.light.intensity = tc.base * n * dip;
      tc.flames.forEach((f, k) => {
        f.scale.set(0.3 + 0.05 * Math.sin(t * 13 + k + tc.phase), (0.55 + 0.12 * Math.sin(t * 17 + k * 2 + tc.phase)) * (dip < 1 ? 0.5 : 1), 1);
        f.material.opacity = (0.75 + 0.25 * Math.sin(t * 21 + k)) * (dip < 1 ? 0.5 : 1);
      });
    }
    // 손전등 / 손 횃불
    if (this.handLight) {
      let v = this.handOn ? 1 : 0;
      if ((this.kind === 'horror' || this.kind === 'study') && this.handOn) {
        if (blackout && t < this.blackoutUntil - 0.6) v = Math.random() < 0.5 ? 0 : 1;
        else if (Math.random() < 0.004) v = 0.3;
      }
      if (this.kind === 'egypt') v *= (0.85 + 0.1 * Math.sin(t * 11) + 0.05 * Math.sin(t * 27)) * dip;
      this.handLight.intensity = this.handBase * v;
      if (this.handFlame) this.handFlame.visible = this.handOn;
    }
    if (this.stalker?.visible && t > this.stalkerHideAt) this.stalker.visible = false;
  }

  _triggerEvent(t) {
    const cam = this.head.position;
    if (this.kind === 'study') {
      // 촛불·샹들리에가 한꺼번에 꺼지고, 어둠 속에 형체가 섰다가 사라진다 + 속삭임
      const sec = 1.4 + this.R() * 0.6;
      this.blackoutUntil = t + sec;
      this.study.blackout(sec);
      this._showStalker(cam, sec);
      this.addTrauma(0.75);
      this.fovPunch = 8;
      this.audio?.sfx('scare');
      this.cb.onCaption?.(this.study.whisper());
      this.cb.onScare?.('blackout');
      return;
    }
    if (this.kind === 'horror') {
      this.blackoutUntil = t + 1.2 + this.R() * 0.6;
      this.stalkerHideAt = this.blackoutUntil + 0.15;
      // 플레이어 정면 5m 지점 (현재 방 안으로 제한)
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.head.quaternion);
      fwd.y = 0;
      fwd.normalize();
      const slot = clamp(Math.floor((cam.x + HALF) / ROOM_SIZE), 0, this.rooms.length - 1);
      const rx = slot * ROOM_SIZE;
      const sx = clamp(cam.x + fwd.x * 5, rx - HALF + 0.6, rx + HALF - 0.6);
      const sz = clamp(cam.z + fwd.z * 5, -HALF + 0.6, HALF - 0.6);
      this.stalker.position.set(sx, 0, sz);
      this.stalker.lookAt(cam.x, 0, cam.z);
      this.stalker.visible = true;
      this.addTrauma(0.85);
      this.fovPunch = 9; // 순간적으로 시야가 좁아진다
      this.audio?.sfx('scare');
      this.cb.onCaption?.('[전등이 꺼진다 — 가까이서 무언가 숨 쉬는 소리]');
      this.cb.onScare?.('blackout');
    } else if (this.kind === 'egypt') {
      this.addTrauma(0.9);
      this.rumbleUntil = t + 1.8;
      this.torchDipUntil = t + 1.6;
      this._spawnSand(cam.x + (this.R() - 0.5) * 2, cam.z + (this.R() - 0.5) * 2, t);
      this.audio?.sfx('rumble');
      this.cb.onCaption?.('[무덤 전체가 흔들리고 모래가 쏟아진다]');
      this.cb.onScare?.('rumble');
    }
  }

  _showStalker(cam, sec) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.head.quaternion);
    fwd.y = 0;
    fwd.normalize();
    const slot = clamp(Math.floor((cam.x + HALF) / ROOM_SIZE), 0, this.rooms.length - 1);
    const rx = slot * ROOM_SIZE;
    this.stalker.position.set(clamp(cam.x + fwd.x * 5, rx - HALF + 0.6, rx + HALF - 0.6), 0, clamp(cam.z + fwd.z * 5, -HALF + 0.6, HALF - 0.6));
    this.stalker.lookAt(cam.x, 0, cam.z);
    this.stalker.visible = true;
    this.stalkerHideAt = this.clock.elapsedTime + sec + 0.15;
  }

  /** 창밖 번개 (붉은 서재) */
  _onLightning() {
    this.audio?.sfx('thunder');
    this.addTrauma(0.12);
    this.cb.onCaption?.('[창밖에 번개가 친다 — 천둥]');
  }

  /** 액자 귀신이 튀어나옴 (붉은 서재) */
  _onGhost() {
    this.audio?.sfx('scare');
    this.addTrauma(0.9);
    this.fovPunch = 10;
    this.cb.onCaption?.('[액자 속에서 무언가가 튀어나왔다]');
    this.cb.onScare?.('ghost');
  }

  /** 자동 해상도: 1.5초 평균 FPS 가 48 미만이면 해상도 배율을 낮추고, 58 초과면 올린다 */
  _autoResolution(dt) {
    this._qCooldown -= dt;
    if (this._qCooldown > 0) return;
    this._qTime += dt;
    this._qFrames++;
    if (this._qTime < 1.5) return;
    const fps = this._qFrames / this._qTime;
    this._qTime = 0;
    this._qFrames = 0;
    const min = Math.max(0.5, this.maxPixelRatio * 0.5);
    let next = this.pixelRatio;
    if (fps < 48 && this.pixelRatio > min) next = Math.max(min, this.pixelRatio - 0.15);
    else if (fps > 58 && this.pixelRatio < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      if (this.composer) {
        this.composer.setPixelRatio(next);
        this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
      }
      this._qCooldown = 1;
      this.cb.onResolution?.(next / this.maxPixelRatio);
    }
  }

  /** 남은 시간 경고 단계 (0 = 없음, 1 = 5분 이하, 2 = 1분 이하) → 화면 맥동 */
  setLowTime(level) {
    this.lowTime = level;
  }

  setDynamicRes(on) {
    this.dynamicRes = !!on;
    if (!on && this.pixelRatio !== this.maxPixelRatio) {
      this.pixelRatio = this.maxPixelRatio;
      this.renderer.setPixelRatio(this.pixelRatio);
      if (this.composer) {
        this.composer.setPixelRatio(this.pixelRatio);
        this.composer.setSize(this.container.clientWidth, this.container.clientHeight);
      }
    }
  }

  _spawnSand(x, z, t) {
    const sf = this.sandFall;
    const p = sf.geometry.attributes.position;
    const v = sf.userData.vel;
    for (let i = 0; i < p.count; i++) {
      p.array[i * 3] = x + (Math.random() - 0.5) * 1.6;
      p.array[i * 3 + 1] = WALL_H - 0.05 - Math.random() * 0.8;
      p.array[i * 3 + 2] = clamp(z + (Math.random() - 0.5) * 1.6, -HALF + 0.2, HALF - 0.2);
      v[i * 3] = (Math.random() - 0.5) * 0.3;
      v[i * 3 + 1] = -Math.random() * 1.5;
      v[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }
    p.needsUpdate = true;
    sf.userData.until = t + 3;
    sf.visible = true;
  }

  _updateSandFall(t, dt) {
    const sf = this.sandFall;
    if (t > sf.userData.until) {
      sf.visible = false;
      return;
    }
    const p = sf.geometry.attributes.position;
    const v = sf.userData.vel;
    for (let i = 0; i < p.count; i++) {
      v[i * 3 + 1] -= 6 * dt;
      p.array[i * 3] += v[i * 3] * dt;
      p.array[i * 3 + 1] = Math.max(0.01, p.array[i * 3 + 1] + v[i * 3 + 1] * dt);
      p.array[i * 3 + 2] += v[i * 3 + 2] * dt;
    }
    p.needsUpdate = true;
  }

  _blocked(x, z) {
    const r = PLAYER_R;
    return this.colliders.some((c) => x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r);
  }

  _move(dt) {
    const fwd = this._v.set(0, 0, -1).applyQuaternion(this.head.quaternion);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const wish = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, r);
    const moving = wish.lengthSq() > 0;
    const crouching = k.has('KeyC');
    const wantRun = (k.has('ShiftLeft') || k.has('ShiftRight')) && moving && f > 0 && !crouching;

    // 스태미나: 달리면 줄고, 바닥나면 한동안 못 달리며 숨이 가빠진다
    const wasExhausted = this.exhausted;
    if (wantRun && !this.exhausted) {
      this.stamina = Math.max(0, this.stamina - dt * 0.17);
      this.staminaCooldown = 0.9;
      if (this.stamina === 0) this.exhausted = true;
    } else {
      this.staminaCooldown -= dt;
      if (this.staminaCooldown <= 0) this.stamina = Math.min(1, this.stamina + dt * (moving ? 0.09 : 0.16));
      if (this.exhausted && this.stamina > 0.4) this.exhausted = false;
    }
    const running = wantRun && !this.exhausted;
    if ((this.exhausted || this.stamina < 0.25) && performance.now() > this._breathAt) {
      this._breathAt = performance.now() + (this.exhausted ? 850 : 1300);
      this.audio?.sfx('breath');
    }
    if (Math.abs(this.stamina - this._lastStamina) > 0.03 || wasExhausted !== this.exhausted || (this.stamina === 1 && this._lastStamina !== 1)) {
      this._lastStamina = this.stamina;
      this.cb.onStamina?.(this.stamina, this.exhausted);
    }

    // 관성: 서서히 출발하고 서서히 멈춘다
    const speed = SPEED * (running ? 1.75 : 1) * (crouching ? 0.5 : 1) * (this.exhausted ? 0.72 : 1);
    if (moving) wish.normalize().multiplyScalar(speed);
    const accel = 1 - Math.exp(-dt * (moving ? 9 : 7));
    this.vel.x += (wish.x - this.vel.x) * accel;
    this.vel.z += (wish.z - this.vel.z) * accel;
    if (!moving && this.vel.lengthSq() < 0.0004) this.vel.set(0, 0, 0);

    // 옆걸음 기울기
    this.lean += (-r * 0.022 - this.lean) * Math.min(1, dt * 6);

    const pos = this.head.position;
    const n = this.rooms.length;
    let nx = clamp(pos.x + this.vel.x * dt, -HALF + PLAYER_R, n * ROOM_SIZE - HALF - PLAYER_R);
    let nz = clamp(pos.z + this.vel.z * dt, -HALF + PLAYER_R, HALF - PLAYER_R);

    // 칸막이 충돌: 문이 열려 있고 문틀 안쪽일 때만 통과
    const band = PLAYER_R + WALL_T / 2;
    const gap = DOOR_W / 2 - PLAYER_R;
    for (const door of this.doors) {
      const wx = door.wx;
      if (Math.abs(nx - wx) >= band) continue;
      const passable = door.open && Math.abs(nz) < gap;
      if (passable) continue;
      if (Math.abs(pos.x - wx) < band) {
        nz = clamp(nz, -gap, gap);
        if (!door.open) nx = pos.x;
      } else {
        nx = pos.x;
      }
    }
    // 소품 충돌 (이미 겹쳐 있으면 빠져나갈 수 있게 무시)
    if (!this._blocked(pos.x, pos.z)) {
      if (this._blocked(nx, pos.z)) nx = pos.x;
      if (this._blocked(nx, nz)) nz = pos.z;
    }
    // 막힌 방향의 속도는 버린다 (벽에 붙어 미끄러지기)
    if (Math.abs(nx - pos.x) < 1e-6 && Math.abs(this.vel.x) > 0.05) this.vel.x = 0;
    if (Math.abs(nz - pos.z) < 1e-6 && Math.abs(this.vel.z) > 0.05) this.vel.z = 0;

    // 걸음: 실제 속도에 비례해 흔들림과 발소리 주기가 정해진다
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const ratio = sp / SPEED;
    this.bobAmp += (Math.min(1.5, ratio) - this.bobAmp) * Math.min(1, dt * 8);
    this.bob += dt * 6.4 * ratio;
    const sign = Math.sin(this.bob) >= 0 ? 1 : -1;
    if (sign !== this.lastStepSign) {
      this.lastStepSign = sign;
      if (sp > 0.4) {
        this.audio?.sfx('step', { pan: sign * 0.2, soft: crouching, heavy: running });
        this.stepDip = running ? 0.032 : crouching ? 0.008 : 0.017;
      }
    }
    pos.x = nx;
    pos.z = nz;
    this._emitMove(false);
  }

  /** 카메라 흔들림·기울기·숨쉬기·시야각·손 지연 (매 프레임) */
  _updateBody(dt, t, playing) {
    const m = this.motion;
    const cam = this.camera;

    // 웅크리기
    const crouchTarget = playing && this.keys.has('KeyC') ? 1 : 0;
    this.crouch += (crouchTarget - this.crouch) * Math.min(1, dt * 8);
    this.head.position.y = EYE_H - 0.62 * this.crouch;

    // 숨쉬기 (지칠수록 크고 빠르게)
    const tired = this.exhausted ? 1 : Math.max(0, 0.35 - this.stamina) / 0.35;
    const br = 1 + tired * 2.6;
    const breathY = Math.sin(t * (1.3 + tired * 1.7)) * 0.006 * br;
    const breathPitch = Math.sin(t * (0.65 + tired * 0.9) + 1) * 0.0025 * br;

    // 걸음 흔들림: 위아래(두 걸음에 두 번) + 좌우(두 걸음에 한 번) + 살짝 기울기
    const amp = this.bobAmp;
    const bobY = (Math.abs(Math.sin(this.bob)) * 0.055 - 0.03) * amp;
    const bobX = Math.cos(this.bob) * 0.026 * amp;
    const bobRoll = Math.cos(this.bob) * 0.011 * amp;
    const bobPitch = Math.abs(Math.sin(this.bob)) * 0.006 * amp;
    this.stepDip *= Math.exp(-dt * 14);

    // 빠르게 돌면 몸이 반대로 살짝 기운다
    this._euler.setFromQuaternion(this.head.quaternion, 'YXZ');
    const yaw = this._euler.y;
    if (this._prevYaw !== null && dt > 0) {
      let d = yaw - this._prevYaw;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      const target = clamp((-d / dt) * 0.01, -0.045, 0.045);
      this.turnRoll += (target - this.turnRoll) * Math.min(1, dt * 5);
    }
    this._prevYaw = yaw;

    // 충격 흔들림 (trauma² 비례, 부드러운 노이즈)
    this.trauma = Math.max(this.rumbleUntil > t ? 0.5 : 0, this.trauma - dt * 0.9);
    const sh = this.trauma * this.trauma * Math.max(m, 0.25);
    const nz = (fr, o) => Math.sin(t * fr + o) * 0.6 + Math.sin(t * fr * 2.3 + o * 1.7) * 0.4;

    cam.position.set(bobX * m + sh * 0.05 * nz(29, 2), (bobY - this.stepDip) * m + breathY + sh * 0.05 * nz(31, 5), 0);
    cam.rotation.set(
      breathPitch + bobPitch * m + sh * 0.035 * nz(23, 1),
      sh * 0.035 * nz(19, 4),
      (bobRoll + this.lean + this.turnRoll) * m + sh * 0.05 * nz(17, 7),
    );

    // 시야각: 달릴 때 넓어지고, 놀라면 순간 좁아진다
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const runKick = sp > SPEED * 1.25 ? 7 : 0;
    this.fovPunch *= Math.exp(-dt * 2.5);
    const targetFov = this.baseFov + runKick * m - this.fovPunch - this.crouch * 2;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 5);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // 손(손전등·횃불)이 시선을 한 박자 늦게 따라온다
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.hand.position);
    cam.getWorldQuaternion(this._q);
    this.hand.quaternion.slerp(this._q, 1 - Math.exp(-dt * (m > 0.5 ? 8 : 20)));
  }

  addTrauma(v) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  /** 화면 흔들림 강도 (0 = 최소, 1 = 기본) */
  setMotion(v) {
    this.motion = clamp(v, 0, 1);
  }

  _emitMove(force) {
    const pos = this.head.position;
    const slot = clamp(Math.floor((pos.x + HALF) / ROOM_SIZE), 0, this.rooms.length - 1);
    if (slot !== this.currentSlot) {
      this.currentSlot = slot;
      this.cb.onRoomChange?.(slot);
    }
    const now = performance.now();
    if (!force && now - this.lastMoveSent < MOVE_SEND_MS) return;
    const euler = new THREE.Euler().setFromQuaternion(this.head.quaternion, 'YXZ');
    const key = `${pos.x.toFixed(2)},${pos.z.toFixed(2)},${euler.y.toFixed(2)}`;
    if (!force && key === this._lastMoveKey) return;
    this._lastMoveKey = key;
    this.lastMoveSent = now;
    this.cb.onMove?.({ position: [pos.x, EYE_H, pos.z], rotation: euler.y, slot });
  }

  // ============================================================ 정리
  _disposeObject(obj) {
    obj.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => {
        m.map?.dispose?.();
        m.bumpMap?.dispose?.();
        m.emissiveMap?.dispose?.();
        m.dispose?.();
      });
    });
  }

  dispose() {
    this.disposed = true;
    this.composer?.dispose?.();
    this.outline?.dispose?.();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mousemove', this._onMouseSpike, true);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.renderer.domElement.removeEventListener('click', this._onClick);
    this._resizeObserver?.disconnect();
    this.controls.unlock();
    this.controls.dispose();
    this._disposeObject(this.scene);
    for (const t of this._texCache.values()) t.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (import.meta.env?.DEV && window.__escapeEngine === this) window.__escapeEngine = undefined;
  }
}
