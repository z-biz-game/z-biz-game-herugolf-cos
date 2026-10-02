// 玩法与仿真的那一层：**不碰 DOM、不碰 canvas、不读 window**。
//
// 为什么单独一层：帧率无关这件事只有"能被逐档喂进同一串定步长"的代码才证得明。
// 渲染与 DOM 掺进来的话，任何对拍都要先造一个假浏览器，那种尺子量不到仿真本身。
// 所以这一层只吃 dt 与输入事件，只吐状态；js/render 与 js/ui 都是它的读者。
//
// 时间口径（本仓的硬约束，见 tools/check.mjs 的禁词门与 README 的 rng 纪律）：
//   · 定步长累加器：SIM_DT = 1/120 秒，`accum + 1e-9 >= SIM_STEP_MS` 才走一步。
//     那 1e-9 是给浮点留的缝：按 1000/60 喂 3 秒会少喂 5e-13 秒，不留缝 60Hz 就少跑一步，
//     凭空造出一个"帧率依赖"的假红（wave-collapse 实测踩过，口径写在派工简报 §3）。
//   · 一切位移/阻尼/概率都按 dt 积分：`x += v*dt`、`shake *= Math.pow(0.86, dt*60)`、
//     `p = 1 - Math.pow(1 - p60, dt*60)`。禁止 `*= 0.96`、`if (Math.random() < 0.02)` 这种只在 60Hz 成立的写法。
//   · 随机数只用带种子的 LCG（粒子撒射方向），不许 Math.random —— 否则三档对拍比的不是同一件事。
import { Board, serializeBoard, parseBoard, serializeAnswer, parseAnswer } from '../engine/grid.js';
import { shipPuzzle, TIERS, parseTier } from '../engine/generate.js';
import { routesFor } from '../engine/routes.js';
import { verify } from '../engine/verify.js';
import { countSolutions, prepare } from '../engine/counter.js';

export const SIM_DT = 1 / 120;
export const SIM_STEP_MS = SIM_DT * 1000;
const STEP_EPS_MS = 1e-9;
const MAX_FRAME_MS = 250; // 掉帧/切后台回来的那一坨时间不许补进仿真（否则暂停回来会炸步）
const PARTICLE_CAP = 160;

export const STATE = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', WON: 'won' };

// 带种子的 LCG：粒子撒射要能跨帧率复现，Math.random 做不到这件事
function makeLcg(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class HerugolfGame {
  constructor({ seed = 1, tierKey = '8x8/4', reduceMotion = false, clock = null } = {}) {
    this.seed = seed;
    this.tierKey = tierKey;
    this.tier = parseTier(tierKey);
    this.reduceMotion = !!reduceMotion;
    this.clock = clock || (() => 0);

    // 时间/推进（对拍就看这几个数在三档下是否逐字相同）
    this.elapsed = 0;
    this.simSteps = 0;
    this.accumMs = 0;
    this.animClock = 0;
    this.pulse = 0;

    // 玩法
    this.state = STATE.TITLE;
    this.board = null;
    this.solution = null;
    this.cands = new Map(); // ball -> 该球当前题面下的全部合法走法
    this.lines = new Map(); // ball -> 玩家已画的落点序列
    this.selected = null;
    this.moves = 0;
    this.blocked = 0;
    this.solved = 0;
    this.undoStack = [];
    this.message = '';
    this.messageClock = 0;
    this.shake = 0;
    this.strokeAnim = 0;
    this.strokeAnimBall = -1;
    this.holeFlash = new Float32Array(8);
    this.ripples = [];
    // 输入落地表：玩家动作不在处理器的调用点改写仿真，而是按虚拟时刻排到定步长边界上。
    // 派发发生在"帧边界的那一帧 rAF 之前"（浏览器与对拍尺都是），所以同步改写会让同一个
    // 动作在三档落到不同步号（1100ms 那一按：30Hz 时仿真只走了 8 步、120Hz 走了 11 步），
    // shake 的阻尼长度、粒子抢到哪个槽位从此永久错开一格。
    this.inputQueue = [];
    this.lastFrameMs = 0;
    this.draining = false;
    // 通关用时：**按仿真步号**算出来的（见 refresh()），不是帧循环里抓的快照。
    // 帧循环里抓的那种读数随刷新率变化（30Hz 最多晚 4 步），一旦进存档就会被 restore 回仿真里。
    this.winSecs = 0;

    // 粒子（typed array 是玩法真值本身，不是渲染缓存：对拍逐格比的就是它们）
    this.pX = new Float32Array(PARTICLE_CAP);
    this.pY = new Float32Array(PARTICLE_CAP);
    this.pVX = new Float32Array(PARTICLE_CAP);
    this.pVY = new Float32Array(PARTICLE_CAP);
    this.pLife = new Float32Array(PARTICLE_CAP);
    this.pKind = new Uint8Array(PARTICLE_CAP);
    this.pAlive = 0;
    this.rng = makeLcg(0xc0ffee ^ seed);

    this.events = [];
    this.build();
  }

  // ── 出货：引擎那一套双条件闸（唯一解数过 ∧ 铅笔零猜测推完）在这里照吃
  build(seed = this.seed, tierKey = this.tierKey) {
    this.seed = seed;
    this.tierKey = tierKey;
    this.winSecs = 0;
    this.tier = parseTier(tierKey);
    const r = shipPuzzle(seed, tierKey, { now: this.clock });
    if (r.ok) {
      this.board = r.board;
      this.solution = r.answer;
      this.shipped = true;
    } else {
      // 通道这一档没出货（tries 用完）：退到官方 5x5 例题，保证界面永远有得玩，
      // 但不许假装出货了 —— shipped=false 会被 HUD 如实标出来。
      this.board = parseBoard(5, 5, '...H.3..#P..#....P...H.3.');
      this.solution = null;
      this.shipped = false;
    }
    this.cands = new Map();
    for (const cell of this.board.cellList()) this.cands.set(cell, routesFor(this.board, cell));
    this.inputQueue.length = 0; // 上一张盘排队没落地的动作不许打到新盘上
    this.rng = makeLcg((0xc0ffee ^ seed) >>> 0);
    return r;
  }

  // ── 输入：选中 / 画一动 / 撤销 / 复位 ────────────────────────────────
  select(cell) {
    if (this.state !== STATE.PLAYING) return false;
    if (this.board && this.board.balls.has(cell)) {
      this.selected = cell;
      return true;
    }
    return false;
  }

  // 目标格必须是"当前这一动"的合法落点：直线、长度等于剩余动长、且整条线仍可收口
  strokeTo(cell) {
    if (this.state !== STATE.PLAYING || this.selected == null || !this.board) return false;
    const ball = this.selected;
    const k0 = this.board.balls.get(ball);
    const stops = this.lines.get(ball) || [];
    if (stops.length >= k0) return this.reject('这一球已经动完 ' + k0 + ' 动了');
    const from = stops.length ? stops[stops.length - 1] : ball;
    const len = k0 - stops.length;
    const [r0, c0] = this.board.rc(from);
    const [r1, c1] = this.board.rc(cell);
    const dr = Math.sign(r1 - r0);
    const dc = Math.sign(c1 - c0);
    const straight = (dr === 0 || dc === 0) && Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0)) === len;
    if (!straight) return this.reject('每一动要走 ' + len + ' 格直线');
    const probe = stops.concat([cell]);
    if (!this.completable(ball, probe)) return this.reject('这条走法收不了口（R3/R4 拦住了）');
    this.lines.set(ball, probe);
    this.undoStack.push({ ball, stops: stops.length });
    this.moves++;
    this.strokeAnim = 0;
    this.strokeAnimBall = ball;
    this.selected = ball;
    this.events.push('stroke');
    if (this.board.holes.has(cell) && probe.length === k0) {
      this.lockHole(ball, cell);
    }
    this.refresh();
    return true;
  }

  // 沿方向画一动（手机上更好按：滑动即出方向）
  strokeDir(dir) {
    if (this.state !== STATE.PLAYING || this.selected == null || !this.board) return false;
    const ball = this.selected;
    const k0 = this.board.balls.get(ball);
    const stops = this.lines.get(ball) || [];
    const len = k0 - stops.length;
    if (len <= 0) return this.reject('这一球已经动完 ' + k0 + ' 动了');
    const from = stops.length ? stops[stops.length - 1] : ball;
    const [r, c] = this.board.rc(from);
    const d = [{ dr: -1, dc: 0 }, { dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }][dir & 3];
    const target = this.board.idx(r + d.dr * len, c + d.dc * len);
    if (!this.board.inb(r + d.dr * len, c + d.dc * len)) return this.reject('出界了（R4 OB）');
    return this.strokeTo(target);
  }

  reject(msg) {
    this.blocked++;
    this.message = msg;
    this.messageClock = 0;
    if (!this.reduceMotion) this.shake = 1;
    this.events.push('blocked');
    return false;
  }

  // 这一球按 probe 这条路走下去，题面里还存在至少一条合法走法吗？
  // 吃的是 routesFor 的那一份候选（R2/R3/R4 已判过），外加"不许压到别的球已经占下的格"。
  completable(ball, probe) {
    const list = this.cands.get(ball) || [];
    const taken = this.occupiedExcept(ball);
    for (const rt of list) {
      if (rt.stops.length < probe.length) continue;
      let same = true;
      for (let i = 0; i < probe.length; i++) if (rt.stops[i] !== probe[i]) { same = false; break; }
      if (!same) continue;
      let clash = false;
      for (const c of rt.cells) if (taken.has(c)) { clash = true; break; }
      if (!clash) return true;
    }
    return false;
  }

  occupiedExcept(ball) {
    const taken = new Set();
    for (const b of this.board.balls.keys()) if (b !== ball) taken.add(b);
    for (const [b, stops] of this.lines) {
      if (b === ball || !stops.length) continue;
      const rt = this.matchRoute(b, stops);
      if (rt) { for (const c of rt.cells) taken.add(c); }
      else { for (const s of stops) taken.add(s); }
    }
    return taken;
  }

  matchRoute(ball, stops) {
    const list = this.cands.get(ball) || [];
    for (const rt of list) {
      if (rt.stops.length !== stops.length) continue;
      let same = true;
      for (let i = 0; i < stops.length; i++) if (rt.stops[i] !== stops[i]) { same = false; break; }
      if (same) return rt;
    }
    return null;
  }

  lockHole(ball, cell) {
    this.solved = this.countSolved();
    this.events.push('hole');
    if (!this.reduceMotion) this.burst(cell, 18);
    const holes = [...this.board.holes];
    const at = holes.indexOf(cell);
    if (at >= 0 && at < this.holeFlash.length) this.holeFlash[at] = 1;
  }

  countSolved() {
    let n = 0;
    for (const [b, stops] of this.lines) {
      const k0 = this.board.balls.get(b);
      if (stops.length === k0 && this.board.holes.has(stops[stops.length - 1])) n++;
    }
    return n;
  }

  undo() {
    const last = this.undoStack.pop();
    if (!last) return false;
    const prev = this.lines.get(last.ball) || [];
    if (prev.length <= last.stops) this.lines.set(last.ball, prev.slice(0, last.stops));
    if (!last.stops) this.lines.delete(last.ball);
    this.selected = last.ball;
    this.moves++;
    this.solved = this.countSolved();
    this.events.push('undo');
    this.refresh();
    return true;
  }

  clearBall(ball) {
    if (ball == null) return false;
    this.lines.delete(ball);
    this.undoStack = this.undoStack.filter((u) => u.ball !== ball);
    this.solved = this.countSolved();
    this.refresh();
    return true;
  }

  // ── 生命周期 ───────────────────────────────────────────────────────
  start() {
    if (this.state === STATE.PLAYING) return false;
    this.state = STATE.PLAYING;
    this.events.push('start');
    return true;
  }

  pause() {
    if (this.state !== STATE.PLAYING) return false;
    this.state = STATE.PAUSED;
    this.events.push('pause');
    return true;
  }

  resume() {
    if (this.state !== STATE.PAUSED) return false;
    this.state = STATE.PLAYING;
    this.events.push('resume');
    return true;
  }

  togglePause() {
    if (this.state === STATE.PLAYING) return this.pause();
    if (this.state === STATE.PAUSED) return this.resume();
    return false;
  }

  // 重开 = 时钟、累加器、粒子、玩家线、撤销栈、临时增益全部归零（不是只调一次 init）
  reset(keepPuzzle = true) {
    this.elapsed = 0;
    this.simSteps = 0;
    this.accumMs = 0;
    this.animClock = 0;
    this.pulse = 0;
    this.lines.clear();
    this.undoStack.length = 0;
    this.selected = this.board ? this.board.cellList()[0] ?? null : null;
    this.moves = 0;
    this.blocked = 0;
    this.solved = 0;
    this.message = '';
    this.messageClock = 0;
    this.shake = 0;
    this.strokeAnim = 1;
    this.strokeAnimBall = -1;
    this.holeFlash.fill(0);
    this.ripples.length = 0;
    this.pX.fill(0); this.pY.fill(0); this.pVX.fill(0); this.pVY.fill(0);
    this.pLife.fill(0); this.pKind.fill(0);
    this.pAlive = 0;
    this.events.length = 0;
    this.inputQueue.length = 0;
    if (keepPuzzle) {
      this.cands = new Map();
      for (const cell of this.board.cellList()) this.cands.set(cell, routesFor(this.board, cell));
      this.rng = makeLcg((0xc0ffee ^ this.seed) >>> 0);
    } else {
      this.build(this.seed + 1, this.tierKey);
    }
    this.state = STATE.PLAYING;
    this.events.push('reset');
    return true;
  }

  nextPuzzle() {
    this.reset(true);
    this.build(this.seed + 1, this.tierKey);
    this.state = STATE.PLAYING;
    this.events.push('next');
    return true;
  }

  setTier(tierKey) {
    this.reset(true);
    this.build(this.seed, tierKey);
    this.state = STATE.PLAYING;
    this.events.push('tier');
    return true;
  }

  setReduceMotion(on) {
    this.reduceMotion = !!on;
    if (on) {
      this.shake = 0;
      this.ripples.length = 0;
      this.pLife.fill(0);
      this.pAlive = 0;
    }
    return this.reduceMotion;
  }

  refresh() {
    if (!this.board) return;
    this.solved = this.countSolved();
    const total = this.board.balls.size;
    if (this.solved === total && this.state === STATE.PLAYING) {
      const answer = [...this.lines.entries()]
        .filter(([b, s]) => s.length === this.board.balls.get(b))
        .map(([b, s]) => ({ start: b, stops: s }));
      const errs = verify(this.board, answer);
      if (!errs.length) {
        this.state = STATE.WON;
        this.events.push('win');
        this.winSecs = Math.round(this.simSteps * SIM_DT * 1000) / 1000;
        this.answerKey = serializeAnswer(answer);
        if (!this.reduceMotion) for (const c of this.board.holes) this.burst(c, 14);
      } else {
        this.message = '看着都进洞了，但规则还差一条：' + errs[0];
        this.messageClock = 0;
      }
    }
  }

  // ── 粒子：只用带种子的 LCG，位置在定步长里积分 ─────────────────────
  burst(cell, n) {
    if (!this.board) return;
    this.phase(() => this.burstNow(cell, n));
  }

  burstNow(cell, n) {
    const [r, c] = this.board.rc(cell);
    for (let i = 0; i < n; i++) {
      const slot = this.allocParticle();
      if (slot < 0) return;
      const a = this.rng() * Math.PI * 2;
      const sp = 0.9 + this.rng() * 2.6;
      this.pX[slot] = c + 0.5;
      this.pY[slot] = r + 0.5;
      this.pVX[slot] = Math.cos(a) * sp;
      this.pVY[slot] = Math.sin(a) * sp - 0.6;
      this.pLife[slot] = 0.55 + this.rng() * 0.5;
      this.pKind[slot] = 1 + ((i + this.simSteps) & 3);
    }
  }

  allocParticle() {
    for (let i = 0; i < PARTICLE_CAP; i++) if (this.pLife[i] <= 0) { this.pAlive = Math.max(this.pAlive, i + 1); return i; }
    return -1;
  }

  ripple(cell) {
    if (this.reduceMotion || !cell && cell !== 0) return;
    this.phase(() => {
      const [r, c] = this.board.rc(cell);
      this.ripples.push({ x: c + 0.5, y: r + 0.5, t: 0 });
      if (this.ripples.length > 12) this.ripples.shift();
    });
  }

  // ── 输入落地：把"玩家在哪一刻按了哪一键"翻译成"第几个定步长边界上做这次改写" ──
  // due = 已走到的仿真钟 + 上一帧周期。帧边界 T 上派发时仿真钟停在 T-帧周期，加回来正好
  // 等于 T 折算出的步号 ⇒ 三档算出同一个步号（暂停期间不推进仿真钟，所以那时排的动作
  // 记在当下步号上，恢复后第一步按 FIFO 落地，同样与刷新率无关）。
  input(fn) {
    const now = this.simSteps * SIM_STEP_MS;
    this.inputQueue.push({ fn, due: this.state === STATE.PAUSED ? now : now + this.lastFrameMs });
    if (this.inputQueue.length > 96) this.inputQueue.shift();
  }

  // 只图外观的改写（粒子撒射、点击涟漪）：在落地表里就跑，在处理器里就排队
  phase(fn) {
    if (this.draining) fn();
    else this.input(fn);
  }

  drainInputs() {
    const boundary = (this.simSteps + 1) * SIM_STEP_MS;
    while (this.inputQueue.length && this.inputQueue[0].due <= boundary + STEP_EPS_MS) {
      const job = this.inputQueue.shift();
      this.draining = true;
      job.fn();
      this.draining = false;
    }
  }

  // 帧入口：吃"这一帧过了多少毫秒"，内部一律按定步长推进
  update(dtMs) {
    let ms = dtMs;
    if (!(ms > 0)) return 0;
    if (ms > MAX_FRAME_MS) ms = MAX_FRAME_MS;
    this.lastFrameMs = ms;
    if (this.state === STATE.PAUSED) { this.accumMs = 0; return 0; }
    this.accumMs += ms;
    let steps = 0;
    while (this.accumMs + STEP_EPS_MS >= SIM_STEP_MS) {
      this.accumMs -= SIM_STEP_MS;
      this.drainInputs();
      this.stepFixed(SIM_DT);
      steps++;
    }
    if (Math.abs(this.accumMs) < STEP_EPS_MS) this.accumMs = 0;
    return steps;
  }

  stepFixed(dt) {
    this.simSteps++;
    this.elapsed += dt;
    this.animClock += dt;
    if (this.state === STATE.TITLE) {
      // 标题态在 reduceMotion 下退化成静图：一个字段都不推进
      if (!this.reduceMotion) this.pulse += dt * Math.PI * 2;
      return;
    }
    if (this.state === STATE.WON) {
      this.integrateParticles(dt);
      this.decay(dt);
      return;
    }
    this.pulse += dt * Math.PI * 2 * (this.reduceMotion ? 0 : 1);
    this.strokeAnim = Math.min(1, this.strokeAnim + dt / 0.22);
    this.messageClock += dt;
    this.decay(dt);
    this.integrateParticles(dt);
    // 空气里的纸屑：概率按 dt 折算（60Hz 下每帧 0.6%），不许写 if (Math.random() < 0.006)
    if (!this.reduceMotion) {
      const p = 1 - Math.pow(1 - 0.006, dt * 60);
      if (this.rng() < p) {
        const slot = this.allocParticle();
        if (slot >= 0) {
          const n = this.board ? this.board.n : 1;
          const cell = Math.floor(this.rng() * n);
          const [r, c] = this.board.rc(cell);
          this.pX[slot] = c + this.rng();
          this.pY[slot] = r + this.rng();
          this.pVX[slot] = (this.rng() - 0.5) * 0.5;
          this.pVY[slot] = -0.25 - this.rng() * 0.3;
          this.pLife[slot] = 1.2 + this.rng() * 1.1;
          this.pKind[slot] = 0;
        }
      }
    }
  }

  decay(dt) {
    const k = Math.pow(0.86, dt * 60);
    this.shake *= k;
    if (this.shake < 1e-4) this.shake = 0;
    for (let i = 0; i < this.holeFlash.length; i++) {
      if (this.holeFlash[i] > 0) this.holeFlash[i] = Math.max(0, this.holeFlash[i] * Math.pow(0.9, dt * 60) - dt * 0.4);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].t += dt;
      if (this.ripples[i].t > 0.7) this.ripples.splice(i, 1);
    }
  }

  integrateParticles(dt) {
    const drag = Math.pow(0.985, dt * 60);
    for (let i = 0; i < this.pAlive; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { this.pLife[i] = 0; continue; }
      this.pX[i] += this.pVX[i] * dt;
      this.pY[i] += this.pVY[i] * dt;
      this.pVX[i] *= drag;
      this.pVY[i] = this.pVY[i] * drag + dt * 1.6; // 墨点往下落，单位：格/秒²
    }
  }

  // ── 存档口径：只写"重放这一局需要的最小事实" ────────────────────────
  snapshot() {
    return {
      v: 1,
      seed: this.seed,
      tier: this.tierKey,
      board: this.board ? serializeBoard(this.board) : '',
      lines: [...this.lines.entries()].map(([b, s]) => ({ start: b, stops: s.slice() })),
      moves: this.moves,
      blocked: this.blocked,
      winSecs: this.winSecs,
      state: this.state === STATE.PAUSED ? STATE.PLAYING : this.state,
    };
  }

  restore(snap) {
    this.build(snap.seed, snap.tier);
    this.state = STATE.PLAYING;
    this.lines = new Map();
    for (const l of snap.lines || []) {
      if (!this.board.balls.has(l.start)) continue;
      this.lines.set(l.start, (l.stops || []).slice());
    }
    this.moves = snap.moves | 0;
    this.blocked = snap.blocked | 0;
    // 用时**不**从存档里搬回来：那个数是在某一帧的边界上抓的，搬回 this.elapsed 等于
    // 让仿真时钟按刷新率倒退不同的量。恢复的是盘面与动数，计时从继续那一刻接着走。
    this.winSecs = Number(snap.winSecs) || 0;
    this.selected = this.board.cellList()[0] ?? null;
    // 存档里已经是"全进洞"的话，通关那一下的粒子与 winSecs 也得到步号边界上落，
    // 不然这一按会在 30Hz 的第 8 步、120Hz 的第 11 步各撒一批粒子。
    this.phase(() => this.refresh());
    return true;
  }

  // 挂给探针/对拍看的那一份（键名里带 state/phase 是刻意的：官方尺子按名字取状态字段）
  inspect() {
    return {
      state: this.state,
      phase: this.state === STATE.PLAYING ? 'sim-running' : this.state,
      screen: this.state === STATE.TITLE ? 'title' : this.state === STATE.WON ? 'won' : 'board',
      mode: this.shipped ? 'engine' : 'fallback',
      seed: this.seed,
      tier: this.tierKey,
      w: this.board ? this.board.w : 0,
      h: this.board ? this.board.h : 0,
      balls: this.board ? this.board.balls.size : 0,
      holes: this.board ? this.board.holes.size : 0,
      ponds: this.board ? this.board.ponds.size : 0,
      solved: this.solved,
      moves: this.moves,
      blocked: this.blocked,
      selected: this.selected == null ? -1 : this.selected,
      drawn: this.lines.size,
      elapsed: this.elapsed,
      winSecs: this.winSecs,
      simSteps: this.simSteps,
      accumMs: this.accumMs,
      animClock: this.animClock,
      pulse: this.pulse,
      shake: this.shake,
      strokeAnim: this.strokeAnim,
      pAlive: this.pAlive,
      pSum: (() => { let s = 0; for (let i = 0; i < this.pAlive; i++) s += this.pLife[i]; return s; })(),
      reduceMotion: this.reduceMotion,
    };
  }
}

export const TIER_MENU = TIERS.filter((t) => t.inMenu).map((t) => t.key);
export { Board, serializeBoard, parseBoard, serializeAnswer, parseAnswer, routesFor, countSolutions, prepare, shipPuzzle, parseTier };
