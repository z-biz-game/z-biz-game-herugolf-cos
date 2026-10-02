// DOM 那一层：按钮、键盘、指针、说明卡、HUD 读数。它只**调用** game 的方法，不持有玩法。
//
// 输入三条硬口径（派工简报 §2）：
//   · pointerdown 优先，没有 PointerEvent 才回落 touchstart/mousedown；
//   · 画布坐标一律按 getBoundingClientRect + clientX 换算（CSS 缩放/滚动都算进去），
//     否则手机上点 A 打 B；
//   · 键盘覆盖 Enter/Space 开局、P 暂停、R 重开、M 静音、F 全屏、H/? 教学、U 撤销、N 下一局。
//     Space **不参与暂停**：官方探针会注入 Space，把它当暂停用会让"进没进玩法态"这件事被自己按灭。
//   · 方向键 = 走一动（0=上 1=右 2=下 3=左，与滑动那条同一套编号），键盘要能打完玩法，不只是开菜单。
export const KEYS = {
  Enter: 'start', ' ': 'start', p: 'pause', P: 'pause', r: 'reset', R: 'reset',
  n: 'next', N: 'next', u: 'undo', U: 'undo', m: 'mute', M: 'mute', f: 'full', F: 'full',
  h: 'help', H: 'help', '?': 'help', Escape: 'close', g: 'hint', G: 'hint',
};
export const DIR_KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };

export function createHud({ doc, win, game, renderer, sfx, store, onSave, onAudio }) {
  const el = (id) => doc.getElementById(id);
  const ui = {
    canvas: el('board'), boardwrap: el('boardwrap'), msg: el('msg'), overlay: el('overlay'),
    title: el('ov-title'), help: el('ov-help'), start: el('btn-start'), pause: el('btn-pause'),
    undo: el('btn-undo'), reset: el('btn-reset'), next: el('btn-next'), hint: el('btn-hint'),
    mute: el('btn-mute'), full: el('btn-full'), helpBtn: el('btn-help'), close: el('btn-close'),
    tier: el('sel-tier'), statSolved: el('stat-solved'), statMoves: el('stat-moves'),
    statTime: el('stat-time'), statTier: el('stat-tier'), statBest: el('stat-best'), statSrc: el('stat-src'),
    continueBtn: el('btn-continue'),
  };
  const out = { ui, bound: false };

  for (const key of ['8x8/4', '10x10/5', '10x10/6', '12x12/7', '15x15/9', '18x18/11']) {
    const o = doc.createElement('option');
    o.value = key;
    o.textContent = key;
    ui.tier.appendChild(o);
  }
  ui.tier.value = store.store.prefs.tier;

  const say = (text) => {
    ui.msg.textContent = text || '';
  };

  const openOverlay = (which) => {
    ui.overlay.hidden = false;
    ui.title.hidden = which !== 'title';
    ui.help.hidden = which !== 'help';
    out.overlayOpen = which;
  };
  const closeOverlay = () => {
    ui.overlay.hidden = true;
    ui.title.hidden = true;
    ui.help.hidden = true;
    out.overlayOpen = '';
  };

  // ── 画布坐标：CSS → 逻辑（这一步错了，手机上的点击就全偏） ──────────
  const toLogical = (clientX, clientY) => {
    const rect = ui.canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? renderer.viewW / rect.width : 1;
    const sy = rect.height > 0 ? renderer.viewH / rect.height : 1;
    return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
  };

  const act = (name) => {
    switch (name) {
      case 'start':
        // 改写仿真的那一下全部排队（见 game.dueStep）：同步改写会让同一次按键在 30Hz 落在
        // 第 8 步、120Hz 落在第 11 步，粒子抢槽位与 shake 的阻尼长度从此跨档错开。
        // DOM（关浮层）与音效不参与仿真，就地做。
        if (game.state === 'title') { game.input(() => game.start()); closeOverlay(); sfx.blip('ui'); }
        else if (game.state === 'won') { doNext(); }
        else if (game.state === 'paused') { game.input(() => game.resume()); sfx.resumeFromPause(); }
        break;
      case 'pause':
        if (game.state === 'playing') { game.input(() => game.pause()); sfx.suspendForPause(); say('暂停中（P 继续）'); }
        else if (game.state === 'paused') { game.input(() => game.resume()); sfx.resumeFromPause(); say(''); }
        break;
      case 'reset': {
        const before = { moves: game.moves, lines: game.lines.size, p: game.pAlive, steps: game.simSteps };
        game.reset(true);
        closeOverlay();
        persist();
        say('重开：动数 ' + before.moves + '→' + game.moves + '、玩家线 ' + before.lines + '→' + game.lines.size + '、粒子 ' + before.p + '→' + game.pAlive);
        sfx.blip('ui');
        break;
      }
      case 'next': doNext(); break;
      case 'undo': game.input(() => game.undo()); break;
      case 'mute': {
        const muted = sfx.setMuted(!sfx.muted);
        if (!muted) sfx.resumeFromPause();
        ui.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
        ui.mute.textContent = muted ? '音效 关' : '音效 开';
        store.store.prefs.muted = muted;
        persist();
        say(muted ? '静音：AudioContext 已 suspend，且不再新建振荡器' : '音效恢复');
        if (onAudio) onAudio(sfx.state());
        break;
      }
      case 'full': doFull(); break;
      case 'help': openOverlay(out.overlayOpen === 'help' ? '' : 'help'); sfx.blip('ui'); break;
      case 'hint': doHint(); break;
      case 'close':
        if (game.state === 'title') openOverlay('title');
        else closeOverlay();
        break;
      default: break;
    }
    sync();
  };

  // 方向键走一动：与滑动那条同一条 game.strokeDir，只是输入设备不同
  const actDir = (dir) => {
    if (game.state === 'title') { act('start'); return; }
    if (game.state !== 'playing') return;
    // 声音与存档都由落地后的事件驱动（game.strokeDir 会推 'stroke'/'blocked'，帧循环负责放）：
    // 处理器这里不能再按返回值 blip 一次，否则 blocked 每次都响两下。
    game.input(() => game.strokeDir(dir));
    sync();
  };

  const doNext = () => {
    game.nextPuzzle();
    closeOverlay();
    persist();
    say('第 ' + game.seed + ' 号盘面 · ' + game.tierKey);
    sfx.blip('ui');
  };

  const doFull = () => {
    const de = doc.documentElement;
    const already = doc.fullscreenElement || doc.webkitFullscreenElement;
    try {
      if (already) {
        (doc.exitFullscreen || doc.webkitExitFullscreen || function () {}).call(doc);
      } else if (de.requestFullscreen) de.requestFullscreen();
      else if (de.webkitRequestFullscreen) de.webkitRequestFullscreen();
      else say('这台设备没有全屏 API');
    } catch (e) {
      say('全屏被浏览器拦下了：' + (e && e.name ? e.name : e));
    }
  };

  // 提示：拿铅笔（零猜测求解器）的那条"单走法"，而不是把答案直接画出来
  const doHint = () => {
    if (game.state !== 'playing') { say('先开局才有提示'); return; }
    const list = game.board.cellList();
    for (const b of list) {
      const stops = game.lines.get(b) || [];
      const k0 = game.board.balls.get(b);
      if (stops.length === k0) continue;
      const cands = (game.cands.get(b) || []).filter((rt) => {
        for (let i = 0; i < stops.length; i++) if (rt.stops[i] !== stops[i]) return false;
        return true;
      });
      if (cands.length === 1) {
        const want = stops.length + 1;
        game.input(() => { game.selected = b; });
        say('提示：' + k0 + ' 号球只剩一条走法，第 ' + want + ' 动往 ' + dirName(stops, cands[0], want) + '（G 再来一条）');
        sfx.blip('ui');
        return;
      }
    }
    say('这一手没有"唯一走法"可指：先想必经格与洞唯一来客');
  };

  const dirName = (stops, route, want) => {
    const from = stops.length ? stops[stops.length - 1] : route.start;
    const to = route.stops[want - 1];
    const [r0, c0] = game.board.rc(from);
    const [r1, c1] = game.board.rc(to);
    if (r1 < r0) return '上';
    if (r1 > r0) return '下';
    if (c1 > c0) return '右';
    return '左';
  };

  const persist = () => {
    if (onSave) onSave();
  };

  // ── 指针：pointerdown 优先，回落 touch/mouse ───────────────────────
  const drag = { active: false, x0: 0, y0: 0, cell: -1, moved: false };

  const onDown = (x, y, pointerId) => {
    if (game.state === 'title') { act('start'); return; }
    if (game.state !== 'playing') return;
    const [lx, ly] = toLogical(x, y);
    const cell = hit(lx, ly);
    drag.active = true;
    drag.x0 = x;
    drag.y0 = y;
    drag.cell = cell;
    drag.moved = false;
    if (cell >= 0) game.ripple(cell);
    if (pointerId != null && ui.canvas.setPointerCapture) {
      try { ui.canvas.setPointerCapture(pointerId); } catch (e) { /* 桩里没有也不影响 */ }
    }
  };

  const onMove = (x, y) => {
    if (!drag.active) return;
    const dx = x - drag.x0;
    const dy = y - drag.y0;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    drag.moved = true;
    const target = drag.cell >= 0 ? drag.cell : game.selected;
    game.input(() => {
      if (target != null && game.board.balls.has(target)) game.selected = target;
      game.strokeDir(dir);
    });
    drag.x0 = x;
    drag.y0 = y;
    sync();
  };

  const onUp = (x, y) => {
    if (!drag.active) return;
    const wasSwipe = drag.moved;
    drag.active = false;
    if (wasSwipe || game.state !== 'playing') return;
    const [lx, ly] = toLogical(x, y);
    const cell = hit(lx, ly);
    if (cell < 0) return;
    // 选中与画线都排到定步长边界上；通关的音效/落档由 'win' 事件在帧循环里统一处理
    if (game.board.balls.has(cell)) {
      sfx.blip('ui'); // 选中是纯反馈，不参与仿真，就地响
      game.input(() => game.select(cell));
    } else {
      game.input(() => game.strokeTo(cell));
    }
    sync();
  };

  const hit = (lx, ly) => hitCellSafe(lx, ly);
  const hitCellSafe = (lx, ly) => {
    if (!game.board) return -1;
    const L = renderer.layout;
    if (!L) return -1;
    const c = Math.floor((lx - L.ox) / L.cell);
    const r = Math.floor((ly - L.oy) / L.cell);
    if (!game.board.inb(r, c)) return -1;
    return game.board.idx(r, c);
  };

  const bind = () => {
    if (out.bound) return;
    out.bound = true;
    if (win.PointerEvent && ui.canvas.addEventListener) {
      ui.canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(e.clientX, e.clientY, e.pointerId); });
      ui.canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
      ui.canvas.addEventListener('pointerup', (e) => onUp(e.clientX, e.clientY));
      ui.canvas.addEventListener('pointercancel', () => { drag.active = false; });
    } else {
      if (ui.canvas.addEventListener) {
        ui.canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; onDown(t.clientX, t.clientY, null); }, { passive: true });
        ui.canvas.addEventListener('touchmove', (e) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: true });
        ui.canvas.addEventListener('touchend', (e) => { const t = (e.changedTouches || [])[0] || { clientX: drag.x0, clientY: drag.y0 }; onUp(t.clientX, t.clientY); }, { passive: true });
        ui.canvas.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY, null));
        ui.canvas.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
        ui.canvas.addEventListener('mouseup', (e) => onUp(e.clientX, e.clientY));
      }
    }

    const onKey = (e) => {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '')) return;
      const dir = DIR_KEYS[e.key];
      const name = KEYS[e.key];
      if (dir === undefined && !name) return;
      e.preventDefault();
      if (dir !== undefined) { actDir(dir); return; }
      act(name);
    };
    // 只绑 document，不"顺手"再绑一份 window：真浏览器里 keydown 先过 document 再冒泡到 window，
    // 两边都绑 = 按一下跑两次（撤销按一次少两动）。document 没有 addEventListener 才退回 window。
    if (doc.addEventListener) doc.addEventListener('keydown', onKey);
    else if (win.addEventListener) win.addEventListener('keydown', onKey);

    const map = {
      'btn-start': 'start', 'btn-pause': 'pause', 'btn-reset': 'reset', 'btn-next': 'next',
      'btn-undo': 'undo', 'btn-mute': 'mute', 'btn-full': 'full', 'btn-help': 'help',
      'btn-hint': 'hint', 'btn-close': 'close', 'btn-close-2': 'close',
    };
    for (const [id, name] of Object.entries(map)) {
      const node = el(id);
      if (node && node.addEventListener) node.addEventListener('click', () => act(name));
    }
    if (ui.continueBtn && ui.continueBtn.addEventListener) {
      ui.continueBtn.addEventListener('click', () => {
        if (out.resumeRun && out.resumeRun()) closeOverlay();
        sync();
      });
    }
    if (ui.tier.addEventListener) {
      ui.tier.addEventListener('change', () => {
        store.store.prefs.tier = ui.tier.value;
        game.setTier(ui.tier.value);
        persist();
        say('换档：' + ui.tier.value);
        sync();
      });
    }
    if (doc.addEventListener) {
      doc.addEventListener('visibilitychange', () => {
        if (doc.hidden && game.state === 'playing') { game.input(() => game.pause()); sfx.suspendForPause(); sync(); }
      });
    }
  };

  const fmt = (secs) => {
    const s = Math.max(0, Math.floor(secs));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  const sync = () => {
    const total = game.board ? game.board.balls.size : 0;
    if (ui.statSolved) ui.statSolved.textContent = game.solved + '/' + total;
    if (ui.statMoves) ui.statMoves.textContent = String(game.moves);
    if (ui.statTime) ui.statTime.textContent = fmt(game.elapsed);
    if (ui.statTier) ui.statTier.textContent = game.tierKey;
    if (ui.statSrc) ui.statSrc.textContent = game.shipped ? '引擎双条件认证' : '退到官方例题';
    const best = store.store.best[game.tierKey];
    if (ui.statBest) ui.statBest.textContent = best ? best.moves + ' 动 / ' + fmt(best.secs) : '—';
    if (ui.pause) ui.pause.textContent = game.state === 'paused' ? '继续 P' : '暂停 P';
    if (ui.start) ui.start.textContent = game.state === 'title' ? '開始 Enter' : game.state === 'won' ? '下一局 Enter' : '游戏中';
    if (game.message && game.messageClock < 4 && ui.msg.textContent !== game.message) say(game.message);
    if (game.state === 'won' && ui.msg.textContent === '') say('全部进洞 · ' + game.moves + ' 动 / ' + fmt(game.elapsed));
  };

  out.act = act;
  out.actDir = actDir;
  out.sync = sync;
  out.say = say;
  out.bind = bind;
  out.closeOverlay = closeOverlay;
  out.openOverlay = openOverlay;
  out.toLogical = toLogical;
  return out;
}
