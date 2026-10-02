// 零依赖 WebAudio 提示音。三个音就够：落子、收洞、被规则拒绝。
// 浏览器要求用户手势之后才能起 AudioContext，所以这里首次调用才建，建不起来就哑掉
// （音效是附加物，绝不能把一次点击变成一条 unhandled rejection）。
const TONES = {
  stroke: { f: 520, dur: 0.07, type: 'triangle', gain: 0.05 },
  hole: { f: 880, dur: 0.16, type: 'sine', gain: 0.07 },
  deny: { f: 180, dur: 0.1, type: 'square', gain: 0.035 },
  win: { f: 660, dur: 0.4, type: 'sine', gain: 0.08 },
};

export class Sound {
  constructor(enabled = () => true) {
    this.enabled = enabled;
    this.ctx = null;
    this.broken = '';
  }
  ensure() {
    if (this.ctx || this.broken) return this.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) {
      this.broken = '这个浏览器没有 WebAudio';
      return null;
    }
    try {
      this.ctx = new AC();
    } catch (e) {
      this.broken = e.message;
    }
    return this.ctx;
  }
  play(name) {
    if (!this.enabled()) return false;
    const t = TONES[name];
    const ctx = this.ensure();
    if (!t || !ctx) return false;
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = t.type;
      o.frequency.value = t.f;
      g.gain.setValueAtTime(t.gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t.dur);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + t.dur);
      return true;
    } catch {
      return false;
    }
  }
}

export const SOUND_NAMES = Object.keys(TONES);
