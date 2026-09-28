// routesFor()：一个球在题面约束下的**全部**合法走法。R2/R3/R4 都在这一个文件里判。
//
// 规则四条（逐条抄自 https://www.nikoli.co.jp/ja/puzzles/herugolf/ 与
// https://www.janko.at/Raetsel/Herugolf/index.htm —— 两处都把这四条写成正文，不是想象）：
//   R1 把所有球都移动到 H（球洞）格里，每个 H 恰好落一球 ⇒ 球与 H 一一对应，且每球至少动一次。
//   R2 每动一次：沿上下左右**直线**走「球里的数字」那么多个格；走完这一动数字减 1（方向可换）
//      ⇒ 一动长度序列严格是 k, k-1, k-2, …；停在 H 上的球不再动。
//   R3 线不许穿过别的球、不许穿过 H（停在它上面不算穿过）、不许自交；线两两不许交叉/重叠
//      （janko 正表述：每格最多被一条线通过）。
//   R4 不许出界（OB）；不许**停在**池（灰格）上，但**可以从池上穿过**。
//
// 判据 2（穷举成本由线索封住）的底气就在这一层：一个球的全部走法可以先验枚举
// —— 第一动 ≤4 个方向、之后每动 ≤3 个（原路回头会把刚走过的格再走一遍 = 自交）、
// 一动比一动短 ⇒ 每个 k 的球最多 4·3^(k-1) 条候选。穷举是在「球 × 候选路径」上做
// 不相交代表系（js/engine/counter.js），不在格子状态上做 ⇒ 搜索空间与格数几乎无关，只与球数有关。
import { DIRS } from './grid.js';

export { DIRS };

// 返回 [{cells, stops, hole, strokes, start}]：
//   cells   这条线经过的所有格（含起点与每一个落点）
//   stops   每一动的落点（按顺序；最后一个必然在 H 上）
//   hole    收尾的 H
//   strokes 动了几动（= stops.length）
// 只看不碰别的球的线走哪儿 —— 那是计数器的活儿（它做的是"这些候选挑一种互不相交的组合"）。
export function routesFor(board, cell) {
  const out = [];
  const k0 = board.balls.get(cell);
  if (k0 === undefined) return out;
  const used = new Set([cell]);
  let nodes = 0; // 走过多少条"半截线"：出货口径不看它，只在 generator-probe 里核对候选数没有爆

  const walk = (at, k, cells, stops, firstStroke) => {
    for (let d = 0; d < 4; d++) {
      nodes++;
      const path = [];
      let cur = at;
      let ok = true;
      for (let s = 0; s < k; s++) {
        cur = board.step(cur, d);
        if (cur < 0) {
          ok = false;
          break; // R4 OB
        }
        if (used.has(cur)) {
          ok = false;
          break; // R3 自交（同一条线不许两次经过同一格）
        }
        if (board.balls.has(cur) && cur !== cell) {
          ok = false;
          break; // R3 穿过别的球
        }
        if (board.holes.has(cur) && s < k - 1) {
          ok = false;
          break; // R3 穿过 H（末格停在其上才算，R2 也要求停下）
        }
        path.push(cur);
      }
      if (!ok) continue;
      const landed = cur;
      if (board.ponds.has(landed)) continue; // R4 不许停在池上（穿过允许，上面就没拦 path 里的池）
      for (const c of path) used.add(c);
      const nextCells = cells.concat(path);
      const nextStops = stops.concat([landed]);
      if (board.holes.has(landed)) {
        out.push({ cells: nextCells, stops: nextStops, hole: landed, strokes: nextStops.length, firstStroke, start: cell });
      } else if (k - 1 >= 1) {
        walk(landed, k - 1, nextCells, nextStops, firstStroke); // R2 数字减 1 再动
      }
      // 动到数字为 0 还没进洞 = 死路（这一球这条方向序列不可能收口），什么都不 push
      for (const c of path) used.delete(c);
    }
  };

  walk(cell, k0, [cell], [], k0);
  // R1 的"每球至少动一次"是结构上满足的：k0 的球第一条动就得走 k0 格，任何候选都至少动了一次。
  // 落点序列唯一决定路径 ⇒ 理论上不会重复；仍按内容去重，防的是"以后改了 walk 而重复悄悄混进来"。
  const seen = new Map();
  for (const r of out) {
    const key = r.cells.join(',') + '|' + r.stops.join(',');
    if (!seen.has(key)) seen.set(key, r);
  }
  const res = [...seen.values()];
  res.nodes = nodes;
  return res;
}

// 一条候选线"经过但不算停靠"的格（判 R3 交叉时用来区分"停在上面"与"穿过"）
export function passThrough(route) {
  const stopSet = new Set(route.stops);
  return route.cells.filter((c) => !stopSet.has(c));
}
