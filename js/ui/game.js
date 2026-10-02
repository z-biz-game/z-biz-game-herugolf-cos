// 界面侧的状态机：一颗球怎么"开出去一动"、哪些落点是合法落点、什么时候算赢。
//
// 三条写在这里的规矩，改之前先读：
//  * **界面不重算规则**。R1..R4 的正文住在 js/engine/（routes.js 文件头带出处）。这一层只做
//    点击几何 + 拒绝理由；"赢没赢"一律交给独立复核 verify()（它一个 routesFor 都不 import）。
//    于是"界面以为自己赢了"和"复核说没赢"是两个可以不相等的东西 —— 那正是 win 腿要量的。
//  * 落子**只拒绝、不留下非法状态**：违反 R2/R3/R4 的那一动根本进不了状态，所以存档里不可能
//    存出一个非法盘。续局读档走的是 tap() 重放（setCodes 不直接写状态），坏档因此只会
//    "重放不过"，不会把非法盘面塞进界面。
//  * seed 是小整数游标，不是日期（见 js/store.js）。同一 seed + 同一档必须同一张盘。
import { Board, DIRS, serializeBoard, parseBoard, serializeAnswer, parseAnswer } from '../engine/grid.js';
import { shipPuzzle, TIERS, parseTier } from '../engine/generate.js';
import { verify } from '../engine/verify.js';
import { freshState, runRule, RULE_ORDER, RULE_TEXT, RULE_WEIGHT, scoreOf } from '../engine/pencil.js';
import { countSolutions, answerOf, DEFAULT_BUDGET_NODES } from '../engine/counter.js';
import { routesFor } from '../engine/routes.js';

// 菜单：档位表就是引擎那张（不复制字段，界面无权改档位）
export { TIERS, parseTier };
export const tierOf = (key) => TIERS.find((t) => t.key === key) || null;
export const MENU = TIERS.map((t) => ({ key: t.key, w: t.w, h: t.h, balls: t.balls, label: t.key }));

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Game {
  constructor({ board, tier, seed, answer = null, genMs = 0, pencil = null }) {
    this.board = board;
    this.tier = tier;
    this.seed = seed;
    this.answer = answer;
    this.genMs = genMs;
    this.pencil = pencil;
    this.lines = new Map(); // ball -> [stop, …]
    this.hist = []; // [{ball}] —— 撤销退的就是这一摞
    this.selected = board.cellList()[0] ?? null; // 一开局就选中第一颗球，省掉"先要点一下"这一步
    this.strokeCount = 0;
    this.hints = 0;
    this.status = 'playing';
    this.msg = { kind: 'idle', rule: '', text: '点一颗球，再点它这一动要停在的那一格。' };
    this.lastHint = null;
    this.own = new Map();
    this.recomputeOwn();
  }
  get balls() {
    return this.board.cellList();
  }
  get n() {
    return this.board.n;
  }
  stopsOf(ball) {
    return this.lines.get(ball) || [];
  }
  tipOf(ball) {
    const s = this.lines.get(ball);
    return s && s.length ? s[s.length - 1] : ball;
  }
  inHole(ball) {
    const s = this.lines.get(ball);
    return !!(s && s.length && this.board.holes.has(s[s.length - 1]));
  }
  // 这一动该走几格：球里的数字减去已经动过的次数（R2）
  needOf(ball) {
    return this.board.balls.get(ball) - this.stopsOf(ball).length;
  }
  doneCount() {
    return this.balls.filter((b) => this.inHole(b)).length;
  }
  // 每格最多一条线（R3）：owner 表由 lines 现算，不做增量记账（增量记账一旦漂，界面会
  // 拒绝合法落子并且说不出为什么）。
  recomputeOwn() {
    const own = new Map();
    for (const b of this.lines.keys()) own.set(b, b);
    for (const [b, stops] of this.lines) {
      let at = b;
      for (const to of stops) {
        for (const c of this.pathCells(at, to)) own.set(c, b);
        at = to;
      }
    }
    this.own = own;
  }
  pathCells(from, to) {
    const [r0, c0] = this.board.rc(from);
    const [r1, c1] = this.board.rc(to);
    const dr = Math.sign(r1 - r0);
    const dc = Math.sign(c1 - c0);
    const out = [];
    const dist = Math.abs(r1 - r0) + Math.abs(c1 - c0);
    for (let t = 1; t <= dist; t++) out.push(this.board.idx(r0 + dr * t, c0 + dc * t));
    return out;
  }
  // 选中球当前这一动的全部合法落点 —— 界面拿它画提示圈，玩家拿它决定点哪儿
  legalTargets() {
    const b = this.selected;
    if (b === null || b === undefined || !this.board.balls.has(b)) return [];
    if (this.inHole(b)) return [];
    const d = this.needOf(b);
    if (d < 1) return [];
    // 方向表只有一份（engine/grid.js 的 DIRS）：这一层再列四个方向就是第二份几何。
    const at = this.tipOf(b);
    const [r, c] = this.board.rc(at);
    const out = [];
    for (const { dr, dc } of DIRS) {
      const t = this.testLanding(b, r + dr * d, c + dc * d, d);
      if (t.ok) out.push(t.cell);
    }
    return out;
  }
  testLanding(ball, r, c, d) {
    const b = this.board;
    const cell = b.inb(r, c) ? b.idx(r, c) : -1;
    const deny = (rule, text) => ({ ok: false, rule, text, cell });
    if (cell < 0) return deny('R4', '这一动会开出盘外（R4 不许 OB）');
    // 数字走完的球不再动（R2）。这一条必须在这里判：d=0 时"走 0 格"在几何上看着合法，
    // 于是界面会给一条已经死掉的线再钉一个落点。
    if (d < 1) return deny('R2', '这颗球的数字已经走完（R2 一动比一动短），不再动了');
    const k = b.balls.get(ball);
    const at = this.tipOf(ball);
    const [r0, c0] = b.rc(at);
    if (r0 !== r && c0 !== c) return deny('R2', '每动沿上下左右直线走（R2），那里在斜对面');
    const path = this.pathCells(at, cell);
    if (path.length !== d) return deny('R2', `这一动要走 ${d} 格，那里差 ${path.length} 格`);
    for (const p of path) {
      if (b.balls.has(p)) return deny('R3', `线上有别的球（格 ${p}），线不许穿过球（R3）`);
      if (this.own.has(p)) return deny('R3', `路上有格（格 ${p}）已经被线经过（R3 每格最多一条线，同一条线也不许自交）`);
      if (b.holes.has(p) && p !== cell) return deny('R3', `线穿过了 H（格 ${p}）——停在它上面才算，穿过不行（R3）`);
    }
    if (b.ponds.has(cell)) return deny('R4', `池上不许停（R4：可以穿过，不能停在上面）`);
    if (b.holes.has(cell) && this.holeOwner(cell) !== null) return deny('R1', `这个 H 已经有别的球在里面了（R1 每洞恰好一球）`);
    return { ok: true, cell, d, k };
  }
  holeOwner(hole) {
    for (const [b, stops] of this.lines) if (stops.length && stops[stops.length - 1] === hole) return b;
    return null;
  }
  // 玩家唯一的落子入口：鼠标、触屏、键盘、重放都走这里（一条路，四种输入）
  tap(cell) {
    const b = this.board;
    if (this.status === 'won') return this.say('idle', '', '这一局已经收完了。按「换一局」开下一张。');
    if (b.balls.has(cell)) return this.selectOrClear(cell);
    const [r, c] = b.rc(cell);
    return this.tryPlace(r, c);
  }
  // 键盘走这一条：方向键给的是 (行,列)，出界的也一样递进去 —— "开出盘外"这件事
  // 必须由 testLanding 报 R4，而不是在界面上被吞掉。
  tapRC(r, c) {
    if (this.status === 'won') return this.say('idle', '', '这一局已经收完了。按「换一局」开下一张。');
    return this.tryPlace(r, c);
  }
  selectOrClear(cell) {
    const b = this.board;
    // 点球身：再点一次已经动过的、被选中的那颗球 = 把它这条线清空重来
    if (cell === this.selected && this.lines.has(cell)) {
      this.popAll(cell);
      return this.say('idle', '', `球 ${cell} 收回原位，这一动还是走 ${this.needOf(cell)} 格（R2 从 ${b.balls.get(cell)} 起算）。`);
    }
    this.selected = cell;
    if (this.inHole(cell)) return this.say('ok', '', `球 ${cell} 已经进了 H ${this.tipOf(cell)}。再点一次球身可以重来。`);
    return this.say('ok', '', `选中球 ${cell}（数字 ${b.balls.get(cell)}）：这一动要正好走 ${this.needOf(cell)} 格。`);
  }
  // 落子与"为什么落不下去"是同一次判定：几何只在 testLanding 里算一遍，
  // 拒绝理由不许另算一次（另算一次的就是第二份规则，它会和第一份漂）。
  tryPlace(r, c) {
    const sel = this.selected;
    if (this.inHole(sel)) return this.say('deny', 'R2', `球 ${sel} 已经在洞里了，停在 H 上的球不再动（R2）。`);
    const d = this.needOf(sel);
    const t = this.testLanding(sel, r, c, d);
    if (!t.ok) return this.say('deny', t.rule || 'R3', `球 ${sel} → 第 ${r + 1} 行第 ${c + 1} 列：${t.text}`);
    this.place(sel, t.cell);
    return this.msg;
  }
  place(ball, cell) {
    const stops = (this.lines.get(ball) || []).slice();
    stops.push(cell);
    this.lines.set(ball, stops);
    this.hist.push({ ball });
    this.strokeCount++;
    this.recomputeOwn();
    const inHole = this.board.holes.has(cell);
    const r = inHole ? 'hole' : 'stroke';
    this.msg = {
      kind: r,
      rule: '',
      text: inHole
        ? `球 ${ball} 落进 H ${cell}（这一动走了 ${this.board.balls.get(ball) - stops.length + 1} 格）。`
        : `球 ${ball} 开了第 ${stops.length} 动，落在 ${cell}；下一动走 ${this.needOf(ball)} 格。`,
    };
    this.checkWin();
    return r;
  }
  popAll(ball) {
    const had = (this.lines.get(ball) || []).length;
    if (!had) return;
    this.lines.delete(ball);
    for (let i = this.hist.length - 1; i >= 0; ) {
      if (this.hist[i].ball === ball) this.hist.splice(i, 1);
      i--;
    }
    this.strokeCount -= had;
    this.recomputeOwn();
    this.status = 'playing';
  }
  undo() {
    const last = this.hist.pop();
    if (!last) return this.say('idle', '', '没有可退的动了。');
    const stops = this.lines.get(last.ball) || [];
    if (stops.length <= 1) this.lines.delete(last.ball);
    else this.lines.set(last.ball, stops.slice(0, -1));
    this.strokeCount--;
    this.selected = last.ball;
    this.recomputeOwn();
    this.status = 'playing';
    return this.say('ok', '', `退回球 ${last.ball} 的最后一动，现在这一动走 ${this.needOf(last.ball)} 格。`);
  }
  // 交上来的那一份 / 存档里的那一串：同一支笔（engine/grid.js 的序列化）
  codes() {
    return serializeAnswer([...this.lines].map(([start, stops]) => ({ start, stops })));
  }
  // 读档 = 重放。非法的、越界的、互相穿的那一动直接丢，界面里永远不会出现非法状态。
  // 串本身连格式都不是（坏档 'zzz'）也算重放失败：refused=-1 是"读不出"，与"读出一半"分开报。
  setCodes(text) {
    this.lines.clear();
    this.hist = [];
    this.strokeCount = 0;
    this.recomputeOwn();
    let parsed;
    try {
      parsed = parseAnswer(text || '');
    } catch {
      return { applied: 0, refused: -1, bad: true };
    }
    let applied = 0;
    let refused = 0;
    for (const { start, stops } of parsed) {
      if (!this.board.balls.has(start)) {
        refused += stops.length;
        continue;
      }
      for (const cell of stops) {
        const [r1, c1] = this.board.rc(cell);
        const d = this.needOf(start);
        // 判"这一动能不能落"只许问 testLanding 一处：在这儿再算一遍直线性/距离，
        // 就是第二份规则，它会和第一份漂。
        if (this.inHole(start) || !this.testLanding(start, r1, c1, d).ok) {
          refused++;
          break;
        }
        this.place(start, cell);
        applied++;
      }
    }
    // 状态不在这儿定：重放的每一动都走 place()，place() 里 checkWin() 已经把
    // status 判到该在的那一档（在这儿再写一次 'playing' 会把刚复核出来的赢抹掉）。
    return { applied, refused };
  }
  solutionAsAnswer() {
    return this.answer ? this.answer.map((s) => ({ start: s.start, stops: s.stops.slice() })) : [];
  }
  // 赢不赢由独立复核说了算，不由这一层的计数说了算。
  checkWin() {
    const allDone = this.balls.every((b) => this.inHole(b));
    if (!allDone) {
      this.status = 'playing';
      this.winErrors = [];
      return false;
    }
    const sols = [...this.lines].map(([start, stops]) => ({ start, stops }));
    const errs = verify(this.board, sols);
    this.winErrors = errs;
    if (errs.length) {
      this.status = 'blocked';
      this.msg = { kind: 'deny', rule: 'R1', text: `每颗球都进洞了，但复核不签：${errs[0]}` };
      return false;
    }
    this.status = 'won';
    this.msg = { kind: 'win', rule: '', text: `每条线都收进洞了，verify() 零错 —— 这一局过了。` };
    return true;
  }
  say(kind, rule, text) {
    this.msg = { kind, rule, text };
    return this.msg;
  }
  // 提示：只说命名规则此刻推得出的那一格（pencil 是引擎那份，不另写一套）
  hint() {
    const d = nextDeduction(this.board);
    this.hints++;
    if (!d) {
      this.lastHint = { rule: '', line: '五条命名规则此刻都推不动 —— 这一盘的候选要猜才能收，出货闸不会发这种盘。' };
      return this.lastHint;
    }
    if (d.ballCell !== null && d.ballCell !== undefined) this.selected = d.ballCell;
    this.lastHint = { rule: d.rule, line: `${RULE_TEXT[d.rule]}。眼前这一条：${d.line}` };
    this.msg = { kind: 'hint', rule: d.rule, text: this.lastHint.line };
    return this.lastHint;
  }
}

// 一条规则一条规则地推，返回**第一条真的发火的规则**给出的那一个结论。
// 为什么不在这里 solve() 一遍再挑：solve() 会一直推到不动点，"推完之后再说"就看不出
// 玩家此刻凭哪一条能落地一步了。
export function nextDeduction(board) {
  const st = freshState(board);
  if (!st.nb) return null;
  for (let round = 0; round < 200; round++) {
    let moved = false;
    for (const name of RULE_ORDER) {
      const before = st.log.length;
      const fires = st.fires[name];
      const res = runRule(name, st);
      if (st.fires[name] > fires) {
        const entry = st.log[before] || null;
        const ballCell = entry ? st.balls[entry.ball] : null;
        let line = `球 ${ballCell} 这一条${entry && entry.kind === 'prune' ? `删掉 ${entry.gone.length} 个走法（还剩 ${st.alive[entry.ball].length} 个）` : ''}`;
        if (entry && entry.kind === 'cell') line = `球 ${ballCell} 的线一定经过格 ${entry.cell} ⇒ 那一格归它`;
        if (entry && entry.kind === 'hole') line = `球 ${ballCell} 只能落进 H ${entry.hole}`;
        return { rule: name, entry, ballCell, line, rounds: round + 1 };
      }
      if (res.fired) moved = true;
      if (st.contradiction) return { rule: name, entry: null, ballCell: null, line: `铅笔在这里推出矛盾：${st.contradiction}`, contradiction: st.contradiction };
    }
    if (!moved) return null;
  }
  return null;
}

// 出货通道：与 tools/balance.mjs 走的是同一个 shipPuzzle（同一份双条件），
// 界面无权挑盘 —— 它只负责把发下来的那一盘画出来。
export function ship(seed, tierKey, { tries = null, now = nowMs } = {}) {
  const r = shipPuzzle(seed, tierKey, { tries, now });
  if (!r.ok) return { ok: false, status: r.status, attempts: r.attempts, tier: r.tier };
  return {
    ok: true,
    board: r.board,
    answer: r.answer,
    tier: r.tier.key,
    spec: r.tier,
    seed,
    attempts: r.attempts,
    genMs: r.ms,
    pencil: r.pencil,
    stats: r.stats,
  };
}

// 复核一张**手摆**的盘（菜单页"这一盘唯一吗"的那句话，以及 corrupt 腿）
export function certify(board, { budgetNodes = DEFAULT_BUDGET_NODES } = {}) {
  const res = countSolutions(board, { limit: 2, budgetNodes, mrv: true });
  return { count: res.count, stopped: res.stopped, nodes: res.nodes, answer: res.count === 1 ? answerOf(res, 0) : null };
}

export { Board, serializeBoard, parseBoard, serializeAnswer, parseAnswer, verify, routesFor, RULE_ORDER, RULE_TEXT, RULE_WEIGHT, scoreOf, nowMs };
