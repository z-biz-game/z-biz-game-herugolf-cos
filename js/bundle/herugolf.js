// ヘルゴルフ / Herugolf —— 浏览器壳的**生成物**，不要手改。
// 由 tools/bundle.mjs 从 13 个 ESM 源模块打成经典脚本；
// 重跑：node tools/bundle.mjs   （产物不带时间戳，逐字节可比对，比对那条闸在 tools/web-test.mjs）
// 为什么要 bundle：官方帧率探针只执行经典脚本，且 file:// 拒绝 ES 模块 —— 见本文件生成器的文件头。

/* eslint-disable */
var HerugolfBundle = (function () {
  'use strict';
  var __cache = Object.create(null);
  var __factories = Object.create(null);
  function __def(name, fn) { __factories[name] = fn; }
  function __req(name) {
    if (__cache[name]) return __cache[name];
    if (!__factories[name]) throw new Error('bundle: 没有模块 ' + name);
    var mod = { exports: {} };
    __cache[name] = mod.exports;
    var ret = __factories[name](__req) || {};
    for (var k in ret) mod.exports[k] = ret[k];
    return mod.exports;
  }
  __def('rng', function (__req) {
  // 确定性随机源：hashSeed + mulberry32 + shuffle。
  //
  // 为什么单独成一个模块（而不是"谁要用谁自己写两行"）：本仓的**全部**读数都建立在
  // 「同一串 seed 在 node 和 Chrome 里画出同一张盘」这句话上。两侧各写一份 PRNG，
  // 这句话就只是一句愿望。
  //
  // 两条写死的纪律（都是别的仓踩过之后抬进来的）：
  //   ① 比较器里不许抽随机数。`arr.sort(() => rnd() - 0.5)` 在 V8 的两条排序路径上会给出
  //      两种结果（node/Chrome 画出两张盘），所以打乱一律走下面的 shuffle()：先抽一个
  //      **和元素无关**的键，再按键排；键的抽取顺序只取决于 rnd 的调用次数。
  //   ② 默认种子不许按日期算。"新的一局"配日期种子 = 界面上那句"这一局是…"说谎。
  //      要"下一局"就用 seed + k 自增（js/engine/generate.js 的 shipPuzzle 就是这么做的），
  //      并把 k 记进 stats，让"为了出这一盘重试了几次"是一条可对账的数。
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 确定性打乱：Fisher–Yates，随机只来自传入的 rnd，比较器（这里根本没有比较器）不抽奖。
  function shuffle(list, rnd) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // 串 = 标签 + 参数。所有参数都进串，所以「换个尺寸/换个球数」必然换一列种子，
  // 不会出现两档共用同一批随机数而读数互相污染。
  function seeded(tag, ...parts) {
    return mulberry32(hashSeed(`${tag}|${parts.join('|')}`));
  }

    return { hashSeed: hashSeed, mulberry32: mulberry32, shuffle: shuffle, seeded: seeded };
  });

  __def('grid', function (__req) {
  // 盘面模型 Board(w,h) + 题面序列化。
  //
  // 规则出处（写进注释时必须照抄来源，四条正文见 js/engine/routes.js 文件头）：
  //   Nikoli 官方页 https://www.nikoli.co.jp/ja/puzzles/herugolf/ （EN 站同名）、
  //   https://www.janko.at/Raetsel/Herugolf/index.htm 、LIPIcs FUN 2018 论文。
  // 题面给的只有：盘面外框 + 球(带数字) + H + 池。内部没有粗线、区块不用求解。
  //
  // 坐标系：cell = r*w + c（0-based，行优先）。方向表 DIRS 是全仓唯一的一份，
  // routes.js / verify.js / counter.js / pencil.js 都从它取邻居，几何不许各写一份。
  const DIRS = [
    { dr: -1, dc: 0, name: '上' },
    { dr: 0, dc: 1, name: '右' },
    { dr: 1, dc: 0, name: '下' },
    { dr: 0, dc: -1, name: '左' },
  ];

  class Board {
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
  function serializeBoard(board) {
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
  function parseBoard(w, h, text) {
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
  function serializeAnswer(answer) {
    return answer
      .slice()
      .sort((a, b) => a.start - b.start)
      .map((s) => `${s.start}:${s.stops.join('-')}`)
      .join(';');
  }

  function parseAnswer(text) {
    if (!text) return [];
    return text.split(';').map((part) => {
      const [start, rest] = part.split(':');
      return { start: Number(start), stops: rest === '' ? [] : rest.split('-').map(Number) };
    });
  }

  // 逐格把题面画出来（打印用；出问题时"看一眼"比看数组快得多）
  function drawBoard(board) {
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

    return { serializeBoard: serializeBoard, parseBoard: parseBoard, serializeAnswer: serializeAnswer, parseAnswer: parseAnswer, drawBoard: drawBoard, Board: Board, DIRS: DIRS };
  });

  __def('routes', function (__req) {
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
  const { DIRS } = __req('grid');


  // 返回 [{cells, stops, hole, strokes, start}]：
  //   cells   这条线经过的所有格（含起点与每一个落点）
  //   stops   每一动的落点（按顺序；最后一个必然在 H 上）
  //   hole    收尾的 H
  //   strokes 动了几动（= stops.length）
  // 只看不碰别的球的线走哪儿 —— 那是计数器的活儿（它做的是"这些候选挑一种互不相交的组合"）。
  function routesFor(board, cell) {
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
  function passThrough(route) {
    const stopSet = new Set(route.stops);
    return route.cells.filter((c) => !stopSet.has(c));
  }

    return { routesFor: routesFor, passThrough: passThrough, DIRS: DIRS };
  });

  __def('verify', function (__req) {
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
  const { Board } = __req('grid');

  function verify(board, solutions) {
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
  function answerKey(answer) {
    return answer
      .slice()
      .sort((a, b) => a.start - b.start)
      .map((s) => `${s.start}>${s.stops.join('-')}`)
      .join(' ; ');
  }

  function sameAnswer(a, b) {
    return answerKey(a) === answerKey(b);
  }

    return { verify: verify, answerKey: answerKey, sameAnswer: sameAnswer };
  });

  __def('counter', function (__req) {
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
  const { routesFor } = __req('routes');

  const DEFAULT_BUDGET_NODES = 500_000;
  const DEFAULT_LIMIT = 2;

  function prepare(board) {
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
  function stopKey(route) {
    return route.stops.join('-');
  }

  // pins（门禁专用，出货路径不用）：Map<球格, stopKey(候选)> 把某个球的候选**限定**成那几条。
  // 它买到的是一句独立问句："铅笔删掉的那条走法，是不是真的不在任何解里？"（tools/rule-test.mjs 的
  // 消值复核）。限定发生在候选表上、DFS 之前 ⇒ 复用的还是同一台机器，没有第二条实现可走。
  // ⚠ 传了 pins 就必须自己给 prep（或干脆不给）：prep 里那份没限定过的候选表不能拿来复用。
  function countSolutions(board, { limit = DEFAULT_LIMIT, budgetNodes = DEFAULT_BUDGET_NODES, prep = null, mrv = true, pins = null } = {}) {
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
  function answerOf(res, i = 0) {
    return res.sols[i].map((x) => ({ start: x.start, stops: x.route.stops.slice() }));
  }

    return { prepare: prepare, stopKey: stopKey, countSolutions: countSolutions, answerOf: answerOf, DEFAULT_BUDGET_NODES: DEFAULT_BUDGET_NODES, DEFAULT_LIMIT: DEFAULT_LIMIT };
  });

  __def('pencil', function (__req) {
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
  const { prepare } = __req('counter');

  const RULE_ORDER = ['单走法', '必经格', '洞唯一来客', '一球一洞', '两球两洞'];

  const RULE_TEXT = {
    单走法: '这个球只剩一条合法走法 ⇒ 它的线定死了：途经格归它、落点那个 H 归它',
    必经格: '这个球所有还活着的走法都经过同一格 ⇒ 那一格归它，别的线不能碰',
    洞唯一来客: '这个 H 只有一个球还够得着 ⇒ 它必须落在这个洞里（R1 每洞恰好一球）',
    一球一洞: '这个球的存活走法只落到一个 H 上 ⇒ 它必须落那里，别的球别再想这个洞',
    两球两洞: '两个球合起来只够得着两个 H ⇒ 这两个洞被它们包场，别的球落到这两个洞的走法全删',
  };

  // 权重 = 用这条规则要"看多远"：单球自身 1 / 单球全线 2 / 一个洞与全体球 3 / 两球两洞 4。
  // score 只是这把尺子上的读数，**只在规则表内可比**（README 的"不承诺"里就这么写）。
  const RULE_WEIGHT = {
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
  const RARE_RULES = ['必经格', '两球两洞'];

  function scoreOf(fires) {
    let s = 0;
    for (const r of RULE_ORDER) s += (RULE_WEIGHT[r] || 0) * (fires[r] || 0);
    return s;
  }

  // 铅笔的内部状态。**导出**是给 tools/rule-test.mjs 用的：它要"只跑一条规则一圈"，
  // 还要在跑完之后读 alive（哪几条候选还活着），拿独立计数器的唯一解对账。
  function freshState(board) {
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
  function runRule(name, st) {
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
  function solve(board, { rules = RULE_ORDER } = {}) {
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
  function stuckBalls(board, { rules = RULE_ORDER } = {}) {
    const r = solve(board, { rules });
    return { solved: r.solved, undecided: r.alive.filter((a) => a > 1).length, steps: r.steps, fires: r.fires };
  }

    return { scoreOf: scoreOf, freshState: freshState, runRule: runRule, solve: solve, stuckBalls: stuckBalls, RULE_ORDER: RULE_ORDER, RULE_TEXT: RULE_TEXT, RULE_WEIGHT: RULE_WEIGHT, RARE_RULES: RARE_RULES };
  });

  __def('generate', function (__req) {
  // 出货通道：由解铺题面 → 反例驱动补池挖唯一 → 摘池极小化 → 双条件闸（计数器认证唯一 ∧ 铅笔零猜测推完）。
  //
  // 为什么"双条件"是**出货口径**而不是一句漂亮话：
  //   ① 计数器说这盘只有一种走法（玩家不会撞上第二解）；
  //   ② 铅笔在零猜测下推得完（玩家只靠那五条命名规则就能解完，不必"试一条线看看"）。
  // 铅笔不完备：存在「多候选杀不完」的盘（不矛盾、仍然唯一，但推不完）。这类盘在这里就作废重铺，
  // 所以 README **不许**写"这个品类都能纯逻辑解"，只能写"出货的每一盘两条都过"。
  //
  // 三条从别的仓抬进来的硬口径（写在代码里，不写在文档里）：
  //   ⚠ 出货前 board 上的答案一律**用计数器数出来的那一解覆盖**（js/engine/counter.js:answerOf），
  //     不信本文件铺题面时自己记的那一份 —— 补池/摘池之后自记的答案可能已不再是任何解。
  //   ⚠ 计数器 stopped=true（没数完）不等于"只有一种"：count===1 && stopped 一律不出货。
  //   ⚠ 默认种子不许按日期算；"下一局"= seed + k 自增（下面的 attempt 就是那个 k），
  //     并且把 k 记进 stats.attempts，让"为了出这一盘重试了几次"成为可对账的数。
  const { Board } = __req('grid');
  const { verify } = __req('verify');
  const { mulberry32, hashSeed, shuffle } = __req('rng');
  const { prepare, countSolutions, answerOf, DEFAULT_BUDGET_NODES } = __req('counter');
  const { solve } = __req('pencil');

  // ── 档位表：尺寸与球数一起长（球数才是难度旋钮，见 tools/balance.mjs 的 R3/R4 两条）──
  // band / budgetMs 是**实测回填**的：由 `node tools/balance.mjs` 打印的建议值抄进来，不许凭感觉填。
  // band = [max(1, floor(中位×0.4)), max(lo+1, ceil(p95×1.6))]，budgetMs = max(10, ceil(p95×4/10)*10)
  // —— 一律卡 p95，绝不卡"中位×2"（出题墙钟是双峰的，中位基线会一绿一红）。
  const TIERS = [
    { key: '8x8/4', w: 8, h: 8, balls: 4, maxK: 5, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
    { key: '10x10/5', w: 10, h: 10, balls: 5, maxK: 5, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
    { key: '10x10/6', w: 10, h: 10, balls: 6, maxK: 6, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
    { key: '12x12/7', w: 12, h: 12, balls: 7, maxK: 6, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
    { key: '15x15/9', w: 15, h: 15, balls: 9, maxK: 6, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
    { key: '18x18/11', w: 18, h: 18, balls: 11, maxK: 6, tries: 30, band: [1, 3], budgetMs: 20, inMenu: true },
  ];
  const SIZES = TIERS.filter((t) => t.inMenu).map((t) => t.key);
  function parseTier(key) {
    const t = TIERS.find((x) => x.key === key);
    if (t) return { ...t };
    const m = /^([0-9]+)x([0-9]+)\/([0-9]+)$/.exec(key);
    if (!m) throw new Error(`parseTier：认不出档位「${key}」（形状应是 10x10/6）`);
    const [, w, h, balls] = m;
    return { key, w: Number(w), h: Number(h), balls: Number(balls), maxK: 6, tries: 30, band: [1, Infinity], budgetMs: Infinity, inMenu: false };
  }

  // ── 由解出发：先铺一组互不相交的合法路线，再读出题面（球/H）──
  // 返回 {ok:true, board, answer} 或 {ok:false, why}。
  // 铺的每一条都当场用独立复核（verify）确认；撒池不在这里 —— 池是后来杀多余走法用的。
  function makeSolution(w, h, rnd, { balls = 3, maxK = 5 } = {}) {
    const answer = [];
    const used = new Set();
    const holes = new Set();
    const ballMap = new Map();
    const tmp = new Board(w, h, { balls: ballMap, holes, ponds: new Set() });
    for (let attempt = 0; attempt < 400 && answer.length < balls; attempt++) {
      const start = Math.floor(rnd() * tmp.n);
      if (used.has(start)) continue;
      const k0 = 2 + Math.floor(rnd() * Math.max(1, maxK - 1)); // 至少 2：只有 1 的球一动就到底，没地方可去
      const route = growRoute(tmp, k0, start, used, rnd);
      if (!route) continue;
      answer.push({ start, stops: route.stops, cells: route.cells });
      for (const c of route.cells) used.add(c);
      holes.add(route.hole);
      ballMap.set(start, k0);
    }
    if (answer.length < balls) return { ok: false, why: `只铺出 ${answer.length}/${balls} 条路线` };
    const errs = verify(tmp, answer.map((s) => ({ start: s.start, stops: s.stops })));
    if (errs.length) return { ok: false, why: `铺出来的答案过不了独立复核：${errs[0]}` };
    return { ok: true, board: tmp, answer: answer.map((s) => ({ start: s.start, stops: s.stops.slice() })) };
  }

  // 从 start 走一条 k,k-1,… 的线，终点变成新 H，且不碰 used 里的格
  function growRoute(board, k0, start, used, rnd) {
    const cells = [start];
    const stops = [];
    let at = start;
    for (let k = k0; k >= 1; k--) {
      const dirs = shuffle([0, 1, 2, 3], rnd); // 打乱走 shuffle，绝不在 sort 比较器里抽随机数（rng.js 纪律①）
      let advanced = false;
      for (const d of dirs) {
        const path = [];
        let cur = at;
        let ok = true;
        for (let s = 0; s < k; s++) {
          cur = board.step(cur, d);
          if (cur < 0 || used.has(cur) || cells.includes(cur)) {
            ok = false;
            break;
          }
          if (board.holes.has(cur) && s < k - 1) {
            ok = false;
            break; // 穿过已有 H
          }
          path.push(cur);
        }
        if (!ok) continue;
        const last = path[path.length - 1];
        if (board.holes.has(last)) continue; // 落在别人的洞上：这一动得停，但洞已占
        cells.push(...path);
        stops.push(last);
        at = last;
        advanced = true;
        break;
      }
      if (!advanced) return null;
    }
    const holeCell = stops[stops.length - 1];
    if (used.has(holeCell)) return null;
    return { cells, stops, hole: holeCell };
  }

  // ── 反例驱动补池：数出多余解，把它的某个"只属于它"的落点变成池 ──
  // 池只能禁止"停在某格"（R4 允许穿过），所以杀点必须是一条多余解的**落点**，
  // 且不能落在正解的落点上、也不能落在正解经过的格上（那样连正解一起杀）。
  // 补池是单调的（只会让候选变少）⇒ 循环不来回震荡 ⇒ 出货成本有先验上界。
  function digUnique(board, answer, { budgetNodes = DEFAULT_BUDGET_NODES, maxPond = 24 } = {}) {
    const answerStops = new Set(answer.flatMap((s) => s.stops));
    const answerCells = new Set(answer.flatMap((s) => s.cells));
    let added = 0;
    let tries = 0;
    let nodesSum = 0;
    let nodesMax = 0;
    let stopped = false;
    for (let round = 0; round <= maxPond; round++) {
      const prep = prepare(board);
      const c = countSolutions(board, { limit: 2, budgetNodes, prep, mrv: true });
      tries++;
      nodesSum += c.nodes;
      nodesMax = Math.max(nodesMax, c.nodes);
      if (c.stopped) {
        stopped = true;
        break;
      }
      if (c.count === 1) return { unique: true, added, tries, nodesSum, nodesMax, stopped: false };
      if (c.count === 0) return { unique: false, why: '正解被自己挖掉了', added, tries, nodesSum, nodesMax, stopped: false };
      const alt = c.sols[1];
      const kill = [];
      for (const item of alt) for (const st of item.route.stops) if (!answerStops.has(st)) kill.push(st);
      if (!kill.length) {
        return { unique: false, why: '多余解的落点全是正解也用的落点，杀不动', added, tries, nodesSum, nodesMax, stopped: false };
      }
      let placed = false;
      for (const cell of kill) {
        if (answerCells.has(cell)) continue;
        board.ponds.add(cell);
        const errs = verify(board, answer.map((s) => ({ start: s.start, stops: s.stops })));
        if (errs.length) {
          board.ponds.delete(cell);
          continue;
        }
        added++;
        placed = true;
        break;
      }
      if (!placed) {
        return { unique: false, why: '没有可用的杀点', added, tries, nodesSum, nodesMax, stopped: false };
      }
    }
    return {
      unique: false,
      why: stopped ? `计数器撞预算 ${nodesMax}` : `补池到上限 ${maxPond} 仍不唯一`,
      added,
      tries,
      nodesSum,
      nodesMax,
      stopped,
    };
  }

  // ── 极小化（只对池做）：逐颗试摘，摘掉之后"预算内唯一 ∧ 铅笔仍零猜测推完"才真摘 ──
  // 口径写清：这是**单颗摘除意义的极小**，不是"线索最少"。球与 H 铺在骨架上（一条线一个），
  // 本文件的极小化不动它们 —— 它们删不删得掉由 auditClueNecessity 逐颗量给 balance 看。
  function minimizePonds(board, { budgetNodes = DEFAULT_BUDGET_NODES } = {}) {
    let removed = 0;
    let overbudget = 0;
    const ponds = [...board.ponds].sort((a, b) => a - b);
    for (const cell of ponds) {
      board.ponds.delete(cell);
      const c = countSolutions(board, { limit: 2, budgetNodes, mrv: true });
      if (c.stopped) {
        overbudget++;
        board.ponds.add(cell);
        continue;
      }
      if (c.count !== 1) {
        board.ponds.add(cell);
        continue;
      }
      const p = solve(board);
      if (!p.solved) {
        board.ponds.add(cell);
        continue;
      }
      removed++;
    }
    return { removed, overbudget };
  }

  // 逐颗摘除审计：球 / H / 池每一颗都单独摘一次，报告"摘掉它之后还剩几解、铅笔还推不推得完"。
  // 摘掉它之后仍然（唯一 ∧ 推得完）= 这颗线索删不得那句话是吹的 ⇒ balance 判红。
  // 摘掉它之后数不完（stopped）= 这颗没证到 ⇒ 只披露不判红。
  function auditClueNecessity(board, { budgetNodes = 500_000 } = {}) {
    const out = [];
    const oneSolvable = (b) => {
      const c = countSolutions(b, { limit: 2, budgetNodes, mrv: true });
      const p = c.count === 1 ? solve(b) : null;
      return { count: c.count, stopped: c.stopped, nodes: c.nodes, solved: !!p && p.solved };
    };
    for (const cell of [...board.balls.keys()].sort((a, b) => a - b)) {
      const balls = new Map(board.balls);
      balls.delete(cell);
      out.push({ kind: 'ball', cell, ...oneSolvable(board.withClues({ balls })) });
    }
    for (const cell of [...board.holes].sort((a, b) => a - b)) {
      const holes = new Set(board.holes);
      holes.delete(cell);
      out.push({ kind: 'hole', cell, ...oneSolvable(board.withClues({ holes })) });
    }
    for (const cell of [...board.ponds].sort((a, b) => a - b)) {
      const ponds = new Set(board.ponds);
      ponds.delete(cell);
      out.push({ kind: 'pond', cell, ...oneSolvable(board.withClues({ ponds })) });
    }
    return out;
  }

  // ── 出货：一个 seed 一串，attempt 用尽仍不出货就返回 ok:false（并带归因）──
  function shipPuzzle(seed, tierKey, { tries = null, budgetNodes = DEFAULT_BUDGET_NODES, maxPond = 24, minimize = true, now = null } = {}) {
    const t0 = now ? now() : Number(process.hrtime.bigint() / 1000n) / 1000;
    const tier = parseTier(tierKey);
    const maxAttempts = tries == null ? tier.tries : tries;
    const stats = newStats();
    let lastStatus = 'noBoard';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // 同一个 seed 的连续尝试：串里带 attempt 号 ⇒ "下一局"是自增而不是日期（纪律见文件头）
      const rnd = mulberry32(hashSeed(`herugolf|${tier.key}|${seed}|a${attempt}`));
      const g = makeSolution(tier.w, tier.h, rnd, { balls: tier.balls, maxK: tier.maxK });
      if (!g.ok) {
        stats.makeFail++;
        lastStatus = 'noBoard';
        continue;
      }
      stats.candSum += prepare(g.board).cands.reduce((a, c) => a + c.length, 0);
      const dig = digUnique(g.board, g.answer, { budgetNodes, maxPond });
      stats.digTries += dig.tries;
      stats.digNodesMax = Math.max(stats.digNodesMax, dig.nodesMax);
      stats.digNodesSum += dig.nodesSum;
      stats.pondsAdded = dig.added;
      if (dig.stopped) stats.stopped++;
      if (!dig.unique) {
        stats.digFail[dig.why] = (stats.digFail[dig.why] || 0) + 1;
        lastStatus = `dig:${dig.why}`;
        continue;
      }
      if (minimize) {
        const min = minimizePonds(g.board, { budgetNodes });
        stats.pondsRemoved = min.removed;
        stats.minimizeOverbudget = min.overbudget;
      }
      // 覆盖口径：答案一律以**这里**数出来的那一解为准（不信 g.answer）
      const cert = countSolutions(g.board, { limit: 2, budgetNodes, mrv: true });
      stats.certTries++;
      stats.certNodesMax = Math.max(stats.certNodesMax, cert.nodes);
      if (cert.stopped) {
        stats.stopped++;
        lastStatus = 'certStopped';
        continue;
      }
      if (cert.count !== 1) {
        lastStatus = `notUnique(${cert.count})`;
        continue;
      }
      const answer = answerOf(cert, 0);
      const errs = verify(g.board, answer);
      if (errs.length) {
        stats.verifyFail++;
        lastStatus = `verify:${errs[0]}`;
        continue;
      }
      const p = solve(g.board);
      if (!p.solved) {
        stats.pencilReject++;
        lastStatus = `pencilStuck(${p.alive.filter((a) => a > 1).length}球未定)`;
        continue;
      }
      if (!sameAnswerLoose(answer, p.sols)) {
        stats.pencilMismatch++;
        lastStatus = 'pencilDisagrees';
        continue;
      }
      stats.pencilAgree++;
      return {
        ok: true,
        status: 'shipped',
        board: g.board,
        answer,
        attempt,
        attempts: attempt + 1,
        pencil: p,
        ms: (now ? now() : Number(process.hrtime.bigint() / 1000n) / 1000) - t0,
        stats,
        tier,
      };
    }
    return { ok: false, status: lastStatus, attempts: maxAttempts, stats, tier, ms: (now ? now() : Number(process.hrtime.bigint() / 1000n) / 1000) - t0 };
  }

  function newStats() {
    return {
      makeFail: 0,
      digTries: 0,
      digNodesMax: 0,
      digNodesSum: 0,
      pondsAdded: 0,
      pondsRemoved: 0,
      minimizeOverbudget: 0,
      certTries: 0,
      certNodesMax: 0,
      stopped: 0,
      verifyFail: 0,
      pencilReject: 0,
      pencilMismatch: 0,
      pencilAgree: 0,
      candSum: 0,
      digFail: {},
    };
  }

  function sameAnswerLoose(a, b) {
    const key = (x) =>
      x
        .slice()
        .sort((p, q) => p.start - q.start)
        .map((s) => `${s.start}>${s.stops.join('-')}`)
        .join(' ; ');
    return key(a) === key(b);
  }

    return { parseTier: parseTier, makeSolution: makeSolution, digUnique: digUnique, minimizePonds: minimizePonds, auditClueNecessity: auditClueNecessity, shipPuzzle: shipPuzzle, newStats: newStats, TIERS: TIERS, SIZES: SIZES };
  });

  __def('game', function (__req) {
  // 玩法与仿真的那一层：**不碰 DOM、不碰 canvas、不读 window**。
  //
  // 为什么单独一层：帧率无关这件事只有"能被逐档喂进同一串定步长"的代码才证得明。
  // 渲染与 DOM 掺进来的话，任何对拍都要先造一个假浏览器，那种尺子量不到仿真本身。
  // 所以这一层只吃 dt 与输入事件，只吐状态；js/render 与 js/ui 都是它的读者。
  //
  // 时间口径（本仓的硬约束，见 tools/check.mjs 的禁词门与 README 的 rng 纪律）：
  //   · 定步长累加器：SIM_DT = 1/120 秒，`accum + 1e-9 >= SIM_STEP_MS` 才走一步。
  //     那 1e-9 是给浮点留的缝：按 1000/60 喂 3 秒会少喂 5e-13 秒，不留缝 60Hz 就少跑一步，
  //     凭空造出一个"帧率依赖"的假红（wave-collapse 实测踩过，口径写在派工简报 §3）。
  //   · 一切位移/阻尼/概率都按 dt 积分：`x += v*dt`、`shake *= Math.pow(0.86, dt*60)`、
  //     `p = 1 - Math.pow(1 - p60, dt*60)`。禁止 `*= 0.96`、`if (Math.random() < 0.02)` 这种只在 60Hz 成立的写法。
  //   · 随机数只用带种子的 LCG（粒子撒射方向），不许 Math.random —— 否则三档对拍比的不是同一件事。
  const { Board, serializeBoard, parseBoard, serializeAnswer, parseAnswer } = __req('grid');
  const { shipPuzzle, TIERS, parseTier } = __req('generate');
  const { routesFor } = __req('routes');
  const { verify } = __req('verify');
  const { countSolutions, prepare } = __req('counter');

  const SIM_DT = 1 / 120;
  const SIM_STEP_MS = SIM_DT * 1000;
  const STEP_EPS_MS = 1e-9;
  const MAX_FRAME_MS = 250; // 掉帧/切后台回来的那一坨时间不许补进仿真（否则暂停回来会炸步）
  const PARTICLE_CAP = 160;

  const STATE = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', WON: 'won' };

  // 带种子的 LCG：粒子撒射要能跨帧率复现，Math.random 做不到这件事
  function makeLcg(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  class HerugolfGame {
    constructor({ seed = 1, tierKey = '8x8/4', reduceMotion = false, clock = null } = {}) {
      this.seed = seed;
      this.tierKey = tierKey;
      this.tier = parseTier(tierKey);
      this.reduceMotion = !!reduceMotion;
      this.clock = clock || (() => 0);

      // 时间/推进（对拍就看这几个数在三档下是否逐字相同）
      this.elapsed = 0;
      this.simSteps = 0;
      this.accumMs = 0;
      this.animClock = 0;
      this.pulse = 0;

      // 玩法
      this.state = STATE.TITLE;
      this.board = null;
      this.solution = null;
      this.cands = new Map(); // ball -> 该球当前题面下的全部合法走法
      this.lines = new Map(); // ball -> 玩家已画的落点序列
      this.selected = null;
      this.moves = 0;
      this.blocked = 0;
      this.solved = 0;
      this.undoStack = [];
      this.message = '';
      this.messageClock = 0;
      this.shake = 0;
      this.strokeAnim = 0;
      this.strokeAnimBall = -1;
      this.holeFlash = new Float32Array(8);
      this.ripples = [];
      // 输入落地表：玩家动作不在处理器的调用点改写仿真，而是按虚拟时刻排到定步长边界上。
      // 派发发生在"帧边界的那一帧 rAF 之前"（浏览器与对拍尺都是），所以同步改写会让同一个
      // 动作在三档落到不同步号（1100ms 那一按：30Hz 时仿真只走了 8 步、120Hz 走了 11 步），
      // shake 的阻尼长度、粒子抢到哪个槽位从此永久错开一格。
      this.inputQueue = [];
      this.lastFrameMs = 0;
      this.draining = false;
      // 通关用时：**按仿真步号**算出来的（见 refresh()），不是帧循环里抓的快照。
      // 帧循环里抓的那种读数随刷新率变化（30Hz 最多晚 4 步），一旦进存档就会被 restore 回仿真里。
      this.winSecs = 0;

      // 粒子（typed array 是玩法真值本身，不是渲染缓存：对拍逐格比的就是它们）
      this.pX = new Float32Array(PARTICLE_CAP);
      this.pY = new Float32Array(PARTICLE_CAP);
      this.pVX = new Float32Array(PARTICLE_CAP);
      this.pVY = new Float32Array(PARTICLE_CAP);
      this.pLife = new Float32Array(PARTICLE_CAP);
      this.pKind = new Uint8Array(PARTICLE_CAP);
      this.pAlive = 0;
      this.rng = makeLcg(0xc0ffee ^ seed);

      this.events = [];
      this.build();
    }

    // ── 出货：引擎那一套双条件闸（唯一解数过 ∧ 铅笔零猜测推完）在这里照吃
    build(seed = this.seed, tierKey = this.tierKey) {
      this.seed = seed;
      this.tierKey = tierKey;
      this.winSecs = 0;
      this.tier = parseTier(tierKey);
      const r = shipPuzzle(seed, tierKey, { now: this.clock });
      if (r.ok) {
        this.board = r.board;
        this.solution = r.answer;
        this.shipped = true;
      } else {
        // 通道这一档没出货（tries 用完）：退到官方 5x5 例题，保证界面永远有得玩，
        // 但不许假装出货了 —— shipped=false 会被 HUD 如实标出来。
        this.board = parseBoard(5, 5, '...H.3..#P..#....P...H.3.');
        this.solution = null;
        this.shipped = false;
      }
      this.cands = new Map();
      for (const cell of this.board.cellList()) this.cands.set(cell, routesFor(this.board, cell));
      this.inputQueue.length = 0; // 上一张盘排队没落地的动作不许打到新盘上
      this.rng = makeLcg((0xc0ffee ^ seed) >>> 0);
      return r;
    }

    // ── 输入：选中 / 画一动 / 撤销 / 复位 ────────────────────────────────
    select(cell) {
      if (this.state !== STATE.PLAYING) return false;
      if (this.board && this.board.balls.has(cell)) {
        this.selected = cell;
        return true;
      }
      return false;
    }

    // 目标格必须是"当前这一动"的合法落点：直线、长度等于剩余动长、且整条线仍可收口
    strokeTo(cell) {
      if (this.state !== STATE.PLAYING || this.selected == null || !this.board) return false;
      const ball = this.selected;
      const k0 = this.board.balls.get(ball);
      const stops = this.lines.get(ball) || [];
      if (stops.length >= k0) return this.reject('这一球已经动完 ' + k0 + ' 动了');
      const from = stops.length ? stops[stops.length - 1] : ball;
      const len = k0 - stops.length;
      const [r0, c0] = this.board.rc(from);
      const [r1, c1] = this.board.rc(cell);
      const dr = Math.sign(r1 - r0);
      const dc = Math.sign(c1 - c0);
      const straight = (dr === 0 || dc === 0) && Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0)) === len;
      if (!straight) return this.reject('每一动要走 ' + len + ' 格直线');
      const probe = stops.concat([cell]);
      if (!this.completable(ball, probe)) return this.reject('这条走法收不了口（R3/R4 拦住了）');
      this.lines.set(ball, probe);
      this.undoStack.push({ ball, stops: stops.length });
      this.moves++;
      this.strokeAnim = 0;
      this.strokeAnimBall = ball;
      this.selected = ball;
      this.events.push('stroke');
      if (this.board.holes.has(cell) && probe.length === k0) {
        this.lockHole(ball, cell);
      }
      this.refresh();
      return true;
    }

    // 沿方向画一动（手机上更好按：滑动即出方向）
    strokeDir(dir) {
      if (this.state !== STATE.PLAYING || this.selected == null || !this.board) return false;
      const ball = this.selected;
      const k0 = this.board.balls.get(ball);
      const stops = this.lines.get(ball) || [];
      const len = k0 - stops.length;
      if (len <= 0) return this.reject('这一球已经动完 ' + k0 + ' 动了');
      const from = stops.length ? stops[stops.length - 1] : ball;
      const [r, c] = this.board.rc(from);
      const d = [{ dr: -1, dc: 0 }, { dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }][dir & 3];
      const target = this.board.idx(r + d.dr * len, c + d.dc * len);
      if (!this.board.inb(r + d.dr * len, c + d.dc * len)) return this.reject('出界了（R4 OB）');
      return this.strokeTo(target);
    }

    reject(msg) {
      this.blocked++;
      this.message = msg;
      this.messageClock = 0;
      if (!this.reduceMotion) this.shake = 1;
      this.events.push('blocked');
      return false;
    }

    // 这一球按 probe 这条路走下去，题面里还存在至少一条合法走法吗？
    // 吃的是 routesFor 的那一份候选（R2/R3/R4 已判过），外加"不许压到别的球已经占下的格"。
    completable(ball, probe) {
      const list = this.cands.get(ball) || [];
      const taken = this.occupiedExcept(ball);
      for (const rt of list) {
        if (rt.stops.length < probe.length) continue;
        let same = true;
        for (let i = 0; i < probe.length; i++) if (rt.stops[i] !== probe[i]) { same = false; break; }
        if (!same) continue;
        let clash = false;
        for (const c of rt.cells) if (taken.has(c)) { clash = true; break; }
        if (!clash) return true;
      }
      return false;
    }

    occupiedExcept(ball) {
      const taken = new Set();
      for (const b of this.board.balls.keys()) if (b !== ball) taken.add(b);
      for (const [b, stops] of this.lines) {
        if (b === ball || !stops.length) continue;
        const rt = this.matchRoute(b, stops);
        if (rt) { for (const c of rt.cells) taken.add(c); }
        else { for (const s of stops) taken.add(s); }
      }
      return taken;
    }

    matchRoute(ball, stops) {
      const list = this.cands.get(ball) || [];
      for (const rt of list) {
        if (rt.stops.length !== stops.length) continue;
        let same = true;
        for (let i = 0; i < stops.length; i++) if (rt.stops[i] !== stops[i]) { same = false; break; }
        if (same) return rt;
      }
      return null;
    }

    lockHole(ball, cell) {
      this.solved = this.countSolved();
      this.events.push('hole');
      if (!this.reduceMotion) this.burst(cell, 18);
      const holes = [...this.board.holes];
      const at = holes.indexOf(cell);
      if (at >= 0 && at < this.holeFlash.length) this.holeFlash[at] = 1;
    }

    countSolved() {
      let n = 0;
      for (const [b, stops] of this.lines) {
        const k0 = this.board.balls.get(b);
        if (stops.length === k0 && this.board.holes.has(stops[stops.length - 1])) n++;
      }
      return n;
    }

    undo() {
      const last = this.undoStack.pop();
      if (!last) return false;
      const prev = this.lines.get(last.ball) || [];
      if (prev.length <= last.stops) this.lines.set(last.ball, prev.slice(0, last.stops));
      if (!last.stops) this.lines.delete(last.ball);
      this.selected = last.ball;
      this.moves++;
      this.solved = this.countSolved();
      this.events.push('undo');
      this.refresh();
      return true;
    }

    clearBall(ball) {
      if (ball == null) return false;
      this.lines.delete(ball);
      this.undoStack = this.undoStack.filter((u) => u.ball !== ball);
      this.solved = this.countSolved();
      this.refresh();
      return true;
    }

    // ── 生命周期 ───────────────────────────────────────────────────────
    start() {
      if (this.state === STATE.PLAYING) return false;
      this.state = STATE.PLAYING;
      this.events.push('start');
      return true;
    }

    pause() {
      if (this.state !== STATE.PLAYING) return false;
      this.state = STATE.PAUSED;
      this.events.push('pause');
      return true;
    }

    resume() {
      if (this.state !== STATE.PAUSED) return false;
      this.state = STATE.PLAYING;
      this.events.push('resume');
      return true;
    }

    togglePause() {
      if (this.state === STATE.PLAYING) return this.pause();
      if (this.state === STATE.PAUSED) return this.resume();
      return false;
    }

    // 重开 = 时钟、累加器、粒子、玩家线、撤销栈、临时增益全部归零（不是只调一次 init）
    reset(keepPuzzle = true) {
      this.elapsed = 0;
      this.simSteps = 0;
      this.accumMs = 0;
      this.animClock = 0;
      this.pulse = 0;
      this.lines.clear();
      this.undoStack.length = 0;
      this.selected = this.board ? this.board.cellList()[0] ?? null : null;
      this.moves = 0;
      this.blocked = 0;
      this.solved = 0;
      this.message = '';
      this.messageClock = 0;
      this.shake = 0;
      this.strokeAnim = 1;
      this.strokeAnimBall = -1;
      this.holeFlash.fill(0);
      this.ripples.length = 0;
      this.pX.fill(0); this.pY.fill(0); this.pVX.fill(0); this.pVY.fill(0);
      this.pLife.fill(0); this.pKind.fill(0);
      this.pAlive = 0;
      this.events.length = 0;
      this.inputQueue.length = 0;
      if (keepPuzzle) {
        this.cands = new Map();
        for (const cell of this.board.cellList()) this.cands.set(cell, routesFor(this.board, cell));
        this.rng = makeLcg((0xc0ffee ^ this.seed) >>> 0);
      } else {
        this.build(this.seed + 1, this.tierKey);
      }
      this.state = STATE.PLAYING;
      this.events.push('reset');
      return true;
    }

    nextPuzzle() {
      this.reset(true);
      this.build(this.seed + 1, this.tierKey);
      this.state = STATE.PLAYING;
      this.events.push('next');
      return true;
    }

    setTier(tierKey) {
      this.reset(true);
      this.build(this.seed, tierKey);
      this.state = STATE.PLAYING;
      this.events.push('tier');
      return true;
    }

    setReduceMotion(on) {
      this.reduceMotion = !!on;
      if (on) {
        this.shake = 0;
        this.ripples.length = 0;
        this.pLife.fill(0);
        this.pAlive = 0;
      }
      return this.reduceMotion;
    }

    refresh() {
      if (!this.board) return;
      this.solved = this.countSolved();
      const total = this.board.balls.size;
      if (this.solved === total && this.state === STATE.PLAYING) {
        const answer = [...this.lines.entries()]
          .filter(([b, s]) => s.length === this.board.balls.get(b))
          .map(([b, s]) => ({ start: b, stops: s }));
        const errs = verify(this.board, answer);
        if (!errs.length) {
          this.state = STATE.WON;
          this.events.push('win');
          this.winSecs = Math.round(this.simSteps * SIM_DT * 1000) / 1000;
          this.answerKey = serializeAnswer(answer);
          if (!this.reduceMotion) for (const c of this.board.holes) this.burst(c, 14);
        } else {
          this.message = '看着都进洞了，但规则还差一条：' + errs[0];
          this.messageClock = 0;
        }
      }
    }

    // ── 粒子：只用带种子的 LCG，位置在定步长里积分 ─────────────────────
    burst(cell, n) {
      if (!this.board) return;
      this.phase(() => this.burstNow(cell, n));
    }

    burstNow(cell, n) {
      const [r, c] = this.board.rc(cell);
      for (let i = 0; i < n; i++) {
        const slot = this.allocParticle();
        if (slot < 0) return;
        const a = this.rng() * Math.PI * 2;
        const sp = 0.9 + this.rng() * 2.6;
        this.pX[slot] = c + 0.5;
        this.pY[slot] = r + 0.5;
        this.pVX[slot] = Math.cos(a) * sp;
        this.pVY[slot] = Math.sin(a) * sp - 0.6;
        this.pLife[slot] = 0.55 + this.rng() * 0.5;
        this.pKind[slot] = 1 + ((i + this.simSteps) & 3);
      }
    }

    allocParticle() {
      for (let i = 0; i < PARTICLE_CAP; i++) if (this.pLife[i] <= 0) { this.pAlive = Math.max(this.pAlive, i + 1); return i; }
      return -1;
    }

    ripple(cell) {
      if (this.reduceMotion || !cell && cell !== 0) return;
      this.phase(() => {
        const [r, c] = this.board.rc(cell);
        this.ripples.push({ x: c + 0.5, y: r + 0.5, t: 0 });
        if (this.ripples.length > 12) this.ripples.shift();
      });
    }

    // ── 输入落地：把"玩家在哪一刻按了哪一键"翻译成"第几个定步长边界上做这次改写" ──
    // due = 已走到的仿真钟 + 上一帧周期。帧边界 T 上派发时仿真钟停在 T-帧周期，加回来正好
    // 等于 T 折算出的步号 ⇒ 三档算出同一个步号（暂停期间不推进仿真钟，所以那时排的动作
    // 记在当下步号上，恢复后第一步按 FIFO 落地，同样与刷新率无关）。
    input(fn) {
      const now = this.simSteps * SIM_STEP_MS;
      this.inputQueue.push({ fn, due: this.state === STATE.PAUSED ? now : now + this.lastFrameMs });
      if (this.inputQueue.length > 96) this.inputQueue.shift();
    }

    // 只图外观的改写（粒子撒射、点击涟漪）：在落地表里就跑，在处理器里就排队
    phase(fn) {
      if (this.draining) fn();
      else this.input(fn);
    }

    drainInputs() {
      const boundary = (this.simSteps + 1) * SIM_STEP_MS;
      while (this.inputQueue.length && this.inputQueue[0].due <= boundary + STEP_EPS_MS) {
        const job = this.inputQueue.shift();
        this.draining = true;
        job.fn();
        this.draining = false;
      }
    }

    // 帧入口：吃"这一帧过了多少毫秒"，内部一律按定步长推进
    update(dtMs) {
      let ms = dtMs;
      if (!(ms > 0)) return 0;
      if (ms > MAX_FRAME_MS) ms = MAX_FRAME_MS;
      this.lastFrameMs = ms;
      if (this.state === STATE.PAUSED) { this.accumMs = 0; return 0; }
      this.accumMs += ms;
      let steps = 0;
      while (this.accumMs + STEP_EPS_MS >= SIM_STEP_MS) {
        this.accumMs -= SIM_STEP_MS;
        this.drainInputs();
        this.stepFixed(SIM_DT);
        steps++;
      }
      if (Math.abs(this.accumMs) < STEP_EPS_MS) this.accumMs = 0;
      return steps;
    }

    stepFixed(dt) {
      this.simSteps++;
      this.elapsed += dt;
      this.animClock += dt;
      if (this.state === STATE.TITLE) {
        // 标题态在 reduceMotion 下退化成静图：一个字段都不推进
        if (!this.reduceMotion) this.pulse += dt * Math.PI * 2;
        return;
      }
      if (this.state === STATE.WON) {
        this.integrateParticles(dt);
        this.decay(dt);
        return;
      }
      this.pulse += dt * Math.PI * 2 * (this.reduceMotion ? 0 : 1);
      this.strokeAnim = Math.min(1, this.strokeAnim + dt / 0.22);
      this.messageClock += dt;
      this.decay(dt);
      this.integrateParticles(dt);
      // 空气里的纸屑：概率按 dt 折算（60Hz 下每帧 0.6%），不许写 if (Math.random() < 0.006)
      if (!this.reduceMotion) {
        const p = 1 - Math.pow(1 - 0.006, dt * 60);
        if (this.rng() < p) {
          const slot = this.allocParticle();
          if (slot >= 0) {
            const n = this.board ? this.board.n : 1;
            const cell = Math.floor(this.rng() * n);
            const [r, c] = this.board.rc(cell);
            this.pX[slot] = c + this.rng();
            this.pY[slot] = r + this.rng();
            this.pVX[slot] = (this.rng() - 0.5) * 0.5;
            this.pVY[slot] = -0.25 - this.rng() * 0.3;
            this.pLife[slot] = 1.2 + this.rng() * 1.1;
            this.pKind[slot] = 0;
          }
        }
      }
    }

    decay(dt) {
      const k = Math.pow(0.86, dt * 60);
      this.shake *= k;
      if (this.shake < 1e-4) this.shake = 0;
      for (let i = 0; i < this.holeFlash.length; i++) {
        if (this.holeFlash[i] > 0) this.holeFlash[i] = Math.max(0, this.holeFlash[i] * Math.pow(0.9, dt * 60) - dt * 0.4);
      }
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        this.ripples[i].t += dt;
        if (this.ripples[i].t > 0.7) this.ripples.splice(i, 1);
      }
    }

    integrateParticles(dt) {
      const drag = Math.pow(0.985, dt * 60);
      for (let i = 0; i < this.pAlive; i++) {
        if (this.pLife[i] <= 0) continue;
        this.pLife[i] -= dt;
        if (this.pLife[i] <= 0) { this.pLife[i] = 0; continue; }
        this.pX[i] += this.pVX[i] * dt;
        this.pY[i] += this.pVY[i] * dt;
        this.pVX[i] *= drag;
        this.pVY[i] = this.pVY[i] * drag + dt * 1.6; // 墨点往下落，单位：格/秒²
      }
    }

    // ── 存档口径：只写"重放这一局需要的最小事实" ────────────────────────
    snapshot() {
      return {
        v: 1,
        seed: this.seed,
        tier: this.tierKey,
        board: this.board ? serializeBoard(this.board) : '',
        lines: [...this.lines.entries()].map(([b, s]) => ({ start: b, stops: s.slice() })),
        moves: this.moves,
        blocked: this.blocked,
        winSecs: this.winSecs,
        state: this.state === STATE.PAUSED ? STATE.PLAYING : this.state,
      };
    }

    restore(snap) {
      this.build(snap.seed, snap.tier);
      this.state = STATE.PLAYING;
      this.lines = new Map();
      for (const l of snap.lines || []) {
        if (!this.board.balls.has(l.start)) continue;
        this.lines.set(l.start, (l.stops || []).slice());
      }
      this.moves = snap.moves | 0;
      this.blocked = snap.blocked | 0;
      // 用时**不**从存档里搬回来：那个数是在某一帧的边界上抓的，搬回 this.elapsed 等于
      // 让仿真时钟按刷新率倒退不同的量。恢复的是盘面与动数，计时从继续那一刻接着走。
      this.winSecs = Number(snap.winSecs) || 0;
      this.selected = this.board.cellList()[0] ?? null;
      // 存档里已经是"全进洞"的话，通关那一下的粒子与 winSecs 也得到步号边界上落，
      // 不然这一按会在 30Hz 的第 8 步、120Hz 的第 11 步各撒一批粒子。
      this.phase(() => this.refresh());
      return true;
    }

    // 挂给探针/对拍看的那一份（键名里带 state/phase 是刻意的：官方尺子按名字取状态字段）
    inspect() {
      return {
        state: this.state,
        phase: this.state === STATE.PLAYING ? 'sim-running' : this.state,
        screen: this.state === STATE.TITLE ? 'title' : this.state === STATE.WON ? 'won' : 'board',
        mode: this.shipped ? 'engine' : 'fallback',
        seed: this.seed,
        tier: this.tierKey,
        w: this.board ? this.board.w : 0,
        h: this.board ? this.board.h : 0,
        balls: this.board ? this.board.balls.size : 0,
        holes: this.board ? this.board.holes.size : 0,
        ponds: this.board ? this.board.ponds.size : 0,
        solved: this.solved,
        moves: this.moves,
        blocked: this.blocked,
        selected: this.selected == null ? -1 : this.selected,
        drawn: this.lines.size,
        elapsed: this.elapsed,
        winSecs: this.winSecs,
        simSteps: this.simSteps,
        accumMs: this.accumMs,
        animClock: this.animClock,
        pulse: this.pulse,
        shake: this.shake,
        strokeAnim: this.strokeAnim,
        pAlive: this.pAlive,
        pSum: (() => { let s = 0; for (let i = 0; i < this.pAlive; i++) s += this.pLife[i]; return s; })(),
        reduceMotion: this.reduceMotion,
      };
    }
  }

  const TIER_MENU = TIERS.filter((t) => t.inMenu).map((t) => t.key);

    return { HerugolfGame: HerugolfGame, SIM_DT: SIM_DT, SIM_STEP_MS: SIM_STEP_MS, STATE: STATE, TIER_MENU: TIER_MENU, Board: Board, serializeBoard: serializeBoard, parseBoard: parseBoard, serializeAnswer: serializeAnswer, parseAnswer: parseAnswer, routesFor: routesFor, countSolutions: countSolutions, prepare: prepare, shipPuzzle: shipPuzzle, parseTier: parseTier };
  });

  __def('save', function (__req) {
  // 存档：**两段式解码**。一条坏记录只丢那一条，不许把整局冻死。
  //
  // 为什么不是 `Object.assign(defaults, JSON.parse(raw))`：那一写法在 JSON.parse 抛错时整局没救，
  // 而更阴的是它不抛错 —— 记录里 `runs: null` 会把默认值的数组盖成 null，
  // 于是下一次 runs.push(...) 才炸，炸在离坏数据最远的地方（玩家看到的是"点开就白屏"）。
  // 所以这里：第一段只管"这串是不是 JSON"，第二段逐条记录自己认领自己的形状，坏一条丢一条。
  //
  // 版本：KEY 带 v1；结构再变就换 key，不换 key 的迁移是下一次事故的入口。
  const { TIER_MENU } = __req('game');

  const SAVE_KEY = 'herugolf.save.v1';
  const SAVE_VERSION = 1;

  const INT = (v, lo, hi, dflt) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n)) return dflt;
    const i = Math.round(n);
    return i < lo || i > hi ? dflt : i;
  };
  const NUM = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
  };
  const STR = (v, max, dflt) => (typeof v === 'string' && v.length && v.length <= max ? v : dflt);

  function defaultStore() {
    return {
      v: SAVE_VERSION,
      prefs: { muted: false, tier: TIER_MENU[0], hintOn: true },
      runs: [],
      best: {},
      wins: 0,
      played: 0,
    };
  }

  // 第二段：一条记录 → 干净记录 | null（null = 只丢这一条）
  function sanitizeRun(rec) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    const tier = STR(rec.tier, 16, '');
    if (!TIER_MENU.includes(tier)) return null;
    const seed = INT(rec.seed, 0, 2147483647, NaN);
    if (!Number.isFinite(seed)) return null;
    if (typeof rec.board !== 'string' || rec.board.length > 324) return null;
    const lines = Array.isArray(rec.lines) ? rec.lines : null;
    if (!lines || lines.length > 12) return null;
    const clean = [];
    for (const l of lines) {
      if (!l || typeof l !== 'object') return null;
      const start = INT(l.start, 0, 323, NaN);
      if (!Number.isFinite(start)) return null;
      const stops = Array.isArray(l.stops) ? l.stops : null;
      if (!stops || stops.length > 9) return null;
      const cs = [];
      for (const s of stops) {
        const v = INT(s, 0, 323, NaN);
        if (!Number.isFinite(v)) return null;
        cs.push(v);
      }
      clean.push({ start, stops: cs });
    }
    return {
      seed,
      tier,
      board: rec.board,
      lines: clean,
      moves: INT(rec.moves, 0, 9999, 0),
      blocked: INT(rec.blocked, 0, 9999, 0),
      winSecs: NUM(rec.winSecs, 0, 86400, 0),
      state: STR(rec.state, 12, 'playing'),
    };
  }

  function sanitizePrefs(p) {
    const d = defaultStore().prefs;
    if (!p || typeof p !== 'object') return d;
    return {
      muted: typeof p.muted === 'boolean' ? p.muted : d.muted,
      tier: TIER_MENU.includes(p.tier) ? p.tier : d.tier,
      hintOn: typeof p.hintOn === 'boolean' ? p.hintOn : d.hintOn,
    };
  }

  function sanitizeBest(b) {
    const out = {};
    if (!b || typeof b !== 'object') return out;
    for (const tier of TIER_MENU) {
      const rec = b[tier];
      if (!rec || typeof rec !== 'object') continue;
      const moves = INT(rec.moves, 1, 9999, NaN);
      const secs = NUM(rec.secs, 0, 86400, NaN);
      if (!Number.isFinite(moves) || !Number.isFinite(secs)) continue;
      out[tier] = { moves, secs };
    }
    return out;
  }

  // 第一段 + 第二段。storage 读不到/解不出都退默认值，且**如实报告丢了几条**。
  function loadStore(storage) {
    const report = { parsed: false, droppedRuns: 0, keptRuns: 0, reason: '' };
    let raw = null;
    try {
      raw = storage && typeof storage.getItem === 'function' ? storage.getItem(SAVE_KEY) : null;
    } catch (e) {
      report.reason = 'storage-unavailable';
      return { store: defaultStore(), report };
    }
    if (raw == null || raw === '') {
      report.reason = 'empty';
      return { store: defaultStore(), report };
    }
    let obj = null;
    try {
      obj = JSON.parse(raw); // 段一：只判"是不是合法 JSON"
    } catch (e) {
      report.reason = 'bad-json';
      return { store: defaultStore(), report };
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      report.reason = 'not-an-object';
      return { store: defaultStore(), report };
    }
    report.parsed = true;
    const store = defaultStore();
    store.prefs = sanitizePrefs(obj.prefs); // 段二：每个字段自己认领形状
    store.best = sanitizeBest(obj.best);
    const runs = Array.isArray(obj.runs) ? obj.runs : [];
    for (const rec of runs.slice(0, 24)) {
      const clean = sanitizeRun(rec);
      if (clean) {
        store.runs.push(clean);
        report.keptRuns++;
      } else {
        report.droppedRuns++;
      }
    }
    report.droppedRuns += Math.max(0, runs.length - 24);
    store.wins = INT(obj.wins, 0, 999999, 0);
    store.played = INT(obj.played, 0, 999999, 0);
    return { store, report };
  }

  function writeStore(storage, store) {
    const payload = JSON.stringify({ ...store, v: SAVE_VERSION });
    try {
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(SAVE_KEY, payload);
        return { ok: true, bytes: payload.length };
      }
    } catch (e) {
      return { ok: false, reason: e && e.name ? e.name : 'write-failed', bytes: payload.length };
    }
    return { ok: false, reason: 'no-storage', bytes: payload.length };
  }

  // 把"这一局"并进存档：同 seed 同 tier 就地覆盖，别的记录一条都不许掉。
  // 记录里**不挂时间戳**：数组下标就是"最近优先"，而一个由帧循环顺手抓的 now() 会让同一局在
  // 30Hz 与 120Hz 落下两个不同的数 —— 那是尺的相位，不是玩家的战绩。
  function upsertRun(store, snap) {
    const rec = { ...snap };
    const i = store.runs.findIndex((r) => r.seed === rec.seed && r.tier === rec.tier);
    if (i >= 0) store.runs[i] = rec;
    else store.runs.unshift(rec);
    if (store.runs.length > 24) store.runs.length = 24;
    return store.runs.length;
  }

  function recordWin(store, snap) {
    store.wins = Math.min(999999, store.wins + 1);
    const cand = { moves: INT(snap.moves, 1, 9999, 9999), secs: NUM(snap.winSecs, 0, 86400, 0) };
    const prev = store.best[snap.tier];
    const better = !prev || cand.moves < prev.moves || (cand.moves === prev.moves && cand.secs < prev.secs);
    if (better) store.best[snap.tier] = cand;
    return store.best[snap.tier];
  }

    return { defaultStore: defaultStore, loadStore: loadStore, writeStore: writeStore, upsertRun: upsertRun, recordWin: recordWin, SAVE_KEY: SAVE_KEY, SAVE_VERSION: SAVE_VERSION };
  });

  __def('audio', function (__req) {
  // 声音：静音要**真停**，不是把 gain 拧到 0。
  //
  // 判据（派工简报 §2 的"行为成立"）：
  //   · setMuted(true) ⇒ AudioContext.suspend()，且此后 blip() 在**创建振荡器节点之前**就返回。
  //     只把 master gain 设 0 的那种写法，静音时还在按帧生节点 —— 省电的是玩家，费的是同一台手机。
  //   · 暂停 ⇒ 同样 suspend()；恢复 ⇒ resume()。切后台（visibilitychange）也走这条路。
  //   · 首个手势之前不建 AudioContext（浏览器策略：未交互的 ctx 恒为 suspended，白占资源）。
  //
  // this.voices 是给自己看的账：静音期间它必须不涨。测试与 window 状态都读这一个数。
  const TONES = {
    stroke: { f: 392, dur: 0.09, type: 'triangle', gain: 0.16 },
    hole: { f: 659.25, dur: 0.26, type: 'sine', gain: 0.22 },
    blocked: { f: 138, dur: 0.12, type: 'square', gain: 0.1 },
    win: { f: 880, dur: 0.5, type: 'sine', gain: 0.2 },
    ui: { f: 523.25, dur: 0.05, type: 'sine', gain: 0.09 },
  };

  class Sfx {
    constructor(Ctor) {
      this.Ctor = Ctor || null;
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.voices = 0;
      this.suspends = 0;
      this.resumes = 0;
      this.lastError = '';
    }

    static available() {
      return typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
    }

    ensure() {
      if (this.muted) return null;
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this._resume();
        return this.ctx;
      }
      const Ctor = this.Ctor || (typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!Ctor) {
        this.lastError = 'no-audiocontext';
        return null;
      }
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
      } catch (e) {
        this.lastError = e && e.name ? e.name : 'ctx-failed';
        this.ctx = null;
        this.master = null;
        return null;
      }
      return this.ctx;
    }

    setMuted(on) {
      this.muted = !!on;
      if (this.muted) this._suspend();
      else if (this.ctx) this._resume();
      return this.muted;
    }

    // 暂停/恢复走同一条路：ctx 真的停，节点不再排程
    suspendForPause() { this._suspend(); return this.ctx ? this.ctx.state : 'none'; }
    resumeFromPause() { if (!this.muted) this._resume(); return this.ctx ? this.ctx.state : 'none'; }

    _suspend() {
      if (!this.ctx || this.ctx.state !== 'running' || typeof this.ctx.suspend !== 'function') return;
      this.ctx.suspend();
      this.suspends++;
    }

    _resume() {
      if (!this.ctx || this.ctx.state === 'running' || typeof this.ctx.resume !== 'function') return;
      try { this.ctx.resume(); } catch (e) { this.lastError = 'resume-failed'; return; }
      this.resumes++;
    }

    // 返回 true = 真的排了一个振荡器；false = 静音/无音频设备，一个节点都没建
    blip(name) {
      if (this.muted) return false;
      const spec = TONES[name] || TONES.ui;
      const ctx = this.ensure();
      if (!ctx || !this.master) return false;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(spec.f, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(spec.gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
      if (name === 'hole' || name === 'win') osc.frequency.exponentialRampToValueAtTime(spec.f * 1.5, t + spec.dur * 0.9);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + spec.dur + 0.02);
      this.voices++;
      return true;
    }

    state() {
      return {
        muted: this.muted,
        ctx: this.ctx ? this.ctx.state : 'none',
        voices: this.voices,
        suspends: this.suspends,
        resumes: this.resumes,
        lastError: this.lastError,
      };
    }
  }

    return { Sfx: Sfx };
  });

  __def('board', function (__req) {
  // Canvas 渲染层：只读 game 的状态画，不改它一个字段。
  //
  // 三条口径：
  //   · 格子最小 44 CSS px（派工简报 §2 的命中区下限）。装不下就让画布比视口宽、外层滚动，
  //     而不是把格子压到 28px 冒充"手机上能玩"—— 那是在手机上点 A 打 B。
  //   · 贴图（web/img/*.png）没加载完也要能画：每个 sprite 都有矢量回落，资产是加分项不是依赖。
  //   · reduceMotion 下粒子、涟漪、抖动、脉冲一个都不画；盘面退化成一张静图。
  const MIN_CELL = 44;
  const CELL_MAX = 108;

  const INK = '#1d1a16';
  const INK_SOFT = 'rgba(29,26,22,0.14)';
  const PAPER_FLAT = '#f2ece0';
  const GREEN = '#2f6b4f';
  const WATER = 'rgba(111,147,165,0.42)';
  const VERMILION = '#c2453a';

  function computeLayout(viewW, viewH, board, minCell = MIN_CELL) {
    const pad = Math.max(8, Math.min(24, viewW * 0.03));
    const availW = Math.max(64, viewW - pad * 2);
    const availH = Math.max(64, viewH - pad * 2);
    let cell = Math.floor(Math.min(availW / board.w, availH / board.h));
    cell = Math.max(minCell, Math.min(CELL_MAX, cell));
    const w = cell * board.w;
    const h = cell * board.h;
    return { cell, ox: Math.round(pad + Math.max(0, (availW - w) / 2)), oy: Math.round(pad + Math.max(0, (availH - h) / 2)), w, h, pad };
  }

  function hitCell(layout, board, x, y) {
    const c = Math.floor((x - layout.ox) / layout.cell);
    const r = Math.floor((y - layout.oy) / layout.cell);
    if (!board.inb(r, c)) return -1;
    return board.idx(r, c);
  }

  class Renderer {
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

    return { computeLayout: computeLayout, hitCell: hitCell, Renderer: Renderer, MIN_CELL: MIN_CELL, CELL_MAX: CELL_MAX };
  });

  __def('hud', function (__req) {
  // DOM 那一层：按钮、键盘、指针、说明卡、HUD 读数。它只**调用** game 的方法，不持有玩法。
  //
  // 输入三条硬口径（派工简报 §2）：
  //   · pointerdown 优先，没有 PointerEvent 才回落 touchstart/mousedown；
  //   · 画布坐标一律按 getBoundingClientRect + clientX 换算（CSS 缩放/滚动都算进去），
  //     否则手机上点 A 打 B；
  //   · 键盘覆盖 Enter/Space 开局、P 暂停、R 重开、M 静音、F 全屏、H/? 教学、U 撤销、N 下一局。
  //     Space **不参与暂停**：官方探针会注入 Space，把它当暂停用会让"进没进玩法态"这件事被自己按灭。
  //   · 方向键 = 走一动（0=上 1=右 2=下 3=左，与滑动那条同一套编号），键盘要能打完玩法，不只是开菜单。
  const KEYS = {
    Enter: 'start', ' ': 'start', p: 'pause', P: 'pause', r: 'reset', R: 'reset',
    n: 'next', N: 'next', u: 'undo', U: 'undo', m: 'mute', M: 'mute', f: 'full', F: 'full',
    h: 'help', H: 'help', '?': 'help', Escape: 'close', g: 'hint', G: 'hint',
  };
  const DIR_KEYS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };

  function createHud({ doc, win, game, renderer, sfx, store, onSave, onAudio }) {
    const el = (id) => doc.getElementById(id);
    const ui = {
      canvas: el('board'), boardwrap: el('boardwrap'), msg: el('msg'), overlay: el('overlay'),
      title: el('ov-title'), help: el('ov-help'), start: el('btn-start'), pause: el('btn-pause'),
      undo: el('btn-undo'), reset: el('btn-reset'), next: el('btn-next'), hint: el('btn-hint'),
      mute: el('btn-mute'), full: el('btn-full'), helpBtn: el('btn-help'), close: el('btn-close'),
      tier: el('sel-tier'), statSolved: el('stat-solved'), statMoves: el('stat-moves'),
      statTime: el('stat-time'), statTier: el('stat-tier'), statBest: el('stat-best'), statSrc: el('stat-src'),
      continueBtn: el('btn-continue'),
    };
    const out = { ui, bound: false };

    for (const key of ['8x8/4', '10x10/5', '10x10/6', '12x12/7', '15x15/9', '18x18/11']) {
      const o = doc.createElement('option');
      o.value = key;
      o.textContent = key;
      ui.tier.appendChild(o);
    }
    ui.tier.value = store.store.prefs.tier;

    const say = (text) => {
      ui.msg.textContent = text || '';
    };

    const openOverlay = (which) => {
      ui.overlay.hidden = false;
      ui.title.hidden = which !== 'title';
      ui.help.hidden = which !== 'help';
      out.overlayOpen = which;
    };
    const closeOverlay = () => {
      ui.overlay.hidden = true;
      ui.title.hidden = true;
      ui.help.hidden = true;
      out.overlayOpen = '';
    };

    // ── 画布坐标：CSS → 逻辑（这一步错了，手机上的点击就全偏） ──────────
    const toLogical = (clientX, clientY) => {
      const rect = ui.canvas.getBoundingClientRect();
      const sx = rect.width > 0 ? renderer.viewW / rect.width : 1;
      const sy = rect.height > 0 ? renderer.viewH / rect.height : 1;
      return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
    };

    const act = (name) => {
      switch (name) {
        case 'start':
          if (game.state === 'title') { game.start(); closeOverlay(); sfx.blip('ui'); }
          else if (game.state === 'won') { doNext(); }
          else if (game.state === 'paused') { game.resume(); sfx.resumeFromPause(); }
          break;
        case 'pause':
          if (game.state === 'playing') { game.pause(); sfx.suspendForPause(); say('暂停中（P 继续）'); }
          else if (game.state === 'paused') { game.resume(); sfx.resumeFromPause(); say(''); }
          break;
        case 'reset': {
          const before = { moves: game.moves, lines: game.lines.size, p: game.pAlive, steps: game.simSteps };
          game.reset(true);
          closeOverlay();
          persist();
          say('重开：动数 ' + before.moves + '→' + game.moves + '、玩家线 ' + before.lines + '→' + game.lines.size + '、粒子 ' + before.p + '→' + game.pAlive);
          sfx.blip('ui');
          break;
        }
        case 'next': doNext(); break;
        case 'undo': game.input(() => game.undo()); break;
        case 'mute': {
          const muted = sfx.setMuted(!sfx.muted);
          if (!muted) sfx.resumeFromPause();
          ui.mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
          ui.mute.textContent = muted ? '音效 关' : '音效 开';
          store.store.prefs.muted = muted;
          persist();
          say(muted ? '静音：AudioContext 已 suspend，且不再新建振荡器' : '音效恢复');
          if (onAudio) onAudio(sfx.state());
          break;
        }
        case 'full': doFull(); break;
        case 'help': openOverlay(out.overlayOpen === 'help' ? '' : 'help'); sfx.blip('ui'); break;
        case 'hint': doHint(); break;
        case 'close':
          if (game.state === 'title') openOverlay('title');
          else closeOverlay();
          break;
        default: break;
      }
      sync();
    };

    // 方向键走一动：与滑动那条同一条 game.strokeDir，只是输入设备不同
    const actDir = (dir) => {
      if (game.state === 'title') { act('start'); return; }
      if (game.state !== 'playing') return;
      if (game.strokeDir(dir)) { sfx.blip('stroke'); persist(); }
      else sfx.blip('blocked');
      sync();
    };

    const doNext = () => {
      game.nextPuzzle();
      closeOverlay();
      persist();
      say('第 ' + game.seed + ' 号盘面 · ' + game.tierKey);
      sfx.blip('ui');
    };

    const doFull = () => {
      const de = doc.documentElement;
      const already = doc.fullscreenElement || doc.webkitFullscreenElement;
      try {
        if (already) {
          (doc.exitFullscreen || doc.webkitExitFullscreen || function () {}).call(doc);
        } else if (de.requestFullscreen) de.requestFullscreen();
        else if (de.webkitRequestFullscreen) de.webkitRequestFullscreen();
        else say('这台设备没有全屏 API');
      } catch (e) {
        say('全屏被浏览器拦下了：' + (e && e.name ? e.name : e));
      }
    };

    // 提示：拿铅笔（零猜测求解器）的那条"单走法"，而不是把答案直接画出来
    const doHint = () => {
      if (game.state !== 'playing') { say('先开局才有提示'); return; }
      const list = game.board.cellList();
      for (const b of list) {
        const stops = game.lines.get(b) || [];
        const k0 = game.board.balls.get(b);
        if (stops.length === k0) continue;
        const cands = (game.cands.get(b) || []).filter((rt) => {
          for (let i = 0; i < stops.length; i++) if (rt.stops[i] !== stops[i]) return false;
          return true;
        });
        if (cands.length === 1) {
          const want = stops.length + 1;
          game.selected = b;
          say('提示：' + k0 + ' 号球只剩一条走法，第 ' + want + ' 动往 ' + dirName(stops, cands[0], want) + '（G 再来一条）');
          sfx.blip('ui');
          return;
        }
      }
      say('这一手没有"唯一走法"可指：先想必经格与洞唯一来客');
    };

    const dirName = (stops, route, want) => {
      const from = stops.length ? stops[stops.length - 1] : route.start;
      const to = route.stops[want - 1];
      const [r0, c0] = game.board.rc(from);
      const [r1, c1] = game.board.rc(to);
      if (r1 < r0) return '上';
      if (r1 > r0) return '下';
      if (c1 > c0) return '右';
      return '左';
    };

    const persist = () => {
      if (onSave) onSave();
    };

    // ── 指针：pointerdown 优先，回落 touch/mouse ───────────────────────
    const drag = { active: false, x0: 0, y0: 0, cell: -1, moved: false };

    const onDown = (x, y, pointerId) => {
      if (game.state === 'title') { act('start'); return; }
      if (game.state !== 'playing') return;
      const [lx, ly] = toLogical(x, y);
      const cell = hit(lx, ly);
      drag.active = true;
      drag.x0 = x;
      drag.y0 = y;
      drag.cell = cell;
      drag.moved = false;
      if (cell >= 0) game.ripple(cell);
      if (pointerId != null && ui.canvas.setPointerCapture) {
        try { ui.canvas.setPointerCapture(pointerId); } catch (e) { /* 桩里没有也不影响 */ }
      }
    };

    const onMove = (x, y) => {
      if (!drag.active) return;
      const dx = x - drag.x0;
      const dy = y - drag.y0;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
      drag.moved = true;
      const target = drag.cell >= 0 ? drag.cell : game.selected;
      if (target != null && game.board.balls.has(target)) game.selected = target;
      if (game.strokeDir(dir)) { sfx.blip('stroke'); persist(); }
      else sfx.blip('blocked');
      drag.x0 = x;
      drag.y0 = y;
      sync();
    };

    const onUp = (x, y) => {
      if (!drag.active) return;
      const wasSwipe = drag.moved;
      drag.active = false;
      if (wasSwipe || game.state !== 'playing') return;
      const [lx, ly] = toLogical(x, y);
      const cell = hit(lx, ly);
      if (cell < 0) return;
      if (game.board.balls.has(cell)) {
        game.select(cell);
        sfx.blip('ui');
      } else if (game.selected != null) {
        if (game.strokeTo(cell)) { sfx.blip('stroke'); persist(); }
        else sfx.blip('blocked');
      }
      if (game.state === 'won') { sfx.blip('win'); persist(); }
      sync();
    };

    const hit = (lx, ly) => hitCellSafe(lx, ly);
    const hitCellSafe = (lx, ly) => {
      if (!game.board) return -1;
      const L = renderer.layout;
      if (!L) return -1;
      const c = Math.floor((lx - L.ox) / L.cell);
      const r = Math.floor((ly - L.oy) / L.cell);
      if (!game.board.inb(r, c)) return -1;
      return game.board.idx(r, c);
    };

    const bind = () => {
      if (out.bound) return;
      out.bound = true;
      if (win.PointerEvent && ui.canvas.addEventListener) {
        ui.canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(e.clientX, e.clientY, e.pointerId); });
        ui.canvas.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
        ui.canvas.addEventListener('pointerup', (e) => onUp(e.clientX, e.clientY));
        ui.canvas.addEventListener('pointercancel', () => { drag.active = false; });
      } else {
        if (ui.canvas.addEventListener) {
          ui.canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; onDown(t.clientX, t.clientY, null); }, { passive: true });
          ui.canvas.addEventListener('touchmove', (e) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: true });
          ui.canvas.addEventListener('touchend', (e) => { const t = (e.changedTouches || [])[0] || { clientX: drag.x0, clientY: drag.y0 }; onUp(t.clientX, t.clientY); }, { passive: true });
          ui.canvas.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY, null));
          ui.canvas.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
          ui.canvas.addEventListener('mouseup', (e) => onUp(e.clientX, e.clientY));
        }
      }

      const onKey = (e) => {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '')) return;
        const dir = DIR_KEYS[e.key];
        const name = KEYS[e.key];
        if (dir === undefined && !name) return;
        e.preventDefault();
        if (dir !== undefined) { actDir(dir); return; }
        act(name);
      };
      // 只绑 document，不"顺手"再绑一份 window：真浏览器里 keydown 先过 document 再冒泡到 window，
      // 两边都绑 = 按一下跑两次（撤销按一次少两动）。document 没有 addEventListener 才退回 window。
      if (doc.addEventListener) doc.addEventListener('keydown', onKey);
      else if (win.addEventListener) win.addEventListener('keydown', onKey);

      const map = {
        'btn-start': 'start', 'btn-pause': 'pause', 'btn-reset': 'reset', 'btn-next': 'next',
        'btn-undo': 'undo', 'btn-mute': 'mute', 'btn-full': 'full', 'btn-help': 'help',
        'btn-hint': 'hint', 'btn-close': 'close', 'btn-close-2': 'close',
      };
      for (const [id, name] of Object.entries(map)) {
        const node = el(id);
        if (node && node.addEventListener) node.addEventListener('click', () => act(name));
      }
      if (ui.continueBtn && ui.continueBtn.addEventListener) {
        ui.continueBtn.addEventListener('click', () => {
          if (out.resumeRun && out.resumeRun()) closeOverlay();
          sync();
        });
      }
      if (ui.tier.addEventListener) {
        ui.tier.addEventListener('change', () => {
          store.store.prefs.tier = ui.tier.value;
          game.setTier(ui.tier.value);
          persist();
          say('换档：' + ui.tier.value);
          sync();
        });
      }
      if (doc.addEventListener) {
        doc.addEventListener('visibilitychange', () => {
          if (doc.hidden && game.state === 'playing') { game.pause(); sfx.suspendForPause(); sync(); }
        });
      }
    };

    const fmt = (secs) => {
      const s = Math.max(0, Math.floor(secs));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    };

    const sync = () => {
      const total = game.board ? game.board.balls.size : 0;
      if (ui.statSolved) ui.statSolved.textContent = game.solved + '/' + total;
      if (ui.statMoves) ui.statMoves.textContent = String(game.moves);
      if (ui.statTime) ui.statTime.textContent = fmt(game.elapsed);
      if (ui.statTier) ui.statTier.textContent = game.tierKey;
      if (ui.statSrc) ui.statSrc.textContent = game.shipped ? '引擎双条件认证' : '退到官方例题';
      const best = store.store.best[game.tierKey];
      if (ui.statBest) ui.statBest.textContent = best ? best.moves + ' 动 / ' + fmt(best.secs) : '—';
      if (ui.pause) ui.pause.textContent = game.state === 'paused' ? '继续 P' : '暂停 P';
      if (ui.start) ui.start.textContent = game.state === 'title' ? '開始 Enter' : game.state === 'won' ? '下一局 Enter' : '游戏中';
      if (game.message && game.messageClock < 4 && ui.msg.textContent !== game.message) say(game.message);
      if (game.state === 'won' && ui.msg.textContent === '') say('全部进洞 · ' + game.moves + ' 动 / ' + fmt(game.elapsed));
    };

    out.act = act;
    out.actDir = actDir;
    out.sync = sync;
    out.say = say;
    out.bind = bind;
    out.closeOverlay = closeOverlay;
    out.openOverlay = openOverlay;
    out.toLogical = toLogical;
    return out;
  }

    return { createHud: createHud, KEYS: KEYS, DIR_KEYS: DIR_KEYS };
  });

  __def('main', function (__req) {
  // 引导层：把 core（无 DOM）+ render + ui 接起来，跑 rAF，管资产与 service worker。
  //
  // 三条不是可有可无的口径：
  //   · 窗口状态挂出去（window.Herugolf / window.HerugolfState）：任何探针读不到状态的仓，
  //     判据都无法复验 —— 那一行"结论：无法比对"就是这么来的。
  //   · file:// 下整段跳过 SW 注册且不抛未捕获异常（本仓的产物要能被双击打开）。
  //   · 帧 dt 只喂给 game.update()，渲染层不参与推进仿真；暂停时 update 直接返回 0 步。
  const { HerugolfGame, SIM_DT, SIM_STEP_MS } = __req('game');
  const { Renderer } = __req('board');
  const { createHud } = __req('hud');
  const { Sfx } = __req('audio');
  const { loadStore, writeStore, upsertRun, recordWin, SAVE_KEY } = __req('save');

  const ART = [
    ['paper', 'web/img/paper-256.png'],
    ['pond', 'web/img/pond-128.png'],
    ['ball', 'web/img/ball-96.png'],
    ['hole', 'web/img/hole-96.png'],
    ['particles', 'web/img/particles-128.png'],
  ];

  function boot(doc, win) {
    const now = () => (win.performance && win.performance.now ? win.performance.now() : 0);
    const storage = (() => {
      try { return win.localStorage || null; } catch (e) { return null; }
    })();

    const store = loadStore(storage);
    const mq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduced = !!(mq && mq.matches);

    const game = new HerugolfGame({ seed: 7, tierKey: store.store.prefs.tier, reduceMotion: reduced, clock: now });
    const canvas = doc.getElementById('board');
    const renderer = new Renderer(canvas);
    const sfx = new Sfx(win.AudioContext || win.webkitAudioContext || null);
    if (store.store.prefs.muted) sfx.setMuted(true);

    const wrap = doc.getElementById('boardwrap');
    const viewSize = () => {
      const rect = wrap && wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : null;
      const w = (rect && rect.width) || win.innerWidth || 960;
      const h = (rect && rect.height) || win.innerHeight || 700;
      return [w, h];
    };
    const relayout = () => {
      const [w, h] = viewSize();
      renderer.resize(w, h, game.board);
    };

    const out = {};
    const save = () => {
      const snap = game.snapshot();
      upsertRun(store.store, snap);
      if (game.state === 'won') recordWin(store.store, snap);
      const r = writeStore(storage, store.store);
      out.lastWrite = r;
      return r;
    };

    const hud = createHud({ doc, win, game, renderer, sfx, store, onSave: save, onAudio: null });
    hud.resumeRun = () => {
      const run = store.store.runs[0];
      if (!run) { hud.say('没有可继续的存档'); return false; }
      game.restore(run);
      hud.say('继续存档：seed ' + run.seed + ' · ' + run.tier);
      relayout();
      return true;
    };
    hud.bind();

    // 有存档就把最近一局端上来（不是只写不读的装饰性 localStorage 键）
    if (store.store.runs.length) {
      const run = store.store.runs[0];
      game.restore(run);
      hud.say('已继续上一局（seed ' + run.seed + ' · ' + run.tier + '）');
    }
    if (store.store.prefs.muted) {
      hud.ui.mute.setAttribute('aria-pressed', 'true');
      hud.ui.mute.textContent = '音效 关';
    }
    relayout();
    hud.openOverlay('title');
    hud.sync();

    const loaded = {};
    if (typeof win.Image === 'function') {
      for (const [key, src] of ART) {
        const img = new win.Image();
        loaded[key] = img;
        img.onload = () => renderer.setArt(loaded);
        img.src = src;
      }
    }

    if (mq) {
      const onMq = () => game.setReduceMotion(!!mq.matches);
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }
    if (win.addEventListener) {
      win.addEventListener('resize', relayout);
      win.addEventListener('orientationchange', relayout);
    }

    // 上一段动完就落一次档；win 也落（win 走 save 里的 recordWin）
    let lastState = game.state;
    let lastMoves = game.moves;
    let frames = 0;
    // 用开机那一刻做基准，而不是"第一帧只记账不推进"：后者每次吞掉整整一帧的墙钟，
    // 吞多少随刷新率变化（3 虚拟秒下 30/60/120Hz 实测 356/358/359 步）—— 那本身就是帧率依赖。
    // 首帧 dt 偏大由 game.update 里那条 250ms 上限兜住，不需要哨兵。
    let last = now();

    const frame = (t) => {
      const stamp = typeof t === 'number' ? t : now();
      let dt = stamp - last;
      last = stamp;
      if (!(dt >= 0)) dt = 0;
      game.update(dt);
      if (game.events.length) {
        for (const e of game.events) {
          if (e === 'hole') sfx.blip('hole');
          else if (e === 'win') sfx.blip('win');
          else if (e === 'blocked') sfx.blip('blocked');
        }
        game.events.length = 0;
      }
      if (game.state !== lastState || game.moves !== lastMoves) {
        lastState = game.state;
        lastMoves = game.moves;
        save();
        hud.sync();
      }
      renderer.draw(game);
      frames++;
      if (win.requestAnimationFrame) win.requestAnimationFrame(frame);
    };

    // 探针/对拍读的就是这一份，而且它是**活视图**（getter 转发），不是每 8 帧抄一次的快照。
    // 抄那份是实测出来的坑：官方尺子按完按钮的同一刻就读状态，中间不推进帧 ——
    // 活对象说 playing、抄本还说 title，于是三档各自走上不同的注入路径（seed 7 vs 8 就是这么来的）。
    const view = () => game.inspect();
    const published = {};
    const expose = (k) => Object.defineProperty(published, k, { enumerable: true, get: () => view()[k] });
    for (const k of Object.keys(view())) expose(k);
    const exposeAt = (k, get) => Object.defineProperty(published, k, { enumerable: true, get });
    exposeAt('audio', () => sfx.state());
    exposeAt('art', () => Object.keys(loaded).length);
    // 帧计数**不**进这份视图：它按定义随刷新率变化（30/60/120 各 90/180/360），挂在状态面上
    // 等于让"跨档可比"这件事自己红一条 —— 要看它在 api.frames() 上。
    // 粒子真值是共享数组（就地改写），直接挂引用
    published.pX = game.pX;
    published.pY = game.pY;
    published.pVX = game.pVX;
    published.pVY = game.pVY;
    published.pLife = game.pLife;
    published.pKind = game.pKind;
    const publish = () => published;

    const api = {
      game, renderer, hud, sfx, store, sfxState: () => sfx.state(),
      state: published,
      start: () => { hud.act('start'); return game.state; },
      startLevel: (seed, tier) => {
        if (seed != null || tier != null) game.build(seed == null ? game.seed : Number(seed), tier || game.tierKey);
        game.state = 'playing';
        relayout();
        hud.sync();
        return game.state;
      },
      pause: () => { game.pause(); sfx.suspendForPause(); return game.state; },
      resume: () => { game.resume(); sfx.resumeFromPause(); return game.state; },
      reset: () => { game.reset(true); relayout(); return game.state; },
      saveKey: SAVE_KEY,
      simDt: SIM_DT,
      simStepMs: SIM_STEP_MS,
      publish,
    };

    Object.assign(out, { game, renderer, hud, sfx, store, api, frames: () => frames, published });
    win.Herugolf = api;
    win.HerugolfState = published;
    win.game = api;

    if (win.requestAnimationFrame) win.requestAnimationFrame(frame);

    // SW：file:// 下整段跳过（那条路径下注册必然抛，且抛在玩家第一次双击 index.html 的时候）
    const isFile = win.location && win.location.protocol === 'file:';
    if (!isFile && 'serviceWorker' in (win.navigator || {})) {
      try {
        const reg = win.navigator.serviceWorker.register('sw.js');
        if (reg && reg.catch) reg.catch(() => { out.swError = 'register-rejected'; });
      } catch (e) {
        out.swError = e && e.name ? e.name : 'register-failed';
      }
    } else {
      out.swSkipped = isFile ? 'file://' : 'no-sw-api';
    }

    return out;
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const start = () => { window.__herugolf = boot(document, window); };
    if (document.readyState === 'loading' && document.addEventListener) {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

    return { boot: boot };
  });

  var __entry = __req("main");
  return { __req: __req, boot: __entry.boot, keys: ["rng","grid","routes","verify","counter","pencil","generate","game","save","audio","board","hud","main"] };
})();
if (typeof window !== 'undefined') { window.HerugolfBundle = HerugolfBundle; }
