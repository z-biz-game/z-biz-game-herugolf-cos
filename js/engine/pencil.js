// 零猜测铅笔：五条**命名**规则，逐条可单独跑、逐条有 fire 计数。
//
// 它只吃 routesFor 给的候选表，不做任何穷举、不试任何一种走法。
// 解完必须过 verify()，且与穷举计数器数出来的那一解一致（三个出口在 tools 里对账）。
//
//   单走法      某球只剩一条候选 ⇒ 它的线定了：途经格归它、落点 H 归它，
//               别人的线碰这些格 / 落这个 H 的候选全死。
//   必经格      某球所有存活候选都经过同一个格 ⇒ 那个格归它（连带杀同上一样的）。
//   洞唯一来客  某个还没被占的 H 只有这一个球够得着 ⇒ 这个球必须停在它上面。
//   一球一洞    某球存活候选的落点只有一个 H ⇒ 同上（从球这一侧看）。
//   两球两洞    两球合起来只够得着 2 个 H ⇒ 这 2 个洞被它们占满，
//               别的球落到这两个洞的候选全死（Hall 的 2 元情形）。
//
// 前两条是"线"的推理，后三条是"H ↔ 球 一一对应"的匹配推理（R1 的直接后果）。
// 两球两洞要杀的是**第三颗球**的候选 ⇒ 3 球盘才刚开始有它（2 球盘上"别的球"是空集），
// 必经格则要某颗球还剩 ≥2 条候选才可能有"都经过的那一格" ⇒ 这两条的发火盘数随**球数**上来，
// 是难度阶梯唯一可能的第二轴 ⇒ tools/balance.mjs 每档都打印它们发火的盘数，
// 并在"最高档 ≤ 最低档"时判红（那条红线红了就是档位退化成"球多 = 盘大"，那是题材问题）。
// ⚠ 措辞纪律：洞唯一来客 / 一球一洞 在 3 球盘上就能发火，**不许**把它们也说成"3 球不可能"。
//   发火盘数的实测值（含"哪几条在几球盘上恒为 0"）只由 tools/balance.mjs 与 pencil-test 说。
//
// ⚠ 铅笔**不完备**：存在"多候选杀不完"的盘（不矛盾、但仍推不完）。这类盘仍然唯一，
//   只是不进出货（js/engine/generate.js 的出货是双条件：计数器认证唯一 ∧ 铅笔零猜测推完）。
//   所以 README 不许写"这个品类都能纯逻辑解"。
import { prepare } from './counter.js';

export const RULE_ORDER = ['单走法', '必经格', '洞唯一来客', '一球一洞', '两球两洞'];

export const RULE_TEXT = {
  单走法: '这个球只剩一条合法走法 ⇒ 它的线定死了：途经格归它、落点那个 H 归它',
  必经格: '这个球所有还活着的走法都经过同一格 ⇒ 那一格归它，别的线不能碰',
  洞唯一来客: '这个 H 只有一个球还够得着 ⇒ 它必须落在这个洞里（R1 每洞恰好一球）',
  一球一洞: '这个球的存活走法只落到一个 H 上 ⇒ 它必须落那里，别的球别再想这个洞',
  两球两洞: '两个球合起来只够得着两个 H ⇒ 这两个洞被它们包场，别的球落到这两个洞的走法全删',
};

// 权重 = 用这条规则要"看多远"：单球自身 1 / 单球全线 2 / 一个洞与全体球 3 / 两球两洞 4。
// score 只是这把尺子上的读数，**只在规则表内可比**（README 的"不承诺"里就这么写）。
export const RULE_WEIGHT = {
  单走法: 1,
  必经格: 2,
  洞唯一来客: 3,
  一球一洞: 3,
  两球两洞: 4,
};

// 稀有规则 = 实测"低球数盘上恒为 0、随球数才上来"的那两条（必经格是"线"的推理、两球两洞是 Hall 的推理）：
// 它们的发火盘数就是难度阶梯的第二轴（tools/balance.mjs 的阶梯红线用的正是这两个数）。
// 另外三条（洞唯一来客 / 一球一洞 / 单走法）在 3 球盘上就大量发火，拿它们当阶梯会把"人人都会"
// 排成难度 —— 这一条是 pencil-test 的 [4] 逐规则量出来的，不是推出来的。
export const RARE_RULES = ['必经格', '两球两洞'];

export function scoreOf(fires) {
  let s = 0;
  for (const r of RULE_ORDER) s += (RULE_WEIGHT[r] || 0) * (fires[r] || 0);
  return s;
}

// 铅笔的内部状态。**导出**是给 tools/rule-test.mjs 用的：它要"只跑一条规则一圈"，
// 还要在跑完之后读 alive（哪几条候选还活着），拿独立计数器的唯一解对账。
export function freshState(board) {
  const { balls, cands } = prepare(board);
  return {
    board,
    balls,
    cands,
    nb: balls.length,
    alive: cands.map((c) => c.map((_, j) => j)),
    owner: new Map(), // cell -> 球下标（这条线一定经过它）
    holeOf: new Map(), // cell(H) -> 球下标（这个洞一定被它填）
    ballHole: new Map(), // 球下标 -> 定了的落点 H
    fires: Object.fromEntries(RULE_ORDER.map((r) => [r, 0])),
    steps: 0,
    contradiction: null,
    log: [], // 每一条结论都记账：{rule, ball, kind:'cell'|'hole'|'prune', ...} —— rule-test 核对"到底推出了哪一格"
  };
}

function prune(st, i, keep, rule) {
  const before = st.alive[i].length;
  const goneIdx = [];
  st.alive[i] = st.alive[i].filter((j) => {
    if (keep(st.cands[i][j])) return true;
    goneIdx.push(j);
    return false;
  });
  const gone = before - st.alive[i].length;
  if (gone) {
    st.fires[rule] += gone;
    st.steps += gone;
    st.log.push({ rule, ball: i, kind: 'prune', gone: goneIdx });
  }
  return gone;
}

// 把「这条线归球 i」写进棋盘，并连带杀别人的候选
function claim(st, i, cell, rule) {
  if (st.owner.has(cell)) {
    if (st.owner.get(cell) !== i) st.contradiction = `格 ${cell} 同时归球 ${st.owner.get(cell)} 和球 ${i}（R3 每格最多一条线）`;
    return false;
  }
  st.owner.set(cell, i);
  st.log.push({ rule, ball: i, kind: 'cell', cell });
  for (let j = 0; j < st.nb; j++) {
    if (j === i) continue;
    prune(st, j, (r) => !r.cells.includes(cell), rule);
  }
  return true;
}

function claimHole(st, i, hole, rule) {
  if (st.holeOf.has(hole) && st.holeOf.get(hole) !== i) {
    st.contradiction = `H ${hole} 同时归球 ${st.holeOf.get(hole)} 和球 ${i}（R1 每洞恰好一球）`;
    return false;
  }
  st.holeOf.set(hole, i);
  if (st.ballHole.has(i) && st.ballHole.get(i) !== hole) {
    st.contradiction = `球 ${i} 要落两个洞（R1 一球一洞）`;
    return false;
  }
  st.ballHole.set(i, hole);
  st.log.push({ rule, ball: i, kind: 'hole', hole });
  for (let j = 0; j < st.nb; j++) {
    if (j === i) continue;
    prune(st, j, (r) => r.hole !== hole, rule);
  }
  return true;
}

// 球 i 现在够得着的 H 集合（只算存活候选）
function touch(st, i) {
  const alive = new Set(st.alive[i]);
  const out = new Set();
  st.cands[i].forEach((r, j) => {
    if (alive.has(j)) out.add(r.hole);
  });
  return out;
}

// 跑一条规则**一圈**（不循环到不动点）。返回这一圈删掉的候选数 + 是否开口 + 是否报矛盾。
export function runRule(name, st) {
  if (!RULE_ORDER.includes(name)) throw new Error(`未知规则「${name}」，规则表是 ${RULE_ORDER.join('/')}`);
  if (st.contradiction) return { fired: 0, touched: 0 };
  const before = st.steps;
  const firedBefore = Object.fromEntries(RULE_ORDER.map((r) => [r, st.fires[r]]));
  let touched = 0; // 有几盘/几球开过口（fires 记的是删除位数，touched 记的是"开口次数"）

  if (name === '单走法') {
    for (let i = 0; i < st.nb; i++) {
      if (st.alive[i].length === 0) {
        st.contradiction = `球 ${i}（格 ${st.balls[i]}）候选被杀空`;
        break;
      }
      if (st.alive[i].length === 1 && !st.ballHole.has(i)) {
        const r = st.cands[i][st.alive[i][0]];
        touched++;
        if (claimHole(st, i, r.hole, name)) {
          for (const c of r.cells) if (!claim(st, i, c, name)) break;
          st.ballHole.set(i, r.hole);
          st.steps++;
          st.fires[name]++;
        }
      }
    }
  } else if (name === '必经格') {
    for (let i = 0; i < st.nb; i++) {
      if (st.alive[i].length < 2) continue;
      const common = st.cands[i][st.alive[i][0]].cells.filter(
        (c) => st.alive[i].every((j) => st.cands[i][j].cells.includes(c)) && !st.board.balls.has(c),
      );
      for (const c of common) {
        if (st.owner.has(c)) continue;
        touched++;
        if (!claim(st, i, c, name)) break;
        st.fires[name]++;
        st.steps++;
      }
    }
  } else if (name === '洞唯一来客') {
    for (const hole of st.board.holes) {
      if (st.holeOf.has(hole)) continue;
      const who = [];
      for (let i = 0; i < st.nb; i++) if (touch(st, i).has(hole)) who.push(i);
      if (!who.length) {
        st.contradiction = `H ${hole} 没有任何球还够得着（R1 每洞一球）`;
        break;
      }
      if (who.length === 1) {
        touched++;
        if (claimHole(st, who[0], hole, name)) {
          st.fires[name]++;
          st.steps++;
        }
      }
    }
  } else if (name === '一球一洞') {
    for (let i = 0; i < st.nb; i++) {
      const hs = [...touch(st, i)];
      if (hs.length === 0) {
        st.contradiction = `球 ${i}（格 ${st.balls[i]}）没有够得着的 H`;
        break;
      }
      if (hs.length === 1 && !st.ballHole.has(i)) {
        touched++;
        if (claimHole(st, i, hs[0], name)) {
          st.fires[name]++;
          st.steps++;
        }
      }
    }
  } else {
    // 两球两洞（Hall 的 2 元情形）
    for (let i = 0; i < st.nb; i++) {
      for (let j = i + 1; j < st.nb; j++) {
        const uni = new Set([...touch(st, i), ...touch(st, j)]);
        if (uni.size !== 2) continue;
        for (const hole of uni) {
          if (st.holeOf.has(hole)) continue;
          let did = false;
          for (let k = 0; k < st.nb; k++) {
            if (k === i || k === j) continue;
            if (prune(st, k, (r) => r.hole !== hole, name)) did = true;
          }
          if (did) {
            touched++;
            st.fires[name]++;
            st.steps++;
          }
        }
      }
    }
  }
  const fired = st.steps - before;
  const spoke = RULE_ORDER.some((r) => st.fires[r] > firedBefore[r]);
  return { fired, spoke, touched };
}

// 批推：轮询规则表到不动点（或矛盾、或每球只剩一条候选）。
export function solve(board, { rules = RULE_ORDER } = {}) {
  for (const r of rules) if (!RULE_ORDER.includes(r)) throw new Error(`未知规则「${r}」`);
  const st = freshState(board);
  if (!st.nb) {
    return { solved: true, contradiction: null, steps: 0, fires: st.fires, sols: [], cands: [], alive: [], touched: {} };
  }
  const touched = Object.fromEntries(RULE_ORDER.map((r) => [r, 0]));
  let guard = 0;
  while (!st.contradiction) {
    let moved = false;
    for (const name of rules) {
      const res = runRule(name, st);
      touched[name] += res.touched;
      if (res.fired) moved = true;
      if (st.contradiction) break;
    }
    if (st.contradiction) break;
    if (!moved) break;
    if (++guard > 4000) {
      st.contradiction = '铅笔轮询超过 4000 圈（写坏了：每一步至少删一个候选，不可能这么多圈）';
      break;
    }
  }
  const routeOf = (i) => (st.alive[i].length === 1 ? st.cands[i][st.alive[i][0]] : null);
  const solved = !st.contradiction && st.balls.every((_, i) => st.alive[i].length === 1);
  const sols = solved ? st.balls.map((cell, i) => ({ start: cell, stops: routeOf(i).stops.slice() })) : null;
  return {
    solved,
    contradiction: st.contradiction,
    steps: st.steps,
    fires: st.fires,
    touched,
    sols,
    cands: st.cands.map((c) => c.length),
    alive: st.alive.map((a) => a.length),
    score: scoreOf(st.fires),
  };
}

// 推不完时"还剩几个球没定"—— 披露口径（不是判据：判据在 generate 的出货闸里）。
export function stuckBalls(board, { rules = RULE_ORDER } = {}) {
  const r = solve(board, { rules });
  return { solved: r.solved, undecided: r.alive.filter((a) => a > 1).length, steps: r.steps, fires: r.fires };
}
