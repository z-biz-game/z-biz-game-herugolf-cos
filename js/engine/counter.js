// 独立穷举计数器 prepare() + countSolutions()：只回答一个问题
// —— "这盘题面（球 + H + 池）到底有几种走法？"
//
// 它与铅笔互不信任：不做任何推理，只把每个球的全部候选走法（js/engine/routes.js 枚举）
// 拿来试组合，在「球 × 候选路径」上做不相交代表系 + H 的一一对应。
// 这就是判据 2 的形状：搜索空间 = ∏(该球的候选数)，一个 k 的球最多 4·3^(k-1) 条
// ⇒ 与格数几乎无关，只与球数有关。它不是 2^格数的暴力。
//
// 挑球用 MRV（存活候选最少的那个先试）。这条是上一轮 Sashigane 的教训抬进来的：
// 行序 DFS 的长尾是自己写坏的，不能拿它当"成本无界"的证据。所以 mrv:false 这条路
// 也留着（tools/counter-test.mjs 拿它对账：同一个数、两种挑序，结点数必须同向）。
//
// ⚠ stopped=true（预算烧完、没数完）**不等于**"只有一种"。
//   count===1 && stopped 是红的 —— 这一条在 js/engine/generate.js 的出货判定里写死。
import { routesFor } from './routes.js';

export const DEFAULT_BUDGET_NODES = 500_000;
export const DEFAULT_LIMIT = 2;

export function prepare(board) {
  const balls = board.cellList();
  const cands = balls.map((b) => routesFor(board, b));
  return { balls, cands };
}

// 返回 {count, nodes, stopped, capped, sols}：
//   count   找到的走法数（到 limit 就早停）
//   nodes   试过的「球 × 候选」组合数（成本口径，balance/ceiling 打印它的 med/p95/max）
//   stopped 预算烧完 = 没数完（唯一性没证到）
//   capped  到 limit 就收了工（说明至少 count 种，不许当成"就这么多"）
//   sols    找到的走法：[{start, route}]，route 是 routesFor 的那一条
//
// 一条候选的身份串：落点序列。落点序列唯一决定整条线（相邻落点共线），所以它就是这条候选的键。
export function stopKey(route) {
  return route.stops.join('-');
}

// pins（门禁专用，出货路径不用）：Map<球格, stopKey(候选)> 把某个球的候选**限定**成那几条。
// 它买到的是一句独立问句："铅笔删掉的那条走法，是不是真的不在任何解里？"（tools/rule-test.mjs 的
// 消值复核）。限定发生在候选表上、DFS 之前 ⇒ 复用的还是同一台机器，没有第二条实现可走。
// ⚠ 传了 pins 就必须自己给 prep（或干脆不给）：prep 里那份没限定过的候选表不能拿来复用。
export function countSolutions(board, { limit = DEFAULT_LIMIT, budgetNodes = DEFAULT_BUDGET_NODES, prep = null, mrv = true, pins = null } = {}) {
  const p0 = prep && !pins ? prep : prepare(board);
  const balls = p0.balls;
  const cands = pins ? p0.cands.map((cs, i) => (pins.has(balls[i]) ? cs.filter((c) => stopKey(c) === pins.get(balls[i])) : cs)) : p0.cands;
  const occupied = new Uint8Array(board.n);
  const holeTaken = new Uint8Array(board.n);
  const chosen = new Array(balls.length);
  let nodes = 0;
  let stopped = false;
  const sols = [];

  const take = (cells, on) => {
    for (const c of cells) occupied[c] = on ? 1 : 0;
  };
  const fits = (c) => {
    if (holeTaken[c.hole]) return false;
    for (const x of c.cells) if (occupied[x]) return false;
    return true;
  };

  const pick = () => {
    if (!mrv) {
      for (let i = 0; i < balls.length; i++) {
        if (chosen[i] !== undefined) continue;
        let cnt = 0;
        for (const c of cands[i]) if (fits(c)) cnt++;
        return { i, cnt };
      }
      return { i: -1, cnt: 0 };
    }
    let best = -1;
    let bestCnt = Infinity;
    for (let i = 0; i < balls.length; i++) {
      if (chosen[i] !== undefined) continue;
      let cnt = 0;
      for (const c of cands[i]) {
        if (!fits(c)) continue;
        if (++cnt >= bestCnt) break; // 已经不如现有的好，不必数完
      }
      if (cnt < bestCnt) {
        bestCnt = cnt;
        best = i;
        if (cnt === 0) break;
      }
    }
    return { i: best, cnt: bestCnt };
  };

  const go = () => {
    const { i, cnt } = pick();
    if (i < 0) {
      // 所有球都选完了。R1 要"每个 H 恰好一球" ⇒ 还有空 H 就不是解。
      for (const hcell of board.holes) if (!holeTaken[hcell]) return false;
      sols.push(balls.map((cell, j) => ({ start: cell, route: chosen[j] })));
      return sols.length >= limit;
    }
    if (cnt === 0) return false; // 这个球一条走法都不剩：死路
    for (const c of cands[i]) {
      if (++nodes > budgetNodes) {
        stopped = true;
        return true;
      }
      if (!fits(c)) continue;
      take(c.cells, true);
      holeTaken[c.hole] = 1;
      chosen[i] = c;
      const done = go();
      chosen[i] = undefined;
      holeTaken[c.hole] = 0;
      take(c.cells, false);
      if (done) return true; // 到 limit 或撞预算：整棵树一起退
    }
    return false;
  };

  const finished = go();
  return { count: sols.length, nodes, stopped, capped: !stopped && finished && sols.length >= limit, sols };
}

// 把计数器吐出来的那一解还原成 verify()/pencil 吃的形状（答案的唯一可信来源）。
// ⚠ 出货盘上的答案必须**用这里数出来的那一份覆盖**，不许信 generate 自己记的：
//   补池/摘池之后自记的那一份可能已经不再是任何解（这是上一轮 Yajilin 实测 0/6 的坑）。
export function answerOf(res, i = 0) {
  return res.sols[i].map((x) => ({ start: x.start, stops: x.route.stops.slice() }));
}
