// Canvas 渲染层：只读 game 的状态画，不改它一个字段。
//
// 三条口径：
//   · 格子最小 44 CSS px（派工简报 §2 的命中区下限）。装不下就让画布比视口宽、外层滚动，
//     而不是把格子压到 28px 冒充"手机上能玩"—— 那是在手机上点 A 打 B。
//   · 贴图（web/img/*.png）没加载完也要能画：每个 sprite 都有矢量回落，资产是加分项不是依赖。
//   · reduceMotion 下粒子、涟漪、抖动、脉冲一个都不画；盘面退化成一张静图。
export const MIN_CELL = 44;
export const CELL_MAX = 108;

const INK = '#1d1a16';
const INK_SOFT = 'rgba(29,26,22,0.14)';
const PAPER_FLAT = '#f2ece0';
const GREEN = '#2f6b4f';
const WATER = 'rgba(111,147,165,0.42)';
const VERMILION = '#c2453a';

export function computeLayout(viewW, viewH, board, minCell = MIN_CELL) {
  const pad = Math.max(8, Math.min(24, viewW * 0.03));
  const availW = Math.max(64, viewW - pad * 2);
  const availH = Math.max(64, viewH - pad * 2);
  let cell = Math.floor(Math.min(availW / board.w, availH / board.h));
  cell = Math.max(minCell, Math.min(CELL_MAX, cell));
  const w = cell * board.w;
  const h = cell * board.h;
  return { cell, ox: Math.round(pad + Math.max(0, (availW - w) / 2)), oy: Math.round(pad + Math.max(0, (availH - h) / 2)), w, h, pad };
}

export function hitCell(layout, board, x, y) {
  const c = Math.floor((x - layout.ox) / layout.cell);
  const r = Math.floor((y - layout.oy) / layout.cell);
  if (!board.inb(r, c)) return -1;
  return board.idx(r, c);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.viewW = 0;
    this.viewH = 0;
    this.art = { paper: null, pond: null, ball: null, hole: null, particles: null };
    this.paperPattern = null;
    this.pondPattern = null;
  }

  setArt(images) {
    Object.assign(this.art, images);
    if (this.art.paper && this.ctx) this.paperPattern = this.ctx.createPattern(this.art.paper, 'repeat');
    if (this.art.pond && this.ctx) this.pondPattern = this.ctx.createPattern(this.art.pond, 'repeat');
  }

  resize(cssW, cssH, board) {
    const dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
    const layout = computeLayout(cssW, cssH, board);
    const w = Math.ceil(layout.w + layout.ox * 2);
    const h = Math.ceil(layout.h + layout.oy * 2);
    this.dpr = dpr;
    this.viewW = w;
    this.viewH = h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.layout = computeLayout(w, h, board);
    return this.layout;
  }

  center(cell) {
    const [r, c] = this.board.rc(cell);
    const L = this.layout;
    return [L.ox + (c + 0.5) * L.cell, L.oy + (r + 0.5) * L.cell];
  }

  draw(game) {
    const ctx = this.ctx;
    if (!ctx || !game.board) return;
    this.board = game.board;
    if (!this.layout || this.layout.cell == null) this.layout = computeLayout(this.viewW || 900, this.viewH || 700, game.board);
    const L = this.layout;
    const dpr = this.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW || 900, this.viewH || 700);

    // 和紙底
    ctx.fillStyle = this.paperPattern || PAPER_FLAT;
    ctx.fillRect(0, 0, this.viewW || 900, this.viewH || 700);

    const still = game.reduceMotion;
    if (!still && game.shake > 0.001) {
      const a = game.animClock * 42;
      ctx.translate(Math.sin(a) * game.shake * 5, Math.cos(a * 1.3) * game.shake * 4);
    }

    // 盘面
    ctx.save();
    ctx.globalAlpha = game.state === 'title' ? 0.55 : 1;
    ctx.fillStyle = 'rgba(255,253,247,0.55)';
    this._roundRect(L.ox - 4, L.oy - 4, L.w + 8, L.h + 8, 8);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    this._roundRect(L.ox - 4, L.oy - 4, L.w + 8, L.h + 8, 8);
    ctx.stroke();

    // 池（R4：可穿过、不许停）
    for (const cell of game.board.ponds) {
      const [r, c] = game.board.rc(cell);
      const x = L.ox + c * L.cell;
      const y = L.oy + r * L.cell;
      ctx.fillStyle = this.pondPattern || WATER;
      ctx.globalAlpha = this.pondPattern ? 0.55 : 1;
      ctx.fillRect(x + 1, y + 1, L.cell - 2, L.cell - 2);
      ctx.globalAlpha = game.state === 'title' ? 0.55 : 1;
    }

    // 细网（题面内部没有粗线，区块不用求解 —— 所以只给一层浅格）
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= game.board.w; i++) {
      ctx.moveTo(Math.round(L.ox + i * L.cell) + 0.5, L.oy);
      ctx.lineTo(Math.round(L.ox + i * L.cell) + 0.5, L.oy + L.h);
    }
    for (let j = 0; j <= game.board.h; j++) {
      ctx.moveTo(L.ox, Math.round(L.oy + j * L.cell) + 0.5);
      ctx.lineTo(L.ox + L.w, Math.round(L.oy + j * L.cell) + 0.5);
    }
    ctx.stroke();

    this._drawLines(game, L);
    this._drawHoles(game, L);
    this._drawBalls(game, L);
    if (!still) this._drawRipples(game, L);
    if (!still) this._drawParticles(game, L);
    ctx.restore();
    ctx.restore();
  }

  _drawLines(game, L) {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [ball, stops] of game.lines) {
      if (!stops.length) continue;
      const pts = [this.center(ball), ...stops.map((s) => this.center(s))];
      const done = stops.length === game.board.balls.get(ball);
      let cut = pts.length;
      if (!done && game.strokeAnimBall === ball && game.strokeAnim < 1) {
        const i = pts.length - 1;
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        pts[i] = [ax + (bx - ax) * game.strokeAnim, ay + (by - ay) * game.strokeAnim];
        cut = i + 1;
      }
      ctx.strokeStyle = done ? INK : 'rgba(29,26,22,0.62)';
      ctx.lineWidth = Math.max(3, L.cell * 0.11);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < Math.min(cut, pts.length); i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      // 每一动的落点
      ctx.fillStyle = done ? INK : 'rgba(29,26,22,0.6)';
      for (let i = 1; i < Math.min(cut, stops.length + 1); i++) {
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], Math.max(2, L.cell * 0.055), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawHoles(game, L) {
    const ctx = this.ctx;
    const holes = [...game.board.holes];
    const size = L.cell * 0.62;
    holes.forEach((cell, i) => {
      const [x, y] = this.center(cell);
      if (this.art.hole && this.art.hole.width) {
        ctx.drawImage(this.art.hole, x - size / 2, y - size / 2, size, size);
      } else {
        ctx.fillStyle = '#101613';
        ctx.beginPath();
        ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = Math.max(2, size * 0.09);
        ctx.stroke();
      }
      // 旗杆 + 朱旗（H 的读法：这一格是洞，而且是带旗的洞）
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, size * 0.06);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - size * 1.05);
      ctx.stroke();
      ctx.fillStyle = VERMILION;
      ctx.beginPath();
      ctx.moveTo(x, y - size * 1.05);
      ctx.lineTo(x + size * 0.52, y - size * 0.78);
      ctx.lineTo(x, y - size * 0.52);
      ctx.closePath();
      ctx.fill();
      const flash = game.holeFlash[i] || 0;
      if (flash > 0.01) {
        ctx.strokeStyle = 'rgba(47,107,79,' + (0.7 * flash).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, size * (0.5 + (1 - flash) * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  _drawBalls(game, L) {
    const ctx = this.ctx;
    const size = L.cell * 0.72;
    for (const [cell, k] of game.board.balls) {
      const [x, y] = this.center(cell);
      const stops = game.lines.get(cell) || [];
      const done = stops.length === k;
      const selected = game.selected === cell && !done;
      ctx.save();
      if (!done && selected && !game.reduceMotion) {
        const t = 0.5 + 0.5 * Math.sin(game.pulse);
        ctx.strokeStyle = 'rgba(194,69,58,' + (0.35 + 0.4 * t).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, size * (0.62 + 0.05 * t), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = done ? 0.55 : 1;
      if (this.art.ball && this.art.ball.width) {
        ctx.drawImage(this.art.ball, x - size / 2, y - size / 2, size, size);
      } else {
        ctx.fillStyle = '#fdf9f0';
        ctx.beginPath();
        ctx.arc(x, y, size * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(2, size * 0.06);
        ctx.stroke();
      }
      ctx.fillStyle = INK;
      ctx.font = '600 ' + Math.round(size * 0.5) + 'px ui-rounded, "Hiragino Maru Gothic ProN", "Yu Gothic", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(k), x, y + size * 0.02);
      ctx.restore();
    }
  }

  _drawRipples(game, L) {
    const ctx = this.ctx;
    for (const rp of game.ripples) {
      const x = L.ox + rp.x * L.cell;
      const y = L.oy + rp.y * L.cell;
      const t = rp.t / 0.7;
      ctx.strokeStyle = 'rgba(29,26,22,' + (0.32 * (1 - t)).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, L.cell * (0.15 + t * 0.55), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawParticles(game, L) {
    const ctx = this.ctx;
    const atlas = this.art.particles;
    for (let i = 0; i < game.pAlive; i++) {
      const life = game.pLife[i];
      if (life <= 0) continue;
      const x = L.ox + game.pX[i] * L.cell;
      const y = L.oy + game.pY[i] * L.cell;
      const s = Math.max(6, L.cell * 0.2);
      ctx.globalAlpha = Math.max(0, Math.min(1, life)) * 0.9;
      if (atlas && atlas.width) {
        const kind = game.pKind[i] & 3;
        const q = atlas.width / 2;
        ctx.drawImage(atlas, (kind % 2) * q, Math.floor(kind / 2) * q, q, q, x - s / 2, y - s / 2, s, s);
      } else {
        ctx.fillStyle = game.pKind[i] === 0 ? 'rgba(29,26,22,0.5)' : GREEN;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
