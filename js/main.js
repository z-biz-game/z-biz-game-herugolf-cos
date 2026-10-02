// 引导层：把 core（无 DOM）+ render + ui 接起来，跑 rAF，管资产与 service worker。
//
// 三条不是可有可无的口径：
//   · 窗口状态挂出去（window.Herugolf / window.HerugolfState）：任何探针读不到状态的仓，
//     判据都无法复验 —— 那一行"结论：无法比对"就是这么来的。
//   · file:// 下整段跳过 SW 注册且不抛未捕获异常（本仓的产物要能被双击打开）。
//   · 帧 dt 只喂给 game.update()，渲染层不参与推进仿真；暂停时 update 直接返回 0 步。
import { HerugolfGame, SIM_DT, SIM_STEP_MS } from './core/game.js';
import { Renderer } from './render/board.js';
import { createHud } from './ui/hud.js';
import { Sfx } from './core/audio.js';
import { loadStore, writeStore, upsertRun, recordWin, SAVE_KEY } from './core/save.js';

const ART = [
  ['paper', 'web/img/paper-256.png'],
  ['pond', 'web/img/pond-128.png'],
  ['ball', 'web/img/ball-96.png'],
  ['hole', 'web/img/hole-96.png'],
  ['particles', 'web/img/particles-128.png'],
];

export function boot(doc, win) {
  const now = () => (win.performance && win.performance.now ? win.performance.now() : 0);
  // 存档介质：boot 时做一次**写入回读探针**，不是"拿到对象就当它能用"。
  // 隐私模式里 getItem 好使、setItem 才抛；有些宿主给的对象 getItem 恒返回 null ——
  // 这两种都只有真写过一次才知道。探针失败就退回内存档继续跑（不拦开局），事实挂到 window 上。
  const PROBE_KEY = SAVE_KEY + ':probe';
  let storageReport = 'ok';
  const storage = (() => {
    try {
      if (!win.localStorage) return null;
      win.localStorage.setItem(PROBE_KEY, '1');
      if (win.localStorage.getItem(PROBE_KEY) !== '1') { storageReport = 'read-back-mismatch'; return null; }
      win.localStorage.removeItem(PROBE_KEY);
      return win.localStorage;
    } catch (e) {
      storageReport = 'unavailable:' + (e && e.name ? e.name : e);
      return null;
    }
  })();

  const store = loadStore(storage);
  const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = !!(mq && mq.matches);

  const game = new HerugolfGame({ seed: 7, tierKey: store.store.prefs.tier, reduceMotion: reduced, clock: now });
  const canvas = doc.getElementById('board');
  const renderer = new Renderer(canvas);
  const sfx = new Sfx(win.AudioContext || win.webkitAudioContext || null);
  if (store.store.prefs.muted) sfx.setMuted(true);

  const wrap = doc.getElementById('boardwrap');
  const viewSize = () => {
    const rect = wrap && wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : null;
    const w = (rect && rect.width) || win.innerWidth || 960;
    const h = (rect && rect.height) || win.innerHeight || 700;
    return [w, h];
  };
  const relayout = () => {
    const [w, h] = viewSize();
    renderer.resize(w, h, game.board);
  };

  const out = {};
  const save = () => {
    const snap = game.snapshot();
    upsertRun(store.store, snap);
    if (game.state === 'won') recordWin(store.store, snap);
    const r = writeStore(storage, store.store);
    out.lastWrite = r;
    return r;
  };

  const hud = createHud({ doc, win, game, renderer, sfx, store, onSave: save, onAudio: null });
  hud.resumeRun = () => {
    const run = store.store.runs[0];
    if (!run) { hud.say('没有可继续的存档'); return false; }
    game.restore(run);
    hud.say('继续存档：seed ' + run.seed + ' · ' + run.tier);
    relayout();
    return true;
  };
  hud.bind();

  // 有存档就把最近一局端上来（不是只写不读的装饰性 localStorage 键）
  if (store.store.runs.length) {
    const run = store.store.runs[0];
    game.restore(run);
    hud.say('已继续上一局（seed ' + run.seed + ' · ' + run.tier + '）');
  }
  if (store.store.prefs.muted) {
    hud.ui.mute.setAttribute('aria-pressed', 'true');
    hud.ui.mute.textContent = '音效 关';
  }
  relayout();
  hud.openOverlay('title');
  hud.sync();

  const loaded = {};
  if (typeof win.Image === 'function') {
    for (const [key, src] of ART) {
      const img = new win.Image();
      loaded[key] = img;
      img.onload = () => renderer.setArt(loaded);
      img.src = src;
    }
  }

  if (mq) {
    const onMq = () => game.setReduceMotion(!!mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq);
  }
  if (win.addEventListener) {
    win.addEventListener('resize', relayout);
    win.addEventListener('orientationchange', relayout);
  }

  // 上一段动完就落一次档；win 也落（win 走 save 里的 recordWin）
  let lastState = game.state;
  let lastMoves = game.moves;
  let frames = 0;
  // 仿真位置不在这里算：core 用同一只钟（performance.now）配时间账本自己决定这一帧能推进到
  // 哪个虚拟时刻。帧回调的 t 只是"第几帧被打断"的信息，拿它当计时器 = 把刷新率漏进仿真。
  const frame = () => {
    game.update();
    if (game.events.length) {
      // 玩法声音只在这一处响：处理器里再按返回值补一次 = blocked 响两下（实测口径）。
      for (const e of game.events) {
        if (e === 'stroke') sfx.blip('stroke');
        else if (e === 'undo') sfx.blip('ui');
        else if (e === 'hole') sfx.blip('hole');
        else if (e === 'win') sfx.blip('win');
        else if (e === 'blocked') sfx.blip('blocked');
      }
      game.events.length = 0;
    }
    if (game.state !== lastState || game.moves !== lastMoves) {
      lastState = game.state;
      lastMoves = game.moves;
      save();
      hud.sync();
    }
    renderer.draw(game);
    frames++;
    if (win.requestAnimationFrame) win.requestAnimationFrame(frame);
  };

  // 探针/对拍读的就是这一份，而且它是**活视图**（getter 转发），不是每 8 帧抄一次的快照。
  // 抄那份是实测出来的坑：官方尺子按完按钮的同一刻就读状态，中间不推进帧 ——
  // 活对象说 playing、抄本还说 title，于是三档各自走上不同的注入路径（seed 7 vs 8 就是这么来的）。
  const view = () => game.inspect();
  const published = {};
  const expose = (k) => Object.defineProperty(published, k, { enumerable: true, get: () => view()[k] });
  for (const k of Object.keys(view())) expose(k);
  const exposeAt = (k, get) => Object.defineProperty(published, k, { enumerable: true, get });
  exposeAt('audio', () => sfx.state());
  exposeAt('art', () => Object.keys(loaded).length);
  exposeAt('storage', () => storageReport);
  exposeAt('lastWrite', () => (out.lastWrite ? out.lastWrite.ok : false));
  // 帧计数**不**进这份视图：它按定义随刷新率变化（30/60/120 各 90/180/360），挂在状态面上
  // 等于让"跨档可比"这件事自己红一条 —— 要看它在 api.frames() 上。
  // 粒子真值是共享数组（就地改写），直接挂引用
  published.pX = game.pX;
  published.pY = game.pY;
  published.pVX = game.pVX;
  published.pVY = game.pVY;
  published.pLife = game.pLife;
  published.pKind = game.pKind;
  const publish = () => published;

  const api = {
    game, renderer, hud, sfx, store, sfxState: () => sfx.state(),
    state: published,
    start: () => { hud.act('start'); return game.state; },
    startLevel: (seed, tier) => {
      if (seed != null || tier != null) game.build(seed == null ? game.seed : Number(seed), tier || game.tierKey);
      game.state = 'playing';
      relayout();
      hud.sync();
      return game.state;
    },
    pause: () => { game.pause(); sfx.suspendForPause(); return game.state; },
    resume: () => { game.resume(); sfx.resumeFromPause(); return game.state; },
    reset: () => { game.reset(true); relayout(); return game.state; },
    saveKey: SAVE_KEY,
    simDt: SIM_DT,
    simStepMs: SIM_STEP_MS,
    publish,
  };

  Object.assign(out, { game, renderer, hud, sfx, store, api, frames: () => frames, published });
  win.Herugolf = api;
  win.HerugolfState = published;
  win.game = api;

  if (win.requestAnimationFrame) win.requestAnimationFrame(frame);

  // SW：file:// 下整段跳过（那条路径下注册必然抛，且抛在玩家第一次双击 index.html 的时候）
  const isFile = win.location && win.location.protocol === 'file:';
  if (!isFile && 'serviceWorker' in (win.navigator || {})) {
    try {
      const reg = win.navigator.serviceWorker.register('sw.js');
      if (reg && reg.catch) reg.catch(() => { out.swError = 'register-rejected'; });
    } catch (e) {
      out.swError = e && e.name ? e.name : 'register-failed';
    }
  } else {
    out.swSkipped = isFile ? 'file://' : 'no-sw-api';
  }

  return out;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const start = () => { window.__herugolf = boot(document, window); };
  if (document.readyState === 'loading' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
