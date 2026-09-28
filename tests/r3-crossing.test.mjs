#!/usr/bin/env node
// R3（线不许交叉/重叠/自交、不许穿过别的球、不许穿过 H）的证人安在这个文件里。
//
// 为什么它得有个家而不是只住在 tools/rule-test.mjs：rule-test 核的是"铅笔会不会误删候选"，
// 这一条核的是**几何层**（js/engine/routes.js 与 js/engine/verify.js 各写一遍的规则）。
// 哪天 walk() 的 `used` 集合被改松（比如"只拦落点不拦途经格"），counter 照样出货、
// 铅笔照样推完，而玩家看到的是两条线叠在一起 —— 四套 tools 门禁全体鼓掌，只有这里会红。
//
// 三条判据：
//   ① 专用夹具：交叉/自交各自被点名，自交那一盘的报错串必须**全是 R3**（归因干净）；
//   ② 官方 5×5 的变异逐个被拒、逐个归因到它声称的那一条。这一盘的题面太紧
//      （球 0 与球 19 各只有 1 条候选），改一条线必然连带违反 R1，所以断言的是
//      "声称的那一条必须出现"，不是"只出现那一条"—— 每个变异实测报出的规则集合
//      写在 tools/scenarios.js 的 OFFICIAL_MUTATION_TAGS 里；
//   ③ 结构不变量：routesFor 给出的每一条线不自交；出货盘上任意两球的线共用格为 0，
//      且没有一条线在中间穿过 H 或别的球。
import { routesFor } from '../js/engine/routes.js';
import { verify } from '../js/engine/verify.js';
import { countSolutions } from '../js/engine/counter.js';
import { shipPuzzle } from '../js/engine/generate.js';
import { officialBoard, officialAnswer, mutateOfficial, OFFICIAL_MUTATIONS, OFFICIAL_MUTATION_TAGS, TEST_BOARDS } from '../tools/scenarios.js';

let checks = 0;
const fails = [];
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
const has = (errs, re, msg) => check(errs.some((e) => re.test(e)), `${msg} —— 报错串里没找到 ${re}：${JSON.stringify(errs)}`);
const selfCrossed = (cells) => new Set(cells).size !== cells.length;
// 把 (起点, 落点序列) 摊成途经格序列：这里**独立算一遍**（不复用 routesFor 的 cells），
// 否则"夹具没真的交叉"这句话就由被检的那份实现自己说了。
function lineCells(board, start, stops) {
  const out = [start];
  let at = start;
  for (const to of stops) {
    const [r0, c0] = board.rc(at);
    const [r1, c1] = board.rc(to);
    const dr = Math.sign(r1 - r0);
    const dc = Math.sign(c1 - c0);
    const dist = Math.abs(r1 - r0) + Math.abs(c1 - c0);
    for (let t = 1; t <= dist; t++) out.push(board.idx(r0 + dr * t, c0 + dc * t));
    at = to;
  }
  return out;
}

// ── ① 专用夹具 ──────────────────────────────────────────────────────────────
{
  const b = TEST_BOARDS.r3cross();
  const ans = TEST_BOARDS.r3crossAnswer(b);
  const errs = verify(b, ans);
  check(errs.length > 0, 'R3 交叉盘：verify 说无错（证人坏了）');
  has(errs, /两条线/, '交叉/重叠要被抓');
  has(errs, /R3/, '交叉的报错必须挂 R3');
  const shared = lineCells(b, ans[0].start, ans[0].stops).filter((cell) => lineCells(b, ans[1].start, ans[1].stops).includes(cell));
  check(shared.length >= 1, `夹具没真的交叉（共用格=${JSON.stringify(shared)}）`);
  const c = countSolutions(b, { limit: 2 });
  check(c.count === 0, `交叉盘的独立计数器必须说 0 解，实为 ${c.count}`);
}
{
  const b = TEST_BOARDS.r3self();
  const ans = TEST_BOARDS.r3selfAnswer(b);
  const cells = lineCells(b, ans[0].start, ans[0].stops);
  const errs = verify(b, ans);
  check(errs.length > 0, 'R3 自交盘：verify 说无错');
  has(errs, /同一条线|两条线/, '自交（原路退回）要被抓');
  check(selfCrossed(cells), `自交夹具的线其实没自交（摊开=${JSON.stringify(cells)}）⇒ 夹具写坏了`);
  check(errs.every((e) => /R3/.test(e)), `自交盘的报错串必须全是 R3（干净归因），实为 ${JSON.stringify(errs)}`);
  const cands = routesFor(b, ans[0].start);
  check(cands.every((r) => !selfCrossed(r.cells)), 'routesFor 里居然有自交的线（枚举层没拦住）');
  check(cands.every((r) => r.stops.join('-') !== ans[0].stops.join('-')), '自交那条线居然出现在候选表里（两份实现分道）');
}
{
  // 正例：合法走法必须被收（只验反例的证人等于没验）
  const b = TEST_BOARDS.r3legal();
  const good = TEST_BOARDS.r3legalAnswer(b);
  check(verify(b, good).length === 0, `合法对照盘被拒：${JSON.stringify(verify(b, good))}`);
  check(countSolutions(b, { limit: 2 }).count === 1, '合法对照盘应当唯一');
}

// ── ② 官方 5×5：变异逐个被拒、逐个归因到它声称的那一条 ────────────────────
{
  const b = officialBoard();
  check(verify(b, officialAnswer()).length === 0, '官方 5×5 的合法答案被 verify 拒了（正例坏了）');
  const r3Cases = OFFICIAL_MUTATIONS.filter((w) => /R3/.test(OFFICIAL_MUTATION_TAGS[w]));
  check(r3Cases.length >= 3, `R3 类变异至少三条（交叉/重叠/自交），实得 ${r3Cases.join('/')}`);
  for (const what of OFFICIAL_MUTATIONS) {
    const errs = verify(b, mutateOfficial(what));
    check(errs.length > 0, `变异 ${what} 没被拒：${JSON.stringify(errs)}`);
    has(errs, OFFICIAL_MUTATION_TAGS[what], `变异 ${what} 的归因漂了（它声称 ${OFFICIAL_MUTATION_TAGS[what]}）`);
  }
  const uniq = countSolutions(b, { limit: 2 });
  check(uniq.count === 1, `官方盘本身仍须唯一（变异改的是答案不是题面），实为 ${uniq.count}`);
  console.log(`  官方 5×5 变异：${OFFICIAL_MUTATIONS.length} 条逐个被拒；R3 类=${r3Cases.join('/')}`);
}

// ── ③ 出货盘上的结构不变量 ─────────────────────────────────────────────────
{
  let boards = 0;
  let badOverlap = 0;
  let badSelf = 0;
  let badHoleThrough = 0;
  let badBallThrough = 0;
  for (const tier of ['8x8/4', '10x10/6', '12x12/7', '15x15/9', '18x18/11']) {
    for (let i = 0; i < 60 && boards < 40; i++) {
      const r = shipPuzzle(`r3-crossing-test|${tier}|${i}`, tier);
      if (!r.ok) continue;
      boards++;
      const lines = r.answer.map((s) => lineCells(r.board, s.start, s.stops));
      for (const l of lines) if (selfCrossed(l)) badSelf++;
      for (let a = 0; a < lines.length; a++) {
        for (let b2 = a + 1; b2 < lines.length; b2++) for (const cell of lines[a]) if (lines[b2].includes(cell)) badOverlap++;
      }
      for (const l of lines) {
        for (let t = 1; t < l.length - 1; t++) {
          if (l[t] !== l[0] && r.board.balls.has(l[t])) badBallThrough++;
          if (r.board.holes.has(l[t])) badHoleThrough++;
        }
      }
      const errs = verify(r.board, r.answer);
      check(errs.length === 0, `出货盘 ${tier}#${i} 的解过不了 verify：${JSON.stringify(errs)}`);
    }
  }
  check(boards >= 40, `样本量够（攒满 40 盘出货盘），实得 ${boards}`);
  check(badOverlap === 0, `${badOverlap} 对线共用格子（R3 交叉漏网）`);
  check(badSelf === 0, `${badSelf} 条线自交`);
  check(badHoleThrough === 0, `${badHoleThrough} 条线在中间穿过了 H（没停在上面）`);
  check(badBallThrough === 0, `${badBallThrough} 条线在中间穿过了别的球`);
  console.log(`  样本：${boards} 盘出货答案；交叉/自交/穿 H/穿球 漏网数 = ${badOverlap}/${badSelf}/${badHoleThrough}/${badBallThrough}`);
}

console.log(`RESULT r3-crossing-test ok=${fails.length === 0} checks=${checks} fails=${fails.length}`);
for (const f of fails) console.error('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
