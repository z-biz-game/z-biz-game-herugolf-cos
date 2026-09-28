// 独立复核 verify()：把「答案」当成一串 (起点, 落点序列) 从题面文字**从头再走一遍**。
//
// 这是引擎里唯一一条「不许抄自己」的通道：出题器与计数器怎么想的不重要，
// 答案必须过这一关。所以本文件一条 routesFor 的代码都不许 import ——
// 连方向表都不用：动与动之间的几何是从 (起点格, 落点格) 现算的（rc + 步长），
// 走法枚举那份实现（js/engine/routes.js）如果写错了，这里必须给出不同的答案。
//
// 规则四条的出处与正文见 js/engine/routes.js 文件头（Nikoli 官方页 + janko + LIPIcs FUN 2018）。
// verify 检查的是：
//   R1 每个球恰有一条路线、每个 H 恰好被一球收下、每球至少动一次
//   R2 第 s 动的长度必须恰是 k-s（逐动递减 1），每动必须是直线（共轴）
//   R3 每格最多被一条线通过（含同一条线自交）、不许穿过别的球、不许穿过 H（末格除外）
//   R4 不许出界、不许停在池上
// 返回**全部**错误串（空数组 = 无错）。返回值不是布尔，因为门禁要打印红在哪一条规则上。
import { Board } from './grid.js';

export function verify(board, solutions) {
  const errs = [];
  if (!(board instanceof Board)) throw new Error('verify 的第一参数必须是 Board');
  const ballCells = [...board.balls.keys()].sort((a, b) => a - b);
  const holeCells = [...board.holes].sort((a, b) => a - b);
  if (solutions.length !== ballCells.length) errs.push(`球数 ${ballCells.length} 与路线数 ${solutions.length} 不等（R1）`);
  const seenBall = new Set();
  const usedCell = new Set();
  const holeTaken = new Map();

  for (const sol of solutions) {
    const { start, stops } = sol;
    const k0 = board.balls.get(start);
    if (k0 === undefined) {
      errs.push(`路线起点 ${start} 没有球`);
      continue;
    }
    if (seenBall.has(start)) {
      errs.push(`同一个球 ${start} 被走了两次（R1）`);
      continue;
    }
    seenBall.add(start);
    if (!stops.length) {
      errs.push(`球 ${start} 一动没动（R1 要求每球至少动一次）`);
      continue;
    }
    let at = start;
    let broken = false;
    const mine = [start];
    for (let s = 0; s < stops.length; s++) {
      const want = k0 - s; // R2：第 s 动的长度
      const to = stops[s];
      const [r0, c0] = board.rc(at);
      const [r1, c1] = board.rc(to);
      const dr = Math.sign(r1 - r0);
      const dc = Math.sign(c1 - c0);
      const straight = dr === 0 ? dc !== 0 : dc === 0;
      const dist = Math.abs(r1 - r0) + Math.abs(c1 - c0);
      if (!straight) {
        errs.push(`球 ${start} 第 ${s + 1} 动不是直线（R2）`);
        broken = true;
        break;
      }
      if (dist !== want) {
        errs.push(`球 ${start} 第 ${s + 1} 动走 ${dist} 格，球里的数字到这一动是 ${want}（R2）`);
        broken = true;
        break;
      }
      for (let t = 1; t <= dist; t++) {
        const rr = r0 + dr * t;
        const cc = c0 + dc * t;
        if (!board.inb(rr, cc)) {
          errs.push(`球 ${start} 第 ${s + 1} 动第 ${t} 格出界（R4 OB）`);
          broken = true;
          break;
        }
        const cell = board.idx(rr, cc);
        if (usedCell.has(cell) || mine.includes(cell)) errs.push(`格 ${cell} 被两条线（或同一条线两次）经过（R3 每格最多一条线）`);
        if (board.balls.has(cell) && cell !== start) errs.push(`线穿过别的球 ${cell}（R3）`);
        if (board.holes.has(cell) && !(t === dist)) errs.push(`线穿过 H ${cell}（R3：停在它上面才算，穿过不行）`);
        if (t === dist && board.ponds.has(cell)) errs.push(`球 ${start} 第 ${s + 1} 动停在池上 ${cell}（R4）`);
        mine.push(cell);
      }
      if (broken) break;
      at = to;
    }
    if (!broken) {
      const last = stops[stops.length - 1];
      if (!board.holes.has(last)) errs.push(`球 ${start} 没进洞（收尾 ${last} 不是 H，R1）`);
      else if (holeTaken.has(last)) errs.push(`H ${last} 落了两球（R1 一一对应）：${holeTaken.get(last)} 与 ${start}`);
      else holeTaken.set(last, start);
      // R2「停在 H 上的球不再动」：中间某动就落在 H 上却继续动 = 违规
      for (let s = 0; s < stops.length - 1; s++) {
        if (board.holes.has(stops[s])) errs.push(`球 ${start} 第 ${s + 1} 动停在 H ${stops[s]} 却又继续动（R2）`);
      }
      for (const c of mine) usedCell.add(c);
    }
  }

  for (const b of ballCells) if (!seenBall.has(b)) errs.push(`球 ${b} 没有路线（R1）`);
  for (const hcell of holeCells) if (!holeTaken.has(hcell)) errs.push(`H ${hcell} 没被填（R1）`);
  return errs;
}

// 「两份答案是不是同一个」的口径：逐球比落点序列，球与球之间无序。
// 三条真值证人、golden、balance 都用它 —— 口径只写一遍，两边才不会各比各的。
export function answerKey(answer) {
  return answer
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((s) => `${s.start}>${s.stops.join('-')}`)
    .join(' ; ');
}

export function sameAnswer(a, b) {
  return answerKey(a) === answerKey(b);
}
