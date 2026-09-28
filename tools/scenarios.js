// 手摆夹具（全仓唯一的一份题面夹具）。
//
// ⚠ 这一轮的教训要带走，所以写死在这里：夹具里的格号**一律用 OFFICIAL.at(r,c) 现算**，
//   任何下标都不许手抄。上一轮把官方解的 [2,5] 手敲成 18（应是 9），当场被报成
//   "模型与官方解不一致" —— 手抄下标的证人会自己制造假案。
//
// 官方 5×5 例题与解答来源：Nikoli 官方页 herugolf01/03.gif
//   https://www.nikoli.co.jp/ja/puzzles/herugolf/ （规则正文同页，见 js/engine/routes.js 文件头）
// 模型必须①认它的解答合法、②在候选表里给那一解留位置、③数出唯一解 —— 三条证人
// 分别住在 tools/rule-test.mjs / tools/counter-test.mjs / tools/pencil-test.mjs。
import { Board, parseBoard } from '../js/engine/grid.js';
import { routesFor } from '../js/engine/routes.js';

// 1-based (r,c) → 0-based 格号
export const OFFICIAL = {
  w: 5,
  h: 5,
  at: (r, c) => (r - 1) * 5 + (c - 1),
  balls: [
    [1, 1, 4],
    [4, 2, 2],
    [4, 5, 2],
  ],
  holes: [
    [2, 2],
    [2, 4],
    [3, 4],
  ],
  ponds: [
    [1, 4],
    [1, 5],
  ],
  solution: [
    { start: [1, 1], stops: [[5, 1], [5, 4], [3, 4]] },
    { start: [4, 2], stops: [[2, 2]] },
    { start: [4, 5], stops: [[2, 5], [2, 4]] },
  ],
};

export function officialBoard() {
  const b = new Board(OFFICIAL.w, OFFICIAL.h);
  for (const [r, c, k] of OFFICIAL.balls) b.balls.set(OFFICIAL.at(r, c), k);
  for (const [r, c] of OFFICIAL.holes) b.holes.add(OFFICIAL.at(r, c));
  for (const [r, c] of OFFICIAL.ponds) b.ponds.add(OFFICIAL.at(r, c));
  return b;
}

// 现算，不抄下标
export function officialAnswer() {
  return OFFICIAL.solution.map((s) => ({
    start: OFFICIAL.at(...s.start),
    stops: s.stops.map(([r, c]) => OFFICIAL.at(r, c)),
  }));
}

export function fx(name, text, note) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ''))
    .filter((l) => l.length);
  const w = lines[0].length;
  for (const l of lines) {
    if (l.length !== w) throw new Error(`夹具 ${name}：行不等宽（${lines.join('/')}）`);
  }
  const board = parseBoard(w, lines.length, lines.join(''));
  board.note = note;
  return board;
}

// 变异：把官方解答里的某一颗球的某一动改掉，其它原样带走。
// 这是"证人必须会红"的那一半 —— 只验"合法答案被接受"的证人等于没验。
export function mutateOfficial(what) {
  const ans = officialAnswer();
  const a = ans.map((s) => ({ start: s.start, stops: s.stops.slice() }));
  switch (what) {
    case 'cross':
      // 球 16（数字 2）本来 16→7 一进洞。改成绕到 22→12：横线压在球 19 那条竖线上（R3 交叉）
      a[1].stops = [OFFICIAL.at(5, 2), OFFICIAL.at(3, 2)];
      break;
    case 'overlap':
      // 球 19 的线改成与球 0 完全重叠的一段（R3 每格最多一条线）
      a[2].stops = [OFFICIAL.at(3, 5), OFFICIAL.at(3, 4)];
      break;
    case 'selfcross':
      // 球 0（数字 4）：4 右 → 3 左 原路退回（同一条线两次经过同一格）
      a[0].stops = [OFFICIAL.at(1, 5), OFFICIAL.at(1, 1), OFFICIAL.at(4, 1)];
      break;
    case 'pond-stop':
      // 球 16 停在池上（R4：池可以穿，不许停）
      a[1].stops = [OFFICIAL.at(1, 4)];
      break;
    case 'pond-pass':
      // 反例的证人：池**穿过**是合法的 ⇒ 这一条 verify 必须说无错
      a[1].stops = [OFFICIAL.at(2, 3), OFFICIAL.at(1, 3)];
      break;
    case 'two-balls-one-hole':
      // 球 19 改落 7（H (2,2)）：那个洞已经有球 16 落 ⇒ R1 一一对应破
      a[2].stops = [OFFICIAL.at(2, 3), OFFICIAL.at(2, 2)];
      break;
    case 'empty-hole':
      // 球 0 改落 9（不是 H）：收尾没进洞 + 洞 14 空着
      a[0].stops = [OFFICIAL.at(5, 3), OFFICIAL.at(3, 3), OFFICIAL.at(2, 5)];
      break;
    case 'wrong-length':
      // 球 0 第二动走 4 格（数字只剩 3 ⇒ R2）
      a[0].stops = [OFFICIAL.at(5, 1), OFFICIAL.at(5, 5), OFFICIAL.at(3, 4)];
      break;
    case 'through-hole':
      // 球 0 第一动穿过 H 9 再停在 10（R3 不许穿过 H）
      a[0].stops = [OFFICIAL.at(1, 5), OFFICIAL.at(4, 5), OFFICIAL.at(4, 2)];
      break;
    case 'ob':
      // 球 16 一动走 2 格出界（R4 OB）
      a[1].stops = [OFFICIAL.at(1, 2)];
      break;
    case 'stop-on-hole-continue':
      // 球 0 第一动就停在 H 20 上却又继续动（R2 停在 H 的球不再动）
      a[0].stops = [OFFICIAL.at(2, 2), OFFICIAL.at(4, 2), OFFICIAL.at(4, 5)];
      break;
    case 'no-move':
      a[1].stops = [];
      break;
    default:
      throw new Error(`未知变异 ${what}`);
  }
  return a;
}

// routesFor 的表自证：某个球在某盘上的候选数（rule-test 拿它对"模型不比出版物严格"这句）
export function candidateCounts(board) {
  return board.cellList().map((c) => routesFor(board, c).length);
}
