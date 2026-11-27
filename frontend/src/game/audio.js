// =====================================================================
// GameAudio — Web Audio API 로 실시간 합성하는 배경음 / 효과음 (음원 파일 없음)
//   horror: 저주파 드론, 형광등 웅웅거림, 멀리서 쿵/물방울/속삭임/삐걱임, 심장 박동
//   study : 빗소리, 괘종시계 째깍임, 벽난로 타닥임, 낮은 현악풍 드론, 멀리서 문 두드리는 소리, 천둥 (리빌딩)
//   egypt : 바람, 횃불 타닥임, 낮은 합창풍 드론, 돌 갈리는 소리, 모래 흘러내림
// 브라우저 정책상 사용자 클릭 이후에 start() 를 호출해야 소리가 난다.
// =====================================================================

const MASTER = 0.9;

export class GameAudio {
  constructor(kind = 'horror') {
    this.kind = kind;
    this.ctx = null;
    this.muted = false;
    this.timers = new Set();
    this.tension = 0;
    this._heartOn = false;
    this.volumes = { master: 1, ambience: 1, sfx: 1 };
    /** 소리 자막 콜백 (설정에서 켰을 때 Game 이 연결) */
    this.onCaption = null;
  }

  /** @param {{ master?: number, ambience?: number, sfx?: number }} v */
  setVolumes(v) {
    this.volumes = { ...this.volumes, ...v };
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER * this.volumes.master, now, 0.08);
    this.amb.gain.setTargetAtTime(Math.max(0.0001, this.volumes.ambience), now, 0.08);
    this.fx.gain.setTargetAtTime(this.volumes.sfx, now, 0.08);
  }

  _caption(text) {
    this.onCaption?.(text);
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER * this.volumes.master;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(c.destination);
    this.amb = c.createGain();
    this.amb.gain.value = 0.0001;
    this.amb.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volumes.ambience), c.currentTime + 4);
    this.amb.connect(this.master);
    this.fx = c.createGain();
    this.fx.gain.value = this.volumes.sfx;
    this.fx.connect(this.master);
    this.noiseBuf = this._noiseBuffer(3);

    if (this.kind === 'egypt') this._egyptAmbience();
    else if (this.kind === 'horror') this._horrorAmbience();
    else if (this.kind === 'study') this._studyAmbience();
    else this._neutralAmbience();
    this._scheduleRandom();
    if (this.tension > 0) this._heartbeat();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : MASTER * this.volumes.master, this.ctx.currentTime, 0.08);
  }

  /** 0~1 : 남은 시간이 적을수록 심장 박동이 빨라진다 */
  setTension(level) {
    this.tension = Math.max(0, Math.min(1, level));
    if (this.tension > 0 && this.ctx && !this._heartOn) this._heartbeat();
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this._heartOn = false;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  // ---------------------------------------------------------------- 기본 도구
  _later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.ctx) fn();
    }, ms);
    this.timers.add(id);
  }

  _noiseBuffer(sec) {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _noise(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    if (!loop) s.loopStart = Math.random();
    return s;
  }

  _panner(pan) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
    if (p.pan) p.pan.value = pan;
    return p;
  }

  /** 짧은 노이즈 효과음 */
  _burst({ freq = 800, q = 1, type = 'lowpass', gain = 0.2, attack = 0.005, decay = 0.2, pan = 0, sweepTo, delay = 0, dest } = {}) {
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const src = this._noise();
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + attack + decay);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    const p = this._panner(pan);
    src.connect(f).connect(g).connect(p).connect(dest || this.fx);
    src.start(t0, Math.random() * 2);
    src.stop(t0 + attack + decay + 0.05);
  }

  /** 짧은 음 (오실레이터) */
  _tone({ type = 'sine', f0 = 440, f1, gain = 0.1, attack = 0.005, decay = 0.3, pan = 0, delay = 0, dest } = {}) {
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + attack + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    const p = this._panner(pan);
    o.connect(g).connect(p).connect(dest || this.fx);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
  }

  _lfo(freq, depth, target) {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    return o;
  }

  // ---------------------------------------------------------------- 배경음
  _horrorAmbience() {
    const c = this.ctx;
    // 저주파 드론
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    lp.Q.value = 3;
    const dg = c.createGain();
    dg.gain.value = 0.07;
    lp.connect(dg).connect(this.amb);
    for (const [type, f] of [['sawtooth', 46], ['sawtooth', 46.7], ['sine', 23]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    this._lfo(0.06, 70, lp.frequency);
    // 형광등 웅웅거림
    const hum = c.createOscillator();
    hum.frequency.value = 120;
    const hg = c.createGain();
    hg.gain.value = 0.008;
    hum.connect(hg).connect(this.amb);
    hum.start();
    const buzz = this._noise(true);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 12;
    const bg = c.createGain();
    bg.gain.value = 0.006;
    buzz.connect(bp).connect(bg).connect(this.amb);
    buzz.start();
    // 공간 잔향 노이즈
    const room = this._noise(true);
    const rl = c.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 260;
    const rg = c.createGain();
    rg.gain.value = 0.03;
    room.connect(rl).connect(rg).connect(this.amb);
    room.start();
  }

  _studyAmbience() {
    const c = this.ctx;
    // 창밖 빗소리: 넓은 대역의 쏴아 + 낮은 웅웅거림
    const rain = this._noise(true);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    const rg = c.createGain();
    rg.gain.value = 0.035;
    rain.connect(hp).connect(lp).connect(rg).connect(this.amb);
    rain.start();
    this._lfo(0.07, 0.012, rg.gain);
    const rumble = this._noise(true);
    const rl = c.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 180;
    const rgl = c.createGain();
    rgl.gain.value = 0.03;
    rumble.connect(rl).connect(rgl).connect(this.amb);
    rumble.start();
    // 낮은 현악풍 드론 (단조)
    for (const f of [55, 65.4, 82.4]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = 0.01;
      o.connect(g).connect(this.amb);
      o.start();
      this._lfo(0.05 + Math.random() * 0.05, 0.006, g.gain);
    }
    // 괘종시계 째깍 (틱-톡)
    let tick = 0;
    const clock = () => {
      this._burst({ type: 'bandpass', freq: tick % 2 ? 2100 : 2600, q: 8, gain: 0.03, decay: 0.03, pan: -0.4, dest: this.amb });
      tick++;
      this._later(clock, 1000);
    };
    clock();
    // 벽난로 타닥임 (작게)
    const crackle = () => {
      if (Math.random() < 0.5) this._burst({ type: 'highpass', freq: 1800, gain: 0.008 + Math.random() * 0.02, decay: 0.02 + Math.random() * 0.03, pan: 0.5, dest: this.amb });
      this._later(crackle, 80 + Math.random() * 260);
    };
    crackle();
  }

  _thunder(pan = 0, near = true) {
    this._burst({ type: 'highpass', freq: 1200, gain: near ? 0.2 : 0.06, attack: 0.005, decay: 0.35, pan });
    this._burst({ type: 'lowpass', freq: 140, gain: near ? 0.55 : 0.25, attack: 0.08, decay: 3.2, pan, delay: near ? 0.15 : 0.6 });
    this._tone({ f0: 45, f1: 28, gain: near ? 0.25 : 0.1, attack: 0.1, decay: 2.5, delay: 0.2 });
  }

  _knock(pan) {
    for (let i = 0; i < 3; i++) {
      this._burst({ type: 'lowpass', freq: 420, gain: 0.22, decay: 0.12, pan, delay: i * 0.32 });
      this._tone({ f0: 110, f1: 70, gain: 0.12, decay: 0.1, pan, delay: i * 0.32 });
    }
  }

  _egyptAmbience() {
    const c = this.ctx;
    // 바람
    const wind = this._noise(true);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.9;
    const wg = c.createGain();
    wg.gain.value = 0.05;
    wind.connect(bp).connect(wg).connect(this.amb);
    wind.start();
    this._lfo(0.05, 320, bp.frequency);
    this._lfo(0.11, 0.025, wg.gain);
    // 낮은 합창풍 드론 (프리지안 느낌)
    for (const f of [73.4, 110, 116.5, 146.8]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = 0.012;
      o.connect(g).connect(this.amb);
      o.start();
      this._lfo(0.07 + Math.random() * 0.08, 0.008, g.gain);
    }
    // 횃불 타닥임
    const crackle = () => {
      if (Math.random() < 0.6) this._burst({ type: 'highpass', freq: 2200, gain: 0.01 + Math.random() * 0.035, decay: 0.02 + Math.random() * 0.03, pan: (Math.random() - 0.5) * 1.4, dest: this.amb });
      this._later(crackle, 50 + Math.random() * 180);
    };
    crackle();
  }

  _neutralAmbience() {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.value = 55;
    const g = c.createGain();
    g.gain.value = 0.02;
    o.connect(g).connect(this.amb);
    o.start();
  }

  _scheduleRandom() {
    const next = () => {
      if (!this.ctx) return;
      const pan = (Math.random() - 0.5) * 1.8;
      const pick = Math.random();
      const side = pan < -0.3 ? '왼쪽에서 ' : pan > 0.3 ? '오른쪽에서 ' : '';
      if (this.kind === 'horror') {
        if (pick < 0.22) { this._bang(pan); this._caption(`[${side}멀리서 쿵 하는 소리]`); }
        else if (pick < 0.42) { this._drip(pan); this._caption('[물방울 떨어지는 소리]'); }
        else if (pick < 0.6) { this._whisper(pan); this._caption(`[${side}누군가 속삭인다]`); }
        else if (pick < 0.8) { this._creak(pan); this._caption('[철제 구조물이 삐걱인다]'); }
        else { this._distantSteps(pan); this._caption(`[${side}어딘가에서 발소리]`); }
      } else if (this.kind === 'vault') {
        this._tone({ type: 'triangle', f0: 125, f1: 175, gain: 0.028, attack: 0.15, decay: 0.65, pan, dest: this.amb });
        this._caption('[천장에서 감시 카메라 모터가 돌아간다]');
      } else if (this.kind === 'study') {
        if (pick < 0.22) { this._thunder(pan, false); this._caption('[멀리서 천둥이 울린다]'); }
        else if (pick < 0.42) { this._creak(pan); this._caption(`[${side}마룻바닥이 삐걱인다]`); }
        else if (pick < 0.6) { this._whisper(pan); this._caption(`[${side}누군가 속삭인다]`); }
        else if (pick < 0.78) { this._knock(pan); this._caption(`[${side}똑, 똑, 똑 — 문 두드리는 소리]`); }
        else { this._distantSteps(pan); this._caption('[위층에서 발소리]'); }
      } else if (this.kind === 'egypt') {
        if (pick < 0.3) { this._burst({ type: 'lowpass', freq: 120, gain: 0.18, attack: 0.6, decay: 2.2, pan }); this._caption('[땅속 깊은 곳의 울림]'); }
        else if (pick < 0.55) { this._burst({ type: 'highpass', freq: 3500, gain: 0.04, attack: 0.3, decay: 1.6, pan }); this._caption('[모래가 흘러내린다]'); }
        else if (pick < 0.8) { this._whisper(pan); this._caption(`[${side}누군가 속삭인다]`); }
        else { this._stoneGrind(pan, 0.1); this._caption('[돌이 갈리는 소리]'); }
      }
      this._later(next, 6000 + Math.random() * 12000);
    };
    this._later(next, 5000);
  }

  _bang(pan) {
    this._burst({ type: 'lowpass', freq: 320, gain: 0.32, attack: 0.004, decay: 1.2, pan });
    this._tone({ f0: 62, f1: 34, gain: 0.25, decay: 0.6, pan });
  }

  _drip(pan) {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this._tone({ f0: 1500 + Math.random() * 400, f1: 480, gain: 0.06, decay: 0.09, pan, delay: i * (0.4 + Math.random() * 0.5) });
  }

  _whisper(pan) {
    const c = this.ctx;
    const t0 = c.currentTime;
    const src = this._noise();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400 + Math.random() * 1200;
    f.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
    const trem = c.createGain();
    trem.gain.value = 0.6;
    this._lfo(6 + Math.random() * 5, 0.45, trem.gain);
    src.connect(f).connect(trem).connect(g).connect(this._panner(pan)).connect(this.fx);
    src.start(t0, Math.random() * 2);
    src.stop(t0 + 2);
  }

  _creak(pan) {
    const c = this.ctx;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t0);
    o.frequency.exponentialRampToValueAtTime(62, t0 + 1.3);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    o.connect(f).connect(g).connect(this._panner(pan)).connect(this.fx);
    o.start(t0);
    o.stop(t0 + 1.5);
  }

  _distantSteps(pan) {
    for (let i = 0; i < 4; i++) this._burst({ type: 'lowpass', freq: 380, gain: 0.07, decay: 0.12, pan, delay: i * 0.55 });
  }

  _stoneGrind(pan, gain) {
    const c = this.ctx;
    const t0 = c.currentTime;
    const src = this._noise();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    const trem = c.createGain();
    this._lfo(11, 0.5, trem.gain);
    src.connect(f).connect(trem).connect(g).connect(this._panner(pan)).connect(this.fx);
    src.start(t0, Math.random());
    src.stop(t0 + 2.3);
  }

  _heartbeat() {
    if (!this.ctx || this.tension <= 0) {
      this._heartOn = false;
      return;
    }
    this._heartOn = true;
    const lv = this.tension;
    this._tone({ f0: 58, f1: 38, gain: 0.25 + lv * 0.3, decay: 0.16 });
    this._tone({ f0: 52, f1: 36, gain: 0.18 + lv * 0.2, decay: 0.16, delay: 0.2 });
    this._later(() => this._heartbeat(), 1050 - lv * 480);
  }

  // ---------------------------------------------------------------- 효과음
  /**
   * @param {string} name
   * @param {{ pan?: number, soft?: boolean, heavy?: boolean }} [opts]
   */
  sfx(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const egypt = this.kind === 'egypt';
    switch (name) {
      case 'step': {
        // 좌우 발 번갈아(pan), 웅크리면 작게, 달리면 크고 둔탁하게. 매번 음색을 조금씩 바꾼다
        const pan = opts.pan ?? 0;
        const g = (opts.soft ? 0.35 : opts.heavy ? 1.5 : 1) * (0.85 + Math.random() * 0.3);
        const v = 0.9 + Math.random() * 0.25;
        if (egypt) {
          this._burst({ type: 'bandpass', freq: 1300 * v, q: 0.8, gain: 0.05 * g, decay: 0.14, pan });
          this._burst({ type: 'lowpass', freq: 220 * v, gain: 0.06 * g, decay: 0.07, pan });
        } else {
          this._burst({ type: 'lowpass', freq: 650 * v, gain: 0.11 * g, decay: 0.08, pan });
          this._tone({ f0: 95 * v, f1: 60, gain: 0.05 * g, decay: 0.05, pan });
          if (opts.heavy) this._burst({ type: 'highpass', freq: 2500, gain: 0.02, decay: 0.05, pan, delay: 0.02 });
        }
        break;
      }
      case 'mark':
        this._tone({ type: 'triangle', f0: 1320, gain: 0.06, decay: 0.12 });
        this._tone({ type: 'triangle', f0: 1760, gain: 0.05, decay: 0.18, delay: 0.09 });
        break;
      case 'breath':
        // 들숨 → 날숨
        this._burst({ type: 'bandpass', freq: 1100, q: 0.7, gain: 0.05, attack: 0.25, decay: 0.3 });
        this._burst({ type: 'bandpass', freq: 650, q: 0.6, gain: 0.06, attack: 0.08, decay: 0.45, delay: 0.42 });
        break;
      case 'clue':
        if (this.kind === 'vault') {
          this._tone({ f0: 920, gain: 0.046, decay: 0.08 });
          this._tone({ f0: 1380, gain: 0.04, decay: 0.12, delay: 0.09 });
          break;
        }
        for (let i = 0; i < 3; i++) this._burst({ type: 'bandpass', freq: 3800 + Math.random() * 1500, q: 1.2, gain: 0.07, decay: 0.06, delay: i * 0.07 });
        break;
      case 'type':
        this._burst({ type: 'highpass', freq: 2500, gain: 0.025, decay: 0.02 });
        break;
      case 'open':
        if (egypt) this._burst({ type: 'bandpass', freq: 600, gain: 0.08, attack: 0.08, decay: 0.4 });
        else {
          this._tone({ type: 'square', f0: 60, f1: 140, gain: 0.03, decay: 0.15 });
          this._burst({ type: 'highpass', freq: 3000, gain: 0.04, decay: 0.25 });
        }
        break;
      case 'success':
        if (egypt) for (const [f, d] of [[440, 0], [660, 0.12], [880, 0.24]]) this._tone({ f0: f, gain: 0.09, decay: 2.2, delay: d });
        else {
          this._tone({ type: 'square', f0: 880, gain: 0.05, decay: 0.12 });
          this._tone({ type: 'square', f0: 1320, gain: 0.05, decay: 0.25, delay: 0.13 });
        }
        break;
      case 'fail':
        if (this.kind === 'vault') {
          this._caption('출입 단말기 경보음');
          for (const delay of [0, 0.24]) this._tone({ type: 'triangle', f0: 660, f1: 420, gain: 0.09, decay: 0.19, delay });
          break;
        }
        if (egypt) {
          this._tone({ f0: 82, f1: 70, gain: 0.3, decay: 1.4 });
          this._burst({ type: 'highpass', freq: 3500, gain: 0.05, attack: 0.1, decay: 1.2 });
        } else {
          this._tone({ type: 'sawtooth', f0: 70, gain: 0.1, decay: 0.45 });
          this._tone({ type: 'square', f0: 73, gain: 0.07, decay: 0.45 });
        }
        break;
      case 'key':
        for (const d of [0, 0.09]) {
          this._tone({ f0: 2400, gain: 0.05, decay: 0.4, delay: d });
          this._tone({ f0: 3150, gain: 0.03, decay: 0.3, delay: d });
        }
        break;
      case 'locked':
        if (egypt) this._burst({ type: 'lowpass', freq: 180, gain: 0.25, decay: 0.35 });
        else for (let i = 0; i < 3; i++) this._burst({ type: 'bandpass', freq: 900, q: 4, gain: 0.12, decay: 0.06, delay: i * 0.08 });
        break;
      case 'door':
        if (this.kind === 'study') {
          // 낡은 나무 문: 길게 끌리는 삐걱임
          this._burst({ type: 'bandpass', freq: 700, sweepTo: 1600, q: 9, gain: 0.12, attack: 0.1, decay: 1.3 });
          this._burst({ type: 'bandpass', freq: 1500, sweepTo: 900, q: 9, gain: 0.08, attack: 0.1, decay: 0.8, delay: 0.9 });
        } else if (egypt) {
          this._stoneGrind(0, 0.35);
          this._burst({ type: 'lowpass', freq: 90, gain: 0.35, attack: 0.2, decay: 2 });
        } else {
          this._burst({ type: 'bandpass', freq: 1400, sweepTo: 280, q: 2, gain: 0.18, attack: 0.05, decay: 1.1 });
          this._tone({ f0: 70, f1: 40, gain: 0.3, decay: 0.4, delay: 1.0 });
        }
        break;
      case 'scare':
        for (const f of [311, 330, 466, 622, 659]) this._tone({ type: 'sawtooth', f0: f, f1: f * 0.92, gain: 0.05, attack: 0.01, decay: 1.6 });
        this._burst({ type: 'highpass', freq: 2000, gain: 0.12, attack: 0.01, decay: 1.2 });
        this._tone({ f0: 50, f1: 30, gain: 0.4, decay: 0.8 });
        break;
      case 'rumble':
        this._burst({ type: 'lowpass', freq: 85, gain: 0.5, attack: 0.15, decay: 2.4 });
        this._burst({ type: 'highpass', freq: 3800, gain: 0.06, attack: 0.5, decay: 1.8 });
        break;
      case 'thunder':
        this._thunder((Math.random() - 0.5) * 0.6, true);
        break;
      case 'spark':
        for (let i = 0; i < 3; i++) this._burst({ type: 'highpass', freq: 3000, gain: 0.08, decay: 0.03, delay: i * 0.05 * Math.random() });
        break;
      default:
    }
  }
}
