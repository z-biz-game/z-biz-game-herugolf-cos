// 出货通道：由解铺题面 → 反例驱动补池挖唯一 → 摘池极小化 → 双条件闸（计数器认证唯一 ∧ 铅笔零猜测推完）。
//
// 为什么"双条件"是**出货口径**而不是一句漂亮话：
//   ① 计数器说这盘只有一种走法（玩家不会撞上第二解）；
//   ② 铅笔在零猜测下推得完（玩家只靠那五条命名规则就能解完，不必"试一条线看看"）。
// 铅笔不完备：存在「多候选杀不完」的盘（不矛盾、仍然唯一，但推不完）。这类盘在这里就作废重铺，
// 所以 README **不许**写"这个品类都能纯逻辑解"，只能写"出货的每一盘两条都过"。
//
// 三条从别的仓抬进来的硬口径（写在代码里，不写在文档里）：
//   ⚠ 出货前 board 上的答案一律**用计数器数出来的那一解覆盖**（js/engine/counter.js:answerOf），
//     不信本文件铺题面时自己记的那一份 —— 补池/摘池之后自记的答案可能已不再是任何解。
//   ⚠ 计数器 stopped=true（没数完）不等于"只有一种"：count===1 && stopped 一律不出货。
//   ⚠ 默认种子不许按日期算；"下一局"= seed + k 自增（下面的 attempt 就是那个 k），
//     并且把 k 记进 stats.attempts，让"为了出这一盘重试了几次"成为可对账的数。
import { Board } from './grid.js';
import { verify } from './verify.js';
import { mulberry32, hashSeed, shuffle } from './rng.js';
import { prepare, countSolutions, answerOf, DEFAULT_BUDGET_NODES } from './counter.js';
import { solve } from './pencil.js';

// ── 档位表：尺寸与球数一起长（球数才是难度旋钮，见 tools/balance.mjs 的 R3/R4 两条）──
// band / budgetMs 是**实测回填**的：由 `node tools/balance.mjs` 打印的建议值抄进来，不许凭感觉填。
// band = [max(1, floor(中位×0.4)), max(lo+1, ceil(p95×1.6))]，budgetMs = max(10, ceil(p95×4/10)*10)
// —— 一律卡 p95，绝不卡"中位×2"（出题墙钟是双峰的，中位基线会一绿一红）。
export const TIERS = [
  { key: '8x8/4', w: 8, h: 8, balls: 4, maxK: 5, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
  { key: '10x10/5', w: 10, h: 10, balls: 5, maxK: 5, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
  { key: '10x10/6', w: 10, h: 10, balls: 6, maxK: 6, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
  { key: '12x12/7', w: 12, h: 12, balls: 7, maxK: 6, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
  { key: '15x15/9', w: 15, h: 15, balls: 9, maxK: 6, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
  { key: '18x18/11', w: 18, h: 18, balls: 11, maxK: 6, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
];
export const SIZES = TIERS.filter((t) => t.inMenu).map((t) => t.key);
export function parseTier(key) {
  const t = TIERS.find((x) => x.key === key);
  if (t) return { ...t };
  const m = /^([0-9]+)x([0-9]+)\/([0-9]+)$/.exec(key);
  if (!m) throw new Error(`parseTier：认不出档位「${key}」（形状应是 10x10/6）`);
  const [, w, h, balls] = m;
  return { key, w: Number(w), h: Number(h), balls: Number(balls), maxK: 6, tries: 30, band: [1, Infinity], budgetMs: Infinity, inMenu: false };
}

// ── 由解出发：先铺一组互不相交的合法路线，再读出题面（球/H）──
// 返回 {ok:true, board, answer} 或 {ok:false, why}。
// 铺的每一条都当场用独立复核（verify）确认；撒池不在这里 —— 池是后来杀多余走法用的。
export function makeSolution(w, h, rnd, { balls = 3, maxK = 5 } = {}) {
  const answer = [];
  const used = new Set();
  const holes = new Set();
  const ballMap = new Map();
  const tmp = new Board(w, h, { balls: ballMap, holes, ponds: new Set() });
  for (let attempt = 0; attempt < 400 && answer.length < balls; attempt++) {
    const start = Math.floor(rnd() * tmp.n);
    if (used.has(start)) continue;
    const k0 = 2 + Math.floor(rnd() * Math.max(1, maxK - 1)); // 至少 2：只有 1 的球一动就到底，没地方可去
    const route = growRoute(tmp, k0, start, used, rnd);
    if (!route) continue;
    answer.push({ start, stops: route.stops, cells: route.cells });
    for (const c of route.cells) used.add(c);
    holes.add(route.hole);
    ballMap.set(start, k0);
  }
  if (answer.length < balls) return { ok: false, why: `只铺出 ${answer.length}/${balls} 条路线` };
  const errs = verify(tmp, answer.map((s) => ({ start: s.start, stops: s.stops })));
  if (errs.length) return { ok: false, why: `铺出来的答案过不了独立复核：${errs[0]}` };
  return { ok: true, board: tmp, answer: answer.map((s) => ({ start: s.start, stops: s.stops.slice() })) };
}

// 从 start 走一条 k,k-1,… 的线，终点变成新 H，且不碰 used 里的格
function growRoute(board, k0, start, used, rnd) {
  const cells = [start];
  const stops = [];
  let at = start;
  for (let k = k0; k >= 1; k--) {
    const dirs = shuffle([0, 1, 2, 3], rnd); // 打乱走 shuffle，绝不在 sort 比较器里抽随机数（rng.js 纪律①）
    let advanced = false;
    for (const d of dirs) {
      const path = [];
      let cur = at;
      let ok = true;
      for (let s = 0; s < k; s++) {
        cur = board.step(cur, d);
        if (cur < 0 || used.has(cur) || cells.includes(cur)) {
          ok = false;
          break;
        }
        if (board.holes.has(cur) && s < k - 1) {
          ok = false;
          break; // 穿过已有 H
        }
        path.push(cur);
      }
      if (!ok) continue;
      const last = path[path.length - 1];
      if (board.holes.has(last)) continue; // 落在别人的洞上：这一动得停，但洞已占
      cells.push(...path);
      stops.push(last);
      at = last;
      advanced = true;
      break;
    }
    if (!advanced) return null;
  }
  const holeCell = stops[stops.length - 1];
  if (used.has(holeCell)) return null;
  return { cells, stops, hole: holeCell };
}

// ── 反例驱动补池：数出多余解，把它的某个"只属于它"的落点变成池 ──
// 池只能禁止"停在某格"（R4 允许穿过），所以杀点必须是一条多余解的**落点**，
// 且不能落在正解的落点上、也不能落在正解经过的格上（那样连正解一起杀）。
// 补池是单调的（只会让候选变少）⇒ 循环不来回震荡 ⇒ 出货成本有先验上界。
export function digUnique(board, answer, { budgetNodes = DEFAULT_BUDGET_NODES, maxPond = 24 } = {}) {
  const answerStops = new Set(answer.flatMap((s) => s.stops));
  const answerCells = new Set(answer.flatMap((s) => s.cells));
  let added = 0;
  let tries = 0;
  let nodesSum = 0;
  let nodesMax = 0;
  let stopped = false;
  for (let round = 0; round <= maxPond; round++) {
    const prep = prepare(board);
    const c = countSolutions(board, { limit: 2, budgetNodes, prep, mrv: true });
    tries++;
    nodesSum += c.nodes;
    nodesMax = Math.max(nodesMax, c.nodes);
    if (c.stopped) {
      stopped = true;
      break;
    }
    if (c.count === 1) return { unique: true, added, tries, nodesSum, nodesMax, stopped: false };
    if (c.count === 0) return { unique: false, why: '正解被自己挖掉了', added, tries, nodesSum, nodesMax, stopped: false };
    const alt = c.sols[1];
    const kill = [];
    for (const item of alt) for (const st of item.route.stops) if (!answerStops.has(st)) kill.push(st);
    if (!kill.length) {
      return { unique: false, why: '多余解的落点全是正解也用的落点，杀不动', added, tries, nodesSum, nodesMax, stopped: false };
    }
    let placed = false;
    for (const cell of kill) {
      if (answerCells.has(cell)) continue;
      board.ponds.add(cell);
      const errs = verify(board, answer.map((s) => ({ start: s.start, stops: s.stops })));
      if (errs.length) {
        board.ponds.delete(cell);
        continue;
      }
      added++;
      placed = true;
      break;
    }
    if (!placed) {
      return { unique: false, why: '没有可用的杀点', added, tries, nodesSum, nodesMax, stopped: false };
    }
  }
  return {
    unique: false,
    why: stopped ? `计数器撞预算 ${nodesMax}` : `补池到上限 ${maxPond} 仍不唯一`,
    added,
    tries,
    nodesSum,
    nodesMax,
    stopped,
  };
}

// ── 极小化（只对池做）：逐颗试摘，摘掉之后"预算内唯一 ∧ 铅笔仍零猜测推完"才真摘 ──
// 口径写清：这是**单颗摘除意义的极小**，不是"线索最少"。球与 H 铺在骨架上（一条线一个），
// 本文件的极小化不动它们 —— 它们删不删得掉由 auditClueNecessity 逐颗量给 balance 看。
export function minimizePonds(board, { budgetNodes = DEFAULT_BUDGET_NODES } = {}) {
  let removed = 0;
  let overbudget = 0;
  const ponds = [...board.ponds].sort((a, b) => a - b);
  for (const cell of ponds) {
    board.ponds.delete(cell);
    const c = countSolutions(board, { limit: 2, budgetNodes, mrv: true });
    if (c.stopped) {
      overbudget++;
      board.ponds.add(cell);
      continue;
    }
    if (c.count !== 1) {
      board.ponds.add(cell);
      continue;
    }
    const p = solve(board);
    if (!p.solved) {
      board.ponds.add(cell);
      continue;
    }
    removed++;
  }
  return { removed, overbudget };
}

// 逐颗摘除审计：球 / H / 池每一颗都单独摘一次，报告"摘掉它之后还剩几解、铅笔还推不推得完"。
// 摘掉它之后仍然（唯一 ∧ 推得完）= 这颗线索删不得那句话是吹的 ⇒ balance 判红。
// 摘掉它之后数不完（stopped）= 这颗没证到 ⇒ 只披露不判红。
export function auditClueNecessity(board, { budgetNodes = 500_000 } = {}) {
  const out = [];
  const oneSolvable = (b) => {
    const c = countSolutions(b, { limit: 2, budgetNodes, mrv: true });
    const p = c.count === 1 ? solve(b) : null;
    return { count: c.count, stopped: c.stopped, nodes: c.nodes, solved: !!p && p.solved };
  };
  for (const cell of [...board.balls.keys()].sort((a, b) => a - b)) {
    const balls = new Map(board.balls);
    balls.delete(cell);
    out.push({ kind: 'ball', cell, ...oneSolvable(board.withClues({ balls })) });
  }
  for (const cell of [...board.holes].sort((a, b) => a - b)) {
    const holes = new Set(board.holes);
    holes.delete(cell);
    out.push({ kind: 'hole', cell, ...oneSolvable(board.withClues({ holes })) });
  }
  for (const cell of [...board.ponds].sort((a, b) => a - b)) {
    const ponds = new Set(board.ponds);
    ponds.delete(cell);
    out.push({ kind: 'pond', cell, ...oneSolvable(board.withClues({ ponds })) });
  }
  return out;
}

// ── 出货：一个 seed 一串，attempt 用尽仍不出货就返回 ok:false（并带归因）──
export function shipPuzzle(seed, tierKey, { tries = null, budgetNodes = DEFAULT_BUDGET_NODES, maxPond = 24, minimize = true, now = null } = {}) {
  const t0 = now ? now() : Number(process.hrtime.bigint() / 1000n) / 1000;
  const tier = parseTier(tierKey);
  const maxAttempts = tries == null ? tier.tries : tries;
  const stats = newStats();
  let lastStatus = 'noBoard';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 同一个 seed 的连续尝试：串里带 attempt 号 ⇒ "下一局"是自增而不是日期（纪律见文件头）
    const rnd = mulberry32(hashSeed(`herugolf|${tier.key}|${seed}|a${attempt}`));
    const g = makeSolution(tier.w, tier.h, rnd, { balls: tier.balls, maxK: tier.maxK });
    if (!g.ok) {
      stats.makeFail++;
      lastStatus = 'noBoard';
      continue;
    }
    stats.candSum += prepare(g.board).cands.reduce((a, c) => a + c.length, 0);
    const dig = digUnique(g.board, g.answer, { budgetNodes, maxPond });
    stats.digTries += dig.tries;
    stats.digNodesMax = Math.max(stats.digNodesMax, dig.nodesMax);
    stats.digNodesSum += dig.nodesSum;
    stats.pondsAdded = dig.added;
    if (dig.stopped) stats.stopped++;
    if (!dig.unique) {
      stats.digFail[dig.why] = (stats.digFail[dig.why] || 0) + 1;
      lastStatus = `dig:${dig.why}`;
      continue;
    }
    if (minimize) {
      const min = minimizePonds(g.board, { budgetNodes });
      stats.pondsRemoved = min.removed;
      stats.minimizeOverbudget = min.overbudget;
    }
    // 覆盖口径：答案一律以**这里**数出来的那一解为准（不信 g.answer）
    const cert = countSolutions(g.board, { limit: 2, budgetNodes, mrv: true });
    stats.certTries++;
    stats.certNodesMax = Math.max(stats.certNodesMax, cert.nodes);
    if (cert.stopped) {
      stats.stopped++;
      lastStatus = 'certStopped';
      continue;
    }
    if (cert.count !== 1) {
      lastStatus = `notUnique(${cert.count})`;
      continue;
    }
    const answer = answerOf(cert, 0);
    const errs = verify(g.board, answer);
    if (errs.length) {
      stats.verifyFail++;
      lastStatus = `verify:${errs[0]}`;
      continue;
    }
    const p = solve(g.board);
    if (!p.solved) {
      stats.pencilReject++;
      lastStatus = `pencilStuck(${p.alive.filter((a) => a > 1).length}球未定)`;
      continue;
    }
    if (!sameAnswerLoose(answer, p.sols)) {
      stats.pencilMismatch++;
      lastStatus = 'pencilDisagrees';
      continue;
    }
    stats.pencilAgree++;
    return {
      ok: true,
      status: 'shipped',
      board: g.board,
      answer,
      attempt,
      attempts: attempt + 1,
      pencil: p,
      ms: (now ? now() : Number(process.hrtime.bigint() / 1000n) / 1000) - t0,
      stats,
      tier,
    };
  }
  return { ok: false, status: lastStatus, attempts: maxAttempts, stats, tier, ms: (now ? now() : Number(process.hrtime.bigint() / 1000n) / 1000) - t0 };
}

export function newStats() {
  return {
    makeFail: 0,
    digTries: 0,
    digNodesMax: 0,
    digNodesSum: 0,
    pondsAdded: 0,
    pondsRemoved: 0,
    minimizeOverbudget: 0,
    certTries: 0,
    certNodesMax: 0,
    stopped: 0,
    verifyFail: 0,
    pencilReject: 0,
    pencilMismatch: 0,
    pencilAgree: 0,
    candSum: 0,
    digFail: {},
  };
}

function sameAnswerLoose(a, b) {
  const key = (x) =>
    x
      .slice()
      .sort((p, q) => p.start - q.start)
      .map((s) => `${s.start}>${s.stops.join('-')}`)
      .join(' ; ');
  return key(a) === key(b);
}
