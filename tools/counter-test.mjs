// tools/counter-test.mjs —— 计数侧门禁：判定判据二的落地。
//
// 这一套要锁的是「唯一性判定的口径」，不是速度：
//   1. **真值证人二**：官方 5×5 数到恰好 1 解，且那一解逐球等于官方解（键全部现算，不抄下标）。
//   2. 计数器与**独立穷举**（候选笛卡尔积 × verify）在若干小盘上逐个相等 —— 计数器的真值不由它自己说。
//   3. `count===1 且 stopped` **不算唯一**（§5.1 红线三：这就是「伪唯一」，本盘用同一份盘面把两个数并排打出来）。
//   4. `pins` 钉法：铅笔删掉的那条走法，钉上之后必须恰好少掉那些解；钉的是「不在任何解里的候选」⇒ 必须 0 解。
//   5. MRV 与行序的成本对比：同一批盘两遍计数，行序的长尾是**自己造的**（sashigane 那一课）。
//
// 判据只看 p95（时延基线要取尾巴）。退出码非 0 = 红。

import { Board, serializeBoard } from '../js/engine/grid.js';
import { routesFor } from '../js/engine/routes.js';
import { countSolutions, answerOf, prepare, stopKey, DEFAULT_BUDGET_NODES } from '../js/engine/counter.js';
import { verify, answerKey, sameAnswer } from '../js/engine/verify.js';
import { seeded } from '../js/engine/rng.js';
import { makeSolution, shipPuzzle } from '../js/engine/generate.js';
import { OFFICIAL, officialBoard, officialAnswer, candidateCounts, TEST_BOARDS } from './scenarios.js';

let fails = 0;
const total = { checks: 0 };
function ok(cond, label, detail = '') {
  total.checks++;
  if (cond) { console.log(`  · ${label}${detail ? ` — ${detail}` : ''}`); return; }
  fails++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}
function eq(actual, expected, label) { ok(actual === expected, label, `实际 ${actual} / 期望 ${expected}`); }

function stats(list) {
  const s = [...list].sort((x, y) => x - y);
  return {
    med: s[Math.floor(s.length / 2)],
    p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)],
    max: s[s.length - 1],
    sum: s.reduce((x, y) => x + y, 0),
  };
}

console.log('══ 计数侧 ══');

/* ── 1. 真值证人二 ───────────────────────────────────────────────────────── */
console.log('\n[1] 真值证人二：官方 5×5 恰好 1 解，且那一解 = 官方解');
{
  const b = officialBoard();
  const res = countSolutions(b, { limit: 2 });
  const off = officialAnswer();
  eq(res.count, 1, 'countSolutions(官方, limit=2).count');
  eq(res.stopped, false, '官方盘不许撞预算（数完了才算 1 解）');
  eq(res.capped, false, '官方盘没到 limit（capped=false 才说明"就这么多"）');
  ok(res.nodes > 0, 'nodes 是真数出来的（0 说明候选表空了）', `nodes=${res.nodes}`);
  const mine = answerOf(res, 0);
  eq(mine.length, b.balls.size, '那一解的路线数 = 盘面球数');
  eq(sameAnswer(mine, off), true, '那一解逐球 = 官方解（answerKey 口径）', answerKey(mine));
  eq(verify(b, mine).length, 0, '数出来的那一解再过一遍独立复核');
  eq(res.sols.length, 1, 'sols 里只有那一条');
  let threw = false;
  try { answerOf(res, 1); } catch { threw = true; }
  eq(threw, true, 'answerOf(res,1) 越界必须抛（不许悄悄给 undefined）');
  console.log(`  证人二 countSolutions(官方5×5) = ${res.count} 解（nodes=${res.nodes}, stopped=${res.stopped}）；解：${answerKey(off)}`);
  console.log(`  · 逐球键（现算，不抄下标）：${off.map((s) => `${s.start}>${s.stops.join('-')}`).join(' ; ')}`);
  console.log(`  · OFFICIAL.at(3,4)=${OFFICIAL.at(3, 4)}，官方 3 号球的落点 H 就是它（上一轮手敲下标敲错过一次）`);
}

/* ── 2. 计数器 vs 独立穷举 ───────────────────────────────────────────────── */
console.log('\n[2] 计数器与独立穷举（候选笛卡尔积 × verify）逐盘相等');
{
  const boards = [];
  const note = [];
  const push = (label, b) => {
    const sets = b.cellList().map((s) => routesFor(b, s));
    const combos = sets.reduce((x, y) => x * y.length, 1);
    if (combos > 30000) { console.log(`    （跳过 ${label}：组合数 ${combos}，暴力会吃掉这一轮的时间预算）`); return; }
    boards.push({ label, b, sets, combos });
  };
  const boardOf = (w, h, balls, holes, ponds) => {
    const b = new Board(w, h);
    for (const [s, k] of balls) b.balls.set(s, k);
    for (const h1 of holes) b.holes.add(h1);
    for (const p of ponds) b.ponds.add(p);
    return b;
  };
  push('官方 5×5', officialBoard());
  push('R3 交叉盘', TEST_BOARDS.r3cross());
  push('R3 自交盘', TEST_BOARDS.r3self());
  push('合法对照盘（穿池）', TEST_BOARDS.r3legal());
  push('R4 停池盘', TEST_BOARDS.r4stop());
  push('一洞两球盘', TEST_BOARDS.holeTwo());
  push('一维两球抢一洞', boardOf(4, 1, [[0, 1], [2, 1]], [1], []));
  push('一维两洞排不开', boardOf(5, 1, [[0, 2], [4, 2]], [2], []));
  push('只有球没有洞', boardOf(4, 4, [[0, 3], [15, 3]], [], []));
  push('洞在池上', boardOf(4, 4, [[0, 2]], [5], [5]));

  let done = 0;
  for (const { label, b, sets, combos } of boards) {
    // 独立穷举：只认 verify()，一次都不叫 counter 帮忙
    let brute = 0;
    if (combos > 0) {
      const idx = new Array(sets.length).fill(0);
      const balls = b.cellList();
      for (let n = 0; n < combos; n++) {
        const ans = balls.map((cell, i) => ({ start: cell, stops: sets[i][idx[i]].stops.slice() }));
        if (verify(b, ans).length === 0) brute++;
        for (let i = 0; i < idx.length; i++) { idx[i]++; if (idx[i] < sets[i].length) break; idx[i] = 0; }
      }
    }
    const res = countSolutions(b, { limit: brute + 2, budgetNodes: DEFAULT_BUDGET_NODES });
    eq(res.count, brute, `${label}：count = 穷举`);
    eq(res.stopped, false, `${label}：${combos} 组合的小盘不许撞预算`);
    note.push(`${label}(${brute})`);
    done++;
  }
  eq(done, 10, '十张盘全对上（跳过一张就是少一张证人）');
  console.log(`    逐盘解数：${note.join(' ')}`);
}

/* ── 3. stopped 不是唯一（伪唯一的现场） ─────────────────────────────────── */
console.log('\n[3] §5.1 红线三：count===1 且 stopped ⇒ 只能判「未证明唯一」');
{
  // 现场自己找：骨架盘（还没补池）通常有 ≥2 解。第二解出现在第 N 个结点 ⇒ 预算掐到 N-1，
  // 这台机器就会**报出 count=1 而根本没数完**。这一条证的是 stopped 那一位，不是速度。
  let trap = null;
  for (let i = 0; i < 40 && !trap; i++) {
    const g = makeSolution(18, 18, seeded('counter-test/trap', i), { balls: 11, maxK: 6 });
    if (!g.ok) continue;
    const first = countSolutions(g.board, { limit: 1 });
    if (first.stopped || first.count !== 1) continue;
    const two = countSolutions(g.board, { limit: 2 });
    if (two.stopped || two.count !== 2 || two.nodes - first.nodes < 3) continue;
    const tight = countSolutions(g.board, { limit: 2, budgetNodes: two.nodes - 1 });
    if (tight.count === 1 && tight.stopped) trap = { i, seed: `counter-test/trap#${i}`, first, two, tight };
  }
  ok(trap !== null, '找到一盘能把人骗了的现场（count=1 且 stopped）', trap ? `第 ${trap.i} 号骨架（种子 ${trap.seed}）` : '40 个种子都没造出来 ⇒ 这一条证人没现场了');
  if (trap) {
    const { first, two, tight } = trap;
    eq(tight.count, 1, '截断版报 count=1（看着像唯一）');
    eq(tight.stopped, true, '截断版 stopped=true（它没数完）');
    eq(two.count, 2, '同一盘放开预算：其实有第二解');
    eq(two.stopped, false, '同一盘放开预算：数完了（这才是"至少两解"的证据）');
    eq(first.nodes <= two.nodes - 1, true, '第一解出现在截断点之前，所以截断版才会先攒到一个解', `first=${first.nodes} < budget=${two.nodes - 1}`);
    console.log(`    现场：骨架盘（18×18/11 球，还没补池）第一解在第 ${first.nodes} 结点、第二解在第 ${two.nodes} 结点。`);
    console.log(`    budgetNodes=${two.nodes - 1} ⇒ count=${tight.count} stopped=${tight.stopped}（伪唯一）；budgetNodes=${DEFAULT_BUDGET_NODES} ⇒ count=${two.count} stopped=${two.stopped}。`);
    console.log('    ⇒ generate.js 的出货判定吃的是 stopped 那一位：count===1 && stopped 一律不出货。');
  }
  eq(serializeBoard(officialBoard()).length, 25, '题面序列化 = 一格一字符的扁平串（5×5）');
}

/* ── 4. pins 钉法 = 铅笔结论的消值复核 ───────────────────────────────────── */
console.log('\n[4] pins：钉掉一条候选之后的解数必须对得上独立穷举');
{
  const b = officialBoard();
  const prep = prepare(b);
  eq(prep.balls.length, 3, 'prepare 每球一条记录');
  eq(prep.cands.map((c) => c.length).join('/'), candidateCounts(b).join('/'), 'prepare 的候选表 = candidateCounts');
  eq(prep.cands.map((c) => c.length).join('/'), '1/2/1', '官方题面的候选表（出版物盘上模型不比它宽松）');
  const mid = prep.balls[1];                    // 唯一有 2 条候选的那一颗（下标现算，不敲格号）
  const two = prep.cands[1];
  eq(two.length, 2, '这颗球两条候选');
  const truth = officialAnswer().find((s) => s.start === mid);
  const inTruth = two.find((r) => stopKey(r) === truth.stops.join('-'));
  ok(inTruth !== undefined, '官方解里的那条候选在候选表里（证人一的另一半）');
  const wrong = two.find((r) => stopKey(r) !== truth.stops.join('-'));
  const pinnedTrue = countSolutions(b, { limit: 2, prep, pins: new Map([[mid, stopKey(inTruth)]]) });
  eq(pinnedTrue.count, 1, '钉在真候选上：仍然 1 解');
  eq(sameAnswer(answerOf(pinnedTrue, 0), officialAnswer()), true, '钉完的那一解还是官方解');
  const pinnedWrong = countSolutions(b, { limit: 2, prep, pins: new Map([[mid, stopKey(wrong)]]) });
  eq(pinnedWrong.count, 0, '钉在另一条候选上：0 解 ⇒ 那条候选不在任何解里（铅笔该删它）', `nodes=${pinnedWrong.nodes}`);
  const rowOrder = countSolutions(b, { limit: 2, mrv: false, pins: new Map([[mid, stopKey(wrong)]]) });
  eq(rowOrder.count, 0, '行序模式同一钉法也 0 解（钉法与挑格顺序无关）');
  const noPin = countSolutions(b, { limit: 2, prep });
  eq(noPin.count, 1, '同一个 prep 不传 pins 时行为不变（prep 复用没被钉法污染）');
  const holePin = countSolutions(b, { limit: 2, pins: new Map([[prep.balls[0], stopKey(prep.cands[0][0])]]) });
  eq(holePin.count, 1, '钉死 1 号球那条唯一候选：仍是 1 解（传了 pins 也必须重新 prepare）');
}

/* ── 5. MRV vs 行序：长尾是自己造的 ──────────────────────────────────────── */
console.log('\n[5] MRV vs 行序：出货盘两遍计数（判据二：挑格启发式决定长尾）');
{
  const N = 30;
  const boards = [];
  for (let i = 0; boards.length < N && i < 400; i++) {
    const r = shipPuzzle(`counter-test/cost|${i}`, '18x18/11', { tries: 1 });
    if (r.ok) boards.push(r.board);
  }
  eq(boards.length, N, `凑满 ${N} 盘出货盘（种子固定 ⇒ 两边吃的是同一批盘）`);
  const run = (mrv) =>
    boards.map((b) => {
      const t0 = performance.now();
      const r = countSolutions(b, { mrv });
      return { ...r, ms: performance.now() - t0 };
    });
  const rows = run(false);
  const mrvs = run(true);
  eq(rows.filter((x) => x.count === 1).length, N, '行序：全 1 解');
  eq(mrvs.filter((x) => x.count === 1).length, N, 'MRV：全 1 解');
  eq(rows.some((x) => x.stopped), false, '行序：这一批不许截断');
  eq(mrvs.some((x) => x.stopped), false, 'MRV：这一批不许截断');
  ok(rows.every((x, i) => x.count === mrvs[i].count), '两种挑序数出来的是同一个数（挑序只改成本，不改答案）');
  ok(rows.every((x, i) => sameAnswer(answerOf(x, 0), answerOf(mrvs[i], 0))), '两种挑序的第一解逐球相同');
  const rn = stats(rows.map((x) => x.nodes));
  const mn = stats(mrvs.map((x) => x.nodes));
  console.log(`    行序 nodes: med=${rn.med} p95=${rn.p95} max=${rn.max} 总=${rn.sum}`);
  console.log(`    MRV  nodes: med=${mn.med} p95=${mn.p95} max=${mn.max} 总=${mn.sum}`);
  console.log(`    逐盘 行序/MRV：${rows.map((x, i) => `${x.nodes}/${mrvs[i].nodes}`).join(' ')}`);
  ok(mn.sum < rn.sum, 'MRV 总节点 < 行序总节点', `${mn.sum} < ${rn.sum}`);
  ok(mn.p95 <= rn.p95, 'MRV 的 p95 不高于行序', `${mn.p95} ≤ ${rn.p95}`);
  ok(mn.max <= rn.max, 'MRV 的 max 不高于行序（长尾是自己写的，不是题材的）', `${mn.max} ≤ ${rn.max}`);
  const rm = stats(rows.map((x) => x.ms));
  const mm = stats(mrvs.map((x) => x.ms));
  console.log(`    墙钟 ms（同进程内、含 JIT 预热，只当上界看）：行序 med=${rm.med.toFixed(3)} p95=${rm.p95.toFixed(3)} max=${rm.max.toFixed(3)} / MRV med=${mm.med.toFixed(3)} p95=${mm.p95.toFixed(3)} max=${mm.max.toFixed(3)}`);
  const avgCand = boards.reduce((a, b) => a + prepare(b).cands.reduce((x, c) => x + c.length, 0), 0) / N;
  console.log(`    平均候选/盘（11 球合计）：${avgCand.toFixed(1)} ⇒ 判据二说的"与格数无关、被线索封住"就是这个数：18×18 上候选总数还是几十条量级`);
  ok(avgCand < 200, '18×18/11 球的候选总数仍是几十到一百的量级（不是 2^324）', `平均 ${avgCand.toFixed(1)}`);
}

console.log(`\n断言 ${total.checks} 条，红 ${fails} 条`);
console.log(`RESULT counter-test ok=${fails === 0} checks=${total.checks} fails=${fails}`);
process.exit(fails === 0 ? 0 : 1);
