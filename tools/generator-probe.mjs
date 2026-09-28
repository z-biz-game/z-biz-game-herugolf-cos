#!/usr/bin/env node
// 出货成本的**观测器**（不是门）：走 js/engine/generate.js 的真实出货通道（由解铺题面 → 反例驱动补池挖唯一
// → 计数器认证唯一 ∧ 铅笔零猜测推完 双条件），把每档烧掉多少种子、题面多重、计数器走了几步、
// 铅笔推了几步、墙钟多长、以及**唯一性失败到底死在哪一句**逐档摊开。
//
// 与同目录别的工具的分工（不重复）：
//   rule-test / pencil-test / counter-test 答"引擎有没有坏"（判据逐条对账、变异必被拒）。
//   scenarios 是夹具与变异的家。
//   本文件答"出货通道的账是不是真的、剂量是多少" —— 它给 balance/ceiling 供数，自己不做难度判断。
//   balance 答"发货承诺那句是不是真的"（红线、球数阶梯、极小性）。
//
// 四条写死的口径：
//   ① 种子是纯函数：seed 串 `probe|<档位>|<样本号>`，随机只发生在"选 seed"这一步。
//      本文件不出现 Math.random / Date.now / process.env（引擎的禁词门守的是 js/engine/ 那一侧，
//      这里**不绕过它**：连测量层也不引入随机与时间输入；墙钟走 process.hrtime.bigint，只作输出不作输入）。
//      复跑一致性是自证的：全部读数跑两遍，逐字段摘要必须逐字相同（墙钟除外 —— 它是本机争用的影子，
//      本来就不该逐字相同，摘要里根本没有它）。
//   ② X/N 一律带每样本分布。聚合数会说谎：8.3% 的命中可以全部来自一个退化样本。
//   ③ 唯一性废因**按 generate.js 给的原话分桶**，不许归并、不许改写。Herugolf 的预期只有一条
//      「多余解的落点全是正解也用的落点，杀不动」。冒出第二条 ⇒ 是要报给老板的新事实，
//      本文件把它单列一行并判红，**绝不顺手加进旧桶**（要加也得先量清楚再改 EXPECTED_DIG_FAIL）。
//   ④ 剂量表不是"只打印不判"：下面 MUST_ZERO / MUST_ALIVE / 逐档硬断言 / 复跑一致 都是断言，红就红。
//
// 跑法：
//   node tools/generator-probe.mjs                      全菜单档 × REP（默认 120）
//   node tools/generator-probe.mjs --rep=24             少抽一点（口径不变，只是样本少）
//   node tools/generator-probe.mjs --only=10x10/5,8x8/4 只跑点名档
//   node tools/generator-probe.mjs --quiet              只打 RESULT 行
// 退出码：0 = 全绿；1 = 有红线。本文件只读引擎出口，不改引擎、不碰浏览器、不联网。
import { shipPuzzle, parseTier, newStats, TIERS, SIZES } from '../js/engine/generate.js';
import { countSolutions, prepare, answerOf, DEFAULT_BUDGET_NODES } from '../js/engine/counter.js';
import { solve, RULE_ORDER } from '../js/engine/pencil.js';
import { verify, answerKey } from '../js/engine/verify.js';
import { serializeBoard } from '../js/engine/grid.js';
import { loadavg, cpus } from 'node:os';
import { createHash } from 'node:crypto'; // 只给"复跑一致"的摘要按个指纹用（打印），不参与任何判定输入

const argOf = (name, dflt) => {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : String(dflt);
};
const QUIET = process.argv.includes('--quiet');
const REP = Math.max(1, Number(argOf('rep', 120)) || 120);
const BUDGET = DEFAULT_BUDGET_NODES; // 500_000 结点：出货配置本身，不是测试配置
const NOW = () => Number(process.hrtime.bigint() / 1000n) / 1000;

// 档位 = 引擎菜单档（generate.js TIERS 里 inMenu 的那些）。观测器盯的是**将要发货**的那几档；
// 表外的球数阶梯是 balance 的命门，不在这里重复。
const LADDER = (() => {
  const only = argOf('only', '');
  const keys = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : TIERS.filter((t) => t.inMenu).map((t) => t.key);
  if (!keys.length) throw new Error('--only= 给了空档位表');
  for (const k of keys) parseTier(k); // 认不出的档形在这里当场炸（parseTier 自己会报形状）
  return keys;
})();

// 唯一性废因的桶（口径 ③）。EXPECTED = 预跑量出来"这一族只该有的一条"；
// KNOWN = generate.js/digUnique 里写死可能出现的全部原话，只用来区分"引擎改了话术"和"真冒出第二种死法"。
const EXPECTED_DIG_FAIL = ['多余解的落点全是正解也用的落点，杀不动'];
const KNOWN_DIG_FAIL = [
  { label: '正解被自己挖掉了', is: (s) => s === '正解被自己挖掉了' },
  { label: '多余解的落点全是正解也用的落点，杀不动', is: (s) => s === '多余解的落点全是正解也用的落点，杀不动' },
  { label: '没有可用的杀点', is: (s) => s === '没有可用的杀点' },
  { label: '补池到上限仍不唯一', is: (s) => /^补池到上限 [0-9]+ 仍不唯一$/.test(s) },
  { label: '计数器撞预算', is: (s) => /^计数器撞预算 [0-9]+$/.test(s) },
];
const isKnownWhy = (s) => KNOWN_DIG_FAIL.some((x) => x.is(s));
const isExpectedWhy = (s) => EXPECTED_DIG_FAIL.includes(s);

let checks = 0;
const fails = [];
const notes = [];
function ok(cond, name, detail = '') {
  checks++;
  if (!cond) fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return !!cond;
}

// ── 分位数：真实排序后取第 ceil(q·n) 个（nearest-rank 向上取整），绝不由中位数推算 ──
const asc = (a) => a.slice().sort((x, y) => x - y);
function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[idx];
}
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f0 = (x) => (Number.isFinite(x) ? String(Math.round(x)) : '-');
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-');
// 每样本分布：值×个数，按值升序（聚合数必须配这一列，见文件头口径 ②）
function hist(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  const parts = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}×${c}`);
  return parts.length <= 14 ? parts.join(' ') : `${parts.slice(0, 12).join(' ')} …（共 ${m.size} 个不同值，最大 ${parts[parts.length - 1]}）`;
}

// ── 一趟抽样：只算不看。跑两趟用于"复跑一致"（摘要里没有墙钟，见文件头口径 ①） ──
function sampleTier(tierKey) {
  const rows = [];
  for (let i = 1; i <= REP; i++) {
    const seed = `probe|${tierKey}|${i}`;
    const t0 = NOW();
    const r = shipPuzzle(seed, tierKey, { now: NOW });
    const wall = NOW() - t0;
    const row = { i, seed, ok: !!r.ok, status: r.status, attempts: r.attempts, stats: r.stats || newStats(), wall };
    if (r.ok) {
      const board = r.board;
      // 独立复算：不吃出货器的返回值，重新跑一遍计数器与铅笔与复核
      const c = countSolutions(board, { limit: 2, budgetNodes: BUDGET, mrv: true });
      const p = solve(board);
      const prep = prepare(board);
      row.nodes = c.nodes;
      row.stopped = c.stopped;
      row.count = c.count;
      row.certAnswer = answerKey(answerOf(c, 0));
      row.shipAnswer = answerKey(r.answer);
      row.pencilAnswer = p.solved ? answerKey(p.sols) : null;
      row.pencilSolved = p.solved;
      row.pencilSteps = p.steps;
      row.fires = p.fires;
      row.cands = prep.cands.map((x) => x.length);
      row.balls = board.balls.size;
      row.holes = board.holes.size;
      row.ponds = board.ponds.size;
      row.cells = board.n;
      row.str = serializeBoard(board);
      row.verifyErrs = verify(board, r.answer);
    }
    rows.push(row);
  }
  return rows;
}
const digestOf = (rows) =>
  rows
    .map((r) =>
      [
        r.i,
        r.ok,
        r.status,
        r.attempts,
        r.str || '-',
        r.shipAnswer || '-',
        r.nodes ?? '-',
        r.count ?? '-',
        r.stopped ?? '-',
        r.pencilSteps ?? '-',
        (r.cands || []).slice().sort((a, b) => a - b).join(','),
        RULE_ORDER.map((k) => (r.fires ? r.fires[k] : '-')).join(','),
        `${r.balls ?? -1}/${r.holes ?? -1}/${r.ponds ?? -1}`,
      ].join('|'),
    )
    .join('\n');

const pass1 = {};
for (const k of LADDER) pass1[k] = sampleTier(k);
const pass2 = {};
for (const k of LADDER) pass2[k] = sampleTier(k);

// ── 逐档读数 ──
function measure(rows, tierKey) {
  const tier = parseTier(tierKey);
  const N = tier.w * tier.h;
  const shipped = rows.filter((r) => r.ok);
  const m = { tier, N, n: rows.length, shipped, rows };
  m.unshipped = rows.filter((r) => !r.ok);
  m.attempts = asc(shipped.map((r) => r.attempts));
  m.attemptsTotal = rows.reduce((a, r) => a + r.attempts, 0);
  m.rejectRate = shipped.length ? m.attemptsTotal / shipped.length : NaN;
  m.clueCount = shipped.map((r) => r.balls + r.holes + r.ponds);
  m.clueShare = shipped.map((r) => (r.balls + r.holes + r.ponds) / r.cells);
  m.pondsAsc = asc(shipped.map((r) => r.ponds));
  m.pondsAddedAsc = asc(shipped.map((r) => r.stats.pondsAdded));
  m.pondsRemovedTotal = shipped.reduce((a, r) => a + r.stats.pondsRemoved, 0);
  m.nodesAsc = asc(shipped.map((r) => r.nodes));
  m.stoppedBoards = shipped.filter((r) => r.stopped);
  m.notUniqueBoards = shipped.filter((r) => !r.stopped && r.count !== 1);
  m.candList = shipped.flatMap((r) => r.cands);
  m.candPerBoardAsc = asc(shipped.map((r) => Math.max(...r.cands)));
  m.stepsAsc = asc(shipped.map((r) => r.pencilSteps));
  m.wallAsc = asc(rows.map((r) => r.wall));
  m.pencilStuck = shipped.filter((r) => !r.pencilSolved);
  m.answerMismatch = shipped.filter((r) => r.certAnswer !== r.shipAnswer);
  m.pencilDisagree = shipped.filter((r) => !r.pencilSolved || r.pencilAnswer !== r.certAnswer);
  m.verifyFail = shipped.filter((r) => r.verifyErrs.length);
  m.pondBoards = shipped.filter((r) => r.ponds > 0);
  m.pondIdentityBreak = shipped.filter((r) => r.stats.pondsAdded !== r.ponds + r.stats.pondsRemoved);
  // 唯一性废因：按原话分桶，逐条计数（口径 ③）
  m.digFail = {};
  for (const r of rows) for (const [why, c] of Object.entries(r.stats.digFail || {})) m.digFail[why] = (m.digFail[why] || 0) + c;
  m.digFailTotal = Object.values(m.digFail).reduce((a, b) => a + b, 0);
  m.newDigFail = Object.keys(m.digFail).filter((s) => !isExpectedWhy(s)); // 预期外死法 ⇒ 新事实
  m.unknownDigFail = Object.keys(m.digFail).filter((s) => !isKnownWhy(s)); // 连已知桶都不是 ⇒ 引擎改了话术
  m.makeFail = rows.reduce((a, r) => a + r.stats.makeFail, 0);
  m.pencilRejectAttempts = rows.reduce((a, r) => a + r.stats.pencilReject, 0);
  m.certTries = rows.reduce((a, r) => a + r.stats.certTries, 0);
  m.stoppedInChannel = rows.reduce((a, r) => a + r.stats.stopped, 0);
  m.pencilMismatchAttempts = rows.reduce((a, r) => a + r.stats.pencilMismatch, 0);
  m.verifyFailAttempts = rows.reduce((a, r) => a + r.stats.verifyFail, 0);
  m.minimizeOverbudget = rows.reduce((a, r) => a + r.stats.minimizeOverbudget, 0);
  m.firesBoards = Object.fromEntries(RULE_ORDER.map((k) => [k, shipped.filter((r) => (r.fires[k] || 0) > 0).length]));
  m.firesTotal = Object.fromEntries(RULE_ORDER.map((k) => [k, shipped.reduce((a, r) => a + (r.fires[k] || 0), 0)]));
  m.rareTop = {};
  for (const k of RULE_ORDER) {
    let top = 0;
    let topSample = -1;
    for (const r of shipped) if ((r.fires[k] || 0) > top) { top = r.fires[k]; topSample = r.i; }
    m.rareTop[k] = { top, topSample, share: m.firesTotal[k] ? top / m.firesTotal[k] : 0 };
  }
  return m;
}
const per = {};
for (const k of LADDER) per[k] = measure(pass1[k], k);

// ── 断言 ──
const MUST_ZERO = [
  ['stoppedInChannel', '出货路径上计数器撞预算的盘数（count===1 && stopped 一律不出货）'],
  ['pencilMismatchAttempts', '铅笔与计数器对同一盘推出不同答案（铅笔不 sound）'],
  ['verifyFailAttempts', '出货答案过不了独立复核 verify()'],
  ['minimizeOverbudget', '极小化摘池时撞预算（撞了就没证到"这颗非留不可"）'],
];
// pencilReject 是**低发火率**的分支（预跑：8x8/4 在 12 盘上一盘都没拒、30 盘才拒 2 盘），
// 按档判红只会把红线咬在样本量上；它要证的是"双条件的第二道不是死代码"，
// 所以咬在整条梯子上（下面 ladderAlive），逐档只照实披露"铅笔拒 N 盘"。
const MUST_ALIVE = [
  ['digFailTotal', '反例驱动补池的"杀不动"这一支一次都没走到过 ⇒ 补池循环是死代码'],
];
for (const key of LADDER) {
  const m = per[key];
  ok(m.shipped.length === m.n, `${key} 出货 x/N 必须是满的`, `${m.shipped.length}/${m.n} 未出货 ${m.unshipped.map((r) => `#${r.i}:${r.status}`).join(' ')}`);
  ok(m.stoppedBoards.length === 0, `${key} 出货盘独立复算必须没有一张撞预算`, `${m.stoppedBoards.length} 张 ${m.stoppedBoards.map((r) => `#${r.i}`).join(' ')}`);
  ok(m.notUniqueBoards.length === 0, `${key} 出货盘独立复算必须张张唯一`, m.notUniqueBoards.map((r) => `#${r.i}=${r.count}`).join(' '));
  ok(m.answerMismatch.length === 0, `${key} 出货盘上的答案必须与独立计数器数出的那一解逐球逐落点相同`, m.answerMismatch.map((r) => `#${r.i}`).join(' '));
  ok(m.pencilDisagree.length === 0, `${key} 铅笔推完的那一解必须与计数器那一解相同（双条件之间也要自洽）`, m.pencilDisagree.map((r) => `#${r.i}`).join(' '));
  ok(m.verifyFail.length === 0, `${key} 出货答案必须过独立复核 verify()`, m.verifyFail.map((r) => `#${r.i}:${r.verifyErrs[0]}`).join(' '));
  ok(m.pondIdentityBreak.length === 0, `${key} 补池账要轧平：pondsAdded === 出货盘池数 + pondsRemoved`, m.pondIdentityBreak.map((r) => `#${r.i}:${r.stats.pondsAdded}≠${r.ponds}+${r.stats.pondsRemoved}`).join(' '));
  for (const [k, why] of MUST_ZERO) ok((m[k] || 0) === 0, `${key} ${k} 必须为 0 —— ${why}`, String(m[k] || 0));
  for (const [k, why] of MUST_ALIVE) ok((m[k] || 0) > 0, `${key} ${k} 必须被走到过 —— ${why}`, String(m[k] || 0));
  ok(m.newDigFail.length === 0, `${key} 唯一性废因只能落在预期那一条上；冒出第二条就是要报的新事实`, m.newDigFail.join(' / '));
  ok(m.unknownDigFail.length === 0, `${key} 废因串必须对得上 generate.js 的原文（引擎改了话术，本文件的桶就失效了）`, m.unknownDigFail.join(' / '));
  ok(m.makeFail === 0, `${key} 由解铺题面应当铺得满（makeFail 是铺不出骨架，不是废盘原因）`, String(m.makeFail));
  ok(m.clueShare.every((x) => x > 0 && x < 0.5), `${key} 题面占格比必须落在 (0,50%) 内`, hist(m.clueCount));
  ok(m.shipped.every((r) => r.balls === m.tier.balls && r.holes === m.tier.balls), `${key} 球数与 H 数都必须等于档位球数（R1 一一对应）`, hist(m.shipped.map((r) => `${r.balls}/${r.holes}`)));
  ok(m.attempts.every((a) => a >= 1 && a <= m.tier.tries), `${key} 每张出货盘烧掉的种子数必须在 1..tries 内`, hist(m.attempts));
}
{
  const pondBoards = LADDER.reduce((a, k) => a + per[k].pondBoards.length, 0);
  ok(pondBoards > 0, '整条梯子上至少要有一张出货盘带池（否则"反例驱动补池 + 极小化摘池"没有证人）', String(pondBoards));
  const pencilRejects = LADDER.reduce((a, k) => a + per[k].pencilRejectAttempts, 0);
  ok(pencilRejects > 0, '整条梯子上双条件的第二道（铅笔零猜测推完）至少要拒过一盘 —— 拒 0 盘就是那道门是死代码', String(pencilRejects));
  const removed = LADDER.reduce((a, k) => a + per[k].pondsRemovedTotal, 0);
  if (removed === 0) notes.push('极小化摘池整条梯子累计 0 颗：出货盘上的池都是挖完就摘不掉的。这是"摘池这一支没起作用"的披露，不是"摘池没跑"。');
}
// 复跑一致（口径 ①）：同一批 seed 两趟，逐字段摘要必须逐字相同
const repro = [];
for (const key of LADDER) {
  const d1 = digestOf(pass1[key]);
  const d2 = digestOf(pass2[key]);
  let where = '';
  if (d1 !== d2) {
    const a = d1.split('\n');
    const b = d2.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { where = `第 ${i + 1} 个样本起不同：${a[i]} ≠ ${b[i]}`; break; }
    if (!where) where = '行数不同';
  }
  ok(d1 === d2, `${key} 复跑一致：同一批 seed 两趟的纯计算读数必须逐字相同（摘要不含墙钟）`, where);
  // 摘要指纹打出来（绿也要看得见）：同一份代码换机器跑，sha 前缀该一样；不一样就是纯函数读数漂了
  repro.push({ key, rows: d1.split('\n').length, chars: d1.length, sha: createHash('sha256').update(d1).digest('hex').slice(0, 16) });
}

// ── 打印 ──
if (!QUIET) {
  const la = loadavg();
  console.log(`generator-probe 出货通道剂量观测：REP=${REP} 盘/档，档位=${LADDER.join(',')}，计数器预算=${BUDGET} 结点`);
  console.log(`本机 load average（1/5/15）= ${la.map((x) => x.toFixed(2)).join(' / ')}，核数 ${cpus().length} ⇒ 墙钟绝对值随争用浮动，只当**上界**看；`);
  console.log(`其余读数（题面串、结点数、候选数、步数、种子数）是纯函数口径，同一批 seed 两趟逐字相同（"复跑一致"断言在表后）。`);
  for (const key of LADDER) {
    const m = per[key];
    const t = m.tier;
    console.log(`\n── ${key}（${t.w}×${t.h}=${m.N} 格，${t.balls} 球，maxK=${t.maxK}，tries=${t.tries}，${SIZES.includes(key) ? '菜单档' : '表外档'}）样本 ${m.n} ──`);
    console.log(`1) 出货 ${m.shipped.length}/${m.n} = ${pct(m.shipped.length, m.n)}｜每张出货盘烧掉的种子数 med ${f0(quantile(m.attempts, 0.5))} / max ${f0(m.attempts[m.attempts.length - 1])}｜拒铺率（烧掉的种子/出货数）${f2(m.rejectRate)}`);
    console.log(`   种子数每样本分布 ${hist(m.attempts)}`);
    console.log(`   出货通道归因（累计）：认证计数 ${m.certTries} 次 / 铺题面失败 ${m.makeFail} / 铅笔拒 ${m.pencilRejectAttempts} 盘 / 挖唯一失败 ${m.digFailTotal} / 撞预算 ${m.stoppedInChannel}`);
    console.log(`2) 题面占格（球+H+池 / 格数）：med ${(100 * quantile(asc(m.clueShare), 0.5)).toFixed(1)}% / max ${(100 * asc(m.clueShare)[m.clueShare.length - 1]).toFixed(1)}%（${m.N} 格）`);
    console.log(`   线索颗数每样本分布 ${hist(m.clueCount)} 颗（球 med ${f0(quantile(asc(m.shipped.map((r) => r.balls)), 0.5))}／H med ${f0(quantile(asc(m.shipped.map((r) => r.holes)), 0.5))}／池 med ${f0(quantile(m.pondsAsc, 0.5))}）`);
    console.log(`3) 补池颗数 med ${f0(quantile(m.pondsAddedAsc, 0.5))} / max ${f0(m.pondsAddedAsc[m.pondsAddedAsc.length - 1])}｜出货盘最终带池率 ${m.pondBoards.length}/${m.shipped.length} = ${pct(m.pondBoards.length, m.shipped.length)}｜极小化摘掉 ${m.pondsRemovedTotal} 颗`);
    console.log(`   出货盘池数每样本分布 ${hist(m.pondsAsc)}`);
    console.log(`4) 计数器 nodes med ${f0(quantile(m.nodesAsc, 0.5))} / p95 ${f0(quantile(m.nodesAsc, 0.95))} / max ${f0(m.nodesAsc[m.nodesAsc.length - 1])}（预算 ${BUDGET}）｜stopped 张数 ${m.stoppedBoards.length}`);
    console.log(`5) 单球候选数 med ${f0(quantile(asc(m.candList), 0.5))} / p95 ${f0(quantile(asc(m.candList), 0.95))} / max ${f0(asc(m.candList)[m.candList.length - 1])}（样本 = 球×盘 = ${m.candList.length} 个）｜单盘最大候选数 med ${f0(quantile(m.candPerBoardAsc, 0.5))} / max ${f0(m.candPerBoardAsc[m.candPerBoardAsc.length - 1])}`);
    console.log(`6) 铅笔步数 med ${f0(quantile(m.stepsAsc, 0.5))} / p95 ${f0(quantile(m.stepsAsc, 0.95))} / max ${f0(m.stepsAsc[m.stepsAsc.length - 1])}`);
    console.log(`7) 墙钟 med ${f2(quantile(m.wallAsc, 0.5))} / p95 ${f2(quantile(m.wallAsc, 0.95))} / max ${f2(m.wallAsc[m.wallAsc.length - 1])} ms（load1 ${la[0].toFixed(2)} ⇒ 上界）`);
    console.log(`8) 唯一性失败原因分类计数（按 generate.js 原话分桶，不归并不改写）：${Object.keys(m.digFail).length ? Object.entries(m.digFail).map(([w, c]) => `「${w}」${c} 次`).join('；') : '无'}`);
    console.log(`   预期外死法（要报的新事实，不并入旧桶）：${m.newDigFail.length ? m.newDigFail.map((x) => `「${x}」`).join('；') : '0 条'}｜已知桶外（引擎话术变了）：${m.unknownDigFail.length ? m.unknownDigFail.map((x) => `「${x}」`).join('；') : '0 条'}`);
    console.log(`9) 铅笔规则发火盘数（分母 = 出货盘 ${m.shipped.length}）：${RULE_ORDER.map((k) => `${k} ${m.firesBoards[k]}/${m.shipped.length}`).join('｜')}`);
    for (const k of RULE_ORDER) {
      const rt = m.rareTop[k];
      if (rt.share > 0.6 && m.firesTotal[k] > 0) notes.push(`${key} 规则「${k}」的 ${m.firesTotal[k]} 次命中里 #${rt.topSample} 独占 ${(100 * rt.share).toFixed(0)}%（覆盖 ${m.firesBoards[k]}/${m.shipped.length} 盘）—— 冷门规则由一两盘撑起，别只看聚合数`);
    }
  }
  console.log('\n── 复跑一致（口径 ①：同一批 seed 两趟，摘要里没有墙钟）──');
  for (const r of repro) console.log(`   ${r.key} 两趟摘要逐字相同｜${r.rows} 行 × ${r.chars} 字符｜sha256 前缀 ${r.sha}`);
  console.log('   （sha 前缀换了 = 纯函数读数漂了 = 引擎或本文件被改，不是机器慢）');
  console.log('');
  for (const n of notes) console.log(`  · ${n}`);
}

console.log(`断言 ${checks} 条，红 ${fails.length} 条`);
for (const f of fails.slice(0, 12)) console.log(`  ✗ ${f}`);
console.log(`RESULT generator-probe ok=${fails.length === 0} checks=${checks} fails=${fails.length}`);
process.exit(fails.length ? 1 : 0);
