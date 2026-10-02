// 单 <canvas> 渲染。画布只吃 Game 的状态与 engine 的题面，自己不做任何规则判断。
//
// cellRect(i) 返回的是 **CSS 像素**、以 canvas 左上角为原点 —— 闸的 hit box 断言
// （getBoundingClientRect 中心 == document.elementFromPoint 命中的元素）要的就是这一份坐标，
// 所以它必须与 pointer→cell 用的是同一个换算，不许各写一份。
import { Palette } from '../theme.js';

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 32;
    this.w = 0;
    this.h = 0;
    this.game = null;
    this.flags = { showTargets: true };
  }
  // 布局：按容器宽度与视口高度取一个格边长，18x18 也要点得到（格太小会被 hit box 那条抓）
  layout(game) {
    this.game = game;
    const cols = game.board.w;
    const rows = game.board.h;
    const wrap = this.canvas.parentElement;
    // clientWidth 为 0 就是"容器还没可见"（display:none 的父级）—— 那一次读数不是这一盘的宽度，
    // 拿它算格边长会把整盘压成最小格。这里退回一个像样的缺省宽，而不是退回 0。
    const cw = wrap ? wrap.clientWidth : 0;
    const avail = Math.max(180, (cw > 0 ? cw : 480) - 8);
    const vh = typeof innerHeight === 'number' ? innerHeight : 800;
    const availH = Math.max(180, vh - 210);
    const size = Math.max(20, Math.min(48, Math.floor(Math.min(avail / cols, availH / rows))));
    this.size = size;
    this.w = cols * size;
    this.h = rows * size;
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
    return { size, cols, rows, dpr };
  }
  cellRect(i) {
    const [r, c] = this.game.board.rc(i);
    return { x: c * this.size, y: r * this.size, size: this.size };
  }
  cellCenter(i) {
    const q = this.cellRect(i);
    return { x: q.x + q.size / 2, y: q.y + q.size / 2 };
  }
  // 指针 → 格：与 cellRect 互逆，同一份 size
  cellAt(px, py) {
    const box = this.canvas.getBoundingClientRect();
    const x = px - box.left;
    const y = py - box.top;
    const c = Math.floor(x / this.size);
    const r = Math.floor(y / this.size);
    return this.game.board.inb(r, c) ? this.game.board.idx(r, c) : -1;
  }
  draw() {
    const g = this.game;
    if (!g) return;
    const ctx = this.ctx;
    const s = this.size;
    const b = g.board;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = Palette.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    for (let i = 0; i < b.n; i++) {
      const q = this.cellRect(i);
      ctx.fillStyle = b.ponds.has(i) ? Palette.pond : Palette.cell;
      ctx.fillRect(q.x, q.y, s, s);
    }
    // 网格线：题面里的"外框 + 细线"，没有粗线、没有区块（那两样不属于 Herugolf）
    ctx.strokeStyle = Palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= b.w; c++) {
      ctx.moveTo(c * s + 0.5, 0);
      ctx.lineTo(c * s + 0.5, b.h * s);
    }
    for (let r = 0; r <= b.h; r++) {
      ctx.moveTo(0, r * s + 0.5);
      ctx.lineTo(b.w * s, r * s + 0.5);
    }
    ctx.stroke();

    this.drawLines(g);
    this.drawTargets(g);
    this.drawClues(g);
    if (g.status === 'won') this.drawWon(g);
  }
  drawLines(g) {
    const ctx = this.ctx;
    const s = this.size;
    for (const [ball, stops] of g.lines) {
      const pts = [ball, ...stops].map((i) => this.cellCenter(i));
      const done = g.inHole(ball);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = done ? Palette.done : ball === g.selected ? Palette.selected : Palette.route;
      ctx.lineWidth = Math.max(4, s * 0.2);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      // 每一动的落点打一个小圆钉 + 那是第几动，玩家才数得清"还剩几格"
      stops.forEach((cell, k) => {
        const c = this.cellCenter(cell);
        ctx.fillStyle = Palette.ball;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = Palette.ballText;
        ctx.font = `600 ${Math.round(s * 0.26)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(k + 1), c.x, c.y + 0.5);
      });
    }
  }
  drawTargets(g) {
    if (!this.flags.showTargets || g.status !== 'playing') return;
    const ctx = this.ctx;
    const s = this.size;
    for (const cell of g.legalTargets()) {
      const c = this.cellCenter(cell);
      ctx.strokeStyle = Palette.target;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, s * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = Palette.target;
      ctx.font = `600 ${Math.round(s * 0.24)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(g.needOf(g.selected)), c.x, c.y);
    }
  }
  drawClues(g) {
    const ctx = this.ctx;
    const s = this.size;
    const b = g.board;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const cell of b.holes) {
      const c = this.cellCenter(cell);
      ctx.fillStyle = Palette.hole;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = Palette.holeRing;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(s * 0.42)}px system-ui, sans-serif`;
      ctx.fillText('H', c.x, c.y + 1);
    }
    for (const [cell, k] of b.balls) {
      const c = this.cellCenter(cell);
      if (cell === g.selected) {
        ctx.strokeStyle = Palette.selected;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s * 0.44, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = Palette.ball;
      ctx.beginPath();
      ctx.arc(c.x, c.y, s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = Palette.ballEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = Palette.ballText;
      ctx.font = `700 ${Math.round(s * 0.42)}px ui-monospace, monospace`;
      ctx.fillText(String(k), c.x, c.y + 1);
      if (g.lines.has(cell) && !g.inHole(cell)) {
        ctx.fillStyle = Palette.selected;
        ctx.font = `600 ${Math.round(s * 0.24)}px ui-monospace, monospace`;
        ctx.fillText(`→${g.needOf(cell)}`, c.x, c.y + s * 0.52);
      }
    }
    for (const cell of b.ponds) {
      const q = this.cellRect(cell);
      ctx.strokeStyle = Palette.pondEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let t = -s; t < s; t += 7) {
        ctx.moveTo(q.x + t, q.y);
        ctx.lineTo(q.x + t + s, q.y + s);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(q.x, q.y, q.size, q.size);
      ctx.clip();
      ctx.stroke();
      ctx.restore();
    }
  }
  drawWon(g) {
    const ctx = this.ctx;
    ctx.strokeStyle = Palette.done;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, this.w - 3, this.h - 3);
  }
}
