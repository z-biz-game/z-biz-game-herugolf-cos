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
// 本文件被**直接执行**时把那三条真值证人原样打出来（`node tools/scenarios.js`）：
// 夹具改了要能一眼看到"官方盘还是不是那三条都对"，而不是等某个套件的日志里翻。
import { Board, parseBoard } from '../js/engine/grid.js';
import { routesFor } from '../js/engine/routes.js';
import { verify, sameAnswer, answerKey } from '../js/engine/verify.js';
import { countSolutions, answerOf } from '../js/engine/counter.js';
import { solve } from '../js/engine/pencil.js';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

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

// 夹具题面：给一段**扁平串**（每格一个字符）与列数，行自动切。
// 字符 = '.' 空格 / 'H' 球洞 / 'P' 池 / '1'..'9' 球（数字就是球里的数）。
// 为什么扁平：手排 '/' 会把格数切错（切错之后证人指的就是隔壁那一格），列数只有这一个来源。
export function fx(name, flat, cols, note = '') {
  const text = flat.replace(/[/\s\n]/g, '');
  if (text.length % cols !== 0) throw new Error(`夹具 ${name}：${text.length} 格切不成 ${cols} 列`);
  const lines = [];
  for (let i = 0; i < text.length; i += cols) lines.push(text.slice(i, i + cols));
  const board = parseBoard(cols, lines.length, text);
  board.note = note;
  board.label = name;
  return board;
}

// 变异：把官方解答里的某一颗球的落点序列换成**另一份**答案，其它球原样带走。
// 这是"证人必须会红"的那一半 —— 只验"合法答案被接受"的证人等于没验。
//
// ⚠ 两条本轮实测出来的口径，写在这里防的是"下一轮把名字当成承诺"：
//   ① 官方 5×5 太紧（球 0 只有 1 条候选、球 19 只有 1 条、球 16 只有 2 条），
//      所以**改一条线几乎必然同时违反两条规则**（改走了就得离开自己那个 H ⇒ R1 一起报）。
//      每个名字后面标的是这一轮 verify() 实际报出来的规则集合，不是"它只想违反那一条"。
//      单规则归因由 tests/ 里的专用夹具承担（r4stop = 只报 R4、r1empty = 只报 R1），
//      官方盘上那些"改一条线必然连带撞第二条规则"的变异，期望写成**实测出来的那一个集合**
//      （tests/hole-two-balls.test.mjs：必含声称的那几条、且不许多出别的一条）。
//   ② 上一版这里有过 6 个"手敲坐标"的变异，实测全是"第 1 动不是直线（R2）"——
//      几何写歪的变异测不到它声称的那条规则，只会让闸红得莫名其妙。现在每一条的落点序列
//      都由 OFFICIAL.at(r,c) 现算，并且长度序列与该球的 k 一致（k, k-1, …），
//      违规点只落在声称的那一处。
export function mutateOfficial(what) {
  const ans = officialAnswer();
  const a = ans.map((s) => ({ start: s.start, stops: s.stops.slice() }));
  switch (what) {
    case 'cross':
      // 球 19（数字 2）改走 (4,5)→(4,3)→(3,3)：第一动途经 (4,4)，那里正压着球 0 那条竖线。
      // 实测报 R3（交叉）+ R1（它没进洞、H 8 空着）
      a[2].stops = [OFFICIAL.at(4, 3), OFFICIAL.at(3, 3)];
      break;
    case 'overlap':
      // 球 16（数字 2）改走 (4,2)→(4,4)→(3,4)：(4,4) 与 (3,4) 两格都是球 0 的线（重叠一段 = 两格）
      // 实测报 R3（每格最多一条线）+ R1（H 13 落了两球）
      a[1].stops = [OFFICIAL.at(4, 4), OFFICIAL.at(3, 4)];
      break;
    case 'selfcross':
      // 球 0（数字 4）第三动沿自己的线退回 (5,2)：那一格正被它自己第一、二动走过
      // 实测报 R3（同一条线两次经过）+ R1（没进洞、H 13 空着）
      a[0].stops = [OFFICIAL.at(5, 1), OFFICIAL.at(5, 4), OFFICIAL.at(5, 2)];
      break;
    case 'hole-steal':
      // 与 overlap 同一条走法，但只盯 R1 那一半：H (3,4) 被球 0 与球 16 双双落下
      // 实测报 R1（落了两球）+ R3
      a[1].stops = [OFFICIAL.at(4, 4), OFFICIAL.at(3, 4)];
      break;
    case 'pond-stop':
      // 球 0 第一动沿第一行向右 4 格，正好**停在**池 (1,5) 上（R4：池可穿不可停）
      // 实测报 R4（停在池上）+ R3（第二动穿过球 19）+ R1
      a[0].stops = [OFFICIAL.at(1, 5), OFFICIAL.at(4, 5)];
      break;
    case 'ob':
      // 球 16 第一动向下 2 格出界（终点写成 (6,2)：长度序列对，但最后一格在盘外）
      // 实测报 R4 OB（第 2 格出界）+ R3（格 21 与球 0 那条横线撞）+ R1（H 6 空着）
      a[1].stops = [OFFICIAL.at(6, 2)];
      break;
    case 'wrong-length':
      // 球 0 第二动走 4 格（该这一动时数字只剩 3）：R2 的长度序列断了
      // 实测报 R2 + R1
      a[0].stops = [OFFICIAL.at(5, 1), OFFICIAL.at(5, 5), OFFICIAL.at(3, 4)];
      break;
    case 'stop-on-hole-continue':
      // 球 0 第三动停在 H (3,4) 上却又动了第四动到 H (2,4)（R2：停在 H 的球不再动）
      // 实测报 R2 + R3（格 8 与球 19 那条线撞）+ R1（H 8 被两球落、H 13 空着）
      a[0].stops = [OFFICIAL.at(5, 1), OFFICIAL.at(5, 4), OFFICIAL.at(3, 4), OFFICIAL.at(2, 4)];
      break;
    case 'empty-hole':
      // 球 19 第二动从 (2,5) 往**下**回到 (3,5)：长度序列 2,1 对、直线对、收尾不是 H。
      // 但 (3,5)=格 14 正是它自己第一动途经的那格 ⇒ 实测报 R1 + R3（自交），不是干净单规则。
      // ⚠ 「收尾不是 H」在官方 5×5 上做不出单规则形状（本轮把球 19 的每一条盘内走法都量过，
      //   不是推出来的）：球 19（数字 2，(4,5)）的 2,1 走法在盘内只有 7 条方向序列 ——
      //     1 条是官方解（落 H 8）、1 条停在池 (1,5)（R4）、5 条撞上别的线（R3：自交格 14/18、
      //     球 0 的线格 18/22、穿球 16）。**一条都没有「只违反 R1」的**。
      //   官方盘 球 0 与球 16 的线把整个盘面钉死了，改走就得离开自己那个 H ⇒ R1 与 R3/R4 一起报。
      //   （上面这三行读数不是承诺：现在每次跑都由 tests/hole-two-balls.test.mjs 重新量一遍，
      //   那颗球的全部盘内走法逐条问 verify，"只违反 R1"的一条都没有 —— 有了那条断言就会红。）
      //   干净 R1-only 的"空 H"由 TEST_BOARDS.r1empty 现场证（tests/hole-two-balls.test.mjs 的那一条严格断言）。
      a[2].stops = [OFFICIAL.at(2, 5), OFFICIAL.at(3, 5)];
      break;
    case 'no-move':
      // 球 16 一动没动（R1：每球至少动一次）——实测只报 R1，是最干净的一条
      a[1].stops = [];
      break;
    default:
      throw new Error(`未知变异 ${what}`);
  }
  return a;
}

// 全部变异名（tests 拿它做"漏一条就红"的对照）。官方 5×5 上做不出干净单规则形状的两条
// —— "穿过 H 再落地"和"从池上穿过" —— 不在这里，改由 TEST_BOARDS.r3self / r3legal 现场证。
export const OFFICIAL_MUTATIONS = [
  'cross', 'overlap', 'selfcross', 'hole-steal', 'pond-stop', 'ob',
  'wrong-length', 'stop-on-hole-continue', 'empty-hole', 'no-move',
];
// 每个变异**实测**必须出现的规则标签（本轮跑出来的，见函数注释）
export const OFFICIAL_MUTATION_TAGS = {
  cross: /R3/,
  overlap: /R3/,
  selfcross: /R3/,
  'hole-steal': /R1/,
  'pond-stop': /R4/,
  ob: /R4/,
  'wrong-length': /R2/,
  'stop-on-hole-continue': /R2/,
  'empty-hole': /R1/,
  'no-move': /R1/,
};

// routesFor 的表自证：某个球在某盘上的候选数（rule-test 拿它对"模型不比出版物严格"这句）
export function candidateCounts(board) {
  return board.cellList().map((c) => routesFor(board, c).length);
}

// ── 坐标式造盘（1-based，和 OFFICIAL 同一套记法）───────────────────────────
// 手摆夹具一律走这里，不走"手敲扁平串"：上一轮把官方解的格号手敲错过一次，
// 证人当场变成假案。坐标是唯一不必被数对的形状。
export function boardFrom(w, h, { balls = [], holes = [], ponds = [] } = {}, note = '') {
  const b = new Board(w, h);
  const at = (r, c) => (r - 1) * w + (c - 1);
  for (const [r, c, k] of balls) b.balls.set(at(r, c), k);
  for (const [r, c] of holes) b.holes.add(at(r, c));
  for (const [r, c] of ponds) b.ponds.add(at(r, c));
  b.note = note;
  return b;
}

// 夹具的变异：摘掉线索（极小性审计与 rule-test 的 near-miss 都走这条路，不重排题面）。
// 参数是成对的 ('hole', 9) 或 ('ball', 20, 'hole', 23) —— 摘球会留下无主的洞，
// 那种盘永远是 0 解，证人就没意义了，所以成对摘。
export function dropClue(board, ...pairs) {
  if (pairs.length % 2 !== 0) throw new Error('dropClue：参数必须成对 (kind, cell)');
  const b = board.clone();
  const tags = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const kind = pairs[i];
    const cell = pairs[i + 1];
    if (kind === 'ball') b.balls.delete(cell);
    else if (kind === 'hole') b.holes.delete(cell);
    else if (kind === 'pond') b.ponds.delete(cell);
    else throw new Error(`dropClue：不认识的种类 ${kind}`);
    tags.push(`${kind === 'ball' ? '球' : kind === 'hole' ? '洞' : '池'} ${cell}`);
  }
  b.note = `${board.note || ''}（摘掉 ${tags.join('、')}）`;
  return b;
}

// ── 规则夹具：四张盘 + 一张"整张表都闷"的对照 ──────────────────────────────
// 每张盘的扁平串都是 serializeBoard() 打出来的**机器输出**（不是手排的），rule-test 里
// 第一道断言就是 serializeBoard(fx(...)) === 这一份串：抄错一格 ⇒ 当场红，不会变成假证人。
//   A 候选 1/1：单走法 / 一球一洞 / 洞唯一来客 三条同时开口（同一事实的三个侧面），
//     但只有单走法把**途经格**也写下来 ⇒ 归因靠"结论的形状"分，不靠"谁先开口" 
//   B 候选 2/3：只有必经格有活干
//   C 候选 2/3/3/2：只有洞唯一来客有活干
//   D 候选 2/2/3/3：只有两球两洞有活干
// "本规则 fire、其余三条 silent"是**量出来的**（rule-test 逐条核对下表 silentOn）。
export const RULE_BOARDS = {
  A: { cols: 5, flat: '.........H.......3...2..H', note: '两球各只剩 1 条候选（1/1）⇒ 线整个定了：球 17（数字 3）走 12-7-2 再 3-4 落 H 9；球 21 走 22-23 再 24 落 H 24' },
  B: { cols: 5, flat: '.H..PH.............3...3.', note: '球 19 还有 2 条候选，两条都必须经过格 18（左上角被池 4 与洞 1/5 挤死）⇒ 格 18 归它' },
  C: { cols: 5, flat: '.H..2...H...2...2..H3..H.', note: '四球四洞，H 8 只有球 20（数字 3）还够得着 ⇒ 它必须落那里' },
  D: { cols: 6, flat: 'H..H....2..2....3.3.......H..H......', note: '球 8 与球 11 合起来只够得着 H 0 与 H 3 ⇒ 这两个洞被它们包场，球 18 落到这两个洞的那条候选全删' },
};

// ── 五条规则的逐条期望（fire 盘 / 该盘上必须闭嘴的另几张盘 / 出口）────────────
export const RULE_FIXTURES = {
  单走法: {
    board: 'A',
    expect: { fired: 2, touched: 2, holes: [[17, 9], [21, 24]], cells: 11, prunes: 0 },
    silentOn: ['B', 'D'],
    contra: { drop: ['hole', 9], why: '摘掉 H 9 ⇒ 球 17 候选被杀空，"候选被杀空"这句话只有单走法有资格说' },
  },
  必经格: {
    board: 'B',
    expect: { fired: 7, touched: 5, holes: [], cells: 5, prunes: 1, firstCell: [19, 18] },
    silentOn: ['A', 'C', 'D'],
    pruneOnly: { drop: ['hole', 1], note: '必经格自己不报"候选被杀空/没人够得着"：0 解盘上矛盾出口必须归别人' },
  },
  洞唯一来客: {
    board: 'C',
    expect: { fired: 1, touched: 1, holes: [[20, 8]], cells: 0, prunes: 0 },
    silentOn: ['B', 'D'],
    contra: { drop: ['ball', 20, 'hole', 23], why: '摘掉球 20 与洞 23 ⇒ H 8 没了客人，洞这一侧的空场只能由它报' },
  },
  一球一洞: {
    board: 'A',
    expect: { fired: 2, touched: 2, holes: [[17, 9], [21, 24]], cells: 0, prunes: 0 },
    silentOn: ['B', 'C', 'D'],
    contra: { drop: ['hole', 9], why: '球 17 再没有够得着的 H ⇒ 一球一洞必须指名（与单走法同一个根因，两条都开口是允许的）' },
  },
  两球两洞: {
    board: 'D',
    expect: { fired: 2, touched: 1, holes: [], cells: 0, prunes: 1 },
    silentOn: ['A', 'B', 'C'],
    pruneOnly: { drop: ['hole', 0], note: '两球两洞只有删值出口 ⇒ 0 解盘上不许它抢矛盾那一句' },
  },
};

// 整张表都闷、而题面仍然多解 = "必须猜"的形状（铅笔不完备的证人，也是出货闸存在的理由）
export const TABLE_STALL = {
  board: 'B',
  drop: ['pond', 4],
  note: '摘掉 B 盘那滴池：球 19 多出第三条走法，五条规则一圈无话，而题面变成 3 解 ⇒ 闷不是错，是线索不够',
};

// ── R1/R3/R4 的手摆夹具（tests/*.test.mjs 用：变异必被拒 + 合法对照必被接受）──
// 这三张全部用坐标现算（1-based），一格都不靠手敲下标。
export const TEST_BOARDS = {
  // 两条线在同一个格上"停靠"：都抢 H (3,3)，于是 R3（一格两线）与 R1（一洞两球）同时破
  r3cross: () =>
    boardFrom(5, 5, { balls: [[3, 1, 2], [1, 3, 2]], holes: [[3, 3], [5, 5]] }, '两球唯一候选都落 (3,3)，H (5,5) 没人够得着'),
  r3crossAnswer: (b) => [
    { start: b.idx(2, 0), stops: [b.idx(2, 2)] },
    { start: b.idx(0, 2), stops: [b.idx(2, 2)] },
  ],
  // 同一条线自交/重叠：球 (2,2) 数字 3 ⇒ 右 3 到 (2,5) 再左 2 原路退回 (2,3)
  r3self: () => boardFrom(5, 5, { balls: [[2, 2, 3]], holes: [[2, 3]] }, '唯一收口方式是自己走回去（R3 不许）'),
  r3selfAnswer: (b) => [{ start: b.idx(1, 1), stops: [b.idx(1, 4), b.idx(1, 2)] }],
  // 合法对照：同样一盘里，绕开自交/绕开停在池上，就不许报错（证人必须会绿，不然红没有意义）
  r3legal: () => boardFrom(5, 5, { balls: [[4, 1, 4]], holes: [[1, 5]], ponds: [[4, 2]] }, '右 4（穿过池 (4,2)）再上 3 落 H (1,5)'),
  r3legalAnswer: (b) => [{ start: b.idx(3, 0), stops: [b.idx(3, 4), b.idx(0, 4)] }],
  // R4：停在池上（拒）—— 同一盘里"穿过池"由 r3legal 作证
  r4stop: () => boardFrom(5, 5, { balls: [[4, 1, 3]], holes: [[1, 3]], ponds: [[1, 1]] }, '上 3 正好停在池 (1,1) 上 ⇒ R4 拒'),
  r4stopAnswer: (b) => [{ start: b.idx(3, 0), stops: [b.idx(0, 0), b.idx(0, 2)] }],
  // R1：一个洞落两球 + 另一个洞空着（这盘本身是唯一的，改坏才报错）
  holeTwo: () => boardFrom(5, 5, { balls: [[3, 1, 2], [1, 3, 2]], holes: [[3, 3], [1, 5]] }, '唯一解：球 (3,1)→(3,3)、球 (1,3)→(1,5)'),
  holeTwoAnswer: (b) => [
    { start: b.idx(2, 0), stops: [b.idx(2, 2)] },
    { start: b.idx(0, 2), stops: [b.idx(0, 4)] },
  ],
  holeTwoMutated: (b) => [
    { start: b.idx(2, 0), stops: [b.idx(2, 2)] },
    { start: b.idx(0, 2), stops: [b.idx(2, 2)] },
  ],
  // R1 的"干净归因"靶子：一颗球走完 2,1 两动、收尾不是 H —— 全程不碰别的线（盘上只有一颗球）、
  // 不碰池、不出界、长度序列对 ⇒ verify 报出来的**必须全是 R1**，多出一条别的就说明归因漂了。
  // 这一条在官方 5×5 上做不出来（见 mutateOfficial 的 'empty-hole'：那颗球的全部盘内走法
  // 被 tests/hole-two-balls.test.mjs 逐条问过 verify，一条"只违反 R1"的都没有），
  // 所以它住在这里，由 tests/hole-two-balls.test.mjs 严格断言 every(/R1/)。
  r1empty: () =>
    boardFrom(4, 4, { balls: [[1, 1, 2]], holes: [[1, 3]] }, '唯一解：球 (1,1) 右 2 落 H (1,3)；变异那份 下2 右1 谁都没碰，只是没进洞'),
  r1emptyAnswer: (b) => [{ start: b.idx(0, 0), stops: [b.idx(0, 2)] }],
  r1emptyMutated: (b) => [{ start: b.idx(0, 0), stops: [b.idx(2, 0), b.idx(2, 1)] }],
};

// ── 三条真值证人（`node tools/scenarios.js` 的证人输出）───────────────────────
// 三条各走各的实现：verify 从题面文字从头再走一遍（不 import routesFor）、
// 计数器只穷举（不做任何推理）、铅笔只删值（不试任何一种走法）。
// 三条的出口必须是**同一份**官方解 ⇒ 哪一条漂了都当场红，而不是"三个数各自都还好看"。
// ⚠ 打印里的每一个格号都来自 OFFICIAL.at(...) / board.idx(...) / 现算的落点序列，
//   一个下标都不许手抄（这一条教训的原文见文件头）。
export function runWitnesses(print = console.log) {
  let checks = 0;
  const fails = [];
  const ok = (cond, msg) => {
    checks++;
    if (!cond) fails.push(msg);
    return !!cond;
  };
  const b = officialBoard();
  const off = officialAnswer();

  // ① 官方解答过独立复核
  const e1 = verify(b, off);
  ok(e1.length === 0, `证人①红：verify(官方 5×5, 官方解答) 应当 0 错，实为 ${JSON.stringify(e1)}`);
  ok(verify(b, mutateOfficial('no-move')).length > 0, '证人①红：verify 对明显的坏答案保持了沉默（正例过了不等于闸在）');
  print(`  ① 独立复核 verify：官方 ${OFFICIAL.w}×${OFFICIAL.h} 的解答判 0 错；同一条闸对变异「no-move」判 ${verify(b, mutateOfficial('no-move')).length} 错 ⇒ 闸会红也会绿。解：${answerKey(off)}`);

  // ② 计数器数到恰好 1 解，且那一解逐球 = 官方解
  const c = countSolutions(b, { limit: 2 });
  ok(c.count === 1, `证人②红：独立计数器应当数到恰好 1 解，实为 ${c.count}`);
  ok(!c.stopped, `证人②红：计数器预算烧完（nodes=${c.nodes}）⇒ 唯一性没数完，1 解不算认证`);
  ok(!c.capped, `证人②红：计数器撞到 limit 就收了工（capped）⇒ "至少 1 解"不是"恰好 1 解"`);
  const perBall = (a) => new Map(a.slice().sort((x, y) => x.start - y.start).map((s) => [s.start, s.stops.join('-')]));
  const got = c.count >= 1 ? perBall(answerOf(c, 0)) : new Map();
  const want = perBall(off);
  const ballsNow = b.cellList();
  ok(got.size === want.size && ballsNow.every((cell) => got.get(cell) === want.get(cell)), `证人②红：计数器那一解与官方解逐球对不上：${JSON.stringify([...got])} vs ${JSON.stringify([...want])}`);
  ok(sameAnswer(c.count >= 1 ? answerOf(c, 0) : [], off), '证人②红：sameAnswer 与逐球对账给了不同的答复（口径分家了）');
  print(`  ② 独立穷举计数器：恰好 ${c.count} 解（nodes=${c.nodes}、stopped=${c.stopped}、capped=${c.capped}），逐球 = 官方解：${ballsNow.map((cell) => `${cell}>${got.get(cell)}`).join(' ; ')}`);

  // ③ 铅笔零猜测推完，且与官方解一致
  const p = solve(b);
  ok(p.solved === true, `证人③红：铅笔没推完（solved=${p.solved}，剩余候选 ${p.alive.join('/')}）`);
  ok(p.contradiction === null, `证人③红：官方盘上铅笔报了矛盾：${p.contradiction}`);
  ok(p.alive.every((n) => n === 1), `证人③红：每颗球都要被推到只剩 1 条候选，实为 ${p.alive.join('/')}`);
  ok(p.steps > 0, `证人③红：步数 0 的"推完"是空的（候选表本来就是 1？）`);
  ok(sameAnswer(p.sols, off), `证人③红：铅笔的解与官方解不一致：${answerKey(p.sols)}`);
  ok(verify(b, p.sols).length === 0, `证人③红：铅笔的解过不了独立复核：${JSON.stringify(verify(b, p.sols))}`);
  print(`  ③ 零猜测铅笔：${p.steps} 步推完（候选 ${p.cands.join('/')} → 每球剩 1，无一条是试出来的），与官方解一致：${answerKey(p.sols)}`);

  for (const f of fails) print('  ✗ ' + f);
  print(`RESULT scenarios ok=${fails.length === 0} checks=${checks} fails=${fails.length}`);
  return fails.length === 0 ? 0 : 1;
}

// 只有被**直接执行**时才开口作证：被 import 时它必须还是那份安静的手摆夹具。
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exit(runWitnesses());
}
