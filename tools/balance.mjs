#!/usr/bin/env node
// 难度实测（balance）：把 package.json description 里那几句承诺变成**会红的线**。
// 量的是：出货率 / 墙钟基线 / 计数器预算 / 零猜测闸 / 逐颗线索极小性 / 球数阶梯。
//
// 与同目录别的工具的分工（不重复）：
//   rule-test / pencil-test / counter-test / scenarios 答"引擎有没有坏"。
//   generator-probe 答"出货通道的账是不是真的、剂量是多少"（观测器，不做难度判断）。
//   本文件答"发货承诺那句是不是真的"。ceiling（下一轮）答"尺寸天花板在哪一档"。
//
// 五条硬口径（本组织栽过的坑，逐条写死在这里）：
//   ① 墙钟基线**抄代码不抄注释**：
//        band = [max(1, ⌊med×0.4⌋), max(lo+1, ⌈p95×1.6⌉)]、budgetMs = max(10, ⌈p95×4⌉ 向上取整到 10ms)
//      （与 js/engine/generate.js:22-24 的口径同源。z-biz-game-triplets-cos 的注释里写着 ×25，那是过期的，
//       它的代码是 ×4 —— 抄代码。）判据一律**卡 p95，绝不卡"中位×2"**：出题墙钟是双峰的
//      （一次就出货 ≈0.2ms、烧到十几次 attempt ≈5ms），中位基线会一绿一红。
//      每轮把 中位 / p95 / 最慢 三个**绝对值**原样打印出来，不许只留比值。
//   ② 计数器：所有出货盘 stopped===0；nodes 的 med/p95/max 绝对值进表。
//      这条红了**只许动 balls/maxK/tries**，不许调大 budgetNodes、不许删判据、不许把 p95 换成中位。
//   ③ 零猜测闸：每档 铅笔零猜测 x/N 必须 x===N（推不完的盘在 generate 的出货闸里就被拒了，所以这是
//      双条件的必然推论）。正因为它是推论，才更要同时打印 拒铺率（烧掉的种子/出货数）做诚实披露：
//      x/N 满员不等于"没拒过盘"，它等于"拒完重铺到满为止"。
//   ④ 极小性：对每颗线索（球 / H / 池）做**单颗摘除**，摘完必须"不再唯一"或"铅笔推不完"至少一条成立。
//      README 的口径是"单颗摘除意义的极小，不是线索最少"，本节把这个口径写成判据（unnecessary 必须 0 颗）。
//      摘完数不完（stopped）= 这颗没证到 ⇒ 只披露不判红（与 js/engine/generate.js:auditClueNecessity 同口径）。
//   ⑤ 阶梯红线（这一族的命门）：档位按**球数**定，不是按尺寸定。尺寸钉死 10x10 跑 3/4/5/6/7/9 球，
//      最高档的稀有规则（必经格 / 两球两洞，见 js/engine/pencil.js:RARE_RULES）发火盘数必须
//      **严格大于**最低档，且最高档不为 0。这条红了说明档位退化成"球多 = 盘大"，那是题材问题，
//      **修法不是把线调松**，是把数报给老板。同一张表里再跑一遍尺寸轴（球数钉死、尺寸变 64→324 格），
//      尺寸轴的稀有规则发火盘数**按每 100 格归一后**几乎不涨 ⇒ "更大不一定更深"这句话原样打印
//      （它将来要进 README 的「不承诺」）。归一是必须的：格数涨 5.1 倍时绝对盘数天然会涨，
//      只看绝对值就把这句话判没了 —— 两个口径同表打印，不许只报好看的那个。
//
// 跑法：
//   node tools/balance.mjs                        正式跑（默认 SAMPLES=200 盘/档）
//   node tools/balance.mjs --samples=40            少抽一点（口径不变，只是 p95 的分位数会变）
//   node tools/balance.mjs --quiet                 只打 RESULT 行（将来进 CI 是单独一步，现在不进 npm test）
//   node tools/balance.mjs --calibrate             额外打印"绝对线建议值"，用于回填下面两张线表
//   node tools/balance.mjs --dose=10x10/6#3        把第 3 盘摘掉一颗线索：红线必须咬住（闸不咬就是假绿）
//   node tools/balance.mjs --only=10x10/5,8x8/5    只跑点名档（调试用，红线口径不变）
// 退出码：0 = 全绿；1 = 有红线。本文件只读引擎出口，不改引擎、不碰浏览器、不联网、不装包。
import { shipPuzzle, parseTier, auditClueNecessity, TIERS } from '../js/engine/generate.js';
import { countSolutions, prepare, answerOf, DEFAULT_BUDGET_NODES } from '../js/engine/counter.js';
import { solve, RULE_ORDER, RARE_RULES } from '../js/engine/pencil.js';
import { verify, answerKey } from '../js/engine/verify.js';
import { loadavg, cpus } from 'node:os';

const argOf = (name, dflt) => {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : String(dflt);
};
const QUIET = process.argv.includes('--quiet');
const CALIBRATE = process.argv.includes('--calibrate');
const SAMPLES = Math.max(4, Number(argOf('samples', 200)) || 200);
const BUDGET = DEFAULT_BUDGET_NODES; // 500_000 结点：出货配置本身（js/engine/counter.js:DEFAULT_BUDGET_NODES）
const AUDIT_BUDGET = DEFAULT_BUDGET_NODES; // 极小性复算同预算：撞了就叫"这颗没证到"，不另开口径
const NOW = () => Number(process.hrtime.bigint() / 1000n) / 1000;

// ── 三条轴 ──
// 轴 1（命门）：尺寸钉死 10x10，球数 3/4/5/6/7/9 —— 档位按球数定，不是按尺寸定（口径 ⑤）。
// 轴 2（对照）：球数钉死 5，尺寸 8x8→18x18（64→324 格）—— 把"更大不一定更深"量成数，不是写成话。
const BALL_AXIS = ['10x10/3', '10x10/4', '10x10/5', '10x10/6', '10x10/7', '10x10/9'];
const SIZE_AXIS = ['8x8/5', '10x10/5', '12x12/5', '15x15/5', '18x18/5'];
const MENU_AXIS = TIERS.filter((t) => t.inMenu).map((t) => t.key), ALL_KEYS = [...new Set([...BALL_AXIS, ...SIZE_AXIS, ...MENU_AXIS])]; // 轴 3＝菜单本身：前两轴是按球数/尺寸设计的，**不覆盖菜单**——8x8/4、12x12/7、15x15/9、18x18/11 在两轴里一颗都没有，而线表 11 球那根线正是从 18x18/11 量来的。菜单上写得出的档必须实测，"两轴里有相近球数"不算替它担保（"跑了"≠"判了"）。
const LADDER = (() => {
  const only = argOf('only', '');
  const keys = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : ALL_KEYS;
  if (!keys.length) throw new Error('--only= 给了空档位表');
  for (const k of keys) parseTier(k); // 认不出的档形当场炸
  return keys;
})();
// 绝对线按**球数**给：默认口径是尺寸钉死 10x10 的球数轴（口径⑤的阶梯定义），线 = 该轴实测按公式取整。
// 两条实测事实要写在这里，别拿假设当结论：
//   · 计数器 nodes 确实与格数几乎无关（5 球：10x10 p95 12 → 18x18 p95 16；9 球：10x10 23 → 15x15 31）
//     —— 穷举成本 ∝ ∏(每球候选数)（js/engine/routes.js 文件头判据 2），尺寸轴因此共用同一根线。
//   · 墙钟**不是**这样：5 球 10x10 p95 0.38ms → 18x18 p95 3.19ms（≈8×，铺路/极小化这些趟是 O(格数)）。
//     所以同一球数的线要按"该球数下所有实测档的最坏"给：5 球因此是 20ms（18x18/5 定），11 球 40ms
//    （18x18/11 定）；9 球的表内 10ms 比 15x15/9 的公式值 20ms **更紧**（实测 p95 3.13ms，余量 3.2×）——
//     只紧不松，红了也只许动 balls/maxK/tries，不许反过来把线抬回公式值。"绝对线"那一节逐档把
//     公式值与表内值并排打出来，这条不吻合就是它自己在喊。
//
// 两张表的来历 = 实测回填（跑法 `node tools/balance.mjs`，SAMPLES=200 默认档，seed 串 balance|<档位>|1..200；
// 2026-09-29 那一轮读到的数：nodes/发火盘数这些纯函数列逐字可复现，墙钟列只当**上界**、每轮会漂）。
// 公式与判据同源（口径①②），两条轴同球数取最坏（"绝对线"那一节把最坏实测与表内线逐字对照）：
//   球数 │ 墙钟 med/p95/最慢 ms                        │ budgetMs=⌈p95×4⌉→10ms │ nodes med/p95/max │ ⌈p95×4⌉→50
//     3 │ 0.12 / 0.36 / 1.77                          │ 10  │ 4 / 7 / 9    │ 50
//     4 │ 0.13 / 0.28 / 0.47                          │ 10  │ 6 / 10 / 16  │ 50
//     5 │ 0.13 / 0.38 / 0.54（10x10/5，球数轴）
//       │ 0.90 / 3.19 / 4.98（18x18/5，尺寸轴取最坏）    │ 20  │ 9 / 16 / 31  │ 100
//     6 │ 0.15 / 0.33 / 0.64                          │ 10  │ 11 / 16 / 40 │ 100
//     7 │ 0.17 / 0.50 / 1.20                          │ 10  │ 12 / 18 / 44 │ 100
//     9 │ 0.19 / 0.51 / 1.06                          │ 10  │ 16 / 23 / 40 │ 100
//       │ 菜单档 15x15/9 另测得 med 0.95 / p95 3.13 / 最慢 5.95ms、nodes p95 31 / max 43
//       │ ⇒ 公式值是 20ms / 150，比表内 10ms / 100 松 —— 表内取紧的那个，只紧不松（见上面那段）
//    11 │ 2.63 / 9.00 / 17.03（18x18/11，菜单顶档；默认三轴里第 3 轴＝菜单本身 ⇒ 现在每轮都点得到，
//       │ 当年它是靠 `--only=8x8/4,…,18x18/11 --samples=200 --calibrate` 手点名量出来的最坏值）  │ 40  │ 27 / 44 / 75 │ 200
// ⚠ 线是按 **200 盘**定的：nearest-rank 分位数（sortedAsc[⌈q·n⌉-1]）随 n 挪格，--samples 变小 p95 会跳到更尾的值。
// ⚠ 5 球要 20ms 是尺寸轴 18x18/5 把 p95 推到 3.2ms（球数轴自己只要 10ms）——共用一根线就得按最坏的算。
// ⚠ 这两张线表不是"许可"，是"该档还配不配进菜单"的刀口。调线的唯一合法路径：先量、再写、注释里带上实测 med/p95；
//   ANTI-DRIFT 那两条断言盯着"线被写松"（松到实测公式值 2 倍以上就红），线表缺档也算红（缺线 = 不判 = 漏网）。
const WALL_P95_LINE_MS = { 3: 10, 4: 10, 5: 20, 6: 10, 7: 10, 9: 10, 11: 40 };
const NODES_P95_LINE = { 3: 50, 4: 50, 5: 100, 6: 100, 7: 100, 9: 100, 11: 200 };

const GATES = [
  `出货率：每档 ${SAMPLES} 颗种子必须档档出货 ${SAMPLES}/${SAMPLES}（tries 用尽不出货就红，红名指到样本号）`,
  '墙钟：出货 p95 ≤ 按球数的绝对线（band=[⌊med×0.4⌋,⌈p95×1.6⌉]、budgetMs=⌈p95×4⌉→10ms 一律**卡 p95**，绝不卡中位×2；med/p95/最慢三个绝对值每轮照打）',
  '计数器：所有出货盘 stopped===0 ∧ nodes p95 ≤ 按球数的绝对线（红了只许动 balls/maxK/tries，不许调大 budgetNodes、不许删判据、不许把 p95 换成中位）',
  '零猜测：每档 铅笔零猜测 x/N 必须 x===N（双条件的必然推论），并同时打印拒铺率（烧掉的种子/出货数）——诚实披露，不许省',
  '极小性：每颗线索（球/H/池）单颗摘除后必须"不再唯一"或"铅笔推不完"至少一条成立；两道都过的颗数必须为 0（口径是单颗摘除意义的极小，不是线索最少）；摘完数不完只披露',
  '阶梯（命门）：球数阶梯最高档的稀有规则（必经格/两球两洞）发火盘数严格大于最低档且不为 0；红了说明档位退化成"球多=盘大"，那是题材问题，修法是把数报给老板而不是把线调松',
  '尺寸轴：球数钉死的对照轴上，稀有规则发火盘数按**每 100 格归一**后最高档 ≤ 最低档×1.5 ⇒ 原样打印"更大不一定更深"（将来进 README 的「不承诺」）；绝对盘数一定涨（格数 5.1 倍），只看绝对值会把这句话判没，所以两个口径同表打印',
  '废因：唯一性失败原因只许是「多余解的落点全是正解也用的落点，杀不动」那一条；冒出第二条按新事实报，不并入旧桶',
  '独立复算：出货盘张张要过 计数器唯一 ∧ 铅笔推完 ∧ verify 无错（不吃出货器的返回值）',
  '线表自身（ANTI-DRIFT，--samples ≥ 50 才判）：写死的线松到实测公式值（⌈p95×4⌉）2 倍以上就红；线表里缺这一档的球数由逐档那条"没写死绝对线"报红（缺线 = 不判 = 漏网，不是宽容）；表内比公式紧是允许的（只紧不松）',
];

let checks = 0;
const fails = [];
const notes = [];
function ok(cond, name, detail = '') {
  checks++;
  if (!cond) fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return !!cond;
}

const asc = (a) => a.slice().sort((x, y) => x - y);
function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[idx];
}
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f0 = (x) => (Number.isFinite(x) ? String(Math.round(x)) : '-');
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-');
const ceilTo = (x, u) => Math.ceil(x / u) * u;
// X/N 一律带每样本分布（聚合数会说谎：8.3% 的命中可以全部来自一个退化样本）
function hist(values, label = '') {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  const parts = [...m.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([v, c]) => `${v}×${c}`);
  const body = parts.length <= 12 ? parts.join(' ') : `${parts.slice(0, 10).join(' ')} …（共 ${m.size} 个不同值，最大 ${parts[parts.length - 1]}）`;
  return `   ${label}${body}`;
}
// 口径 ①：墙钟基线（抄代码不抄注释）
function wallBaseline(medMs, p95Ms) {
  const lo = Math.max(1, Math.floor(medMs * 0.4));
  const hi = Math.max(lo + 1, Math.ceil(p95Ms * 1.6));
  const budgetMs = Math.max(10, Math.ceil((p95Ms * 4) / 10) * 10);
  return { lo, hi, budgetMs };
}

const DOSE = (() => {
  const a = process.argv.find((s) => s.startsWith('--dose='));
  if (!a) return null;
  const m = /^--dose=(.+#[0-9]+)$/.exec(a);
  if (!m) throw new Error(`--dose 的形状是 --dose=10x10/6#3，收到 ${a}`);
  const [key, i] = m[1].split('#');
  parseTier(key);
  return { key, i: Number(i) };
})();
const DOSE_LANDED = [];

// ── 每盘一行读数：出货 → 独立复算（计数器 / 铅笔 / verify）→ 逐颗单摘审计 ──
function sampleTier(tierKey) {
  const rows = [];
  for (let i = 1; i <= SAMPLES; i++) {
    const seed = `balance|${tierKey}|${i}`;
    const t0 = NOW();
    const r = shipPuzzle(seed, tierKey, { now: NOW });
    const wall = NOW() - t0;
    const row = { i, seed, ok: !!r.ok, status: r.status, attempts: r.attempts, wall, stats: r.stats };
    if (r.ok) {
      let board = r.board;
      if (DOSE && DOSE.key === tierKey && DOSE.i === i) {
        // 绿着不等于拦得住：摘**一颗**线索（优先池，其次格号最小的球 / H），复算必须当场报出
        // 「不唯一 / 推不完 / 必要性审计说这颗还能删」中的至少一个。摘了还全绿 ⇒ 是闸坏了，不是盘没事。
        const ponds = [...board.ponds].sort((a, b) => a - b);
        const balls = [...board.balls.keys()].sort((a, b) => a - b);
        const holes = [...board.holes].sort((a, b) => a - b);
        const kind = ponds.length ? 'pond' : balls.length ? 'ball' : 'hole';
        const cell = kind === 'pond' ? ponds[0] : kind === 'ball' ? balls[0] : holes[0];
        if (cell === undefined) throw new Error(`--dose 落空：${tierKey}#${i} 上一颗线索都没有，变异等于没做`);
        const next = board.clone();
        if (kind === 'pond') next.ponds.delete(cell);
        else if (kind === 'ball') next.balls.delete(cell);
        else next.holes.delete(cell);
        board = next;
        row.dose = `摘掉 ${kind}@${cell}（原盘 池${r.board.ponds.size}/球${r.board.balls.size}/H${r.board.holes.size}）`;
        DOSE_LANDED.push(`${tierKey}#${i} ${row.dose}`);
      }
      const c = countSolutions(board, { limit: 2, budgetNodes: BUDGET, mrv: true });
      const p = solve(board);
      const prep = prepare(board);
      row.cells = board.n;
      row.clueCount = board.balls.size + board.holes.size + board.ponds.size;
      row.nodes = c.nodes;
      row.stopped = c.stopped;
      row.count = c.count;
      row.unique = !c.stopped && c.count === 1;
      row.pencilSolved = p.solved;
      row.pencilSteps = p.steps;
      row.fires = p.fires;
      row.maxCand = Math.max(...prep.cands.map((x) => x.length));
      row.verifyErrs = c.count >= 1 ? verify(board, answerOf(c, 0)) : [];
      row.answerStr = c.count >= 1 ? answerKey(answerOf(c, 0)) : '-';
      // 口径 ④：逐颗单摘（球 / H / 池每一颗都摘一次）
      const audit = auditClueNecessity(board, { budgetNodes: AUDIT_BUDGET });
      row.audited = audit.length;
      row.byKind = { ball: 0, hole: 0, pond: 0 };
      row.notUnique = 0;
      row.pencilBreak = 0;
      row.overbudget = 0;
      row.unnecessary = []; // 摘掉它之后「仍然唯一 ∧ 仍零猜测推完」⇒ "这颗非留不可"是吹的
      for (const a of audit) {
        row.byKind[a.kind]++;
        if (a.stopped) { row.overbudget++; continue; }
        if (a.count !== 1) row.notUnique++;
        else if (!a.solved) row.pencilBreak++;
        else row.unnecessary.push(`${a.kind}@${a.cell}`);
      }
      row.proven = row.unique && row.pencilSolved && row.verifyErrs.length === 0 && row.unnecessary.length === 0;
    }
    rows.push(row);
  }
  return rows;
}

function measure(rows, tierKey) {
  const tier = parseTier(tierKey);
  const shipped = rows.filter((r) => r.ok);
  const m = { tier, key: tierKey, balls: tier.balls, N: tier.w * tier.h, n: rows.length, shipped, rows };
  m.unshipped = rows.filter((r) => !r.ok);
  m.attemptsAsc = asc(shipped.map((r) => r.attempts));
  m.seedsTotal = rows.reduce((a, r) => a + r.attempts, 0);
  m.rejectRate = shipped.length ? m.seedsTotal / shipped.length : NaN;
  m.pencilReject = rows.reduce((a, r) => a + (r.stats ? r.stats.pencilReject : 0), 0);
  m.makeFail = rows.reduce((a, r) => a + (r.stats ? r.stats.makeFail : 0), 0);
  m.digFail = {};
  for (const r of rows) for (const [why, cnt] of Object.entries(r.stats ? r.stats.digFail : {})) m.digFail[why] = (m.digFail[why] || 0) + cnt;
  m.digFailTotal = Object.values(m.digFail).reduce((a, b) => a + b, 0);
  m.wallAsc = asc(rows.map((r) => r.wall));
  m.nodesAsc = asc(shipped.map((r) => r.nodes));
  m.stepsAsc = asc(shipped.map((r) => r.pencilSteps));
  m.clueAsc = asc(shipped.map((r) => r.clueCount));
  m.stoppedBoards = shipped.filter((r) => r.stopped);
  m.notUniqueBoards = shipped.filter((r) => !r.unique);
  m.pencilStuckBoards = shipped.filter((r) => !r.pencilSolved);
  m.verifyFailBoards = shipped.filter((r) => r.verifyErrs.length > 0);
  m.necViolationBoards = shipped.filter((r) => r.unnecessary.length > 0);
  m.overbudgetBoards = shipped.filter((r) => r.overbudget > 0);
  m.auditedCells = shipped.reduce((a, r) => a + r.audited, 0);
  m.unnecessaryCells = shipped.reduce((a, r) => a + r.unnecessary.length, 0);
  m.overbudgetCells = shipped.reduce((a, r) => a + r.overbudget, 0);
  m.notUniqueCells = shipped.reduce((a, r) => a + r.notUnique, 0);
  m.pencilBreakCells = shipped.reduce((a, r) => a + r.pencilBreak, 0);
  m.pondCells = shipped.reduce((a, r) => a + r.byKind.pond, 0);
  m.zeroGuess = shipped.filter((r) => r.pencilSolved).length;
  m.proven = shipped.filter((r) => r.proven).length;
  m.firesBoards = Object.fromEntries(RULE_ORDER.map((k) => [k, shipped.filter((r) => (r.fires[k] || 0) > 0).length]));
  m.firesTotal = Object.fromEntries(RULE_ORDER.map((k) => [k, shipped.reduce((a, r) => a + (r.fires[k] || 0), 0)]));
  m.rareTop = {};
  for (const k of RULE_ORDER) {
    let top = 0;
    let topSample = -1;
    for (const r of shipped) if ((r.fires[k] || 0) > top) { top = r.fires[k]; topSample = r.i; }
    m.rareTop[k] = { top, topSample, share: m.firesTotal[k] ? top / m.firesTotal[k] : 0 };
  }
  const bl = wallBaseline(quantile(m.wallAsc, 0.5), quantile(m.wallAsc, 0.95));
  m.band = [bl.lo, bl.hi];
  m.budgetMs = bl.budgetMs;
  m.wallP95 = quantile(m.wallAsc, 0.95);
  m.nodesP95 = quantile(m.nodesAsc, 0.95);
  m.wallLineMs = WALL_P95_LINE_MS[tier.balls] ?? Infinity;
  m.nodesLine = NODES_P95_LINE[tier.balls] ?? Infinity;
  return m;
}
const per = {};
for (const k of LADDER) per[k] = measure(sampleTier(k), k);
const MEASURED_BALL = BALL_AXIS.filter((k) => per[k]);
const MEASURED_SIZE = SIZE_AXIS.filter((k) => per[k]);

// ── 按球数聚合两条轴的实测最坏值：线表那两列就是这里取整来的，"建议值"打印与 ANTI-DRIFT 共用同一口径，不分叉 ──
const worst = {};
for (const k of LADDER) {
  const m = per[k];
  const w = worst[m.balls] || (worst[m.balls] = { med: 0, p95: 0, slow: 0, budgetMs: 0, nodesP95: 0, nodesMax: 0, keys: [] });
  w.med = Math.max(w.med, quantile(m.wallAsc, 0.5));
  w.p95 = Math.max(w.p95, m.wallP95);
  w.slow = Math.max(w.slow, m.wallAsc[m.wallAsc.length - 1] || 0);
  w.budgetMs = Math.max(w.budgetMs, m.budgetMs); // 公式 ⌈p95×4⌉→10ms
  w.nodesP95 = Math.max(w.nodesP95, m.nodesP95);
  w.nodesMax = Math.max(w.nodesMax, m.nodesAsc[m.nodesAsc.length - 1] || 0);
  w.keys.push(k);
}
const WORST_BALLS = Object.keys(worst).map(Number).sort((a, b) => a - b);

// ── 逐档判定（口径 ①②③④ + 独立复算；每条都是一个 ok，绿也要有数）──
function judge(m) {
  const flags = [];
  const add = (cond, what) => {
    ok(cond, what);
    if (!cond) flags.push(what);
  };
  add(m.shipped.length === m.n, `${m.key} 出货 ${m.shipped.length}/${m.n} 不满（tries=${m.tier.tries} 用尽）：${m.unshipped.map((r) => `#${r.i}:${r.status}`).join(' ')}`);
  add(m.stoppedBoards.length === 0, `${m.key} ${m.stoppedBoards.length} 张出货盘计数器撞预算（口径②：红了只许动 balls/maxK/tries，不许调大 budgetNodes）：${m.stoppedBoards.map((r) => `#${r.i}`).join(' ')}`);
  add(m.notUniqueBoards.length === 0, `${m.key} ${m.notUniqueBoards.length} 张出货盘独立复算不唯一：${m.notUniqueBoards.map((r) => `#${r.i}=${r.count}`).join(' ')}`);
  add(m.zeroGuess === m.shipped.length, `${m.key} 零猜测闸（口径③）铅笔零猜测 ${m.zeroGuess}/${m.shipped.length} ≠ x===N：推不完 ${m.pencilStuckBoards.map((r) => `#${r.i}`).join(' ')}`);
  add(m.verifyFailBoards.length === 0, `${m.key} ${m.verifyFailBoards.length} 张出货盘过不了独立复核 verify()：${m.verifyFailBoards.map((r) => `#${r.i}:${r.verifyErrs[0]}`).join(' ')}`);
  add(m.unnecessaryCells === 0, `${m.key} 极小性破口（口径④）：${m.unnecessaryCells} 颗线索单颗摘掉后「仍然唯一 ∧ 仍零猜测推完」——"每颗都删不得"这句是吹的（涉及 ${m.necViolationBoards.length} 盘 ${m.necViolationBoards.map((r) => `#${r.i}[${r.unnecessary.join(' ')}]`).join(' ')}）`);
  add(m.proven === m.shipped.length, `${m.key} 已证 ${m.proven}/${m.shipped.length}：${m.shipped.length - m.proven} 盘独立复算不认账（唯一性/零猜测/verify/逐颗必要性）`);
  add(m.wallP95 <= m.wallLineMs, `${m.key} 墙钟 p95 ${f2(m.wallP95)}ms > 线 ${m.wallLineMs}ms（球数 ${m.balls} 的绝对线；红了摘档或降 balls/maxK/tries，不许把 p95 换成中位）`);
  add(m.nodesP95 <= m.nodesLine, `${m.key} 计数器 nodes p95 ${f0(m.nodesP95)} > 线 ${f0(m.nodesLine)}（球数 ${m.balls}；红了只许动 balls/maxK/tries，不许调大 budgetNodes）`);
  // 线表里没写这一档 = Infinity = 不判 ⇒ 那不能算绿（Infinity 是漏网，不是宽容）
  const noWall = !Object.prototype.hasOwnProperty.call(WALL_P95_LINE_MS, m.balls);
  const noNodes = !Object.prototype.hasOwnProperty.call(NODES_P95_LINE, m.balls);
  add(!noWall && !noNodes, `${m.key} 球数 ${m.balls} 没写死绝对线（${[noWall && '墙钟', noNodes && 'nodes'].filter(Boolean).join('/')}）：线表里缺这档就是"不判"，要么按实测回填、要么把这档摘出轴`);
  const badReason = Object.keys(m.digFail).filter((s) => s !== '多余解的落点全是正解也用的落点，杀不动');
  add(badReason.length === 0, `${m.key} 唯一性废因冒出预期外的第二条（新事实，按新事实报、不并入旧桶）：${badReason.map((x) => `「${x}」`).join('；')}`);
  if (m.overbudgetCells > 0) notes.push(`${m.key} 极小性审计里 ${m.overbudgetCells} 颗摘完数不完（涉及 ${m.overbudgetBoards.length} 盘 ${m.overbudgetBoards.map((r) => `#${r.i}`).join(' ')}）⇒ 这些颗的"非留不可"没证到，只披露不判红`);
  return flags;
}

// ── 阶梯红线（口径 ⑤，命门）──
function ladderLines() {
  const lines = [];
  if (MEASURED_BALL.length < 2) {
    notes.push(`本轮只量到 ${MEASURED_BALL.length} 个球数档（--only= 的结果）⇒ 阶梯红线要比较的是"最高档 vs 最低档"，少于两档不适用，自动跳过`);
    return { lines, skipped: true };
  }
  if (MEASURED_BALL.length < BALL_AXIS.length) {
    notes.push(`球数轴只量到 ${MEASURED_BALL.length}/${BALL_AXIS.length} 档（${MEASURED_BALL.join('/')}，--only= 的结果）⇒ 下面的阶梯红线是在这点档上比的，最高档 vs 最低档离得越近越说明不了事`);
  }
  for (const rule of RARE_RULES) {
    const seq = MEASURED_BALL.map((k) => per[k].firesBoards[rule]);
    const bottom = seq[0];
    const top = seq[seq.length - 1];
    const grow = top > bottom;
    const nonzero = top > 0;
    const text = `${rule} 发火盘数（分母 ${SAMPLES} 盘/档，尺寸钉死 10x10，球数 ${MEASURED_BALL.map((k) => parseTier(k).balls).join('/')}）：`
      + `${MEASURED_BALL.map((k, j) => `${parseTier(k).balls}球 ${seq[j]}`).join(' → ')}`
      + `｜红线：最高档 ${top} 严格大于最低档 ${bottom} ⇒ ${grow ? '成立' : '**不成立**'}，且最高档不为 0 ⇒ ${nonzero ? '成立' : '**不成立**'}`;
    lines.push({ rule, seq, bottom, top, ok: grow && nonzero, text });
  }
  // 球数轴没有把 maxK 钉死：10x10/5 与 10x10/6 走 generate.js TIERS 的 maxK（5 与 6），
  // 其余档走 parseTier 对表外档的默认值 6。这一维混在阶梯里，读数照打、但要在报告里写明
  // （两球两洞在 5 球档掉到 0 就是它干的，不是阶梯坏了）。
  notes.push(`球数轴的 maxK 不是同一维：${MEASURED_BALL.map((k) => `${parseTier(k).balls}球 maxK=${parseTier(k).maxK}`).join(' / ')}（10x10/5、10x10/6 吃 generate.js TIERS 的表内值，其余吃 parseTier 对表外档的默认 6）⇒ 阶梯比较里混了这一维，掉档要看它`);
  return { lines, skipped: false };
}
const LAD = ladderLines();
const sizeSeq = {};
for (const rule of RARE_RULES) sizeSeq[rule] = MEASURED_SIZE.map((k) => per[k].firesBoards[rule]);
// ── "几乎不涨"的口径（尺寸轴）：发火**盘数**天然跟格数走，格数 64→324 就是 5.1 倍，绝对值一定涨。
//    所以"更大不一定更深"问的不是绝对值，是**每 100 格的发火盘数**（深度/格数）。归一后最高档 ≤ 最低档×1.5
//    就叫几乎不涨。两个口径同表打印，不许只报好看的那个（200 盘/档时 8x8 的 23/64 格 比 18x18 的 41/324 格
//    每格更"深"，绝对数却反过来 —— 只看绝对值会把这句话判没）。
const AREA_MULT = MEASURED_SIZE.length >= 2 ? per[MEASURED_SIZE[MEASURED_SIZE.length - 1]].N / per[MEASURED_SIZE[0]].N : 1;
const per100Cells = (k, rule) => (per[k].firesBoards[rule] / per[k].N) * 100;
const flatRules = MEASURED_SIZE.length >= 2 ? RARE_RULES.filter((rule) => {
  const s = MEASURED_SIZE.map((k) => per100Cells(k, rule));
  return s[s.length - 1] <= Math.max(1e-9, s[0]) * 1.5;
}) : [];

// ── 打印 ──
function printTier(m) {
  const t = m.tier;
  const la = loadavg();
  console.log(`\n── ${m.key}（${t.w}×${t.h}=${m.N} 格，${t.balls} 球，maxK=${t.maxK}，tries=${t.tries}）样本 ${m.n} ──`);
  console.log(`1) 出货 ${m.shipped.length}/${m.n} = ${pct(m.shipped.length, m.n)}｜每张出货盘烧掉的种子数 med ${f0(quantile(m.attemptsAsc, 0.5))} / max ${f0(m.attemptsAsc[m.attemptsAsc.length - 1])}｜拒铺率（烧掉的种子/出货数）${f2(m.rejectRate)}`);
  console.log(hist(m.attemptsAsc, '种子数每样本分布 '));
  console.log(`   出货通道归因（${m.n} 颗种子累计）：铺题面失败 ${m.makeFail} / 挖唯一失败 ${m.digFailTotal} / 铅笔拒 ${m.pencilReject} 盘｜废因 ${Object.keys(m.digFail).length ? Object.entries(m.digFail).map(([w, c]) => `「${w}」${c} 次`).join('；') : '无'}`);
  console.log(`2) 墙钟 med ${f2(quantile(m.wallAsc, 0.5))} / p95 ${f2(m.wallP95)} / 最慢 ${f2(m.wallAsc[m.wallAsc.length - 1])} ms（本机 load1 ${la[0].toFixed(2)}、${cpus().length} 核 ⇒ 上界）`);
  console.log(`   基线（口径①的公式，卡 p95 不卡中位×2）band=[${m.band[0]}, ${m.band[1]}]、budgetMs=${m.budgetMs}ms｜本档绝对线 p95 ≤ ${m.wallLineMs}ms ⇒ ${m.wallP95 <= m.wallLineMs ? '绿' : '红'}`);
  console.log(`3) 计数器 nodes med ${f0(quantile(m.nodesAsc, 0.5))} / p95 ${f0(m.nodesP95)} / max ${f0(m.nodesAsc[m.nodesAsc.length - 1])}（预算 ${BUDGET}）｜stopped 张数 ${m.stoppedBoards.length}｜本档绝对线 p95 ≤ ${f0(m.nodesLine)} ⇒ ${m.nodesP95 <= m.nodesLine ? '绿' : '红'}`);
  console.log(`4) 铅笔零猜测 ${m.zeroGuess}/${m.shipped.length}（红线 x===N）｜步数 med ${f0(quantile(m.stepsAsc, 0.5))} / p95 ${f0(quantile(m.stepsAsc, 0.95))} / max ${f0(m.stepsAsc[m.stepsAsc.length - 1])}｜题面线索 med ${f0(quantile(m.clueAsc, 0.5))}/${m.N} 格 = ${pct(quantile(m.clueAsc, 0.5), m.N)}`);
  console.log(hist(m.shipped.map((r) => r.attempts > 1 ? r.attempts : 1), '重铺过的种子数分布 '));
  console.log(`5) 极小性（单颗摘除意义的极小，不是线索最少）：审计 ${m.auditedCells} 颗 = 球 ${m.shipped.reduce((a, r) => a + r.byKind.ball, 0)} + H ${m.shipped.reduce((a, r) => a + r.byKind.hole, 0)} + 池 ${m.pondCells}`);
  console.log(`   摘完的去处：不再唯一 ${m.notUniqueCells} 颗｜铅笔推不完 ${m.pencilBreakCells} 颗｜两道都过=多余 ${m.unnecessaryCells} 颗（红线 0）｜数不完=没证到 ${m.overbudgetCells} 颗（只披露）`);
  console.log(hist(m.shipped.map((r) => r.unnecessary.length), '每盘多余颗数分布 '));
  console.log(`6) 已证（唯一 ∧ 零猜测 ∧ verify ∧ 逐颗必要性）${m.proven}/${m.shipped.length}`);
  console.log(`7) 规则发火盘数（分母 = 出货盘 ${m.shipped.length}）：${RULE_ORDER.map((k) => `${k} ${m.firesBoards[k]}/${m.shipped.length}`).join('｜')}`);
  for (const k of RARE_RULES) {
    console.log(hist(m.shipped.map((r) => r.fires[k] || 0), `   「${k}」每盘命中次数分布 `));
    const rt = m.rareTop[k];
    if (rt.share > 0.6 && m.firesTotal[k] > 0) notes.push(`${m.key} 稀有规则「${k}」的 ${m.firesTotal[k]} 次命中里 #${rt.topSample} 独占 ${(100 * rt.share).toFixed(0)}%（覆盖 ${m.firesBoards[k]}/${m.shipped.length} 盘）—— 聚合数是被一两盘撑起来的`);
  }
  return judge(m);
}

if (QUIET) {
  for (const k of LADDER) judge(per[k]);
} else {
  const la = loadavg();
  console.log(`balance 难度实测：SAMPLES=${SAMPLES} 盘/档；轴1 球数阶梯（命门，尺寸钉死 10x10）=${MEASURED_BALL.map((k) => parseTier(k).balls).join('/')}；轴2 尺寸阶梯（对照，球数钉死 ${parseTier(SIZE_AXIS[0]).balls} 颗球）=${MEASURED_SIZE.join('/')}`);
  console.log(`计数器预算=${BUDGET} 结点（出货配置本身，红线不许调大它）；审计预算=${AUDIT_BUDGET} 结点；墙钟与判据一律卡 p95（绝不卡中位×2：出题墙钟双峰，一次出货 ≈0.2ms、烧满 tries ≈5ms）。`);
  console.log(`本机 load average（1/5/15）= ${la.map((x) => x.toFixed(2)).join(' / ')}，核数 ${cpus().length} ⇒ 墙钟绝对值随争用浮动，只当**上界**看；结点数/步数/线索数/发火盘数是纯函数口径，同一批 seed 逐字可复现（seed 串 balance|<档位>|<1..N>）。`);
  console.log(`\n══ 轴 1：球数阶梯（尺寸钉死 10x10）══`);
  for (const k of MEASURED_BALL) printTier(per[k]);
  const extraSize = MEASURED_SIZE.filter((k) => !MEASURED_BALL.includes(k));
  if (extraSize.length) {
    console.log(`\n══ 轴 2：尺寸阶梯（球数钉死 ${parseTier(SIZE_AXIS[0]).balls} 颗；10x10/5 与轴 1 共用，不重复跑）══`);
    for (const k of extraSize) printTier(per[k]);
  }
  // 两条轴都不沾的点名档（例如 --only= 只指菜单梯子）也必须被判定 —— 不然"跑了"不等于"判了"
  const others = LADDER.filter((k) => !MEASURED_BALL.includes(k) && !MEASURED_SIZE.includes(k));
  if (others.length) {
    console.log(`\n══ 轴外点名档（--only= 指到、不在两条轴里的档；逐档判定照跑，阶梯红线不参与）══`);
    for (const k of others) printTier(per[k]);
  }
}

if (!QUIET) {
  console.log(`\n══ 阶梯红线（口径⑤：这一族的命门）══`);
  for (const v of LAD.lines) console.log(`${v.ok ? ' 绿 ' : ' 红 '} ${v.text}`);
}
for (const v of LAD.lines) ok(v.ok, `阶梯红线[${v.rule}]：${v.text}`);

// ── ANTI-DRIFT：线表写死在文件里，实测会漂。漂到"线比公式值（⌈p95×4⌉）还松 2 倍以上"就是有人在调松线 ⇒ 红。
//    这条与"红了只许动 balls/maxK/tries"是同一件事的两面：那条管当下别松手，这条管几周后没人记得为什么。
//    只在正式口径（--samples ≥ 50）下判：nearest-rank p95 在小样本会跳到更尾的格，公式值不可比。
if (SAMPLES >= 50) {
  for (const b of WORST_BALLS) {
    // 缺档由逐档那条"没写死绝对线"负责报，这里只比"写了但写松了"
    if (!Object.prototype.hasOwnProperty.call(WALL_P95_LINE_MS, b) || !Object.prototype.hasOwnProperty.call(NODES_P95_LINE, b)) continue;
    const w = worst[b];
    ok(WALL_P95_LINE_MS[b] <= w.budgetMs * 2, `ANTI-DRIFT 墙钟线：球数 ${b} 写死 ${WALL_P95_LINE_MS[b]}ms > 实测公式值 ⌈p95×4⌉→10ms=${w.budgetMs}ms 的 2 倍（实测 p95 ${f2(w.p95)}ms，档 ${w.keys.join('/')}）⇒ 线被写松了；该红的是盘，不是线`);
    ok(NODES_P95_LINE[b] <= ceilTo(w.nodesP95 * 4, 50) * 2, `ANTI-DRIFT nodes 线：球数 ${b} 写死 ${NODES_P95_LINE[b]} > 实测公式值 ⌈p95×4⌉→50=${ceilTo(w.nodesP95 * 4, 50)} 的 2 倍（实测 p95 ${f0(w.nodesP95)}，档 ${w.keys.join('/')}）⇒ 同上`);
  }
} else {
  notes.push(`ANTI-DRIFT（线表 vs 实测公式值）本轮跳过：--samples=${SAMPLES} < 50 时 nearest-rank p95 跳到更尾的格、公式值不可比；正式口径是 --samples=200`);
}

// ── 菜单覆盖：inMenu 的档必须档档被本轮点到（"跑了"≠"判了"，见上面轴 3 那段）──
// 这条盯的是"默认表被人改回两轴"或"TIERS 加了新档而轴没跟着加"：线表里有这一球数的线、实测里
// 却没有这一档，那根线就变成无人复算的许可。--only 是调试口径 ⇒ 跳过时写进 notes，不静默。
if (argOf('only', '')) {
  notes.push(`菜单完整性那条本轮不判：--only=${argOf('only', '')} 是点名调试口径（正式口径是不带 --only 的默认三轴）`);
} else {
  for (const k of MENU_AXIS) ok(per[k], `菜单档 ${k} 没被本轮点到：generate.js TIERS 里 inMenu=true 的档必须实测，两轴里有相近球数不算替它担保`);
}

if (!QUIET && MEASURED_SIZE.length >= 2) {
  console.log(`\n── 尺寸轴读数（球数钉死，格数 ${per[MEASURED_SIZE[0]].N}→${per[MEASURED_SIZE[MEASURED_SIZE.length - 1]].N}，${AREA_MULT.toFixed(1)} 倍）──`);
  for (const rule of RARE_RULES) {
    console.log(`   ${rule} 发火盘数（绝对）：${MEASURED_SIZE.map((k, j) => `${k} ${sizeSeq[rule][j]}`).join(' → ')}`);
    console.log(`   ${rule} 每 100 格发火盘数（归一，判定看这条）：${MEASURED_SIZE.map((k) => `${k} ${f2(per100Cells(k, rule))}`).join(' → ')}`);
  }
  console.log(`   计数器 nodes med：${MEASURED_SIZE.map((k) => `${k} ${f0(quantile(per[k].nodesAsc, 0.5))}`).join(' → ')}`);
  console.log(`   铅笔步数 med：${MEASURED_SIZE.map((k) => `${k} ${f0(quantile(per[k].stepsAsc, 0.5))}`).join(' → ')}`);
  console.log(`   墙钟 p95 ms：${MEASURED_SIZE.map((k) => `${k} ${f2(per[k].wallP95)}`).join(' → ')}`);
  console.log(`   出货盘带池率：${MEASURED_SIZE.map((k) => `${k} ${pct(per[k].shipped.filter((r) => r.clueCount > 2 * parseTier(k).balls).length, per[k].shipped.length)}`).join(' → ')}`);
  const fmtBoth = RARE_RULES.map((rule) => {
    const s = sizeSeq[rule];
    const p = MEASURED_SIZE.map((k) => per100Cells(k, rule));
    return `${rule}：绝对 ${s[0]}→${s[s.length - 1]}（${(s[s.length - 1] / Math.max(1, s[0])).toFixed(2)} 倍）｜每100格 ${f2(p[0])}→${f2(p[p.length - 1])}（${(p[p.length - 1] / Math.max(1e-9, p[0])).toFixed(2)} 倍，格数 ${AREA_MULT.toFixed(1)} 倍）`;
  }).join('；');
  if (flatRules.length) {
    const line = '更大不一定更深：尺寸轴（球数钉死）的稀有规则发火盘数几乎不涨。这句话将来要进 README 的「不承诺」。';
    console.log(`   ⇒ ${line}（判定口径：每 100 格归一后最高档 ≤ 最低档×1.5；命中规则 ${flatRules.join('/')}）`);
    console.log(`     ${fmtBoth}`);
    notes.push(`${line} 本轮口径：格数涨 ${AREA_MULT.toFixed(1)} 倍，${flatRules.join('/')} 每 100 格发火盘数最高档 ≤ 最低档×1.5（绝对盘数会涨，涨得比格数慢就是没更深）`);
  } else {
    console.log(`   ⇒ 本轮尺寸轴**没有**测出"发火盘数几乎不涨"（判定口径：每 100 格归一后最高档 ≤ 最低档×1.5）。`);
    console.log(`     ${fmtBoth}`);
  }
}

if (!QUIET) {
  console.log('\n── 档位对照表（两条轴一起看；墙钟三个绝对值 med/p95/最慢）──');
  console.log('   每档两行带标签读数（不用对齐列：墙钟三个绝对值 med/p95/最慢 原样在列）');
  for (const k of LADDER) {
    const m = per[k];
    const axis = [MEASURED_BALL.includes(k) && MEASURED_SIZE.includes(k) ? '球数轴+尺寸轴共用' : MEASURED_BALL.includes(k) ? '球数轴' : MEASURED_SIZE.includes(k) ? '尺寸轴' : '菜单轴', MENU_AXIS.includes(k) ? '＋菜单档' : '（不在菜单里）'].join('');
    console.log(
      `   ${k}｜${axis}｜出货 ${m.shipped.length}/${m.n}｜种子 med ${f0(quantile(m.attemptsAsc, 0.5))}/max ${f0(m.attemptsAsc[m.attemptsAsc.length - 1])}｜拒铺率 ${f2(m.rejectRate)}` +
        `｜墙钟 med ${f2(quantile(m.wallAsc, 0.5))}/p95 ${f2(m.wallP95)}/最慢 ${f2(m.wallAsc[m.wallAsc.length - 1])}ms（线 ${m.wallLineMs}ms、band=[${m.band.join(', ')}]、budgetMs=${m.budgetMs}ms）`,
    );
    console.log(
      `      nodes med ${f0(quantile(m.nodesAsc, 0.5))}/p95 ${f0(m.nodesP95)}/max ${f0(m.nodesAsc[m.nodesAsc.length - 1])}（线 ${f0(m.nodesLine)}）｜stopped ${m.stoppedBoards.length} 张` +
        `｜零猜测 ${m.zeroGuess}/${m.shipped.length}｜步数 med ${f0(quantile(m.stepsAsc, 0.5))}/p95 ${f0(quantile(m.stepsAsc, 0.95))}｜线索 med ${f0(quantile(m.clueAsc, 0.5))}/${m.N} 格` +
        `｜必经格 ${m.firesBoards['必经格']}/${m.shipped.length}｜两球两洞 ${m.firesBoards['两球两洞']}/${m.shipped.length}｜多余 ${m.unnecessaryCells} 颗｜没证到 ${m.overbudgetCells} 颗｜已证 ${m.proven}/${m.shipped.length}`,
    );
  }
  console.log('\n── 绝对线（表内写死的线 = 这里的最坏实测按公式取整；红了不许调松线，只许动 balls/maxK/tries）──');
  console.log('   两条轴同球数取最坏；公式 = 墙钟 ⌈p95×4⌉→10ms（口径①）、nodes ⌈p95×4⌉→50（同一条留余量规则）');
  for (const b of WORST_BALLS) {
    const w = worst[b];
    const wLine = WALL_P95_LINE_MS[b];
    const nLine = NODES_P95_LINE[b];
    const nf = ceilTo(w.nodesP95 * 4, 50);
    console.log(`   球数 ${String(b).padStart(2)}｜实测最坏 med ${f2(w.med)} / p95 ${f2(w.p95)} / 最慢 ${f2(w.slow)}ms（档 ${w.keys.join('/')}）` +
      `⇒ 墙钟公式线 ${w.budgetMs}ms、表内 ${wLine ?? '缺（=不判，见逐档那条红）'}ms${Number.isFinite(wLine) ? `（余量 ${(wLine / w.p95).toFixed(1)}× p95）` : ''}` +
      `｜nodes 最坏 p95 ${f0(w.nodesP95)} / max ${f0(w.nodesMax)} ⇒ 公式线 ${nf}、表内 ${nLine ?? '缺（=不判）'}${Number.isFinite(nLine) ? `（余量 ${(nLine / w.nodesP95).toFixed(1)}× p95）` : ''}`);
  }
  const menu = TIERS.filter((t) => t.inMenu);
  notes.push(`generate.js TIERS 的 band/budgetMs 目前仍是占位值（${menu.map((t) => `${t.key} band=[${t.band.join(',')}] budgetMs=${t.budgetMs}`).join(' / ')}），且**没有任何判定路径吃它**（shipPuzzle 只读 w/h/balls/maxK/tries）⇒ 接线留给 ceiling 那一轮，本文件只把实测建议值打出来，不改引擎。`);
}

if (CALIBRATE) {
  const lines = [];
  for (const k of LADDER) {
    const m = per[k];
    lines.push(`   ${k} 墙钟 med ${f2(quantile(m.wallAsc, 0.5))} / p95 ${f2(m.wallP95)} / 最慢 ${f2(m.wallAsc[m.wallAsc.length - 1])}ms → band=[${m.band.join(', ')}] budgetMs=${m.budgetMs}ms；nodes med ${f0(quantile(m.nodesAsc, 0.5))} / p95 ${f0(m.nodesP95)} / max ${f0(m.nodesAsc[m.nodesAsc.length - 1])}`);
  }
  console.log('\n── --calibrate：每档实测与公式值（回填 WALL_P95_LINE_MS / NODES_P95_LINE / generate.js TIERS 用）──');
  for (const l of lines) console.log(l);
}

if (QUIET) {
  // 门禁模式：全绿只留 RESULT 一行；有红就把红名念出来（不然 CI 那边只看到一个 false 不知道为什么）
  for (const f of fails) console.log(`  ✗ ${f}`);
  if (DOSE_LANDED.length) console.log(`[DOSE] 变异已落地：${DOSE_LANDED.join('；')}｜红线 ${fails.length} 项`);
} else {
  console.log('');
  for (const n of notes) console.log(`  · ${n}`);
  if (DOSE_LANDED.length) {
    const n = fails.length;
    console.log(`\n[DOSE] 变异已落地：${DOSE_LANDED.join('；')}｜红线 ${n} 项` + (n ? '（摘一颗线索就咬 ⇒ 上面那些绿是真绿，红名指到了那一盘）' : '（摘了线索还全绿 ⇒ 这条闸不咬，上面的绿别当证据）'));
    if (n === 0) ok(false, '--dose 之后必须至少一条红线咬住（闸不咬就是假绿）', DOSE_LANDED.join('；'));
  }
  console.log(`\n门禁口径（GATES，来历见本文件文件头五条硬口径）：`);
  for (const g of GATES) console.log(`  · ${g}`);
  console.log(`\n断言 ${checks} 条，红 ${fails.length} 条`);
  for (const f of fails) console.log(`  ✗ ${f}`);
}
console.log(`RESULT balance ok=${fails.length === 0} checks=${checks} fails=${fails.length}`);
process.exit(fails.length ? 1 : 0);
