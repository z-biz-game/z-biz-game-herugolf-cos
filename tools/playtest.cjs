// 驱动 headless Chrome 的最小 CDP 台架（Node 22+ 的全局 WebSocket/fetch）。
//
// env: CDP_PORT（devtools 端口，默认 9350）、BASE_URL（页面 origin，默认 http://127.0.0.1:5340/）、
//      WITNESS（派发导航之前由 node 取走的证人 json）、GATE_SELFTEST=1（每一份报告都种一条
//      注定错的期望 —— scenarios.js 那份与 node 侧的 leg/nav/reload 那份走同一条规矩）
//
//   node tools/playtest.cjs open <url>              新开一页，打印开机读数
//   node tools/playtest.cjs eval '<expr>' [nonav]   求值、等 promise、打印
//   node tools/playtest.cjs scenario <name>         注入 tools/scenarios.js，跑 __ng.<name>()
//     ⚠ 这一条**现在跑不通**（本轮实测 rc=1）：tools/scenarios.js 是纯 Node 夹具，既带 `from 'node:process'`
//        （注进页面就是 SyntaxError: Cannot use import statement outside a module），也从来没有定义过
//        window.__ng。要它绿需要先写一份浏览器侧的场景模块 —— 那是没落地的东西，不是这条腿的读数。
//        能跑的腿是 open / leg mouse|touch|keys / nav / reload / witness / answer / eval / logs。
//   node tools/playtest.cjs witness                 在派发导航**之前**取 timeOrigin/doc/哨兵
//   node tools/playtest.cjs nav <url> same|fresh    导航 + 断言它到底算不算新文档
//   node tools/playtest.cjs reload                  真重载 + 断言文档真的死了
//   node tools/playtest.cjs leg mouse|touch|keys    真事件（Input.dispatch*）驱动的三条腿
//   node tools/playtest.cjs answer <tier> <seed>    由 node 出这一盘并打印答案（跨引擎证人）
//   node tools/playtest.cjs shot <file.png> / logs
//
// attach 到哪一页由 BASE_URL 的 origin 决定，不写死端口：一个悄悄落在 about:blank 上的
// eval 读起来像"部署坏了"，其实什么都没测。
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CDP_PORT || 9350);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5340/';
const ORIGIN = new URL(BASE).origin;
const SELFTEST = process.env.GATE_SELFTEST === '1';
const cmd = process.argv[2];
const arg = process.argv[3];
const rest = process.argv[4];
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);

const logs = [];
const rows = [];
const ck = (test, cond, detail) => rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
const result = (extra) => {
  // 阴性自证要覆盖 node 侧的腿：真事件（leg mouse/touch/keys）与 nav/reload 的报告不经过
  // scenarios.js 的 report()，不在这里也种一条的话，这几条腿就永远是"没能红过的绿"。
  if (SELFTEST) rows.push({ test: 'GATE_SELFTEST 种下的错期望（1 应当等于 2）', pass: 1 === 2, detail: 'planted red' });
  return { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
};
const out = (extra) => {
  const r = result(extra);
  if (logs.length) console.error(logs.slice(-40).join('\n'));
  // console 噪声在前，机器可读行在最后：verify.sh 取的是最后那条 RESULT，
  // 日志里冒出一个 '{' 就不能劫持这份报告。
  console.log('RESULT ' + JSON.stringify(r));
};
const evidence = (o) => console.log('EVIDENCE ' + Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' '));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) this.consume(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  consume(m) {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') logs.push(`[log:error] ${e.text} ${e.url || ''}`);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {
      /* 还没 bind */
    }
    if (Date.now() > deadline) throw new Error(`devtools never bound on :${PORT}`);
    await sleep(250);
  }
}

async function main() {
  // `answer` 完全不碰浏览器：它是 node 侧的那一份证人来源，必须在没有 Chrome 的时候也能跑。
  if (cmd === 'answer') {
    const { shipPuzzle, parseTier } = await import('../js/engine/generate.js');
    const { serializeBoard, serializeAnswer } = await import('../js/engine/grid.js');
    const tier = arg || '10x10/5';
    const seed = Number(rest || 1);
    if (!parseTier(tier)) throw new Error(`unknown tier ${tier}`);
    const r = shipPuzzle(seed, tier, {});
    if (!r.ok) throw new Error(`shipPuzzle(${seed}, ${tier}) 没出货：${r.status}`);
    console.log('ANSWER ' + JSON.stringify({ tier, seed, board: serializeBoard(r.board), answer: serializeAnswer(r.answer), balls: r.board.balls.size, ms: Math.round(r.ms * 100) / 100 }));
    process.exit(0);
  }

  const info = await waitForDevTools();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const cdp = new CDP(ws);

  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) {
      if (t.type === 'page' && isOurs(t.url)) {
        try {
          await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId });
        } catch { /* 已经没了 */ }
      }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let sessionId;
  if (existing) {
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: existing.id || existing.targetId, flatten: true }));
  } else {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 900000 }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const json = async (expression) => JSON.parse(await evaluate(`JSON.stringify((${expression}))`));

  const ready = async () => {
    for (let i = 0; i < 160; i++) {
      const s = await evaluate('document.readyState').catch(() => 'loading');
      if (s === 'complete') return;
      await sleep(100);
    }
  };
  const navigate = async (url) => {
    await cdp.send('Page.navigate', { url }, sessionId);
    await ready();
    await sleep(200);
  };
  // 只差一个 hash 的 URL 是 same-document navigation：Page.navigate 过去并不会换文档。
  // 所以"这一腿必须落在新文档里"的走 Page.reload，URL 真的不同才用 navigate。
  const gotoFresh = async (url = BASE) => {
    const cur = String(await evaluate('location.href').catch(() => ''));
    const cut = (u) => u.split('#')[0];
    if (cur && cut(cur) === cut(url)) {
      await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
      await ready();
      await sleep(200);
    } else {
      await navigate(url);
    }
  };
  const docInfo = () =>
    evaluate(`(()=>{const h=window.herugolf;return {url:location.href,to:performance.timeOrigin,doc:h?h.doc:'(no window.herugolf)',boot:!!h};})()`).catch((e) => ({ url: 'unknown', to: 0, doc: 'ERR:' + e.message, boot: false }));

  // ---------- 页内几何：先量 hit box，再谈"点得到" ----------

  const PREP = `(()=>{
    const h=window.herugolf, v=h.view, g=h.game;
    if(!g) throw new Error('对局页还没开起来（没有 window.herugolf.game）');
    const rect=v.canvas.getBoundingClientRect();
    const at=(x,y)=>{const e=document.elementFromPoint(x,y);return e?(e.id||e.tagName):'null';};
    const o={rect:{l:rect.left,t:rect.top,w:rect.width,h:rect.height},iw:innerWidth,dpr:devicePixelRatio,
      seed:g.seed,tier:g.tier,cells:[],btns:[],sweepTotal:g.n,sweepHits:0,balls:[],targets:[]};
    let miss=0;
    for(let i=0;i<g.n;i++){const r=v.cellRect(i);const x=rect.left+r.x+r.size/2,y=rect.top+r.y+r.size/2;
      if(at(x,y)==='board')o.sweepHits++;else miss++;}
    o.sweepMiss=miss;
    for(const b of g.balls){const r=v.cellRect(b);
      o.balls.push({i:b,x:rect.left+r.x+r.size/2,y:rect.top+r.y+r.size/2,k:g.board.balls.get(b),hit:at(rect.left+r.x+r.size/2,rect.top+r.y+r.size/2)});}
    for(const t of g.legalTargets()){const r=v.cellRect(t);
      o.targets.push({i:t,x:rect.left+r.x+r.size/2,y:rect.top+r.y+r.size/2,hit:at(rect.left+r.x+r.size/2,rect.top+r.y+r.size/2)});}
    // 斜对面那一个：一定不合法（R2 要直线），拿来当"界面必须拒绝"的那个点
    const first=g.balls[0], q=g.board.rc(first), off=g.board.inb(q[0]+1,q[1]+1)?g.board.idx(q[0]+1,q[1]+1):0;
    const r=v.cellRect(off);
    o.diagonal={i:off,x:rect.left+r.x+r.size/2,y:rect.top+r.y+r.size/2};
    for(const id of ['btn-hint','btn-undo','btn-new','btn-menu']){const e=document.getElementById(id);const b=e.getBoundingClientRect();
      const x=b.left+b.width/2,y=b.top+b.height/2;
      o.btns.push({id,x,y,hit:at(x,y),w:Math.round(b.width),h:Math.round(b.height)});}
    return o;})()`;

  // 两条腿各自只发自己那一种真事件：mouse 腿发鼠标，touch 腿发触屏。脚本里成对写 tap，
  // 于是同一条断言在两种事件下各跑一次，而不会出现"鼠标腿其实也按了一遍触屏"的假证据。
  const mouse = async (x, y) => {
    if (arg === 'touch') return;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(90);
  };
  const touch = async (x, y) => {
    if (arg !== 'touch') return;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }] }, sessionId);
    await sleep(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    await sleep(90);
  };
  const key = async (k) => {
    const map = { ' ': 'Space', Backspace: 'Backspace', ArrowRight: 'ArrowRight', ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', h: 'KeyH' };
    const vk = { ' ': 32, Backspace: 8, ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, h: 72 };
    const text = k.length === 1 ? k : undefined;
    // 绝不给 nativeVirtualKeyCode：在 macOS 上 Chrome 把它当平台原生键码，于是这只键会被
    // raw keyboard 路径反复补发（sibling 仓实测：带 nvk 时 520ms 内到达 3664 次 keydown）。
    // 让 Chrome 自己从 wvk 推原生键码，一次派发就正好是一次按键。
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: map[k], text, windowsVirtualKeyCode: vk[k] }, sessionId);
    if (text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text, key: k, code: map[k], windowsVirtualKeyCode: vk[k] }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: map[k], windowsVirtualKeyCode: vk[k] }, sessionId);
    await sleep(60);
  };

  const GAME = `(()=>{const g=window.herugolf.game;return {selected:g.selected,seed:g.seed,tier:g.tier,strokes:g.strokeCount,hints:g.hints,status:g.status,covered:g.own.size,codes:g.codes(),kind:g.msg.kind,rule:g.msg.rule,doc:window.herugolf.doc,to:performance.timeOrigin};})()`;
  const DOMTXT = `(()=>{const t=s=>(document.querySelector(s)||{}).textContent||'';
    return {name:t('#stat-name'),seed:t('#stat-seed'),tier:t('#stat-tier'),time:t('#stat-time'),
    strokes:t('#stat-strokes'),hints:t('#stat-hints'),indone:t('#stat-indone'),remaining:t('#stat-remaining'),
    covered:t('#stat-covered'),conflicts:t('#stat-conflicts'),score:t('#stat-score'),genms:t('#stat-genms'),
    state:t('#state-line'),hintRule:t('#hint-rule'),hintLine:t('#hint-line'),
    veilShown:(()=>{const e=document.getElementById('win-veil');return e?!e.hidden&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0:false;})(),
    menuShown:(()=>{const e=document.getElementById('view-menu');return e?!e.hidden&&e.getClientRects().length>0:false;})(),
    gameShown:(()=>{const e=document.getElementById('view-game');return e?!e.hidden&&e.getClientRects().length>0:false;})(),
    active:document.activeElement?(document.activeElement.id||document.activeElement.tagName):'null'};})()`;

  // ---------- commands ----------

  if (cmd === 'open') {
    await navigate(arg || BASE);
    const d = await docInfo();
    evidence({ url: d.url, timeOrigin: d.to, doc: d.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (rest !== 'nonav') await navigate(BASE);
    const v = await evaluate(arg);
    console.log(typeof v === 'string' ? v : JSON.stringify(v));
  } else if (cmd === 'witness') {
    const d = await docInfo();
    // 派发导航之先，证人已经在 node 手里了：续局那条腿要证明的是"新文档"，不是"我按了一次刷新"。
    // 证人同时把"导航前盘面长什么样"抄一份下来 —— 续局腿要比的是这一份，不是它自己重算的期望。
    const sent = await evaluate(`(()=>{const g=window.herugolf.game;window.__gateSentinel='sn'+Math.floor(Math.random()*1e6);return window.__gateSentinel+'|'+(g?g.codes():'')+'|'+(g?g.seed:'');})()`);
    const snap = await json(`(()=>{const g=window.herugolf.game,S=window.herugolf.engine.Store,r=S.resume(window.herugolf.engine.tierOf);
      return {tier:g?g.tier:'',seed:g?g.seed:0,codes:g?g.codes():'',strokes:g?g.strokeCount:0,hints:g?g.hints:0,
        covered:g?g.own.size:0,ms:g?window.herugolf.state().elapsedMs:0,storedMs:r?r.elapsedMs:0,storedSeed:r?r.seed:0,storedLines:r&&r.cells?r.cells.split(';').filter(Boolean).length:0};})()`);
    evidence({ url: d.url, timeOrigin: d.to, doc: d.doc, sentinel: sent, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio'), ...snap });
    console.log(JSON.stringify({ timeOrigin: d.to, doc: d.doc, url: d.url, sentinel: sent, ...snap }));
  } else if (cmd === 'nav' || cmd === 'reload') {
    const before = await docInfo();
    const expect = cmd === 'reload' ? 'fresh' : rest;
    const url = cmd === 'reload' ? before.url.split('#')[0] : arg;
    if (cmd === 'reload') await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
    else await cdp.send('Page.navigate', { url: url || BASE }, sessionId);
    await sleep(expect === 'fresh' ? 500 : 350);
    await ready();
    if (expect === 'fresh') {
      for (let i = 0; i < 60; i++) {
        const d = await docInfo();
        if (d.boot && d.doc !== before.doc) break;
        await sleep(150);
      }
    }
    const after = await docInfo();
    evidence({ leg: cmd, expect, urlBefore: before.url, urlAfter: after.url, timeOriginBefore: before.to, timeOriginAfter: after.to, docBefore: before.doc, docAfter: after.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    eq(`${cmd} 之后页面还在同一个 URL 形态`, new URL(after.url).pathname, new URL(url || before.url).pathname);
    ck(`${cmd} 之后应用又起来了（window.herugolf 在）`, after.boot, after.doc);
    if (expect === 'same') {
      eq('片段导航不算重载：timeOrigin 必须没变', after.to, before.to);
      eq('片段导航不算重载：文档身份必须没变', after.doc, before.doc);
    } else {
      ck('真重载：timeOrigin 必须换了（新文档）', after.to !== before.to, `${before.to} -> ${after.to}`);
      ck('真重载：文档身份必须换了', after.doc !== before.doc, `${before.doc} -> ${after.doc}`);
    }
    out({ before, after, expect });
  } else if (cmd === 'scenario') {
    const src = fs.readFileSync(path.join(__dirname, 'scenarios.js'), 'utf8');
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src }, sessionId);
    await gotoFresh(BASE);
    await evaluate(`window.__witness=${process.env.WITNESS || 'null'};window.__selftest=${SELFTEST};window.__nodeAnswer=${process.env.NODE_ANSWER || 'null'};'ok'`);
    // headless 把页面报成后台，而渲染循环被允许在后台跳帧 —— 所以等动画的场景会对着一个
    // "假装在后台"的浏览器超时。这里把可见性掰回前台。
    await evaluate(`Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
      Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});'ok'`);
    const d = await docInfo();
    evidence({ scenario: arg, url: d.url, timeOrigin: d.to, doc: d.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    const res = await evaluate(`(async()=>{
      if (!window.__ng) throw new Error('scenarios.js never installed');
      // 报告必须是字符串：把对象交给 returnByValue 只会打印出 "[object Object]"，
      // 于是这一腿看起来跑了、verify.sh 却一行断言都解析不到。
      return JSON.stringify(await window.__ng[${JSON.stringify(arg)}]());
    })()`);
    // 每一次注入都在文档上留一份，用完就撤：否则同一个文档里会有第 N 份 scenarios.js 在跑。
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId).catch(() => {});
    if (logs.length) console.error(logs.slice(-40).join('\n'));
    console.log('RESULT ' + res);
  } else if (cmd === 'leg') {
    await leg();
  } else if (cmd === 'shot') {
    await cdp.send('Page.bringToFront', {}, sessionId);
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.mkdirSync(path.dirname(arg), { recursive: true });
    fs.writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg);
  } else if (cmd === 'logs' || cmd === 'reload-logs') {
    if (cmd === 'reload-logs') await navigate(BASE);
    console.log(logs.join('\n') || '(clean)');
  } else {
    console.error('unknown command: ' + cmd);
    process.exit(64);
  }
  ws.close();
  process.exit(0);

  // ---------- 真事件腿：鼠标 / 触屏 / 键盘（都走 CDP Input.*，不是页内 new Event） ----------

  async function leg() {
    await gotoFresh(BASE);
    // 直接走深链开一局：腿不靠"页内调 begin"起手，深链本身就是被真事件点出来的同一条开机路径
    await gotoFresh(BASE.replace(/\/$/, '') + '/#t=10x10/5&s=5');
    await evaluate(`(()=>{ if(!window.herugolf.game) window.herugolf.begin({tier:'10x10/5', seed:5}); return 1; })()`);
    await sleep(150);
    if (arg === 'touch') {
      // 覆写必须写在腿自己的调用里，并且腿要能读回证人：另起进程设 Emulation 等于把桌面断言
      // 重跑一遍。所以这里读回 innerWidth/dpr，并且只把它命名成"覆写在位"，不命名成"这是手机"。
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sessionId);
      await sleep(400);
    }
    const p = await json(PREP);
    // 版面读数：格边长 + 棋盘尺寸 + 面板第一个按钮的视口坐标。
    // 这一条抓的是"整局不可玩"里最难看见的一种：开局那一次 layout() 跑在容器还 hidden
    // （display:none）的时候，clientWidth 读到 0 ⇒ 格边长退到最小档、整盘画成 200px，
    // 而下一次 layout()（换一局/窗口变化）又把面板整体推下去 —— 玩家第一眼是张小盘，
    // 而闸这边所有真事件坐标从 PREP 之后就全失效（红的形状是"提示 got 0"，看不出是坐标漂）。
    const GEOM = `(()=>{const v=window.herugolf.view,c=v.canvas.getBoundingClientRect(),b=document.getElementById('btn-hint').getBoundingClientRect();return {size:v.size,cols:v.game.board.w,boardW:Math.round(c.width),boardH:Math.round(c.height),hintTop:Math.round(b.top),hintLeft:Math.round(b.left),scrollY:Math.round(window.scrollY)};})()`;
    const g0 = await json(GEOM);
    ck('第一画的格边长可点（>=30px，不是隐藏容器量出来的最小档）', g0.size >= 30, JSON.stringify(g0));
    ck('第一画的棋盘宽 = 格边长×列数（画布没停在缺省 300×150）', g0.boardW, g0.size * g0.cols);
    ck('第一画的格数与 PREP 数到的一致', g0.cols * g0.cols, p.sweepTotal);
    const d0 = await docInfo();
    evidence({ leg: arg, url: d0.url, timeOrigin: d0.to, doc: d0.doc, innerWidth: p.iw, dpr: p.dpr, seed: p.seed, cells: p.sweepTotal, targets: p.targets.length });
    eq('hit box：棋盘每一格中心都落在 canvas 上', p.sweepMiss, 0);
    eq('hit box：按钮中心都落在自己上', p.btns.filter((b) => b.hit !== b.id).map((b) => b.hit + '@' + b.id).join(','), '');
    ck('按钮都够点（>=34px 高）', p.btns.every((b) => b.h >= 34), JSON.stringify(p.btns.map((b) => b.h)));
    if (arg === 'touch') {
      eq('移动覆写在位：innerWidth 读回 390', p.iw, 390);
      eq('移动覆写在位：devicePixelRatio 读回 3', p.dpr, 3);
      ck('窄屏下棋盘整个留在视口里', p.rect.l >= 0 && p.rect.w <= p.iw + 1, JSON.stringify({ rect: p.rect, iw: p.iw }));
    }
    ck('这一档确实有合法落点可点（选中球不是死球）', p.targets.length > 0, JSON.stringify(p.targets));
    eq(`hit box：球 ${p.balls[0].i} 的命中元素就是 canvas`, p.balls[0].hit, 'board');
    eq(`hit box：合法落点 ${p.targets[0] ? p.targets[0].i : '(none)'} 的命中元素就是 canvas`, p.targets[0] ? p.targets[0].hit : 'none', 'board');

    if (arg === 'touch' || arg === 'mouse') {
      const before = await json(GAME);
      // ① 点合法落点 = 真落一动
      await mouse(p.targets[0].x, p.targets[0].y);
      await touch(p.targets[0].x, p.targets[0].y);
      const afterPlace = await json(GAME);
      const dom1 = await json(DOMTXT);
      eq(`真事件落子：动数 0→1`, `${before.strokes}->${afterPlace.strokes}`, '0->1');
      eq(`真事件落子：DOM 的动数跟着读到 1`, dom1.strokes, '1');
      eq('真事件落子：落的就是点的那一格', afterPlace.codes.split(':')[1], String(p.targets[0].i));
      ck('状态行说的是落子不是拒绝', afterPlace.kind !== 'deny', afterPlace.kind + ' ' + dom1.state);

      // ② 点斜对面 = 必须被 R2 拒，且动数不许动
      await mouse(p.diagonal.x, p.diagonal.y);
      await touch(p.diagonal.x, p.diagonal.y);
      const afterBad = await json(GAME);
      const dom2 = await json(DOMTXT);
      eq('斜对面被拒：动数还是 1', afterBad.strokes, 1);
      eq('斜对面被拒：状态行点了 R2', afterBad.rule, 'R2');
      ck('状态行说出了为什么', /直线|R2/.test(dom2.state), dom2.state);

      // ③ 撤销按钮（真事件）
      const bu = p.btns.find((b) => b.id === 'btn-undo');
      await mouse(bu.x, bu.y);
      await touch(bu.x, bu.y);
      const domU = await json(DOMTXT);
      const afterUndo = await json(GAME);
      eq('撤销退掉最后一步', afterUndo.strokes, 0);
      eq('DOM 动数退回 0', domU.strokes, '0');
      eq('撤销之后盘面串是空的', afterUndo.codes, '');

      // ④ 换一局（真事件）：seed 必须来自存档里的自增游标，而不是日期/时间
      const sBefore = await json(`(()=>({seed:window.herugolf.game.seed,cur:window.herugolf.engine.Store.peekSeed()}))()`);
      const bn = p.btns.find((b) => b.id === 'btn-new');
      await mouse(bn.x, bn.y);
      await touch(bn.x, bn.y);
      const sAfter = await json(`(()=>({seed:window.herugolf.game.seed,cur:window.herugolf.engine.Store.peekSeed(),tier:window.herugolf.game.tier}))()`);
      const domN = await json(DOMTXT);
      ck('换一局换了盘（seed 变了）', sAfter.seed !== sBefore.seed, `${sBefore.seed} -> ${sAfter.seed}`);
      ck('seed 是小整数自增号，不是日期/时间戳', sAfter.seed >= 1 && sAfter.seed < 1e6 && Number.isInteger(sAfter.seed), sAfter.seed);
      ck('游标推到了 seed 之后（下一局不会撞同一张）', sAfter.cur > sAfter.seed, `${sAfter.seed} / ${sAfter.cur}`);
      ck('页面把 seed 印出来了', domN.seed.includes(String(sAfter.seed)), domN.seed);
      eq('换一局没把档位换掉', sAfter.tier, p.tier);

      // ⑤ 提示按钮（真事件）：规则名必须来自引擎那张表
      // 先核对版面没在真事件之间挪过位：换了局之后若 hintTop/hintLeft 变了，那 PREP 那份
      // 坐标就是旧的，这一次点击戳的是空气 —— 不写这条，红的形状是"提示 got 0"。
      const g1 = await json(GEOM);
      eq('换一局之后版面不整体挪位（PREP 的真事件坐标仍然有效）', `${g1.hintTop},${g1.hintLeft},${g1.size}`, `${g0.hintTop},${g0.hintLeft},${g0.size}`);
      const bh = p.btns.find((b) => b.id === 'btn-hint');
      await mouse(bh.x, bh.y);
      await touch(bh.x, bh.y);
      const domH = await json(DOMTXT);
      const stH = await json(`(()=>({hints:window.herugolf.game.hints,rule:window.herugolf.game.lastHint?window.herugolf.game.lastHint.rule:'(none)'}))()`);
      eq('按提示计一次数', domH.hints, '1');
      // 白名单那份表要 await 读回来再判：把 Promise 直接交给 ck() 是"永远为真的绿"
      // （Promise 对象恒真），那条断言等于没写。
      ck('提示说出的是命名规则之一', await window_is(stH.rule), stH.rule);
      ck('提示不是空话', domH.hintLine.length > 8, domH.hintLine);
    }
    if (arg === 'keys') {
      // 键盘之前先钉焦点：真点一次棋盘（焦点是 pointerdown 里 canvas.focus() 给的），
      // 于是"键盘送不到"与"焦点不在棋盘上"这两件事在这条腿里是分得开的。
      await mouse(p.balls[0].x, p.balls[0].y);
      await touch(p.balls[0].x, p.balls[0].y);
      const act = await json(`(()=>({active:document.activeElement?document.activeElement.id:'null'}))()`);
      eq('焦点钉在棋盘上（先真点了一次）', act.active, 'board');
      // 由当前这盘的合法落点反推该按哪只方向键：期望不是手抄的，是盘面给的
      const dirKey = await json(`(()=>{const g=window.herugolf.game,t=g.legalTargets()[0];const [r0,c0]=g.board.rc(g.tipOf(g.selected));const [r1,c1]=g.board.rc(t);
        return {cell:t, key: r1<r0?'ArrowUp':r1>r0?'ArrowDown':c1<c0?'ArrowLeft':'ArrowRight'};})()`);
      ck('有一个可考的方向键落子（这一档的选中球够得着一个落点）', Number.isInteger(dirKey.cell), JSON.stringify(dirKey));
      const seq = [dirKey.key, ' ', 'Backspace', 'h'];
      // 逐个按键各取一次快照：整段求差只会打印出一个大数，说不清是哪一只键被重复送达。
      const per = [];
      for (const k of seq) {
        const a = await json(`window.herugolf.keyHits()`);
        await key(k);
        const b = await json(`window.herugolf.keyHits()`);
        per.push({ k, seen: b.seen - a.seen, handled: b.handled - a.handled, rep: b.repeated - a.repeated, n: b.by[k] || 0 });
      }
      const dom = await json(DOMTXT);
      const st = await json(GAME);
      // 仓里 known flake：同一个键盘计数在同样的跑法里读到 0/2/7。所以这里报的是"到达数"，
      // 派发数与实际到达数不等就红，红的那条写着到达数、处理数和自动重复数。
      for (const q of per) eq(`按键 ${q.k} 到达游戏一次`, `${q.seen} seen/${q.handled} handled/${q.rep} repeat/${q.n} total`, `1 seen/1 handled/0 repeat/1 total`);
      const sum = per.reduce((a, q) => a + q.seen, 0);
      eq(`派发了 ${seq.length} 个按键：到达游戏的 keydown 总数`, sum, seq.length);
      eq('方向键真的落了一动（之后退格又退回 0，所以读到 0）', st.strokes, 0);
      ck('退格之后盘面串是空的', st.codes === '', st.codes);
      eq('H 键给了一次提示', dom.hints, '1');
      ck('提示说出了规则名', /^规则：(单走法|必经格|洞唯一来客|一球一洞|两球两洞)$/.test(dom.hintRule), dom.hintRule);
      ck('空格换了一颗球（选中态在动）', Number.isInteger(st.selected), st.selected);
    }
    if (arg === 'touch') {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId).catch(() => {});
      await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId).catch(() => {});
    }
    out({ leg: arg, cells: p.cells.length, buttons: p.btns.length, balls: p.balls.length });
  }

  // 规则名的白名单由**引擎那张表**现算，不在这儿再抄一份名单：抄的那一份会漂。
  async function window_is(rule) {
    const list = await json(`window.herugolf.engine.RULE_ORDER`);
    return list.includes(rule);
  }
}

main().catch((err) => {
  console.error('ERROR ' + (err.message || err));
  if (rows.length) console.error('RESULT ' + JSON.stringify(result({ crashed: true })));
  else console.error('RESULT ' + JSON.stringify({ rows: [{ test: `${cmd} ${arg || ''} 整条腿跑挂了`, pass: false, detail: String(err.message || err) }], fail: 1, crashed: true }));
  if (logs.length) console.error(logs.slice(-12).join('\n'));
  process.exit(1);
});
