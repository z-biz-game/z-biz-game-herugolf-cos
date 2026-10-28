#!/usr/bin/env node
// 存档的证人：判的是 js/store.js 的**行为**，不是"代码里出现过 localStorage"。
//
// 为什么要有这一张：静态尺子只能看见 getItem/setItem 这两个串，而真正会红给玩家的
// 四种事故都不在串里 ——
//   ① 写进去的东西读不回来（宿主给的对象 setItem 静默失败，或 iOS 隐私模式当场抛）；
//   ② 一条坏记录把整局冻死（JSON.parse 抛错、或 `v` 对不上时整份存档消失且不留痕迹，
//      界面分不清"第一次打开"与"档坏了"）；
//   ③ 恢复出来的局和存进去的局不是同一局（tier/seed/cells/动数/提示数任一漂掉，
//      玩家按「继续」看到的可能就是另一盘）；
//   ④ seed 游标回退（换一局拿到同一个 seed，页面上印的 seed 7 就不再是那一张盘）。
// 所以这里跑真回路：真 Store → 真写 → 换一个 storage 实例读回 → 逐字段比；
// 坏档与隐私模式两侧各给一个"退回默认但留下 lastLoad 证据"的断言。
import { Store, STORAGE_KEY } from '../js/store.js';
import { TIERS } from '../js/engine/generate.js';

const TIER = TIERS[0].key;
const tierOf = (k) => TIERS.find((t) => t.key === k) || null;

let checks = 0;
const fails = [];
const check = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
const eq = (a, b, msg) => check(Object.is(a, b), `${msg}（期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}）`);

// 可替换的介质桩：每个实例自带一张 map，读/写/删都真的走一遍（共享一张就等于没测到"换实例"）。
// writes 是可数的：断言"确实落了盘"不能只看内存里那个对象。
const mem = (init = {}) => {
  const map = { ...init };
  const s = {
    map, writes: 0, failWrite: false, failRead: false,
    getItem(k) { if (s.failRead) throw new Error('SecurityError'); return k in map ? map[k] : null; },
    setItem(k, v) { if (s.failWrite) throw new Error('QuotaExceededError'); s.writes++; map[k] = String(v); },
    removeItem(k) { delete map[k]; },
  };
  return s;
};
const SNAP = { tier: TIER, seed: 7, cells: '4:1-17-25;8:32-48-56', strokes: 6, hints: 1, elapsedMs: 91000, savedAt: 1700000000000 };

// ── ① 无档：第一次打开不许被当成"档坏了" ──
{
  const s = new Store(mem());
  eq(s.lastLoad.ok, true, '无档时 lastLoad.ok');
  eq(s.lastLoad.why, '没有存档', '无档时 lastLoad.why 说得清"没档"');
  eq(s.get('sound'), true, '无档时 settings.sound 取默认 true');
  eq(s.get('motion'), true, '无档时 settings.motion 取默认 true');
  eq(s.peekSeed(), 1, '无档时 seed 游标从 1 起');
  eq(s.resume(tierOf), null, '无档时 resume 为 null');
  eq(Object.keys(s.data.best).length, 0, '无档时 best 为空');
  eq(s.data.totals.solved + s.data.totals.hints + s.data.totals.ms, 0, '无档时 totals 三项全 0');
}

// ── ② 真回路：写 → 换实例读 → 逐字段对得上 ──
{
  const media = mem();
  const a = new Store(media);
  a.set('sound', false);
  eq(a.peekSeed(), 1, 'takeSeed 之前 peekSeed 不会自己前进');
  eq(a.takeSeed(), 1, '第一次换一局拿到 1');
  eq(a.takeSeed(), 2, '第二次换一局拿到 2');
  a.putResume(SNAP);
  const rec = a.record(TIER, { strokes: 6, hints: 1, ms: 91000 });
  eq(rec.improved, true, '第一次成绩一定刷新纪录');
  check(media.writes >= 4, `每个写入口都真的落了盘（writes=${media.writes}）`);

  const b = new Store(media);
  eq(b.lastLoad.ok, true, '读回时 lastLoad.ok');
  eq(b.get('sound'), false, '读回 settings.sound 是写进去的 false');
  eq(b.get('motion'), true, '没写过的设置读回默认 true（深合并，不是整块覆盖）');
  eq(b.peekSeed(), 3, 'seed 游标跨实例继续（下一次换一局是 3）');
  const r = b.resume(tierOf);
  check(!!r, '读回 resume 非 null');
  for (const k of ['tier', 'seed', 'cells', 'strokes', 'hints', 'elapsedMs', 'savedAt']) {
    eq(r && r[k], SNAP[k], `resume.${k} 原样读回`);
  }
  eq(b.data.best[TIER] && b.data.best[TIER].strokes, 6, 'best 的动数读回');
  eq(b.data.totals.solved, 1, 'totals.solved 读回');
  check(typeof b.data.best[TIER].at === 'number' && b.data.best[TIER].at > 0, 'best.at 是一个真实时间戳');
}

// ── ③ resume 的形状闸：形状不对的档不许冒充"能续" ──
{
  const s = new Store(mem());
  const bad = (patch, msg) => {
    s.putResume({ ...SNAP, ...patch });
    eq(s.resume(tierOf), null, msg);
  };
  bad({ tier: '9x9/4' }, '不认识的档位不许续');
  bad({ seed: 1.5 }, '非整数 seed 不许续');
  bad({ cells: 42 }, '非字符串 cells 不许续');
  bad({ strokes: '6' }, '字符串 strokes 不许续');
  bad({ hints: null }, 'null hints 不许续');
  s.data.resume = SNAP;
  check(!!s.resume(tierOf), '形状全对的快照可以续（上面每一条坏档都有正对照）');
  s.clearResume();
  eq(s.resume(tierOf), null, 'clearResume 之后续不上');
}

// ── ④ 坏档：退回默认，但必须留下"坏在哪一条"的证据 ──
{
  const media = mem({ [STORAGE_KEY]: '{not json' });
  const s = new Store(media);
  eq(s.lastLoad.ok, false, '坏 JSON：lastLoad.ok=false');
  check(/解析失败/.test(s.lastLoad.why), `坏 JSON：why 说得出是解析失败（实得「${s.lastLoad.why}」）`);
  eq(s.lastLoad.raw, '{not json', '坏 JSON：原文留在 lastLoad.raw（界面要能说出"档是坏的"）');
  eq(s.get('sound'), true, '坏 JSON：设置退回默认');
  eq(s.peekSeed(), 1, '坏 JSON：seed 游标退回 1，不会卡在 0');
  eq(s.data.totals.solved, 0, '坏 JSON：战绩不会带半截');
  s.set('sound', false);
  eq(JSON.parse(media.map[STORAGE_KEY]).settings.sound, false, '坏档之后仍能正常写入（不是永久只读）');
}
{
  const media = mem({ [STORAGE_KEY]: JSON.stringify({ v: 2, settings: { sound: false } }) });
  const s = new Store(media);
  eq(s.lastLoad.ok, false, '版本不对：lastLoad.ok=false');
  eq(s.get('sound'), true, '版本不对：不许把 v2 的字段硬塞进 v1');
}

// ── ⑤ 隐私模式：读抛、写抛都不许把这一局带走 ──
{
  const media = mem();
  media.failRead = true;
  const s = new Store(media);
  eq(s.lastLoad.ok, false, 'setItem/getItem 抛错时 lastLoad.ok=false');
  check(/读不到存档/.test(s.lastLoad.why), `读抛时 why 点名"读不到存档"（实得「${s.lastLoad.why}」）`);
  media.failRead = false;
  media.failWrite = true;
  let threw = '';
  try { s.set('sound', false); s.takeSeed(); } catch (e) { threw = e.message; }
  eq(threw, '', '写抛时 Store 不向上抛（隐私模式还能继续玩）');
  eq(s.get('sound'), false, '写失败不影响本局内存里的设置');
}

// ── ⑥ 深合并：缺字段的档只补缺的那几个，不把整份结构换成默认 ──
{
  const media = mem({ [STORAGE_KEY]: JSON.stringify({ v: 1, settings: { sound: false }, seedCounter: 0 }) });
  const s = new Store(media);
  eq(s.lastLoad.ok, true, '缺字段的 v1 档仍算读成功');
  eq(s.get('sound'), false, '缺字段：写过的 sound 保留');
  eq(s.get('motion'), true, '缺字段：没写过的 motion 补默认');
  eq(s.peekSeed(), 1, 'seedCounter 为 0 时修回 1');
  eq(s.data.totals.solved, 0, '缺 totals 时补默认 0');
}

// ── ⑦ 纪录比较：先提示数、再动数、最后时间；三条都要有正反两面 ──
{
  const s = new Store(mem());
  const probe = (hints, strokes, ms) => s.record(TIER, { hints, strokes, ms }).improved;
  eq(probe(1, 6, 90000), true, '首纪录：刷新');
  eq(probe(2, 1, 1000), false, '提示数更多：不算更好（哪怕动数少得多）');
  eq(probe(1, 7, 1000), false, '同提示、动数更多：不算更好（哪怕时间更短）');
  eq(probe(1, 6, 91000), false, '同提示同动数、时间更长：不算更好');
  eq(probe(1, 5, 99999), true, '同提示、动数更少：刷新（时间不参与这一层的否定）');
  eq(probe(0, 5, 100), true, '提示数更少：刷新');
  eq(s.data.best[TIER].hints, 0, 'best 记的是最新那次更好成绩的提示数');
  eq(s.data.best[TIER].strokes, 5, 'best 记的是最新那次更好成绩的动数');
  eq(s.data.totals.solved, 6, '每一次通关都记进 totals.solved（不管破没破纪录）');
  eq(s.data.totals.hints, 1 + 2 + 1 + 1 + 1 + 0, 'totals.hints 是每次真实提示数之和');
  eq(s.data.totals.ms, 90000 + 1000 + 1000 + 91000 + 99999 + 100, 'totals.ms 是每次真实用时之和');
}

// ── ⑧ seed 游标：只增不减，且新开局一定拿到没出现过的号 ──
{
  const media = mem();
  const a = new Store(media);
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(a.takeSeed());
  eq(seen.size, 6, '连续六次换一局拿到六个不同的 seed');
  const b = new Store(media);
  eq(b.peekSeed(), 7, '重开页面后游标接着走（不会拿回已经用过的 1）');
  check(b.peekSeed() > Math.max(...seen), '游标严格大于历史最大号（"同一个 seed + 同一档必同一张盘"的前提）');
}

const res = `RESULT save-test ok=${fails.length === 0} checks=${checks} fails=${fails.length}`;
if (fails.length) for (const f of fails) console.error('  ✗ ' + f);
console.log(res);
process.exit(fails.length === 0 ? 0 : 1);
