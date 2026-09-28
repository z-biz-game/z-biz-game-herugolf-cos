// 盘面模型 Board(w,h) + 题面序列化。
//
// 规则出处（写进注释时必须照抄来源，四条正文见 js/engine/routes.js 文件头）：
//   Nikoli 官方页 https://www.nikoli.co.jp/ja/puzzles/herugolf/ （EN 站同名）、
//   https://www.janko.at/Raetsel/Herugolf/index.htm 、LIPIcs FUN 2018 论文。
// 题面给的只有：盘面外框 + 球(带数字) + H + 池。内部没有粗线、区块不用求解。
//
// 坐标系：cell = r*w + c（0-based，行优先）。方向表 DIRS 是全仓唯一的一份，
// routes.js / verify.js / counter.js / pencil.js 都从它取邻居，几何不许各写一份。
export const DIRS = [
  { dr: -1, dc: 0, name: '上' },
  { dr: 0, dc: 1, name: '右' },
  { dr: 1, dc: 0, name: '下' },
  { dr: 0, dc: -1, name: '左' },
];

export class Board {
  constructor(w, h, { balls = new Map(), holes = new Set(), ponds = new Set() } = {}) {
    this.w = w;
    this.h = h;
    this.balls = balls; // cell -> k（第一动的长度；R2 里数字逐动减 1）
    this.holes = holes; // Set<cell>（H，球洞）
    this.ponds = ponds; // Set<cell>（池/灰格：不许停在上面，可以穿过 —— R4）
  }
  get n() {
    return this.w * this.h;
  }
  idx(r, c) {
    return r * this.w + c;
  }
  rc(i) {
    return [Math.floor(i / this.w), i % this.w];
  }
  inb(r, c) {
    return r >= 0 && r < this.h && c >= 0 && c < this.w;
  }
  // 走一步；出界返回 -1（R4 的 OB 就是这里判的）
  step(i, d) {
    const [r, c] = this.rc(i);
    const { dr, dc } = DIRS[d];
    return this.inb(r + dr, c + dc) ? this.idx(r + dr, c + dc) : -1;
  }
  cellList() {
    return [...this.balls.keys()].sort((a, b) => a - b);
  }
  clone() {
    return new Board(this.w, this.h, {
      balls: new Map(this.balls),
      holes: new Set(this.holes),
      ponds: new Set(this.ponds),
    });
  }
  // 只换其中一类线索，别的原样带走 —— 极小性审计（单颗摘除）走的就是这条路
  withClues({ balls, holes, ponds }) {
    return new Board(this.w, this.h, {
      balls: balls ? new Map(balls) : new Map(this.balls),
      holes: holes ? new Set(holes) : new Set(this.holes),
      ponds: ponds ? new Set(ponds) : new Set(this.ponds),
    });
  }
}

// ---- 序列化：题面一格里一个字符，答案一串「起点:落点序列」 ------------------
// '.' 空格 · 'H' 球洞 · 'P' 池 · '1'..'9' 球（字符就是它自己的数字）
// 盘面上最多 9 的球（maxK ≤ 9，见 generate.js 的档位表），所以单字符够用；
// golden 与夹具都吃这个串，浏览器轮的对照物也吃它，所以它必须是个纯函数对。
export function serializeBoard(board) {
  const cells = [];
  for (let i = 0; i < board.n; i++) {
    if (board.balls.has(i)) cells.push(String(board.balls.get(i)));
    else if (board.holes.has(i)) cells.push('H');
    else if (board.ponds.has(i)) cells.push('P');
    else cells.push('.');
  }
  return cells.join('');
}

// 同一格上的两类线索 = 题面写坏了（球不许是 H、H 不许是池…），所以 parse 必须拒绝。
export function parseBoard(w, h, text) {
  if (text.length !== w * h) throw new Error(`parseBoard：串长 ${text.length} 与盘面 ${w}x${h} 不符`);
  const board = new Board(w, h);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '.') continue;
    if (ch === 'H') board.holes.add(i);
    else if (ch === 'P') board.ponds.add(i);
    else if (ch >= '1' && ch <= '9') board.balls.set(i, Number(ch));
    else throw new Error(`parseBoard：第 ${i} 格出现非法字符「${ch}」`);
  }
  return board;
}

// 答案 = [{start, stops:[cell,…]}]（stops 是每一动的落点，最后一个是 H）。
// 落点序列唯一决定整条线（相邻落点共线 ⇒ 途经格可推），所以这就是「玩家交上来的那一份」。
export function serializeAnswer(answer) {
  return answer
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((s) => `${s.start}:${s.stops.join('-')}`)
    .join(';');
}

export function parseAnswer(text) {
  if (!text) return [];
  return text.split(';').map((part) => {
    const [start, rest] = part.split(':');
    return { start: Number(start), stops: rest === '' ? [] : rest.split('-').map(Number) };
  });
}

// 逐格把题面画出来（打印用；出问题时"看一眼"比看数组快得多）
export function drawBoard(board) {
  const lines = [];
  for (let r = 0; r < board.h; r++) {
    const row = [];
    for (let c = 0; c < board.w; c++) {
      const i = board.idx(r, c);
      if (board.balls.has(i)) row.push(String(board.balls.get(i)));
      else if (board.holes.has(i)) row.push('H');
      else if (board.ponds.has(i)) row.push('#');
      else row.push('.');
    }
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}
