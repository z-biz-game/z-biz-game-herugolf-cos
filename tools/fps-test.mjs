#!/usr/bin/env node
// tools/fps-test.mjs —— 帧率对拍：**自己写的**三档 harness，外加一条内置阴性对照。
//
// 为什么官方探针过了还要再写一把尺（BRIEF_COS §3 的硬要求，不是重复劳动）：
//   · 官方探针只会"装载 + 等帧 + 泛化注入"，它进不了"按方向键走一动"这条路，
//     所以它验的是**标题/背景动画**级别的帧率无关；关卡里的走子、撤销、通关那条线它没判过。
//   · 这一把按**固定步号**对拍：注入时刻全部是 100ms 的整数倍（30Hz=3 帧、60Hz=6 帧、120Hz=12 帧
//     ⇒ 三档落在同一个仿真步号上），然后要求三档末态**逐字段相等**，而不是"看起来一致"。
//   · 随机数用本文件自带的 LCG（不借宿主 Math.random）：三档必须是同一条随机流，
//     否则比的是两次不同的抽样，凡是每帧抽样的写法都会凭空长出跨档差异。
//   · 沙箱时钟从 1000ms 起（不是 0）：0 起步会喂给游戏一个 `last === 0` 的假哨兵，
//     30Hz 白少一帧 dt —— 那是尺自己造的帧率依赖。
//
// 阴性对照（§6 指定的那条线）：把定步长累加器 `this.accumMs += ms` 改成"每帧固定加一份"，
// 于是仿真推进改为随**帧数**而不是随虚拟时长 ⇒ 本 harness 必须转红。
// 这条对照是 harness 的**牙**：少了它，"三档一致"可能只是因为尺读不到任何会动的字段。
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'js', 'bundle', 'herugolf.js');
const HTML = join(ROOT, 'index.html');
const LADDER = [30, 60, 120];
const SECONDS = 3;
const STEP_MS = 1000 / 120; // 尺这边写死：跟着被测代码走就不是尺了（下面有一条断言核对它）
const INJECT_EVERY_MS = 100;

// ─────────────────────────────────────────────── 结果记录（RESULT 行是给门禁读的）
let checks = 0;
let fails = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { fails++; console.error(`  ✗ ${msg}`); }
  return !!cond;
};
const note = (...parts) => console.log(parts.join(' '));

// ─────────────────────────────────────────────── 最小 DOM/窗口沙箱
const IDS = (() => {
  const html = readFileSync(HTML, 'utf8');
  return new Set([...html.matchAll(/id\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
})();

function makeEl(id, rect) {
  const handlers = {};
  const noop = () => {};
  const grad = { addColorStop: noop };
  const ctx2d = new Proxy({}, {
    get: (_o, k) => {
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'canvas') return null;
      return noop;
    },
    set: () => true,
  });
  const el = {
    id, tagName: 'DIV', hidden: true, value: '', textContent: '', innerHTML: '',
    width: 900, height: 700, checked: false, children: [], dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: new Proxy({}, { get: (o, k) => (k === 'setProperty' ? noop : o[k]), set: (o, k, v) => { o[k] = v; return true; } }),
    _h: handlers,
    addEventListener(t, cb) { (handlers[t] = handlers[t] || []).push(cb); },
    removeEventListener(t, cb) { handlers[t] = (handlers[t] || []).filter((f) => f !== cb); },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); return c; },
    setAttribute: noop, focus: noop, blur: noop, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: rect[0], height: rect[1] }),
    getContext: () => ctx2d,
  };
  return el;
}

// 2D 音频桩：suspend/resume 与振荡器个数要**可数**，否则"静音不再建振荡器"没法当断言
function makeAudio() {
  const a = { voices: 0, suspends: 0, resumes: 0, state: 'running', currentTime: 0, sampleRate: 48000, destination: {} };
  a.createOscillator = () => { a.voices++; return { connect: () => a.destination, start: () => {}, stop: () => {}, type: 'sine', frequency: { value: 440, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }; };
  a.createGain = () => ({ connect: () => a.destination, disconnect: () => {}, gain: { value: 1, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} } });
  a.resume = () => { a.resumes++; a.state = 'running'; return Promise.resolve(); };
  a.suspend = () => { a.suspends++; a.state = 'suspended'; return Promise.resolve(); };
  return a;
}

// 每个档位一套全新沙箱：状态不许跨档共用（共用一个 window 就等于没对拍）
function bootSandbox(source) {
  let rs = 0x2f6e2b1 >>> 0;
  const rand = () => { rs = (Math.imul(rs, 1103515245) + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  let clock = 1000; // ← 不是 0，理由见文件头
  let pending = [];
  const timers = [];
  let timerId = 1;
  const audio = makeAudio();
  const store = {};
  const errors = [];
  const rectFor = (id) => (id === 'boardwrap' || id === 'board' ? [900, 700] : [240, 44]);
  const elMap = new Map();
  const byId = (id) => {
    if (!IDS.has(id)) return null;
    if (!elMap.has(id)) elMap.set(id, makeEl(id, rectFor(id)));
    return elMap.get(id);
  };
  const doc = {
    readyState: 'complete', hidden: false, fullscreenElement: null, title: '',
    getElementById: byId,
    createElement: (t) => makeEl('created-' + t, [120, 24]),
    querySelector: () => null, querySelectorAll: () => [],
    body: makeEl('body', [900, 700]), documentElement: makeEl('html', [900, 700]),
    _h: {}, addEventListener(t, cb) { (doc._h[t] = doc._h[t] || []).push(cb); },
    removeEventListener(t, cb) { doc._h[t] = (doc._h[t] || []).filter((f) => f !== cb); },
  };
  const fire = (target, type, ev) => {
    const hs = (target === doc ? doc._h[type] : (target._h || {})[type]) || [];
    ev.target = ev.currentTarget = target;
    for (const cb of [...hs]) { try { cb(ev); } catch (e) { errors.push(`${type}: ${e.message}`); } }
    return hs.length;
  };
  const mkKey = (key) => ({ type: 'keydown', key, code: key, timeStamp: clock, target: doc, preventDefault: () => {}, stopPropagation: () => {} });
  const env = {
    document: doc, console: { log: noopLog, warn: noopLog, error: (...a) => errors.push('console.error ' + a.join(' ')) },
    requestAnimationFrame: (cb) => { pending.push(cb); return pending.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (cb, ms) => { const id = timerId++; timers.push({ at: clock + Math.max(0, Number(ms) || 0), cb, id }); return id; },
    setInterval: (cb, ms) => { const iv = Math.max(1, Number(ms) || 1), id = timerId++; timers.push({ at: clock + iv, cb, id, iv }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.dead = true; },
    clearInterval: (id) => { const t = timers.find((x) => x.id === id); if (t) t.dead = true; },
    performance: { now: () => clock },
    Date: class D { constructor(t) { this._t = t === undefined ? clock : t; } getTime() { return this._t; } },
    addEventListener: (t, cb) => { (env._h[t] = env._h[t] || []).push(cb); },
    removeEventListener: (t, cb) => { env._h[t] = (env._h[t] || []).filter((f) => f !== cb); },
    _h: {},
    AudioContext: function AC() { return audio; },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    location: { href: 'file:///index.html', protocol: 'file:' },
    navigator: { userAgent: 'fps-test', maxTouchPoints: 0, serviceWorker: undefined },
    devicePixelRatio: 1, innerWidth: 900, innerHeight: 700,
    Math: new Proxy(Math, { get: (o, k) => (k === 'random' ? rand : o[k]) }),
  };
  function noopLog() {}
  for (const k of ['Object', 'Array', 'Number', 'String', 'Boolean', 'Map', 'Set', 'JSON', 'Promise', 'RegExp', 'Error', 'TypeError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Symbol', 'BigInt', 'ArrayBuffer', 'DataView', 'Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'TextDecoder', 'TextEncoder']) {
    if (typeof globalThis[k] !== 'undefined') env[k] = globalThis[k];
  }
  env.window = env; env.self = env; env.global = env;
  const ctx = createContext(env);
  runInContext(source, ctx, { filename: relative(ROOT, BUNDLE) });

  const timers_due = () => {
    for (const t of timers) {
      if (t.dead || t.at > clock) continue;
      if (t.iv) t.at = clock + t.iv; else t.dead = true;
      try { t.cb(); } catch (e) { errors.push('timer: ' + e.message); }
    }
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].dead) timers.splice(i, 1);
  };
  const stepFrame = (dtMs, pre) => {
    clock += dtMs;
    timers_due();
    if (pre) pre(); // 浏览器顺序：input 处理器跑在 rAF 之前（官方探针也是这个相位）
    const batch = pending; pending = [];
    for (const cb of batch) { try { cb(clock); } catch (e) { errors.push('rAF: ' + ((e && e.stack) || e).split('\n').slice(0, 2).join(' | ')); } }
  };
  return { env, doc, fire, mkKey, stepFrame, errors, audio, store, clock: () => clock, byId };
}

// ─────────────────────────────────────────────── 一档跑一遍：注入 + 推进 + 取摘要
const KEYS_SEQ = ['Enter', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'g', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'u'];

function runLadder(fps, source, { checkpointAtMs = null, phase = 'pre' } = {}) {
  const s = bootSandbox(source);
  const st = () => s.env.HerugolfState;
  const total = SECONDS * 1000;
  const frameMs = 1000 / fps;
  const n = Math.round(total / frameMs);
  let at1s = null;
  let injected = 0;
  let nextSlot = 0;
  const inject = (slot) => {
    s.fire(s.doc, 'keydown', s.mkKey(KEYS_SEQ[slot % KEYS_SEQ.length]));
    injected++;
  };
  // 槽 0 在任何一帧之前打：此刻三档都还没跑过仿真步，起点精确重合
  inject(0);
  nextSlot = 1;
  // 注入时刻 = 1000 + k·100ms（三档精确相等的虚拟时刻）。相位 pre = rAF 之前（浏览器与
  // 官方探针的顺序），post = 这一帧的 dt 已被仿真吃掉之后。两种相位都必须落到同一个步号：
  // 落地表若还按帧长折算，post 会比 pre 晚 frameMs/步长 步 ⇒ 下面那条相位对照当场转红。
  const dueNow = () => nextSlot * INJECT_EVERY_MS <= (s.clock() - 1000) + 1e-6 && nextSlot * INJECT_EVERY_MS <= total;
  for (let i = 0; i < n; i++) {
    if (phase === 'pre') s.stepFrame(frameMs, () => { while (dueNow()) inject(nextSlot++); });
    else {
      s.stepFrame(frameMs);
      while (dueNow()) inject(nextSlot++);
    }
    if (checkpointAtMs != null && at1s === null && s.clock() - 1000 >= checkpointAtMs - 1e-6) at1s = snapshot(st());
  }
  const view = st();
  return { fps, phase, digest: snapshot(view), at1s, injected, errors: s.errors, sim: view && view.simSteps, state: view && view.state, audio: s.audio, simStepMs: s.env.Herugolf && s.env.Herugolf.simStepMs };
}

// 摘要 = 标量原样 + typed array 的量化指纹与副本（逐格比，不转储）
function snapshot(view) {
  const out = {};
  if (!view) return out;
  for (const [k, v] of Object.entries(view)) {
    if (ArrayBuffer.isView(v)) {
      let fp = 0, sum = 0, nz = 0;
      for (let i = 0; i < v.length; i++) { const q = Math.round(v[i] * 1e6); fp = (Math.imul(fp ^ q, 16777619) >>> 0); sum += v[i]; if (v[i] !== 0) nz++; }
      out[k] = { ta: true, len: v.length, fp, nz, sum: Math.round(sum * 1e6) / 1e6, copy: Array.from(v) };
    } else if (typeof v === 'number') out[k] = Math.round(v * 1e6) / 1e6;
    else if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'number' || typeof vv === 'string' || typeof vv === 'boolean') out[`${k}.${kk}`] = vv;
  }
  return out;
}

const fmtVal = (x) => (x && typeof x === 'object' && x.ta ? `[${x.kind || ''}len=${x.len} fp=${(x.fp >>> 0).toString(16)} nz=${x.nz} sum=${x.sum}]` : String(x));
const sameVal = (x, y) => {
  if (x && typeof x === 'object' && x.ta) return !!y && y.ta && y.len === x.len && y.fp === x.fp && y.nz === x.nz && Math.abs(y.sum - x.sum) < 1e-6;
  return Object.is(x, y);
};

// ─────────────────────────────────────────────── 开跑
const source = readFileSync(BUNDLE, 'utf8');
ok(source.length > 1000, `bundle 读不到或太小（${source.length} 字节）：先 node tools/bundle.mjs`);

const runs = LADDER.map((fps) => runLadder(fps, source, { checkpointAtMs: 1000 }));
const REF = runs[1]; // 60Hz

ok(runs.every((r) => r.digest && Object.keys(r.digest).length > 0), 'HerugolfState 为空 —— harness 取不到状态（三档一致是假绿）');
ok(runs.every((r) => r.errors.length === 0), `沙箱里有未捕获错误：${runs.map((r) => `${r.fps}Hz[${r.errors.slice(0, 2).join(' / ')}]`).join(' ')}`);
note('推进:', runs.map((r) => `${r.fps}Hz 步数=${r.digest.simSteps} 状态=${r.digest.state}/${r.digest.phase} 动数=${r.digest.moves} 画线=${r.digest.drawn} 被挡=${r.digest.blocked} 进洞=${r.digest.solved} 注入=${r.injected}`).join(' ‖ '));

// 1) 这一把真的在关卡里走了子（官方探针做不到的一条）
ok(runs.every((r) => r.digest.state === 'playing'), '有档位没进 playing（键位没绑上？那三档一致也没意义）');
ok(runs.every((r) => (r.digest.moves | 0) > 0), '三档都没走出任何一动 ⇒ 注入没打中玩法，覆盖为零');
ok(runs.every((r) => (r.digest.drawn | 0) > 0), '玩家线一条都没画出来 ⇒ 关卡真值没动过');

// 2) 步号对齐：同一虚拟时长必须跑同样的仿真步数（"推进随帧数"的当场现形处）
const steps = runs.map((r) => r.digest.simSteps);
ok(steps.every((s) => s === steps[0]), `仿真步数随帧率变化：${runs.map((r) => `${r.fps}Hz=${r.digest.simSteps}`).join(' / ')} ⇒ 累加器又吃帧 dt 了`);
note('步数一致性:', steps.join(' = '), '（3 虚拟秒，SIM_STEP_MS=' + STEP_MS.toFixed(6) + '）');
ok(runs.every((r) => Math.abs(r.simStepMs - STEP_MS) < 1e-9), `SIM_STEP_MS 与本尺写死的 ${STEP_MS} 不一致（实为 ${runs.map((r) => r.simStepMs).join('/')}）⇒ 尺要跟着改，别默默失准`);
const EXPECT_STEPS = Math.round(SECONDS * 1000 / STEP_MS);
ok(steps[0] === EXPECT_STEPS, `步数应为 ${EXPECT_STEPS}（3s ÷ 步长），实为 ${steps[0]}`);

// 3) 逐字段比对：三档必须**每个字段**都相等，而不是"看起来差不多"
const keys = [...new Set(runs.flatMap((r) => Object.keys(r.digest)))].sort();
const diffs = [];
for (const k of keys) {
  const vals = runs.map((r) => r.digest[k]);
  if (!(sameVal(vals[0], vals[1]) && sameVal(vals[0], vals[2]))) diffs.push(`${k}: ${vals.map(fmtVal).join(' / ')}`);
}
ok(diffs.length === 0, `三档有 ${diffs.length} 个字段不一致：\n    ${diffs.slice(0, 10).join('\n    ')}`);
const shown = keys.filter((k) => ['state', 'phase', 'seed', 'moves', 'drawn', 'blocked', 'solved', 'selected', 'elapsed', 'simSteps', 'accumMs', 'pAlive', 'pSum', 'pX', 'pLife', 'pKind', 'pulse', 'shake', 'audio.voices'].includes(k));
note('逐字段（30/60/120 同值）:', shown.map((k) => `${k}=${fmtVal(REF.digest[k])}`).join(' '));

// 3.5) 相位对照：注入打在 rAF 之前（浏览器与官方探针的顺序）与打在帧之后，必须逐字段相同。
// 这一条专门逮"按帧长折算落地时刻"的写法：那样 post 相位会比 pre 晚 frameMs/步长 步落地，
// 帧长一变粒子撒射就换槽位 —— 它是 §3 那 8 个字段分叉的病灶，也是官方探针判红的同一件事。
const posts = LADDER.map((fps) => runLadder(fps, source, { phase: 'post' }));
ok(posts.every((r) => r.errors.length === 0), `post 相位沙箱里有未捕获错误：${posts.map((r) => `${r.fps}Hz[${r.errors.slice(0, 2).join(' / ')}]`).join(' ')}`);
const phaseDiff = [];
for (const k of keys) {
  for (let i = 0; i < LADDER.length; i++) {
    if (!sameVal(runs[i].digest[k], posts[i].digest[k])) { phaseDiff.push(`${LADDER[i]}Hz.${k}`); break; }
  }
}
note('注入相位对照（pre=帧前 / post=帧后）:', phaseDiff.length ? `${phaseDiff.length} 档有字段随相位变化（${phaseDiff.slice(0, 6).join(', ')}）` : '三档 pre/post 逐字段相同（落地步号与帧长、相位无关）');
ok(phaseDiff.length === 0, `落地步号随注入相位变化 ⇒ 还在按帧长折算：${phaseDiff.slice(0, 6).join(', ')}`);

// 4) 推进证人：同一档 1s→3s 必须真的动了（否则"三档相等"是静止快照的相等）
const grew = [];
for (const k of keys) {
  const a = REF.at1s && REF.at1s[k];
  if (k in (REF.at1s || {}) && !sameVal(a, REF.digest[k])) grew.push(k);
}
note('1s→3s 推进字段:', `${grew.length} 个（${grew.slice(0, 8).join(', ')}${grew.length > 8 ? ' …' : ''}）`);
ok(grew.length >= 3, '1s→3s 只有 ' + grew.length + ' 个字段在动 ⇒ 尺读不到会动的东西，比对无效');

// 5) 阴性对照：§6 指定的那条线 —— 累加器改吃"每帧固定一份"，本 harness 必须转红
const NEEDLE = 'this.accumMs += ms;';
const hits = source.split(NEEDLE).length - 1;
ok(hits === 1, `找不到唯一的累加线「${NEEDLE}」（命中 ${hits} 处）⇒ 源码改了，这条对照已经失效，必须跟着改`);
const patched = source.replace(NEEDLE, 'this.accumMs += 16.666666666666668;');
ok(patched !== source, '阴性对照没能改写累加线（等于没做对照）');
const ctl = LADDER.map((fps) => runLadder(fps, patched));
const ctlDiff = [];
for (const k of keys) {
  const vals = ctl.map((r) => r.digest[k]);
  if (!(sameVal(vals[0], vals[1]) && sameVal(vals[0], vals[2]))) ctlDiff.push(k);
}
note('阴性对照（累加器吃帧数）:', `步数 ${ctl.map((r) => `${r.fps}Hz=${r.digest.simSteps}`).join(' / ')}；${ctlDiff.length} 个字段跨档不同（${ctlDiff.slice(0, 8).join(', ')}）`);
ok(ctlDiff.length >= 3, `阴性对照只抓到 ${ctlDiff.length} 个字段 ⇒ 这把尺没牙：注入或摘要面出了问题`);
ok(new Set(ctl.map((r) => r.digest.simSteps)).size === 3, '阴性对照下三档步数仍然相同 ⇒ 仿真推进没被改成随帧数，对照无效');

console.log(`RESULT fps-test ok=${fails === 0} checks=${checks} fails=${fails}`);
process.exit(fails === 0 ? 0 : 1);
