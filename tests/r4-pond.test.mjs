#!/usr/bin/env node
// R4（不许停在池上，可以穿过）的证人安在这个文件里。
//
// 为什么它必须**两侧都有**：这一条规则有两个出口，只测"停在池上被抓"的那一半，
// 实现里只要把 `board.ponds.has(landed)` 写成"这一格是池就整条都不许走"，
// 反例照样红、正例（穿过池）却会被误杀 ⇒ 出题器会系统性漏掉一大类合法走法，
// 玩家看到的是"这盘无解"。所以本文件的第二条判据是穿过必须放行。
//
// 三条判据：
//   ① 停在池上的答案 verify 必须点名 R4，独立计数器必须说 0 解；
//   ② 从池上穿过的答案 verify 必须无错，且那个池格确实出现在途经格里（正例不是空转）；
//   ③ routesFor 的结构不变量：任何一条候选的**落点**都不是池，而池可以出现在 cells 中间。
import { routesFor, passThrough } from '../js/engine/routes.js';
import { verify } from '../js/engine/verify.js';
import { countSolutions } from '../js/engine/counter.js';
import { shipPuzzle } from '../js/engine/generate.js';
import { officialBoard, officialAnswer, mutateOfficial, OFFICIAL_MUTATIONS, OFFICIAL_MUTATION_TAGS, TEST_BOARDS } from '../tools/scenarios.js';

let checks = 0;
const fails = [];
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
const has = (errs, re, msg) => check(errs.some((e) => re.test(e)), `${msg} —— 报错串里没找到 ${re}：${JSON.stringify(errs)}`);

// ── ① 停在池上：拒 ──────────────────────────────────────────────────────────
{
  const b = TEST_BOARDS.r4stop();
  const pond = b.cellList().length && [...b.ponds][0];
  const ans = TEST_BOARDS.r4stopAnswer(b);
  const errs = verify(b, ans);
  check(errs.length > 0, '停在池上：verify 说无错（证人坏了）');
  has(errs, /停在池上/, 'R4 要抓到"停在池上"');
  has(errs, /R4/, '这一条必须挂 R4');
  check(ans[0].stops.includes(pond), `夹具写坏了：那份答案的第一动根本没落在池 ${pond} 上（这一条就没测到东西）`);
  const c = countSolutions(b, { limit: 2 });
  check(c.count === 0, `停在池上的盘独立计数器必须说 0 解，实为 ${c.count}`);
  // 枚举层同一条：routesFor 不许给出"停在池上"的候选
  for (const cell of b.cellList()) {
    for (const r of routesFor(b, cell)) check(!b.ponds.has(r.hole), `routesFor 给出的候选收尾在池 ${r.hole} 上（枚举与复核不一致）`);
  }
}

// ── ② 穿过池：放行，而且是真穿过去的 ───────────────────────────────────────
{
  const b = TEST_BOARDS.r3legal();
  const ans = TEST_BOARDS.r3legalAnswer(b);
  const errs = verify(b, ans);
  check(errs.length === 0, `穿过池的合法答案被拒：${JSON.stringify(errs)}`);
  const pond = [...b.ponds][0];
  check(b.ponds.size === 1, `夹具应当只有一滴池，实为 ${b.ponds.size}`);
  const route = routesFor(b, ans[0].start).find((r) => r.stops.join('-') === ans[0].stops.join('-'));
  check(route !== undefined, '那份合法答案不在 routesFor 的候选表里（两份实现分道了）');
  check(route.cells.includes(pond), `那份走法根本没经过池 ${pond}（正例是空转）`);
  check(!route.stops.includes(pond), '那份走法停在池上（正例选错了）');
  check(passThrough(route).includes(pond), 'passThrough() 没把池算作"穿过"（那 R4 的两半就没人守了）');
  const c = countSolutions(b, { limit: 2 });
  check(c.count === 1, `穿过池的盘应当唯一，实为 ${c.count}`);
  // 官方 5×5 的 R4 类变异（停在池上 / 出界）逐个被拒并归因到 R4。
  // ⚠ 官方那一盘的**正例半边**（线从池上穿过去）做不出来：两滴池都在右上角 (1,4)(1,5)，
  //   任何一条合法长度的动想穿过它们都必然 OB 或停在它们上面。所以正例半边由上面的
  //   TEST_BOARDS.r3legal 承担 —— 这一条缺口如实写在这里，不假装官方盘证到了它。
  const ob = officialBoard();
  check(verify(ob, officialAnswer()).length === 0, '官方解答本身被拒（正例坏了）');
  const r4Cases = OFFICIAL_MUTATIONS.filter((w) => /R4/.test(OFFICIAL_MUTATION_TAGS[w]));
  check(r4Cases.length >= 2, `R4 类变异至少两条（停池 / 出界），实得 ${r4Cases.join('/')}`);
  for (const what of r4Cases) {
    const errs = verify(ob, mutateOfficial(what));
    check(errs.length > 0, `变异 ${what} 没被拒`);
    has(errs, OFFICIAL_MUTATION_TAGS[what], `变异 ${what} 必须挂 R4`);
  }
}

// ── ③ 出货盘上的池：落点不在池上，且摘掉一滴池不会让正解失效 ───────────────
{
  let boards = 0;
  let stopOnPond = 0;
  let unused = 0;
  let deadAfterDrop = 0;
  let pondCellsTotal = 0;
  for (const tier of ['8x8/4', '10x10/6', '12x12/7', '18x18/11']) {
    for (let i = 0; i < 60 && boards < 32; i++) {
      const r = shipPuzzle(`r4-pond-test|${tier}|${i}`, tier);
      if (!r.ok) continue;
      boards++;
      const pondCells = new Set(r.board.ponds);
      pondCellsTotal += pondCells.size;
      if (pondCells.size === 0) unused++;
      for (const s of r.answer) for (const st of s.stops) if (pondCells.has(st)) stopOnPond++;
      // 每一滴池都必须是"有活儿干"的：摘掉之后正解仍然是合法答案（池只杀多余走法，不杀正解）
      for (const cell of pondCells) {
        const b = r.board.clone();
        b.ponds.delete(cell);
        if (verify(b, r.answer).length !== 0) deadAfterDrop++;
      }
      // 落点在池上 = R4 漏网（出货盘上不该有，枚举层与复核层都拦住了）
      for (const cell of r.board.cellList()) {
        for (const rt of routesFor(r.board, cell)) if (pondCells.has(rt.hole)) stopOnPond++;
      }
      const errs = verify(r.board, r.answer);
      check(errs.length === 0, `出货盘 ${tier}#${i} 的解过不了 verify：${JSON.stringify(errs)}`);
    }
  }
  check(boards >= 32, `样本量够（攒满 32 盘出货盘），实得 ${boards}`);
  check(stopOnPond === 0, `${stopOnPond} 个落点压在池上（R4 漏网）`);
  check(deadAfterDrop === 0, `${deadAfterDrop} 滴池摘掉之后正解反而不合法（池挖到正解线上去了）`);
  console.log(`  样本：${boards} 盘出货盘、共 ${pondCellsTotal} 滴池；其中 ${unused} 盘一颗池都没用上（补池空转的盘数）`);
}

console.log(`RESULT r4-pond-test ok=${fails.length === 0} checks=${checks} fails=${fails.length}`);
for (const f of fails) console.error('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
