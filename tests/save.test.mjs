#!/usr/bin/env node
// 存档的证人：判的是**行为**，不是"代码里出现过 localStorage"。
//
// 为什么要有这一张（派工简报 §2 的"行为成立"）：静态尺子只能看见 setItem/getItem 这两个串，
// 而真正会红给玩家的三种事故都不在串里 ——
//   ① 写进去的东西读不回来（宿主给的对象 setItem 静默失败，或 iOS 隐私模式当场抛）；
//   ② 一条坏记录把整局冻死（`Object.assign(defaults, JSON.parse(raw))` 那种写法，
//      `runs: null` 会盖掉默认数组，下一次 push 才炸，炸在离坏数据最远的地方）；
//   ③ 恢复出来的局和存进去的局不是同一局（动数、玩家线、盘面对不上）。
// 所以这里跑真回路：建一个真 game → 真走一步 → snapshot → 写 → 换一个 storage 实例读回 → restore
// 到第二个 game，逐字段比。坏记录那半边给的是"只丢这一条"的计数证人。
import { HerugolfGame } from '../js/core/game.js';
import { loadStore, writeStore, upsertRun, recordWin, defaultStore, SAVE_KEY } from '../js/core/save.js';

let checks = 0;
const fails = [];
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
const eq = (a, b, msg) => check(Object.is(a, b), `${msg}（期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}）`);

// 可替换的介质桩：每个实例自带一张 map，读/写/删都真的走一遍（共享一张就等于没测到"换实例"）
const mem = (init = {}) => {
  const map = { ...init };
  return { map, getItem: (k) => (k in map ? map[k] : null), setItem: (k, v) => { map[k] = String(v); }, removeItem: (k) => { delete map[k]; } };
};

// ── ① 真回路：game → snapshot → write → 换实例 read → restore，逐字段对得上 ──
let payload = null;
let goodRun = null;
{
  let vt = 0;
  const a = new HerugolfGame({ seed: 7, tierKey: '8x8/4', reduceMotion: true, clock: () => vt });
  a.start();
  // 拿引擎自己算出的合法走法走一步（不是硬编码坐标：题面变了证人跟着动）
  let stepped = false;
  for (const [ball, routes] of a.cands) {
    if (!routes || !routes.length) continue;
    a.selected = ball;
    stepped = a.strokeTo(routes[0].stops[0]);
    if (stepped) break;
  }
  check(stepped, '正例空转：一局里连一步合法走法都走不出来，后面比对没有意义');
  check(a.lines.size >= 1 && a.moves >= 1, `走子没进真值（lines=${a.lines.size} moves=${a.moves}）`);

  const st = mem();
  const store = defaultStore();
  const snap = a.snapshot();
  upsertRun(store, snap);
  const w = writeStore(st, store);
  check(w.ok === true, `writeStore 说没落盘：${JSON.stringify(w)}`);
  check(typeof st.map[SAVE_KEY] === 'string' && st.map[SAVE_KEY].length > 20, `介质里没有 ${SAVE_KEY} 这条记录`);
  payload = st.map[SAVE_KEY];
  goodRun = snap;

  // 换一根 storage 实例（等于刷新一次页面）
  const reload = loadStore(mem({ [SAVE_KEY]: payload }));
  check(reload.report.parsed === true, `回读没解析成功：${JSON.stringify(reload.report)}`);
  eq(reload.report.droppedRuns, 0, '刚写出去的正确记录被自己的解码器丢了');
  const back = reload.store.runs[0];
  check(back && typeof back === 'object', '回读的 runs[0] 不见了');
  for (const k of ['seed', 'tier', 'board', 'moves', 'blocked', 'winSecs', 'state']) eq(back[k], snap[k], `字段 ${k} 回读不一致`);
  eq(JSON.stringify(back.lines), JSON.stringify(snap.lines), '玩家线回读不一致');

  const b = new HerugolfGame({ seed: 999, tierKey: '8x8/4', reduceMotion: true, clock: () => vt });
  b.restore(back);
  vt += 100;
  b.update(); // 让 restore 排进落地表的那次 refresh 真落到步号边界上
  eq(b.seed, snap.seed, 'restore 之后 seed 不是那一局');
  eq(b.moves, snap.moves, 'restore 之后动数不是那一局');
  eq(b.lines.size, snap.lines.length, 'restore 之后玩家线条数不对');
  eq(b.snapshot().board, a.snapshot().board, 'restore 出来的盘面和原盘不是同一张');
  const savedLines = [...b.lines.entries()].sort((x, y) => x[0] - y[0]);
  check(savedLines.length === 0 || savedLines[0][1].length >= 1, '玩家线恢复成空数组（线在但落点没了）');
}

// ── ② 一条坏记录只丢那一条：其余照旧，且默认形状不被脏数据盖掉 ──
{
  const bad = {
    v: 1,
    prefs: { muted: 'yes', tier: '99x99/99', hintOn: 1 },
    best: { '8x8/4': { moves: 0, secs: -3 }, '10x10/5': { moves: 5, secs: 12 }, bogus: { moves: 2, secs: 2 } },
    runs: [
      goodRun,
      null,
      'a string',
      { seed: 'abc', tier: '8x8/4', board: '', lines: [] },
      { seed: 3, tier: '8x8/4', board: 42, lines: [] },
      { seed: 3, tier: '8x8/4', board: '', lines: [{ start: 99999, stops: [1] }] },
      { seed: 3, tier: '8x8/4', board: '', lines: 'nope' },
    ],
    wins: '12',
    played: null,
  };
  const st = mem({ [SAVE_KEY]: JSON.stringify(bad) });
  const r = loadStore(st);
  eq(r.report.parsed, true, '坏记录不该让整档解析失败');
  eq(r.store.runs.length, 1, '只该留下那一条正确记录');
  eq(r.report.keptRuns, 1, 'keptRuns 计数与实收不符');
  eq(r.report.droppedRuns, 6, 'droppedRuns 没数到那 6 条坏记录（坏一条丢一条没成立）');
  eq(r.store.runs[0].seed, goodRun.seed, '留下的那条不是原来的好记录');
  eq(r.store.prefs.muted, false, 'prefs.muted 被字符串 "yes" 盖成 truthy');
  eq(r.store.prefs.tier, defaultStore().prefs.tier, 'prefs.tier 收进了菜单外的档');
  eq(r.store.prefs.hintOn, true, 'prefs.hintOn 被数字 1 盖成非布尔');
  eq(Object.keys(r.store.best).join(','), '10x10/5', 'best 里混进了非法档名或非法数值');
  eq(r.store.wins, 12, 'wins 没把字符串 "12" 折成整数');
  eq(r.store.played, 0, 'played: null 没退回默认值');
  // 关键行为：解出来的 runs 必须还是数组，push 得动（那才是"白屏"事故的正主）
  let threw = '';
  try {
    upsertRun(r.store, { ...goodRun, seed: goodRun.seed + 1 });
    upsertRun(r.store, { ...goodRun, seed: goodRun.seed + 2 });
  } catch (e) { threw = String(e && e.message ? e.message : e); }
  eq(threw, '', '脏档回读之后 push 就炸（Object.assign 那一族的事故）');
  eq(r.store.runs.length, 3, '新写的记录没并进去');
}

// ── ③ 半截 JSON / 类型不对的顶层：退默认档并如实报告原因 ──
{
  const half = loadStore(mem({ [SAVE_KEY]: '{"v":1,"runs":[' }));
  eq(half.report.reason, 'bad-json', '半截 JSON 没被点名');
  eq(Array.isArray(half.store.runs), true, '坏 JSON 之后默认档的 runs 不是数组');
  const arr = loadStore(mem({ [SAVE_KEY]: '[1,2,3]' }));
  eq(arr.report.reason, 'not-an-object', '顶层数组没被点名');
  const empty = loadStore(mem({}));
  eq(empty.report.reason, 'empty', '空介质应报 empty 而不是抛');
  const gone = loadStore(null);
  eq(gone.report.parsed, false, '没有介质时 parsed 该是 false');
  eq(Array.isArray(gone.store.runs) && gone.store.runs.length === 0, true, '没有介质时默认档不干净');
}

// ── ④ 介质本身会抛（iOS 隐私模式的 setItem）：报告失败，不许把异常抛给帧循环 ──
{
  const domErr = (name) => { const e = new Error(name); e.name = name; return e; };
  const boom = { getItem: () => { throw domErr('SecurityError'); }, setItem: () => { throw domErr('QuotaExceededError'); } };
  let threw = '';
  const r = (() => { try { return writeStore(boom, defaultStore()); } catch (e) { threw = String(e); return null; } })();
  eq(threw, '', 'writeStore 把介质异常抛了出来（玩家侧就是一个未捕获错误）');
  eq(r && r.ok, false, 'setItem 抛了却报告成功');
  eq(r && r.reason, 'QuotaExceededError', '写失败没点名原因');
  const rl = loadStore(boom);
  eq(rl.report.reason, 'storage-unavailable', 'getItem 抛了没被认成介质不可用');
  eq(Array.isArray(rl.store.runs), true, '介质异常时默认档不干净');
}

// ── ⑤ 只写不读的介质（探针要能认出来）：写进去立刻读不回就是不可用 ──
{
  const mute = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const PROBE = SAVE_KEY + ':probe';
  mute.setItem(PROBE, '1');
  eq(mute.getItem(PROBE) === '1', false, '探针写下去居然读得回，这条判据抓不到"静默失败的介质"');
  // 上面这一对就是 main.js 里那段写入回读探针的语义：读不回 → 退回内存档，不拦开局
  const st = defaultStore();
  upsertRun(st, { ...goodRun, seed: 1234 });
  const r = writeStore(mute, st);
  eq(r.ok, true, 'writeStore 对"不抛的介质"报成功是对的（抛不抛是介质的事）');
  eq(loadStore(mute).store.runs.length, 0, '静默失败的介质读回来必须有存档（应当没有）');
}

// ── ⑥ 记录数封顶 24 条，战绩只留更好的那一档 ──
{
  const st = defaultStore();
  for (let i = 0; i < 30; i++) upsertRun(st, { ...goodRun, seed: 1000 + i });
  eq(st.runs.length, 24, 'upsertRun 没把记录数封顶');
  eq(st.runs[0].seed, 1029, '最新一局没排在最前（数组下标就是"最近优先"）');
  // 绕过 upsertRun 的封顶，直接塞一份 30 条的脏盘：解码这一侧也必须自己截到 24 条
  const fat = { ...defaultStore(), runs: Array.from({ length: 30 }, (_, i) => ({ ...goodRun, seed: 2000 + i })) };
  const back = loadStore(mem({ [SAVE_KEY]: JSON.stringify(fat) }));
  eq(back.store.runs.length, 24, '回读没截到 24 条');
  eq(back.report.droppedRuns, 6, '超出 24 条的那 6 条没被数进 droppedRuns');
  eq(back.store.runs[0].seed, 2000, '截断截错了头（该留最近优先的前 24 条）');
  const same = defaultStore();
  upsertRun(same, { ...goodRun, seed: 7, moves: 9 });
  upsertRun(same, { ...goodRun, seed: 7, moves: 4 });
  eq(same.runs.length, 1, '同 seed 同 tier 没就地覆盖');
  eq(same.runs[0].moves, 4, '就地覆盖没生效');
  const w = defaultStore();
  recordWin(w, { tier: '8x8/4', moves: 10, winSecs: 30 });
  recordWin(w, { tier: '8x8/4', moves: 15, winSecs: 20 });
  eq(w.best['8x8/4'].moves, 10, '更差的一局盖掉了最好成绩');
  recordWin(w, { tier: '8x8/4', moves: 10, winSecs: 20 });
  eq(w.best['8x8/4'].secs, 20, '同动数更少时间该刷新纪录');
  eq(w.wins, 3, '通关计数与实际通关次数不符');
}

console.log(`RESULT save-test ok=${fails.length === 0} checks=${checks} fails=${fails.length}`);
for (const f of fails) console.error('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
