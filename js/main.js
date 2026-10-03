// 接线层：DOM、指针 + 键盘输入、计时、存档，以及闸要的 window.herugolf 面。
// 这一层一条规则都不判 —— 盘面上的每个判断都来自 js/engine/（经 js/ui/game.js）。
//
// 默认 seed 取自存档里的自增游标，绝不取 Date.now()：页面上印着 "seed 7" 就必须能用
// 同一个 7 + 同一档重新出同一张盘。闸里那条断言量的是这个（见 tools/scenarios.js 的 play 段）。
import { applyThemeVars, setReduceMotion, systemPrefersReducedMotion, Palette } from './theme.js';
import { Sound } from './audio/synth.js';
import { Store, STORAGE_KEY } from './store.js';
import * as Grid from './engine/grid.js';
import * as Pencil from './engine/pencil.js';
import { countSolutions, answerOf, DEFAULT_BUDGET_NODES } from './engine/counter.js';
import { TIERS, parseTier, shipPuzzle } from './engine/generate.js';
import { routesFor } from './engine/routes.js';
import { verify } from './engine/verify.js';
import { Game, MENU, tierOf, ship, certify, nextDeduction, nowMs } from './ui/game.js';
import { BoardView } from './render/board.js';

const VERSION = '1.0.0';
// 每个文档一个身份：片段跳转不换文档，所以这个身份在 hash 导航后必须还在、真重载后必须消失。
// 它是"续局这一腿跑在新文档里"的证人之一。
const DOC = 'doc' + Math.random().toString(36).slice(2, 10);

const $ = (sel) => document.querySelector(sel);
const el = {
  viewMenu: $('#view-menu'),
  viewGame: $('#view-game'),
  tiers: $('#tier-list'),
  rules: $('#rule-list'),
  records: $('#record-list'),
  resumeCard: $('#resume-card'),
  resumeName: $('#resume-name'),
  resumeMeta: $('#resume-meta'),
  name: $('#stat-name'),
  tier: $('#stat-tier'),
  seed: $('#stat-seed'),
  time: $('#stat-time'),
  strokes: $('#stat-strokes'),
  hints: $('#stat-hints'),
  indone: $('#stat-indone'),
  remaining: $('#stat-remaining'),
  covered: $('#stat-covered'),
  conflicts: $('#stat-conflicts'),
  score: $('#stat-score'),
  genms: $('#stat-genms'),
  hintRule: $('#hint-rule'),
  hintLine: $('#hint-line'),
  hintCount: $('#hint-count'),
  stateLine: $('#state-line'),
  winVeil: $('#win-veil'),
  winMeta: $('#win-meta'),
  winRecord: $('#win-record'),
  wrap: $('#board-wrap'),
  canvas: $('#board'),
};

const store = new Store();
const sound = new Sound(() => store.get('sound'));
const view = new BoardView(el.canvas);
let game = null;
let startedAt = 0;
let baseElapsed = 0;
let ticker = null;

// ---- 键盘到达数：仓里 known flake 是"同一个键盘计数在同样的跑法里读到 0/2/7"，
// 所以这里把派发口径写死成一份可被闸读回的账（seen/handled/repeated/逐键）。
const keys = { seen: 0, handled: 0, repeated: 0, by: {} };

const elapsedMs = () => baseElapsed + (nowMs() - startedAt);
const fmtTime = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function sync() {
  if (!game) return;
  const g = game;
  el.name.textContent = `${g.tier} · ${g.board.w}×${g.board.h} · ${g.balls.length} 球`;
  el.tier.textContent = g.tier;
  el.seed.textContent = `seed ${g.seed}`;
  el.strokes.textContent = String(g.strokeCount);
  el.hints.textContent = String(g.hints);
  el.hintCount.textContent = String(g.hints);
  el.indone.textContent = `${g.doneCount()}/${g.balls.length}`;
  el.remaining.textContent = String(g.balls.length - g.doneCount());
  el.covered.textContent = `${g.own.size}/${g.n}`;
  el.conflicts.textContent = String((g.winErrors || []).length);
  el.score.textContent = g.pencil ? `${g.pencil.steps} 步 · 加权 ${g.pencil.score}` : '—';
  el.genms.textContent = `${g.genMs.toFixed(2)} ms / ${g.attempts || 1} 次尝试`;
  el.stateLine.textContent = g.msg.text;
  el.stateLine.className = `conflict-line ${g.msg.kind}`;
  el.hintRule.textContent = g.lastHint ? `规则：${g.lastHint.rule}` : '提示理由';
  if (g.lastHint) el.hintLine.textContent = g.lastHint.line;
  el.winVeil.hidden = g.status !== 'won';
  if (g.status === 'won') {
    el.winMeta.textContent = `${g.tier} · ${g.strokeCount} 动 · 提示 ${g.hints} 次 · ${fmtTime(elapsedMs())}`;
    // 赢的那一刻记一次档：菜单页那张「纪录（同档比）」的表、和这张卡上的纪录那一行，
    // 吃的都是 store.data.best —— 原来 record() 一个调用者都没有，于是纪录永远是「—」，
    // 而界面上照样印着那句标题（写了不许有，是文档在替树撒谎）。
    if (!g.recorded) {
      g.recorded = true;
      const res = store.record(g.tier, { strokes: g.strokeCount, hints: g.hints, ms: Math.round(elapsedMs()) });
      const best = res.best;
      el.winRecord.textContent = res.improved
        ? `新纪录：${g.tier} 提示 ${best.hints} 次 · ${best.strokes} 动 · ${fmtTime(best.ms)}（累计通关 ${store.data.totals.solved} 盘）`
        : `${g.tier} 的纪录还是那份更好的：提示 ${best.hints} 次 · ${best.strokes} 动 · ${fmtTime(best.ms)}（这一局没刷掉它）`;
    }
  }
  view.draw();
}

function tick() {
  if (!game) return;
  el.time.textContent = fmtTime(elapsedMs());
}

function persist() {
  if (!game) return;
  store.putResume({
    tier: game.tier,
    seed: game.seed,
    cells: game.codes(),
    strokes: game.strokeCount,
    hints: game.hints,
    elapsedMs: Math.round(elapsedMs()),
    savedAt: Date.now(),
  });
}

// ---------- 开局 ----------

function begin({ tier = MENU[0].key, seed = null } = {}) {
  const t = tierOf(tier) ? tier : MENU[0].key;
  const s = Number.isInteger(seed) && seed > 0 ? seed : store.takeSeed();
  const p = ship(s, t);
  if (!p.ok) {
    // 出货通道的账：tries 用尽没出货。界面不许自己造一盘"看起来像"的题面顶上。
    say(`这一档这一次没出货（${p.status}，试了 ${p.attempts} 次）。换一档或按「换一局」重铺。`);
    return null;
  }
  game = new Game(p);
  startedAt = nowMs();
  baseElapsed = 0;
  game.msg = { kind: 'idle', rule: '', text: `球 ${game.selected} 已经选中：这一动正好走 ${game.needOf(game.selected)} 格。蓝圈是它够得着的落点。` };
  // 先让容器可见，再量它：#view-game 还 hidden 时 wrap.clientWidth 是 0，
  // layout() 会退到最小格边长（整盘画成 200px），而玩家第一次看到的就那张小盘，
  // 下一次 layout()（换一局/resize）又把下面所有控件往下推 —— 坐标全漂。
  showGame();
  view.layout(game);
  sync();
  persist();
  startTicker();
  return game;
}

function resumeSaved() {
  const r = store.resume(tierOf);
  if (!r) return null;
  const p = ship(r.seed, r.tier);
  if (!p.ok) return null;
  const g = new Game(p);
  const { applied, refused } = g.setCodes(r.cells);
  // refused<0 = 那串根本读不出格式；refused>0 = 一半落不下去。两种都判"续不上"，
  // 而不是把半截盘画出来 —— 半截盘看起来就像正常在局，玩家分不清。
  if (refused < 0 || refused > 0) return null;
  game = g;
  game.hints = Number.isInteger(r.hints) ? r.hints : 0;
  startedAt = nowMs();
  baseElapsed = Number.isInteger(r.elapsedMs) && r.elapsedMs > 0 ? r.elapsedMs : 0;
  showGame();
  // 续局这一腿原来只调 sync()（= view.draw()），而 view.game 在"从菜单直接续局"时
  // 从来没被 layout() 设过 —— draw() 第一行的 `if (!g) return` 直接收工，
  // 于是玩家按「继续」看到的是一张 300×150 的空画布：档续上了，盘却整个不画。
  view.layout(game);
  sync();
  startTicker();
  return { game, applied, refused };
}

function startTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(tick, 250);
  tick();
}

function say(text) {
  el.stateLine.textContent = text;
  el.stateLine.className = 'conflict-line deny';
}

function showGame() {
  el.viewMenu.hidden = true;
  el.viewGame.hidden = false;
  el.canvas.focus({ preventScroll: true });
}

function showMenu() {
  persist();
  el.viewGame.hidden = true;
  el.viewMenu.hidden = false;
  renderMenu();
}

// ---------- 输入 ----------

// 指针与键盘都收敛到"落一步 + 同一套副作用"这一个出口。场景腿写格子走的也是它 ——
// 于是"页内写"与"真事件"落进的是同一个状态机，不会各测各的。
function settle(before, msg) {
  if (!game) return msg;
  if (game.strokeCount > before) sound.play(game.inHole(game.selected) ? 'hole' : 'stroke');
  else if (msg && msg.kind === 'deny') sound.play('deny');
  sync();
  tick();
  persist();
  return msg;
}

function clickCell(cell) {
  if (!game || cell < 0) return null;
  const before = game.strokeCount;
  return settle(before, game.tap(cell));
}

// 方向键给的是 (行,列)：出界的照递 —— "开出盘外"必须报 R4，不许在界面上被吞掉
function keyRC(r, c) {
  if (!game) return null;
  const before = game.strokeCount;
  return settle(before, game.tapRC(r, c));
}

function pressKey(e) {
  if (!game) return false;
  const k = e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
    const dir = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    const at = game.tipOf(game.selected);
    const [r, c] = game.board.rc(at);
    // 距离由球里的数字定死（R2），所以一个方向键就是一次完整落子，不需要"先瞄准再确认"
    const d = game.needOf(game.selected);
    keyRC(r + dir[0] * d, c + dir[1] * d);
    e.preventDefault();
    return true;
  }
  if (k === ' ') {
    const list = game.balls;
    const at = list.indexOf(game.selected);
    clickCell(list[(at + 1) % list.length]);
    e.preventDefault();
    return true;
  }
  if (k === 'Backspace' || k === 'z' || k === 'Z') {
    game.undo();
    sound.play('stroke');
    sync();
    persist();
    e.preventDefault();
    return true;
  }
  if (k === 'h' || k === 'H') {
    useHint();
    e.preventDefault();
    return true;
  }
  return false;
}

function useHint() {
  if (!game) return null;
  const info = game.hint();
  sync();
  tick();
  persist();
  return info;
}

el.canvas.addEventListener('pointerdown', (e) => {
  if (!game) return;
  e.preventDefault();
  el.canvas.focus({ preventScroll: true });
  clickCell(view.cellAt(e.clientX, e.clientY));
});
el.canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (game && game.selected !== null) {
    game.popAll(game.selected);
    sync();
    persist();
  }
});
document.addEventListener(
  'keydown',
  (e) => {
    keys.seen++;
    keys.by[e.key] = (keys.by[e.key] || 0) + 1;
    if (e.repeat) keys.repeated++;
    // 焦点在按钮上时键盘属于那个按钮（空格/回车就是它的激活键），不许同时再驱动棋盘
    const onButton = e.target && e.target.tagName === 'BUTTON';
    if (!onButton && pressKey(e)) keys.handled++;
  },
  true
);

// 按钮
$('#btn-hint').addEventListener('click', useHint);
$('#btn-undo').addEventListener('click', () => {
  if (!game) return;
  game.undo();
  sync();
  persist();
});
$('#btn-new').addEventListener('click', () => begin({ tier: game ? game.tier : MENU[0].key }));
$('#btn-menu').addEventListener('click', showMenu);
$('#btn-menu-2').addEventListener('click', showMenu);
$('#btn-again').addEventListener('click', () => begin({ tier: game ? game.tier : MENU[0].key }));
$('#btn-resume').addEventListener('click', () => {
  const r = resumeSaved();
  if (!r) say('续不上那份档（题面重出不来或存档读不出档位）。');
});
$('#btn-sound').addEventListener('click', (e) => {
  const on = !store.get('sound');
  store.set('sound', on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
  e.currentTarget.textContent = on ? '音效 开' : '音效 关';
  if (on) sound.play('stroke');
});
$('#btn-motion').addEventListener('click', (e) => {
  const on = !store.get('motion');
  store.set('motion', on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
  e.currentTarget.textContent = on ? '动效 全' : '动效 简';
  setReduceMotion(!on);
});
$('#btn-reset').addEventListener('click', () => {
  store.reset();
  game = null;
  renderMenu();
  showMenu();
  sync2();
});

function sync2() {
  el.stateLine.textContent = '存档已清空：seed 游标回到 1，纪录与续局都从头开始。';
  el.stateLine.className = 'conflict-line';
}

// ---------- 选档页 ----------

function renderMenu() {
  el.tiers.innerHTML = '';
  for (const t of MENU) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier';
    b.id = `btn-tier-${t.key.replace('/', '-')}`;
    b.innerHTML = `<b>${t.key}</b><span class="mono">${t.w}×${t.h} · ${t.balls} 球</span>`;
    b.addEventListener('click', () => begin({ tier: t.key }));
    el.tiers.appendChild(b);
  }
  el.records.innerHTML = '';
  for (const t of MENU) {
    const li = document.createElement('li');
    const best = store.data.best[t.key];
    li.innerHTML = `<span>${t.key}</span><span class="mono">${best ? `提示 ${best.hints} · ${best.strokes} 动 · ${fmtTime(best.ms)}` : '—'}</span>`;
    el.records.appendChild(li);
  }
  const r = store.resume(tierOf);
  el.resumeCard.hidden = !r;
  if (r) {
    el.resumeName.textContent = `未完成的 ${r.tier}`;
    const lines = r.cells ? r.cells.split(';').filter(Boolean).length : 0;
    el.resumeMeta.textContent = `seed ${r.seed} · ${lines} 条线 · 存档于 ${new Date(r.savedAt || Date.now()).toLocaleTimeString('zh-CN')}`;
  }
}

function renderRules() {
  el.rules.innerHTML = '';
  for (const name of Pencil.RULE_ORDER) {
    const li = document.createElement('li');
    li.textContent = Pencil.RULE_TEXT[name];
    li.dataset.rule = name;
    el.rules.appendChild(li);
  }
}

// ---------- 深链：#t=10x10/5&s=7 ----------
// 为什么走 hash 而不是 query：闸的"片段导航不算重载"那条腿要的就是同文档换 hash，
// 而这一份深链在**开机时**读一次就够（换 hash 不重开一局，那是另一条腿断言的事）。
function deepLink() {
  const m = /[#&]t=([^&]+)(?:[#&]s=([0-9]+))?/.exec(location.hash || '');
  if (!m) return null;
  const tier = decodeURIComponent(m[1]);
  if (!tierOf(tier)) return null;
  return { tier, seed: m[2] ? Number(m[2]) : null };
}

function boot() {
  applyThemeVars();
  const motionOn = store.get('motion') !== false && !systemPrefersReducedMotion();
  setReduceMotion(!motionOn);
  $('#btn-motion').setAttribute('aria-pressed', String(motionOn));
  $('#btn-motion').textContent = motionOn ? '动效 全' : '动效 简';
  $('#btn-sound').setAttribute('aria-pressed', String(store.get('sound')));
  $('#btn-sound').textContent = store.get('sound') ? '音效 开' : '音效 关';
  renderRules();
  renderMenu();
  const link = deepLink();
  if (link) {
    const g = begin({ tier: link.tier, seed: link.seed });
    if (g) {
      el.stateLine.textContent = `深链开局：${link.tier} · seed ${link.seed}`;
      return;
    }
  }
  if (!store.lastLoad.ok) say(`存档读不懂：${store.lastLoad.why}。已按"没有存档"继续。`);
  showMenu();
}

addEventListener('pagehide', persist);
addEventListener('resize', () => {
  if (game && !el.viewGame.hidden) view.layout(game);
});
addEventListener('error', (e) => {
  (window.__bootErrors || (window.__bootErrors = [])).push(String(e.message || e));
});

boot();

// ---------- 闸要的这盘面 ----------
window.herugolf = {
  version: VERSION,
  doc: DOC,
  engine: {
    Game,
    TIERS,
    parseTier,
    tierOf,
    ship,
    shipPuzzle,
    certify,
    countSolutions,
    answerOf,
    DEFAULT_BUDGET_NODES,
    verify,
    routesFor,
    nextDeduction,
    Store: store,
    STORAGE_KEY,
    RULE_ORDER: Pencil.RULE_ORDER,
    RULE_TEXT: Pencil.RULE_TEXT,
    RULE_WEIGHT: Pencil.RULE_WEIGHT,
    serializeBoard: Grid.serializeBoard,
    parseBoard: Grid.parseBoard,
    serializeAnswer: Grid.serializeAnswer,
    parseAnswer: Grid.parseAnswer,
    Board: Grid.Board,
    DIRS: Grid.DIRS,
  },
  get game() {
    return game;
  },
  view,
  palette: Palette,
  begin,
  click: clickCell,
  // 场景写格子用的那支笔：与指针落到同一个入口（先选球，再点落点）
  write(ball, cell) {
    if (!game) return null;
    if (game.selected !== ball) game.tap(ball);
    return clickCell(cell);
  },
  useHint,
  undo: () => {
    if (!game) return null;
    game.undo();
    sync();
    persist();
    return game.msg;
  },
  persistNow: persist,
  state: () => ({
    elapsedMs: game ? elapsedMs() : 0,
    status: game ? game.status : 'menu',
    strokes: game ? game.strokeCount : 0,
    hints: game ? game.hints : 0,
    covered: game ? game.own.size : 0,
    remaining: game ? game.balls.length - game.doneCount() : 0,
    doc: DOC,
    seedCounter: store.peekSeed(),
    bootErrors: (window.__bootErrors || []).length,
  }),
  keyHits: () => ({ seen: keys.seen, handled: keys.handled, repeated: keys.repeated, by: { ...keys.by } }),
  showMenu,
  showGame,
};

// ---- 全屏开关 ----
//
// 绑到 index.html 的 HUD 里真实存在的 #btn-fullscreen。
// 只在 js 里留一串 requestFullscreen 能骗过字符串扫描，但按钮不在 DOM 里就是死代码：
// 玩家按不到，功能等于没做。所以 id 必须与 HTML 里的按钮对得上，缺失时要在控制台喊出来。
//
// 三套 API 一律**特性探测**，不做 UA 判断：iPhone 版 Safari 压根没有元素全屏（只有 <video> 能全屏），
// 老 Edge 只认 ms 前缀，Firefox 认 moz 前缀。UA 字符串是猜的，方法在不在是量的，猜错就静默失效。
function fsRoot() {
  return document.documentElement;
}

function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function fsRequest(root) {
  // 老 Edge 的 msRequestFullscreen 挂在元素上，和标准名同一个位置，所以并排取即可。
  return root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen || null;
}

// iOS Safari 会把非 video 元素的请求直接 reject 成 NotAllowedError。
// 这个 promise 没人接就升级成 unhandledrejection，冒到 window.onerror——离屏预载时足以把整页判死。
// 因此凡是可能返回 promise 的调用，返回值一律就地吞掉，绝不让拒绝逃出这一层。
function fsQuiet(p) {
  if (p && typeof p.catch === 'function') p.catch(() => {});
  return p;
}

// 返回 true=请求进入，false=请求退出，null=不支持（调用方据此禁用按钮）。
function toggleFullscreen(root) {
  const req = fsRequest(root);
  if (!req) return null;
  if (fsElement()) {
    // 退出侧同样要兜底：老 Edge 是 msExitFullscreen；万一三者皆无就当无事发生，不抛。
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) fsQuiet(exit.call(document));
    return false;
  }
  // 部分实现（如被 Permissions-Policy 挡住的 iframe）会同步抛，所以 catch 和 .catch 两头都要接。
  try {
    fsQuiet(req.call(root));
  } catch (err) {
    // 拒绝即降级：静默保持当前形态，不冒泡、不打断这一局的其余逻辑。
  }
  return true;
}

function bindFullscreen(btn) {
  const root = fsRoot();

  // 状态回写：Esc 和 iOS 下滑手势退出时不会经过按钮，
  // 只有 fullscreenchange 事件能把按钮的文案/字形拉回正确状态，否则它会一直假装自己在全屏里。
  const sync = () => {
    const on = !!fsElement();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    btn.title = on ? "退出全屏 (F)" : "全屏 (F)";
    document.body.classList.toggle('is-fullscreen', on);
    return on;
  };

  if (!fsRequest(root)) {
    // 不支持就要说明为什么：只把按钮变灰，玩家会以为这活根本没做完。
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」）';
    return;
  }

  btn.addEventListener('click', () => {
    toggleFullscreen(root);
    sync();
  });

  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);

  window.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // 正在输入框里打字时不劫持按键，否则会打不出 f。
    if (ev.target && /^(input|textarea|select)$/i.test(ev.target.tagName)) return;
    if (ev.key === "f" || ev.key === "F") {
      ev.preventDefault();
      toggleFullscreen(root);
      sync();
    }
  });

  sync();
}

function bootFullscreen() {
  const btn = document.getElementById("btn-fullscreen");
  if (!btn) {
    // 按钮被谁删掉了？在控制台喊出来，别让这个坑静默地烂在下一棒手里。
    console.warn('[fullscreen] index.html 里找不到 #' + "btn-fullscreen" + '，全屏开关没有入口');
    return;
  }
  bindFullscreen(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootFullscreen);
} else {
  bootFullscreen();
}
