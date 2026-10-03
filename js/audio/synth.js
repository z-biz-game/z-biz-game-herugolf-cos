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
    // 静音态连 ctx 都不许建、不许拉起来：静音期间这个 AudioContext 根本没有在跑。
    if (this.muted) return null;
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
  /**
   * 真静音：挂起整个 AudioContext，不是把音量拧到 0。
   * 简报 §2：只把 gain 设 0 是假静音 —— 节点照建、时钟照跑，取消静音还有尾巴。
   * 偏好单独记在 cos.mute：它决定"这个 AudioContext 允不允许跑起来"，
   * 而注入的 enabled() 决定控件显示成什么样，两边都要。
   */
  setMuted(on) {
    const next = !!on;
    if (next === this.muted) return this.muted;
    this.muted = next;
    if (this.ctx) {
      if (next) {
        if (this.ctx.state === 'running' && this.ctx.suspend) this.ctx.suspend().catch(() => {});
      } else if (this.ctx.state === 'suspended' && this.ctx.resume) {
        this.ctx.resume().catch(() => {});
      }
    }
    try {
      localStorage.setItem('cos.mute', next ? '1' : '0');
    } catch { /* 隐私模式下写不进去也不该炸游戏 */ }
    return this.muted;
  }

  isMuted() {
    return !!this.muted;
  }

  /** init 用：把存档偏好灌进静音态（重开一局不会自己弹回来） */
  syncFromStore() {
    let saved = null;
    try {
      saved = localStorage.getItem('cos.mute');
    } catch { /* 读不到就沿用 store 的值 */ }
    // 没有 cos.mute 时退回 store：老存档里"关声"也应该真的关声。
    const off = saved === null ? !this.enabled() : saved === '1';
    return this.setMuted(off);
  }

  play(name) {
    if (this.muted) return false;
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
