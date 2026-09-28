// tools/pencil-test.mjs —— 铅笔侧门禁：判定判据一的落地。
//
//   1. **真值证人三**：solve(官方 5×5) 零猜测推完，且推出来的那一解逐球 = 官方解。
//   2. 逐规则能力表：五条规则**各自单独**跑官方盘与出货盘，量"哪几条撑得起哪一盘"（不是宣传语）。
//   3. 出货盘批对账：铅笔的每一结论都要能和独立计数器对上（solved ∧ 无矛盾 ∧ 同一解）。
//   4. 稀有规则的发火盘数随**球数**上来（= 难度阶梯的第二轴，也是"更大 ≠ 更难"的反证）。
//   5. **铅笔不完备的现场**：存在"计数器认证唯一、铅笔推不完、且不报矛盾"的盘 ⇒ 出货闸是双条件。
//   6. 加规则不减能力：任一子集推得完的盘，全表必须推得完且给出同一解（这条红了 = 有规则写坏了，不 sound）。
//
// 退出码非 0 = 红。打印的数全部来自本轮运行。

import { Board, serializeBoard, drawBoard } from '../js/engine/grid.js';
import { countSolutions, answerOf } from '../js/engine/counter.js';
import { solve, runRule, freshState, scoreOf, RULE_ORDER, RULE_WEIGHT, RARE_RULES, RULE_TEXT } from '../js/engine/pencil.js';
import { sameAnswer, answerKey, verify } from '../js/engine/verify.js';
import { seeded } from '../js/engine/rng.js';
import { shipPuzzle, makeSolution, digUnique } from '../js/engine/generate.js';
import { officialBoard, officialAnswer, fx, dropClue, RULE_BOARDS } from './scenarios.js';

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
  return { med: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)], max: s[s.length - 1] };
}
// 同一尺寸只变球数时，steps 中位应当一路不降；降了就是"球多 ≠ 更难"，那是档位设计问题（不是红线放宽的理由）
function stepsRising(ladder) {
  for (let i = 1; i < ladder.length; i++) if (ladder[i].steps.med < ladder[i - 1].steps.med) return false;
  return true;
}
const fireLine = (p) => RULE_ORDER.map((r) => `${r}=${p.fires[r]}`).join(' ');

console.log('══ 铅笔侧 ══');

/* ── 1. 真值证人三 ───────────────────────────────────────────────────────── */
console.log('\n[1] 真值证人三：官方 5×5 零猜测推完，且那一解 = 官方解');
{
  const b = officialBoard();
  const off = officialAnswer();
  const p = solve(b);
  eq(p.solved, true, 'solve(官方).solved');
  eq(p.contradiction, null, '官方盘不许报矛盾', String(p.contradiction));
  eq(p.alive.every((a) => a === 1), true, '每颗球都被推到只剩 1 条候选');
  ok(p.steps > 0, '步数（删除位数）不是 0', `steps=${p.steps}`);
  eq(sameAnswer(p.sols, off), true, '铅笔的解逐球 = 官方解', answerKey(p.sols));
  eq(verify(b, p.sols).length, 0, '铅笔的解再过一遍独立复核');
  eq(p.cands.join('/'), '1/2/1', '候选表（与计数器同一条：模型不比出版物宽松）');
  eq(p.score, scoreOf(p.fires), 'score = Σ 权重×发火（口径只有一处）');
  console.log(`  证人三 solve(官方5×5) = 零猜测推完（steps=${p.steps}，score=${p.score}）；解：${answerKey(p.sols)}`);
  console.log(`  · 发火明细：${fireLine(p)}`);
  console.log(`  · 开口次数明细：${RULE_ORDER.map((r) => `${r}=${p.touched[r]}`).join(' ')}`);
}

/* ── 2. 逐规则能力表（单条规则的极限，不是宣传语） ────────────────────────── */
console.log('\n[2] 逐规则单独跑：官方 5×5 与四张规则夹具');
{
  const single = {};
  for (const r of RULE_ORDER) {
    const p = solve(officialBoard(), { rules: [r] });
    single[r] = p;
    console.log(`    只给「${r}」：solved=${p.solved} steps=${p.steps} alive=${p.alive.join('/')} —— ${RULE_TEXT[r]}`);
  }
  ok(RULE_ORDER.some((r) => single[r].solved), '官方盘至少有一条规则单独撑得起来', RULE_ORDER.filter((r) => single[r].solved).join('/'));
  ok(RULE_ORDER.some((r) => !single[r].solved), '也有一条单独撑不起来的（否则"规则表"是装饰品）', RULE_ORDER.filter((r) => !single[r].solved).join('/'));
  eq(single['单走法'].solved, true, '官方盘靠「单走法」一条就推完（候选 1/2/1 的形状决定的）');
  eq(single['必经格'].solved, false, '官方盘上「必经格」单独推不完');
  // 每条规则在自己的 fire 夹具上单独跑一圈必须开口（rule-test 核的是逐条结论，这里核的是"单独可用"）
  for (const [name, spec] of Object.entries({ 单走法: 'A', 必经格: 'B', 洞唯一来客: 'C', 一球一洞: 'A', 两球两洞: 'D' })) {
    const b = fx(`sub-${name}`, RULE_BOARDS[spec].flat, RULE_BOARDS[spec].cols);
    const one = solve(b, { rules: [name] });
    ok(one.fires[name] > 0, `「${name}」在自己的夹具 ${spec} 上单独跑就有结论`, `${name}=${one.fires[name]}`);
    for (const other of RULE_ORDER.filter((x) => x !== name)) {
      eq(one.fires[other], 0, `只给「${name}」时「${other}」没有记账（rules 参数是真筛子）`);
    }
  }
  let threw = false;
  try { runRule('随便编的规则', freshState(officialBoard())); } catch { threw = true; }
  eq(threw, true, '未知规则名必须抛（静默返回 0 就等于"规则表里少了一条"没人发现）');
}

/* ── 3. 出货盘批对账 ─────────────────────────────────────────────────────── */
console.log('\n[3] 出货盘批对账：铅笔的每一结论都要和独立计数器对上');
const batch = [];
for (const tier of ['8x8/4', '10x10/5', '10x10/6', '12x12/7', '15x15/9', '18x18/11']) {
  const rows = [];
  let stuck = 0;
  let mismatch = 0;
  let contra = 0;
  for (let i = 0; i < 20; i++) {
    const r = shipPuzzle(`pencil-test|${tier}|${i}`, tier, { tries: 1 });
    if (!r.ok) continue;                       // 没出货的档不进账（tries=1 只为凑对局）
    const c = countSolutions(r.board, { limit: 2 });
    const p = solve(r.board);
    if (!p.solved) stuck++;
    if (p.contradiction) contra++;
    if (p.solved && !sameAnswer(p.sols, answerOf(c, 0))) mismatch++;
    rows.push({ p, c, r });
  }
  eq(rows.length > 0, true, `${tier}：有出货盘可对账`, `${rows.length} 盘`);
  eq(stuck, 0, `${tier}：出货盘铅笔全推得完（generate 的双条件闸说了算）`);
  eq(contra, 0, `${tier}：出货盘上没有一条矛盾（铅笔在这些盘上是 sound 的）`);
  eq(mismatch, 0, `${tier}：铅笔的解与计数器数出来的那一解逐盘相同`);
  eq(rows.every((x) => x.c.count === 1 && !x.c.stopped), true, `${tier}：同一批盘计数器也说唯一`);
  const st = stats(rows.map((x) => x.p.steps));
  const sc = stats(rows.map((x) => x.p.score));
  const firedByRule = Object.fromEntries(RULE_ORDER.map((r) => [r, rows.filter((x) => x.p.fires[r] > 0).length]));
  console.log(`    ${tier}：${rows.length} 盘 / steps med=${st.med} p95=${st.p95} max=${st.max} / score med=${sc.med} p95=${sc.p95} max=${sc.max} / 发火盘数 ${RULE_ORDER.map((r) => `${r}=${firedByRule[r]}`).join(' ')}`);
  batch.push({ tier, n: rows.length, firedByRule, steps: st });
}

/* ── 4. 稀有规则的发火盘数随球数上来 ─────────────────────────────────────── */
console.log('\n[4] 把尺寸钉在 10x10、只变球数：稀有规则发火盘数（阶梯的第二轴）');
{
  const ladder = [];
  for (const balls of [3, 4, 5, 6, 7, 9]) {
    const key = `10x10/${balls}`;
    let shipped = 0;
    const fireBoards = Object.fromEntries(RULE_ORDER.map((r) => [r, 0]));
    const steps = [];
    for (let i = 0; i < 24; i++) {
      const r = shipPuzzle(`pencil-test/ladder|${balls}|${i}`, key, { tries: 1 });
      if (!r.ok) continue;
      const p = solve(r.board);
      if (!p.solved) continue;
      shipped++;
      steps.push(p.steps);
      for (const rule of RULE_ORDER) if (p.fires[rule] > 0) fireBoards[rule]++;
    }
    const st = stats(steps.length ? steps : [0]);
    console.log(`    ${key}：出货且推完 ${shipped} 盘 / steps med=${st.med} p95=${st.p95} / ${RULE_ORDER.map((x) => `${x}=${fireBoards[x]}`).join(' ')}`);
    ladder.push({ balls, key, shipped, fireBoards, steps: st });
  }
  const low = ladder[0];
  const high = ladder[ladder.length - 1];
  // ⚠ 简报 §4 那句"后三条在 3 球盘上结构上不可能发火"在我这一轮的量里**不成立**：
  //   3 球 24 个种子里「必经格」发了 1 盘、「两球两洞」发了 1 盘（见上一行打印）。
  //   所以这一条闸不许按"最低档恒为 0"来断言，只按能量化的那句断：两条稀有规则都必须**严格上升**。
  ok(low.fireBoards['必经格'] < high.fireBoards['必经格'], '「必经格」发火盘数：最高档严格高于最低档', `${high.fireBoards['必经格']} > ${low.fireBoards['必经格']}`);
  ok(low.fireBoards['两球两洞'] < high.fireBoards['两球两洞'], '「两球两洞」发火盘数：最高档严格高于最低档', `${high.fireBoards['两球两洞']} > ${low.fireBoards['两球两洞']}`);
  ok(high.fireBoards['必经格'] > 0 && high.fireBoards['两球两洞'] > 0, '最高档两条稀有规则都不为 0', `必经格=${high.fireBoards['必经格']} 两球两洞=${high.fireBoards['两球两洞']}`);
  ok(ladder.some((x) => x.fireBoards['洞唯一来客'] > 0), '洞唯一来客在任何档都真的会发火（不是死规则）');
  ok(stepsRising(ladder), '同一尺寸下 steps 中位随球数不降（球数才是难度旋钮）', ladder.map((x) => x.steps.med).join('→'));
  console.log(`    注：洞唯一来客 / 一球一洞 在 3 球盘上就大量发火 ⇒ 它们不能当阶梯的第二轴（见 js/engine/pencil.js 的 RARE_RULES 注释）。`);
  console.log(`    注：3 球盘上「必经格」${low.fireBoards['必经格']} 盘、「两球两洞」${low.fireBoards['两球两洞']} 盘 ⇒ "结构上不可能发火"这句话不写进 README。`);
}

/* ── 5. 铅笔不完备的现场 ─────────────────────────────────────────────────── */
console.log('\n[5] 铅笔不完备：唯一、不矛盾、却推不完的盘确实存在（出货闸为何是双条件）');
{
  // 这条路就是 generate.js 的拒铺路径：铺骨架 → 补池挖到唯一 → 计数器认证唯一 → 铅笔推不完。
  let found = null;
  let uniqueSeen = 0;
  let stuck = 0;
  let contradictionStuck = 0;
  let aliveSum = 0;
  for (let i = 0; i < 400 && uniqueSeen < 60; i++) {
    const g = makeSolution(10, 10, seeded('pencil-test/incomplete', i), { balls: 5, maxK: 5 });
    if (!g.ok) continue;
    const d = digUnique(g.board, g.answer, { budgetNodes: 200_000 });
    if (!d.unique) continue;
    const c = countSolutions(g.board, { limit: 2 });   // digUnique 是就地补池：盘就是 g.board
    if (c.count !== 1 || c.stopped) continue;
    uniqueSeen++;
    const p = solve(g.board);
    if (p.solved) continue;
    stuck++;
    aliveSum += p.alive.filter((a) => a > 1).length;
    if (p.contradiction) { contradictionStuck++; continue; }
    if (!found) found = { b: g.board, p, c, i };
  }
  ok(found !== null, '找到"计数器认证唯一 ∧ 铅笔推不完 ∧ 不报矛盾"的盘', `${uniqueSeen} 盘唯一里 ${stuck} 盘推不完`);
  eq(contradictionStuck, 0, '推不完的盘一条矛盾都不该报（报了 = 有规则在不 sound 地删候选）', `实际 ${contradictionStuck}`);
  ok(stuck > 0 && stuck < uniqueSeen, '唯一盘里"推不完"既不是全部也不是空集 ⇒ 双条件闸真的有选择性', `${stuck}/${uniqueSeen}`);
  if (found) {
    const { b, p } = found;
    console.log(`    现场（种子 pencil-test/incomplete#${found.i}）：`);
    console.log(drawBoard(b).split('\n').map((l) => '      ' + l).join('\n'));
    console.log(`    题面串：${serializeBoard(b)}`);
    console.log(`    计数器 ${found.c.count} 解 ∧ stopped=${found.c.stopped}，铅笔 solved=${p.solved}，还剩 ${p.alive.filter((a) => a > 1).length} 颗球多候选：alive=${p.alive.join('/')}，矛盾=${p.contradiction === null ? '无' : p.contradiction}`);
    console.log(`    推不完的盘平均每盘剩 ${stuck ? (aliveSum / stuck).toFixed(1) : '—'} 颗多候选球 ⇒「多候选杀不完」，不是矛盾。`);
    console.log('    ⇒ README 不许写"这个品类都能纯逻辑解"，只能写"出货的每一盘两条都过"。');
  }
  // 手摆的近邻证人：B 盘摘掉那滴池 ⇒ 五条规则一圈无话，而题面是 3 解（rule-test [7] 用的是同一形状）
  {
    const b = dropClue(fx('stall', RULE_BOARDS.B.flat, RULE_BOARDS.B.cols), 'pond', 4);
    const c = countSolutions(b, { limit: 3 });
    const p = solve(b);
    eq(c.count, 3, '手摆的"必须猜"盘：3 解');
    eq(p.solved, false, '同一盘铅笔推不完');
    eq(p.contradiction, null, '而且不报矛盾');
  }
}

/* ── 6. 加规则不减能力（前缀单调） ───────────────────────────────────────── */
console.log('\n[6] 前缀单调：子集推得完 ⇒ 全表必须推得完且同一解');
{
  let tested = 0;
  let regress = 0;
  let disagree = 0;
  for (let i = 0; i < 60; i++) {
    for (const tier of ['8x8/4', '10x10/6', '12x12/7']) {
      const r = shipPuzzle(`pencil-test/mono|${tier}|${i}`, tier, { tries: 1 });
      if (!r.ok) continue;
      const full = solve(r.board);
      for (let n = 1; n < RULE_ORDER.length; n++) {
        const sub = solve(r.board, { rules: RULE_ORDER.slice(0, n) });
        if (!sub.solved) continue;
        tested++;
        if (!full.solved) regress++;
        else if (!sameAnswer(sub.sols, full.sols)) disagree++;
      }
    }
  }
  ok(tested > 0, '至少有前缀能单独推完的盘（否则这条闸是空的）', `命中 ${tested} 次`);
  eq(regress, 0, '子集推得完而全表推不完的盘 = 0（加规则不减能力）');
  eq(disagree, 0, '子集与全表给出不同解的盘 = 0（推出来的那一解与规则顺序无关）');
}

/* ── 7. 权重口径 ─────────────────────────────────────────────────────────── */
console.log('\n[7] 权重与 score 的口径');
{
  eq(RULE_ORDER.length, 5, '规则表是五条');
  eq(RARE_RULES.length, 2, '稀有规则两条（必经格 / 两球两洞）');
  ok(RULE_ORDER.includes(RARE_RULES[0]) && RULE_ORDER.includes(RARE_RULES[1]), '稀有规则都在规则表里');
  const ws = RULE_ORDER.map((r) => RULE_WEIGHT[r]);
  eq(ws.every((x, i) => i === 0 || x >= ws[i - 1]), true, '权重沿规则表单调不降（score 才有"看多远"的含义）');
  const p = solve(officialBoard());
  eq(p.score, RULE_ORDER.reduce((a, r) => a + RULE_WEIGHT[r] * p.fires[r], 0), '官方盘 score 逐条加得回来');
  const empty = solve(new Board(4, 4));
  eq(empty.solved, true, '空盘（没有球）算推完');
  eq(empty.steps, 0, '空盘步数 0');
  console.log(`    官方盘 score=${p.score} = ${RULE_ORDER.map((r) => `${RULE_WEIGHT[r]}×${p.fires[r]}`).join(' + ')}`);
  console.log('    ⇒ score 只在这把五格尺子内可比，README 不许把它当"难度"卖。');
}

console.log(`\n断言 ${total.checks} 条，红 ${fails} 条`);
console.log(`RESULT pencil-test ok=${fails === 0} checks=${total.checks} fails=${fails}`);
process.exit(fails === 0 ? 0 : 1);
