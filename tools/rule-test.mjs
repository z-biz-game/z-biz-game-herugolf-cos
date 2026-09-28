#!/usr/bin/env node
// 规则表逐条验收：五条命名规则每一条都要
//   ① 在自己的夹具盘上 **fire**，且核对 fired/touched/结论（哪个球落哪个洞、哪一格归谁）
//   ② 结论被**独立穷举计数器**复核：
//        订洞 ⇒ 把该球钉在"不落这个洞"的候选上必须 0 解
//        订格 ⇒ 把该球钉在"不经过这个格"的候选上必须 0 解
//        删候选 ⇒ 把该球钉在被删的那条候选上必须 0 解
//      （pins 通道：js/engine/counter.js:countSolutions 的 pins 参数，出货路径不用它）
//   ③ 真解不许被杀：跑完这一圈，每一球的**真候选**必须还活着
//   ④ 在别人的夹具盘上必须**闭嘴**（silentOn 表，量出来的分工，不是愿望）
//   ⑤ 矛盾出口只落在真该报它的规则上；纯删值规则（必经格/两球两洞）不许抢那一句
// 外加真值证人一：verify(Nikoli 官方 5×5, 官方解答) 必须无错（模型不许比出版物宽松），
// 以及一整张表都闷、题面却多解的"必须猜"证人（铅笔不完备 ⇒ 出货必须是双条件）。
//
// 期望值全部是手写的（人话推理写在夹具的 note 里），不是从当前输出抄的 —— 红了就修引擎。
import { fx, RULE_BOARDS, RULE_FIXTURES, TABLE_STALL, officialBoard, officialAnswer, dropClue } from './scenarios.js';
import { serializeBoard } from '../js/engine/grid.js';
import { verify, answerKey } from '../js/engine/verify.js';
import { countSolutions, prepare, stopKey } from '../js/engine/counter.js';
import { RULE_ORDER, RULE_TEXT, RULE_WEIGHT, runRule, freshState, solve } from '../js/engine/pencil.js';

let checks = 0;
const fails = [];
const notes = [];
function ok(cond, name, detail = '') {
  checks++;
  if (!cond) fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return !!cond;
}
const COUNTER_BUDGET = 200_000; // 夹具盘（5×5/6×6、2~4 球）用不到的量级，撞预算就是夹具写坏了

// ── 夹具串的自证：抄错一格就当场红（上一轮的教训：手敲下标造出过假案）──
const BOARDS = {};
for (const [key, spec] of Object.entries(RULE_BOARDS)) {
  const b = fx(`夹具${key}`, spec.flat, spec.cols, spec.note);
  BOARDS[key] = b;
  ok(serializeBoard(b) === spec.flat.replace(/\//g, ''), `夹具 ${key} 的串必须与 serializeBoard 往返相同`, `${serializeBoard(b)}`);
  const c = countSolutions(b, { limit: 3, budgetNodes: COUNTER_BUDGET });
  ok(!c.stopped && c.count === 1, `夹具 ${key} 必须是预算内的唯一解盘（独立计数器）`, `count=${c.count} stopped=${c.stopped}`);
}

// ── ① 规则表自洽 ────────────────────────────────────────────────────────
{
  ok(new Set(RULE_ORDER).size === RULE_ORDER.length, '规则表：RULE_ORDER 无重复', RULE_ORDER.join(','));
  for (const k of RULE_ORDER) {
    ok(typeof RULE_TEXT[k] === 'string' && RULE_TEXT[k].length > 8, `规则表：${k} 有人话`, RULE_TEXT[k] || '(缺)');
    ok(Number.isInteger(RULE_WEIGHT[k]) && RULE_WEIGHT[k] >= 1, `规则表：${k} 有权重`, String(RULE_WEIGHT[k]));
    let threw = false;
    try {
      runRule('__nope__', freshState(BOARDS.A));
    } catch {
      threw = true;
    }
    ok(threw, '规则表：runRule 对未知规则名必须炸（不许静默返回 null）');
    ok(k in RULE_FIXTURES, `规则表：${k} 有夹具条目`);
  }
}

// ── ② 逐条规则：fire / 计数器复核 / 真解不杀 / silentOn / 出口 ──────────────
for (const key of RULE_ORDER) {
  const F = RULE_FIXTURES[key];
  if (!ok(BOARDS[F.board], `夹具：${key} 指向存在的盘 ${F.board}`)) continue;
  const board = BOARDS[F.board];
  const prep = prepare(board);
  const truth = countSolutions(board, { limit: 2, budgetNodes: COUNTER_BUDGET });
  if (!ok(!truth.stopped && truth.count === 1, `${key}：夹具盘必须被计数器数成唯一解`, `${truth.count}/${truth.stopped}`)) continue;
  const truthRoute = new Map(truth.sols[0].map((x) => [x.start, x.route]));

  const st = freshState(board);
  const res = runRule(key, st);
  const E = F.expect;
  ok(!st.contradiction, `${key}：夹具盘上不许报矛盾（它是唯一解盘）`, String(st.contradiction));
  ok(res.fired === E.fired, `${key}：fired 必须等于期望`, `期望 ${E.fired}，实得 ${res.fired}`);
  ok(res.touched === E.touched, `${key}：开口次数必须等于期望`, `期望 ${E.touched}，实得 ${res.touched}`);
  ok(st.fires[key] === E.fired, `${key}：账必须记在本规则名下`, `fires[${key}]=${st.fires[key]}`);
  for (const other of RULE_ORDER) {
    if (other === key) continue;
    ok(st.fires[other] === 0, `${key}：本圈不许记到别的规则头上（归因干净）`, `${other}=${st.fires[other]}`);
  }

  const holeClaims = st.log.filter((x) => x.kind === 'hole');
  const cellClaims = st.log.filter((x) => x.kind === 'cell');
  const prunes = st.log.filter((x) => x.kind === 'prune');
  ok(holeClaims.length === E.holes.length, `${key}：订洞条数`, `期望 ${E.holes.length}，实得 ${holeClaims.length}`);
  ok(cellClaims.length === E.cells, `${key}：订格条数`, `期望 ${E.cells}，实得 ${cellClaims.length}`);
  ok(prunes.length === E.prunes, `${key}：删候选批次`, `期望 ${E.prunes}，实得 ${prunes.length}`);
  for (const [ballCell, hole] of E.holes) {
    const i = prep.balls.indexOf(ballCell);
    ok(holeClaims.some((x) => x.ball === i && x.hole === hole), `${key}：必须订下「球 ${ballCell} 落 H ${hole}」`, JSON.stringify(holeClaims.map((x) => `${prep.balls[x.ball]}→${x.hole}`)));
  }
  if (E.firstCell) {
    const [ballCell, cell] = E.firstCell;
    const i = prep.balls.indexOf(ballCell);
    ok(cellClaims[0] && cellClaims[0].ball === i && cellClaims[0].cell === cell, `${key}：第一句必须订「格 ${cell} 归球 ${ballCell}」`, JSON.stringify(cellClaims[0]));
  }

  // ③ 真解不许被杀
  for (let i = 0; i < prep.balls.length; i++) {
    const tRoute = truthRoute.get(prep.balls[i]);
    const tIdx = prep.cands[i].findIndex((c) => stopKey(c) === stopKey(tRoute));
    ok(tIdx >= 0 && st.alive[i].includes(tIdx), `${key}：球 ${prep.balls[i]} 的真候选必须还活着`, `alive=[${st.alive[i]}] 真=${tIdx}`);
  }

  // ② 独立计数器复核每一条结论
  const pinTo = (ballCell, route) => {
    const pins = new Map([[ballCell, stopKey(route)]]);
    const c = countSolutions(board, { limit: 2, budgetNodes: COUNTER_BUDGET, pins });
    if (c.stopped) {
      ok(false, `${key}：pins 复核撞预算（夹具盘不该有这种事）`, `${ballCell}`);
      return -1;
    }
    return c.count;
  };
  for (const claim of holeClaims) {
    const ballCell = prep.balls[claim.ball];
    ok(claim.hole === truthRoute.get(ballCell).hole, `${key}：订的洞必须与计数器那一解相同`, `球 ${ballCell}：订 ${claim.hole}，真 ${truthRoute.get(ballCell).hole}`);
    let bad = 0;
    for (const c of prep.cands[claim.ball]) if (c.hole !== claim.hole && pinTo(ballCell, c) !== 0) bad++;
    ok(bad === 0, `${key}：订洞「球 ${ballCell} → H ${claim.hole}」的独立复核（钉到别的洞必须 0 解）`, `${bad} 条钉上后仍有解`);
  }
  for (const claim of cellClaims) {
    const ballCell = prep.balls[claim.ball];
    ok(truthRoute.get(ballCell).cells.includes(claim.cell), `${key}：订的格必须在计数器那一解的线上`, `格 ${claim.cell}`);
    let bad = 0;
    for (const c of prep.cands[claim.ball]) if (!c.cells.includes(claim.cell) && pinTo(ballCell, c) !== 0) bad++;
    ok(bad === 0, `${key}：订格「格 ${claim.cell} 归球 ${ballCell}」的独立复核（钉到不经过它的候选必须 0 解）`, `${bad} 条钉上后仍有解`);
  }
  for (const p of prunes) {
    const ballCell = prep.balls[p.ball];
    let bad = 0;
    for (const j of p.gone) if (pinTo(ballCell, prep.cands[p.ball][j]) !== 0) bad++;
    ok(bad === 0, `${key}：删掉的候选必须"钉上就 0 解"（独立复核）`, `${bad}/${p.gone.length} 条其实还在某个解里`);
  }

  // ④ silentOn：别人的夹具盘上本规则必须连一步都迈不出去
  for (const other of F.silentOn) {
    const s2 = freshState(BOARDS[other]);
    const r2 = runRule(key, s2);
    ok(r2.fired === 0 && !s2.contradiction, `${key} 在夹具 ${other} 上必须闭嘴`, `fired=${r2.fired} contra=${s2.contradiction || '-'}`);
  }

  // ⑤ 出口
  if (F.contra) {
    const v = dropClue(board, ...F.contra.drop);
    const c = countSolutions(v, { limit: 2, budgetNodes: COUNTER_BUDGET });
    ok(c.count === 0 && !c.stopped, `${key} 的矛盾夹具：计数器必须独立说 0 解`, `count=${c.count} stopped=${c.stopped}`);
    const s3 = freshState(v);
    runRule(key, s3);
    ok(!!s3.contradiction, `${key}：0 解盘上本规则必须报矛盾`, s3.contradiction || '没报');
    const whole = solve(v);
    ok(!!whole.contradiction, `${key}：0 解盘整张表必须报矛盾`, String(whole.contradiction));
    notes.push(`${key} contra：${F.contra.why}｜计数器 0 解｜报的是「${s3.contradiction}」`);
  }
  if (F.pruneOnly) {
    const v = dropClue(board, ...F.pruneOnly.drop);
    const c = countSolutions(v, { limit: 2, budgetNodes: COUNTER_BUDGET });
    ok(c.count === 0, `${key} 的 0 解夹具：计数器必须独立说 0`, `count=${c.count}`);
    const s4 = freshState(v);
    runRule(key, s4);
    ok(!s4.contradiction, `${key}：纯删值规则不许抢矛盾那一句`, String(s4.contradiction));
    const whole = solve(v);
    ok(!!whole.contradiction, `${key}：0 解盘整张表必须有人报矛盾`, whole.solved ? '全推完了 yet 0 解' : '闷住而没人报');
    notes.push(`${key} pruneOnly：${F.pruneOnly.note}｜0 解盘由「${whole.contradiction}」报出`);
  }
  notes.push(`${key} 夹具 ${F.board}：fired=${res.fired} 订洞 ${holeClaims.length} 订格 ${cellClaims.length} 删批次 ${prunes.length}｜${RULE_BOARDS[F.board].note}`);
}

// ── ⑥ 整张表都闷、题面却多解 = 铅笔不完备的证人 ────────────────────────────
{
  const base = BOARDS[TABLE_STALL.board];
  const v = dropClue(base, ...TABLE_STALL.drop);
  const c = countSolutions(v, { limit: 3, budgetNodes: COUNTER_BUDGET });
  ok(!c.stopped && c.count >= 2, '闷局夹具必须仍是"有解且不止一解"（否则证人没意义）', `count=${c.count} stopped=${c.stopped}`);
  const p = solve(v);
  ok(!p.solved && !p.contradiction, '整张表在这盘上必须**闷**（不是矛盾）—— 这就是"必须猜"的形状', `solved=${p.solved} contra=${p.contradiction}`);
  ok(p.steps === 0, '整张表在这盘上连一步都迈不出去', `steps=${p.steps}`);
  ok(prepare(v).cands.some((x) => x.length > 1), '而且候选表并非只有一条 ⇒ 唯一性是计数器给的，不是铅笔给的');
  notes.push(`整表闷局：${TABLE_STALL.note}｜计数器 ${c.count} 解、铅笔 0 步 —— 这一族盘不进出货（generate 的双条件闸）`);
}

// ── 真值证人一：Nikoli 官方 5×5 的解答必须无错 ─────────────────────────────
{
  const b = officialBoard();
  const ans = officialAnswer();
  const errs = verify(b, ans);
  ok(errs.length === 0, '证人一 verify(官方 5×5, 官方解答) 必须无错（模型不许比出版物宽松）', errs.slice(0, 3).join(' / '));
  const prep = prepare(b);
  for (const s of ans) {
    const cands = prep.cands[prep.balls.indexOf(s.start)];
    ok(cands.some((c) => stopKey(c) === stopKey({ stops: s.stops })), `证人一：官方解里球 ${s.start} 的那一条必须在候选表里`, `${s.stops.join('-')}`);
  }
  console.log(`证人一 verify(官方5×5, 官方解答) = ${errs.length ? 'FAIL ' + errs.slice(0, 3).join(' / ') : 'PASS'}（候选表 ${prep.cands.map((x) => x.length).join('/')}，官方三条走法都在表里）`);
  notes.push(`官方 5×5：${answerKey(ans)}`);
}

// ── 打印 ──────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`  · ${n}`);
console.log(`\n规则表：${RULE_ORDER.join(' → ')}`);
console.log(`断言 ${checks} 条，红 ${fails.length} 条`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(`RESULT rule-test ok=${fails.length === 0} checks=${checks} fails=${fails.length}`);
process.exit(fails.length ? 1 : 0);
