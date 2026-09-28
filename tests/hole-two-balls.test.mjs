#!/usr/bin/env node
// R1（球与 H 一一对应：每洞恰好一球、每球恰好一动线、每球至少动一次）的证人。
//
// 为什么单独一个文件：counter.js 的 `fits()` 只用一个 `holeTaken` 位图守"一洞一球"，
// 而 verify.js 从题面文字另写一遍。这两处只要有一处被改松（比如忘了收尾检查空 H），
// 出货盘就会出现"两个球进同一个洞、另一个洞空着"的题面，玩家会当成 bug 报上来。
// 反例必须现场造（不是引用曾经跑过的记录），所以本文件带一张专门的盘 + 官方盘的全部变异。
//
// 三条判据：
//   ① 一洞两球 + 另一洞空着的反例：verify 点名 R1，独立计数器说 0 解；
//   ② 官方 5×5 的全部变异（OFFICIAL_MUTATIONS，现测 10 条）逐个被拒，且逐条对上**实测的归因集合**
//      —— 证人必须会红，也要会绿；能做出干净单规则形状的地方（no-move）要求 every(/R1/)，
//      官方盘上做不出那个形状的地方（empty-hole）把期望钉成"必含那两条 R1 + 恰一条 R3 + R2/R4 闭嘴"，
//      并且那一条 R3 由两份独立几何复核钉住（见下面的 empty-hole 段）；
//      做不出干净形状是**量**出来的：把那颗球的全部盘内走法逐条问一遍 verify，一条干净的都没有；
//   ③ 出货盘上「球数 == H 数 == 路线数」不变量 + 摘掉一颗球后 verify 必须点名 R1（不许沉默）；
//      以及"收尾不是 H"的干净单规则证人（TEST_BOARDS.r1empty：报出来的必须全是 R1）。
import { routesFor } from '../js/engine/routes.js';
import { verify, answerKey, sameAnswer } from '../js/engine/verify.js';
import { countSolutions, answerOf } from '../js/engine/counter.js';
import { shipPuzzle } from '../js/engine/generate.js';
import {
  officialBoard, officialAnswer, mutateOfficial,
  OFFICIAL_MUTATIONS, OFFICIAL_MUTATION_TAGS, TEST_BOARDS,
} from '../tools/scenarios.js';

let checks = 0;
const fails = [];
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
const has = (errs, re, msg) => check(errs.some((e) => re.test(e)), `${msg} —— 报错串里没找到 ${re}：${JSON.stringify(errs)}`);

// 现算「这条线被自己走两遍的格」：不走 verify、不走 routesFor，只按 (起点, 落点序列) 逐动补出途经格。
// 返回第一个重复出现的格号，没有重复返回 -1。（mine/usedCell 那一套顺序在这条通道里根本没有对应物，
// 所以它量出来的是几何本身，不是 verify 的记账方式。）
function doubleWalkedCell(board, sol) {
  const cells = [sol.start];
  let at = sol.start;
  for (const to of sol.stops) {
    const [r0, c0] = board.rc(at);
    const [r1, c1] = board.rc(to);
    const dr = Math.sign(r1 - r0);
    const dc = Math.sign(c1 - c0);
    const dist = Math.abs(r1 - r0) + Math.abs(c1 - c0);
    for (let t = 1; t <= dist; t++) cells.push(board.idx(r0 + dr * t, c0 + dc * t));
    at = to;
  }
  return cells.find((c, i) => cells.indexOf(c) !== i) ?? -1;
}

// 一颗球在盘内的**全部**走法：只按 R2 的长度序列（k, k-1, …）与外框枚举，
// 不查线之间互不干涉、不查池（那两条正是这里要拿去问 verify 的东西）。
// 「官方盘上做不出干净的 R1-only」这句话要有证，就得先把这颗球全部走法摊开，而不是只挑一条。
function walksOf(board, start) {
  const k = board.balls.get(start);
  if (k === undefined) return [];
  const res = [];
  const go = (at, len, cells, stops) => {
    for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
      const [r0, c0] = board.rc(at);
      let r = r0;
      let c = c0;
      const path = [];
      let inb = true;
      for (let t = 0; t < len; t++) {
        r += dr;
        c += dc;
        if (!board.inb(r, c)) {
          inb = false;
          break;
        }
        path.push(board.idx(r, c));
      }
      if (!inb) continue;
      const landed = path[path.length - 1];
      const nextCells = cells.concat(path);
      const nextStops = stops.concat([landed]);
      if (board.holes.has(landed)) res.push({ cells: nextCells, stops: nextStops }); // R2：停在 H 的球不再动
      else if (len - 1 >= 1) go(landed, len - 1, nextCells, nextStops);
      else res.push({ cells: nextCells, stops: nextStops }); // 数字用完还没进洞 = 收尾不是 H 的那种
    }
  };
  go(start, k, [start], []);
  return res;
}

// ── ① 一洞两球的反例 ────────────────────────────────────────────────────────
{
  const b = TEST_BOARDS.holeTwo();
  const good = TEST_BOARDS.holeTwoAnswer(b);
  const unique = countSolutions(b, { limit: 2 });
  check(unique.count === 1, `夹具盘本身应当唯一，实为 ${unique.count} 解（夹具写坏了）`);
  check(sameAnswer(answerOf(unique, 0), good), `夹具的唯一解与预期那份不同：${answerKey(answerOf(unique, 0))} vs ${answerKey(good)}`);
  check(verify(b, good).length === 0, `夹具的合法答案被拒：${JSON.stringify(verify(b, good))}`);
  const bad = TEST_BOARDS.holeTwoMutated(b);
  const errs = verify(b, bad);
  check(errs.length > 0, '一洞两球：verify 说无错（证人坏了）');
  has(errs, /落了两球/, 'R1 要抓到"一个洞落两球"');
  has(errs, /没被填/, '同一个反例里另一个空洞也必须点名');
  has(errs, /R1/, '这两条都必须挂 R1');
  const hole = bad[0].stops[bad[0].stops.length - 1];
  check(b.holes.has(hole), `反例的收尾格 ${hole} 不是 H（那份答案挑错了靶子）`);
  check(bad.filter((s) => s.stops[s.stops.length - 1] === hole).length === 2, '反例里那个洞确实只被落了一次（构造没生效）');
  check(!sameAnswer(bad, good), '反例与正解应当是两份不同的答案');
  const c = countSolutions(b, { limit: 3 });
  check(c.count === 1, `同一盘计数器只给 ${c.count} 解 ⇒ 那份两球抢一洞的组合本来就不在候选里`);
}

// ── ② 官方 5×5 的全部变异：逐个被拒 ────────────────────────────────────────
{
  const b = officialBoard();
  check(verify(b, officialAnswer()).length === 0, '官方解答被 verify 拒了（正例坏了）');
  // 变异表住在这里（tools/scenarios.js），本文件只做两件事：逐条必须被拒 + 归因到它声称那一条。
  // R1 类（hole-steal / empty-hole / no-move）是本文件的靶子。
  const r1Cases = OFFICIAL_MUTATIONS.filter((w) => /R1/.test(OFFICIAL_MUTATION_TAGS[w]));
  check(r1Cases.length >= 3, `R1 类变异至少三条（抢洞 / 空 H / 一动没动），实得 ${r1Cases.join('/')}`);
  for (const what of OFFICIAL_MUTATIONS) {
    const errs = verify(b, mutateOfficial(what));
    check(errs.length > 0, `变异 ${what}：verify 说无错`);
    has(errs, OFFICIAL_MUTATION_TAGS[what], `变异 ${what} 的归因漂了（声称 ${OFFICIAL_MUTATION_TAGS[what]}）`);
  }
  check(OFFICIAL_MUTATIONS.length >= 10, `变异表至少十条，实为 ${OFFICIAL_MUTATIONS.length}`);
  for (const what of OFFICIAL_MUTATIONS) {
    const m = mutateOfficial(what);
    check(m.length === officialAnswer().length, `变异 ${what} 把路线条数改变了`);
    check(m.every((s) => s.stops.length >= 1) || what === 'no-move', `变异 ${what} 让某颗球一动没动（除 no-move 之外不该）`);
  }
  // 干净归因的两块靶子（本轮实测分家，口径见 tools/scenarios.js 的 mutateOfficial 文件头）：
  //   no-move    ：官方 5×5 上真做得到「只报 R1」⇒ 断言保持严格 every(/R1/)。它是"归因不许漂"
  //                这条性质的严格证人，一处都不许松。
  //   empty-hole ：官方 5×5 上**做不到**（下面把那颗球的全部盘内走法摊开量，不是推的）。
  //                期望因此写成"实测出来的那一个集合"：必含那两条 R1、必含那一条 R3、
  //                且 R2/R4 必须闭嘴。仍然可证伪（少一条红、多一条也红），并且那一条 R3
  //                被两份独立复核钉住（现算途经格 + 单线复跑），不是拿"允许 R3"糊过去。
  {
    const errs = verify(b, mutateOfficial('no-move'));
    check(errs.every((e) => /R1/.test(e)), `变异 no-move 应当只报 R1（干净归因），实为 ${JSON.stringify(errs)}`);
  }
  {
    const off = officialAnswer();
    const m = mutateOfficial('empty-hole');
    // 这条变异动了哪一颗球：与官方答案逐球一比，落点序列不同的那一颗。格号一律现算，不抄下标。
    const at = m.findIndex((s, i) => s.start === off[i].start && s.stops.join(',') !== off[i].stops.join(','));
    check(at >= 0, `empty-hole 没有改动任何一颗球的落点（这条变异是空操作）`);
    const ball = m[at].start;
    const emptied = off[at].stops[off[at].stops.length - 1]; // 官方解里它填的那个 H，变异之后应当空下来
    check(b.holes.has(emptied), `empty-hole 的靶子不对：官方解里球 ${ball} 收的格 ${emptied} 不是 H`);
    const errs = verify(b, m);
    has(errs, new RegExp(`球 ${ball} 没进洞`), 'empty-hole：R1 的"收尾不是 H"必须在');
    has(errs, new RegExp(`H ${emptied} 没被填`), 'empty-hole：R1 的"空 H"必须在');
    check(!errs.some((e) => /R2/.test(e)), `empty-hole 不许报 R2（长度序列原样没动）：${JSON.stringify(errs)}`);
    check(!errs.some((e) => /R4/.test(e)), `empty-hole 不许报 R4（这条变异没碰池）：${JSON.stringify(errs)}`);
    const r3 = errs.filter((e) => /R3/.test(e));
    check(r3.length === 1, `empty-hole 的 R3 恰好一条（自交只有一处），实为 ${JSON.stringify(r3)}`);
    check(errs.every((e) => /R1|R3/.test(e)), `empty-hole 的归因只能落在 R1/R3 这两条上，实为 ${JSON.stringify(errs)}`);
    // 独立几何复核之一：不走 verify、不走 routesFor，只按 (起点, 落点) 现算途经格，
    // 数出**被这条线自己走两遍**的那一格。它必须正是 verify 报出来的那一格。
    const crossed = doubleWalkedCell(b, m[at]);
    check(crossed >= 0, `empty-hole 的走法里没有自交格？（那 verify 报的 R3 就是凭空的）：${JSON.stringify(m[at])}`);
    check(r3.length === 1 && r3[0].includes(`格 ${crossed} 被`), `empty-hole 的 R3 格的不是现算出来的那一格（现算=${crossed}），实为 ${JSON.stringify(r3)}`);
    // 独立几何复核之二（"顺序假象"的反证）：把另外两颗球的线从交上来的答案里**整条拿掉**，
    // 只留这一条 —— usedCell 全空，别人只剩"没有路线"那几句 R1。
    // 若这一格的 R3 是"先登记了别人的线才判出来的顺序假象"，它在这里就该消失；实测它还在、同一格
    // ⇒ 它是这条线自己走两遍同一个格，与登记顺序无关 ⇒ verify 的归因没有毛病，改的是断言的期望。
    const solo = verify(b, [m[at]]);
    check(solo.filter((e) => /R3/.test(e)).length === 1 && solo.some((e) => e.includes(`格 ${crossed} 被`)), `empty-hole 的 R3 在"只交这一条线"时应当照样成立（自交是这条线自己的事），实为 ${JSON.stringify(solo)}`);
    // 这颗球到底有没有一条"只违反 R1"的走法？把盘内全部走法摊开逐条问 verify（官方盘太紧是量的，不是想的）。
    const all = walksOf(b, ball);
    const verdicts = all.map((w) => verify(b, m.map((s, i) => (i === at ? { start: ball, stops: w.stops.slice() } : { start: s.start, stops: s.stops.slice() }))));
    const clean = verdicts.filter((e) => e.length > 0 && e.every((x) => /R1/.test(x)));
    const acceptedIdx = verdicts.findIndex((e) => e.length === 0);
    const accepted = acceptedIdx >= 0 ? [verdicts[acceptedIdx]] : [];
    check(all.length >= 4, `球 ${ball} 的盘内走法枚举只得 ${all.length} 条（枚举本身写坏了 ⇒ "无一干净"是假的）`);
    check(acceptedIdx >= 0, `球 ${ball} 的盘内走法里没有一条被 verify 全收 ⇒ 枚举连官方解都没枚举出来，"无一干净"是假证`);
    check(verdicts.filter((e) => e.length === 0).length === 1, `球 ${ball} 被 verify 全收的走法应当恰好一条（官方解那一条）`);
    check(acceptedIdx >= 0 && sameAnswer(off, m.map((s, i) => (i === at ? { start: ball, stops: all[acceptedIdx].stops.slice() } : s))), `球 ${ball} 被全收的那一条不是官方解：${JSON.stringify(all[acceptedIdx].stops)} vs ${JSON.stringify(off[at].stops)}`);
    check(clean.length === 0, `球 ${ball} 上存在「只违反 R1」的干净走法（那 empty-hole 的断言就该继续严格，不该放成 R1+R3）：${JSON.stringify(clean[0])}`);

    const withR3 = verdicts.filter((e) => e.some((x) => /R3/.test(x))).length;
    const withR4 = verdicts.filter((e) => e.some((x) => /R4/.test(x))).length;
    console.log(`  empty-hole 的归因口径：球 ${ball} 盘内 ${all.length} 条走法 ⇒ 全收 ${accepted.length}（官方解）/ 只报 R1 ${clean.length} / 含 R3 ${withR3} / 含 R4 ${withR4}${withR4 ? '' : '（这条变异碰不到池）'}；自交格现算 ${crossed}，单线复跑照样报同一格`);
  }
  {
    // 干净 R1-only 的"空 H"必须还有一位证人：官方 5×5 太紧做不出那个形状，改由专用夹具现场证。
    // 这一条保持**严格** every(/R1/) —— 上一段允许 R3 的理由是"那盘没有干净形状"，
    // 不是"归因可以漂"；能干净的地方就得要求干净。
    const eb = TEST_BOARDS.r1empty();
    const legal = TEST_BOARDS.r1emptyAnswer(eb);
    check(verify(eb, legal).length === 0, `r1empty 夹具的正解被拒（夹具写坏了）：${JSON.stringify(verify(eb, legal))}`);
    const unique = countSolutions(eb, { limit: 2 });
    check(unique.count === 1 && !unique.stopped && !unique.capped, `r1empty 夹具应当恰好 1 解，实为 ${unique.count}（stopped=${unique.stopped} capped=${unique.capped}）`);
    const errs = verify(eb, TEST_BOARDS.r1emptyMutated(eb));
    check(errs.every((e) => /R1/.test(e)), `r1empty 夹具（干净的"收尾不是 H"）应当只报 R1，实为 ${JSON.stringify(errs)}`);
    has(errs, /没进洞/, 'r1empty：空 H 那一半必须由 R1 点名');
    has(errs, /没被填/, 'r1empty：被空下的那个 H 必须被点名');
    check(doubleWalkedCell(eb, TEST_BOARDS.r1emptyMutated(eb)[0]) < 0, 'r1empty 夹具的变异不许自交（自交了就不是干净靶子）');
  }
  console.log(`  官方 5×5 变异 ${OFFICIAL_MUTATIONS.length} 条逐个被拒；R1 类=${r1Cases.join('/')}`);
}

// ── ③ 球数 == H 数 == 每盘路线数（出货侧的 R1 不变量） ─────────────────────
{
  let boards = 0;
  let ballHoleMismatch = 0;
  let dupHole = 0;
  let emptyHole = 0;
  let dropBallSilent = 0;
  for (const tier of ['8x8/4', '10x10/6', '12x12/7', '15x15/9', '18x18/11']) {
    for (let i = 0; i < 60 && boards < 40; i++) {
      const r = shipPuzzle(`hole-two-test|${tier}|${i}`, tier);
      if (!r.ok) continue;
      boards++;
      if (r.board.balls.size !== r.board.holes.size) ballHoleMismatch++;
      const holes = new Set();
      for (const s of r.answer) {
        const h = s.stops[s.stops.length - 1];
        if (holes.has(h)) dupHole++;
        holes.add(h);
      }
      for (const h of r.board.holes) if (!holes.has(h)) emptyHole++;
      // 摘掉一颗球（连同它那条线）⇒ 它原本占着的那个 H 就空了 ⇒ verify 必须点名 R1。
      // 这就是"一一对应"的另一半：球与洞是配对的，题面少一颗球一定有话要说（实测会说是"H 没被填"，
      // 而不是沉默 —— 沉默就等于"多一个洞少一个球没关系"，那出货盘上的空 H 就没人拦了）。
      const cell = r.board.cellList()[0];
      const b2 = r.board.clone();
      b2.balls.delete(cell);
      const errs = verify(b2, r.answer.filter((s) => s.start !== cell));
      if (!errs.some((e) => /R1/.test(e))) dropBallSilent++;
      const errs2 = verify(r.board, r.answer.filter((s) => s.start !== cell));
      check(errs2.some((e) => /没有路线|R1/.test(e)), `少交一条路线没被抓：${JSON.stringify(errs2)}`);
      check(verify(r.board, r.answer).length === 0, `出货盘 ${tier}#${i} 的正解过不了 verify：${JSON.stringify(verify(r.board, r.answer))}`);
    }
  }
  check(boards >= 40, `样本量够（攒满 40 盘出货盘），实得 ${boards}`);
  check(ballHoleMismatch === 0, `${ballHoleMismatch} 盘球数与 H 数不等（由解铺题面的形状被改坏了）`);
  check(dupHole === 0, `${dupHole} 个洞被落了两个球（counter 的 holeTaken 漏网）`);
  check(emptyHole === 0, `${emptyHole} 个洞没人填（counter 收尾的空 H 检查漏网）`);
  check(dropBallSilent === 0, `${dropBallSilent} 盘摘球之后 verify 对空 H 保持沉默`);
  console.log(`  样本：${boards} 盘出货盘，球数≠H 数 / 一洞两球 / 空 H 的漏网数 = ${ballHoleMismatch}/${dupHole}/${emptyHole}`);
  // routesFor 的每一条候选收尾必是 H（R1 在枚举层的形状）
  const ob = officialBoard();
  for (const cell of ob.cellList()) {
    for (const rt of routesFor(ob, cell)) {
      check(ob.holes.has(rt.hole), `候选收尾 ${rt.hole} 不是 H`);
      check(rt.hole === rt.stops[rt.stops.length - 1], 'route.hole 与最后一个落点不一致');
      check(rt.strokes === rt.stops.length, 'route.strokes 与落点数不一致');
    }
  }
}

console.log(`RESULT hole-two-balls-test ok=${fails.length === 0} checks=${checks} fails=${fails.length}`);
for (const f of fails) console.error('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
