// 声音：静音要**真停**，不是把 gain 拧到 0。
//
// 判据（派工简报 §2 的"行为成立"）：
//   · setMuted(true) ⇒ AudioContext.suspend()，且此后 blip() 在**创建振荡器节点之前**就返回。
//     只把 master gain 设 0 的那种写法，静音时还在按帧生节点 —— 省电的是玩家，费的是同一台手机。
//   · 暂停 ⇒ 同样 suspend()；恢复 ⇒ resume()。切后台（visibilitychange）也走这条路。
//   · 首个手势之前不建 AudioContext（浏览器策略：未交互的 ctx 恒为 suspended，白占资源）。
//
// this.voices 是给自己看的账：静音期间它必须不涨。测试与 window 状态都读这一个数。
const TONES = {
  stroke: { f: 392, dur: 0.09, type: 'triangle', gain: 0.16 },
  hole: { f: 659.25, dur: 0.26, type: 'sine', gain: 0.22 },
  blocked: { f: 138, dur: 0.12, type: 'square', gain: 0.1 },
  win: { f: 880, dur: 0.5, type: 'sine', gain: 0.2 },
  ui: { f: 523.25, dur: 0.05, type: 'sine', gain: 0.09 },
};

export class Sfx {
  constructor(Ctor) {
    this.Ctor = Ctor || null;
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.voices = 0;
    this.suspends = 0;
    this.resumes = 0;
    this.lastError = '';
  }

  static available() {
    return typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
  }

  ensure() {
    if (this.muted) return null;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this._resume();
      return this.ctx;
    }
    const Ctor = this.Ctor || (typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
    if (!Ctor) {
      this.lastError = 'no-audiocontext';
      return null;
    }
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.lastError = e && e.name ? e.name : 'ctx-failed';
      this.ctx = null;
      this.master = null;
      return null;
    }
    return this.ctx;
  }

  setMuted(on) {
    this.muted = !!on;
    if (this.muted) this._suspend();
    else if (this.ctx) this._resume();
    return this.muted;
  }

  // 暂停/恢复走同一条路：ctx 真的停，节点不再排程
  suspendForPause() { this._suspend(); return this.ctx ? this.ctx.state : 'none'; }
  resumeFromPause() { if (!this.muted) this._resume(); return this.ctx ? this.ctx.state : 'none'; }

  _suspend() {
    if (!this.ctx || this.ctx.state !== 'running' || typeof this.ctx.suspend !== 'function') return;
    this.ctx.suspend();
    this.suspends++;
  }

  _resume() {
    if (!this.ctx || this.ctx.state === 'running' || typeof this.ctx.resume !== 'function') return;
    try { this.ctx.resume(); } catch (e) { this.lastError = 'resume-failed'; return; }
    this.resumes++;
  }

  // 返回 true = 真的排了一个振荡器；false = 静音/无音频设备，一个节点都没建
  blip(name) {
    if (this.muted) return false;
    const spec = TONES[name] || TONES.ui;
    const ctx = this.ensure();
    if (!ctx || !this.master) return false;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(spec.gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
    if (name === 'hole' || name === 'win') osc.frequency.exponentialRampToValueAtTime(spec.f * 1.5, t + spec.dur * 0.9);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + spec.dur + 0.02);
    this.voices++;
    return true;
  }

  state() {
    return {
      muted: this.muted,
      ctx: this.ctx ? this.ctx.state : 'none',
      voices: this.voices,
      suspends: this.suspends,
      resumes: this.resumes,
      lastError: this.lastError,
    };
  }
}
