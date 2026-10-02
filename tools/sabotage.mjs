// 破坏试验台账：把每一类谎各写回代码/文档一遍，看闸会不会**点名**变红。
//
// 用法：node tools/sabotage.mjs          跑 README「破坏试验台账」里的全部刀，并把实测 rc 写回那张表
//       node tools/sabotage.mjs K1 K3    只跑点名的几把（调试用；不回写 rc）
//
// 为什么要有这个文件：一份全绿的报告只说明"这一轮没有东西坏"，它没说**闸会不会红**。
// 台账每一行那个退出码必须由脚本把 rc 读回来，不能抄。
//
// 六条硬规矩（机制照 z-biz-game-kurotto-cos/tools/sabotage.mjs，只把"改完再 git 恢复"换成"改临时副本"）：
//   1. 刀打在**临时副本**上：workspace 根的 `../_tmp-herugolf-sab-<刀号>/`，跑完删掉。共享工作区里
//      绝对不许出现 `git checkout --` / `git restore` / `git reset` 那类恢复动作——它会把别的车道正在写的东西抹掉。
//   2. 针必须唯一命中：0 次或 >1 次都是 ERROR——"打不中却一声不响跑完"是台账最坏的失败。
//      台账那张表自己会把针抄一遍，所以数命中的时候把 `| K… |` 那些行摘掉再数。
//   3. rc != 0 **且**输出点名了它那一条 FAIL 行才算红；语法炸了也是 rc != 0，但那不是闸红。
//   4. 一把刀没弄红（或没点名）就整体判红并点名，不回写任何 rc。
//   5. 全部刀红完之后，不带刀整跑两道常驻闸要求全绿——台账的前提是"把刀拔了之后闸本来就是绿的"。
//   6. 副本里跑的仍是同一份 doctest：不改判据、不改阈值、不改输入清单。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_PARENT = dirname(ROOT); // workspace 根：scratch 一律 _tmp- 前缀，不放 /tmp
const read = p => readFileSync(join(ROOT, p), 'utf8');
const PH = String.fromCharCode(1);
const stripTicks = s => (/^`.*`$/.test(s) ? s.slice(1, -1) : s);
const die = msg => { console.log(`  ERROR ${msg}`); process.exit(2); };

const sh = (cmd, cwd, timeout) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || ''),
    timedOut: !!r.error && r.error.code === 'ETIMEDOUT' };
};

// ---- 台账的刀是从 README 那张表里解析出来的：文档改了，跑的就是改后的那一版 ----
const readmePath = 'README.md';
const readme0 = read(readmePath);
const ledgerRows = readme0.split('\n').filter(l => /^\| K\d+ \| /.test(l));
const parse = l => l.replace(/\\\|/g, PH).split('|').slice(1, -1).map(c => c.trim().replace(new RegExp(PH, 'g'), '|'));
const knives = ledgerRows.map(l => {
  const c = parse(l);
  if (c.length !== 8) die(`台账那一行的列数不是 8：${l.slice(0, 40)}…（解析到 ${c.length} 列）`);
  return { id: c[0], where: c[1], file: stripTicks(c[2]), needle: stripTicks(c[3]),
    repl: stripTicks(c[4]).replace(/\\n/g, '\n'), expect: stripTicks(c[5]), cmd: stripTicks(c[6]), rc: c[7], raw: l };
});
if (knives.length < 3) die(`台账只解析到 ${knives.length} 把刀（至少 3 把：文档数字 / 代码常数 / 解析器 needle 各一）`);
const only = process.argv.slice(2);
const picked = only.length ? knives.filter(k => only.includes(k.id)) : knives;
if (only.length && picked.length !== only.length) die(`点名的刀有几把不在台账上：${only.filter(x => !picked.some(k => k.id === x)).join(' ')}`);

// ---- 预检：针唯一命中；期望点名的那条断言得真的写在闸里 ----
const harness = read('tools/doctest.mjs');
const target = (src, needle) => {   // 命中在哪一处：台账行自己会把针抄一遍，那些命中不算
  const lines = src.split('\n');
  const ledger = lines.map((l, i) => /^\| K\d+ \| /.test(l) ? i : -1).filter(i => i >= 0);
  const isLedger = pos => {
    let up = 0;
    for (let i = 0; i < lines.length; i++) { up += lines[i].length + 1; if (up > pos) return ledger.includes(i); }
    return false;
  };
  const at = [];
  for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) if (!isLedger(i)) at.push(i);
  return at;
};
for (const k of picked) {
  let src;
  try { src = read(k.file); } catch { die(`${k.id} 的文件不存在：${k.file}`); }
  const at = target(src, k.needle);
  if (at.length !== 1) die(`${k.id} 的针在 ${k.file} 的台账行之外命中 ${at.length} 次（必须恰好 1 次；打不中或打多了都不许跑）`);
  if (k.repl === k.needle) die(`${k.id} 的「改成」与针相同，这一刀不会改变任何东西`);
  // 断言名里带模板插值（如 `D7c ${label}线 球数 ${b}`）时整串不会原样出现在源码里：
  // 拆成「拉丁段 / 汉字段」的碎片逐个查，改名或删断言时碎片必然消失，预检仍然是死的。
  const frags = k.expect.split(/[\s，：]+/).flatMap(t => t.split(/(?<=[A-Za-z0-9])(?=[\u4e00-\u9fff])|(?<=[\u4e00-\u9fff])(?=[A-Za-z0-9])/)).filter(Boolean);
  const missing = frags.filter(f => !harness.includes(f) && !(k.expect.includes(f) && false));
  if (!harness.includes(k.expect) && missing.length) die(`${k.id} 期望点名的「${k.expect}」在 tools/doctest.mjs 里找不到（缺碎片 ${missing.join('/')}；断言被改名或删掉了）`);
  console.log(`  预检 ${k.id} · ${k.file} 针唯一命中 · 期望点名「${k.expect}」`);
}

const timeoutFor = cmd => (/doctest/.test(cmd) ? 240000 : 300000);
const results = [];
for (const k of picked) {
  const dir = join(SCRATCH_PARENT, `_tmp-herugolf-sab-${k.id}`);
  rmSync(dir, { recursive: true, force: true });
  const rs = sh(`mkdir -p '${dir}' && rsync -a --exclude '.git' --exclude '_tmp-*' '${ROOT}/' '${dir}/'`, ROOT, 120000);
  if (rs.rc !== 0) die(`${k.id} 的副本建不起来（rsync rc=${rs.rc}）：${rs.out.slice(0, 200)}`);
  const fp = join(dir, k.file);
  const src = readFileSync(fp, 'utf8');
  const at = target(src, k.needle);
  if (at.length !== 1) { rmSync(dir, { recursive: true, force: true }); die(`${k.id} 落刀前副本里针的命中数变成 ${at.length} 了`); }
  writeFileSync(fp, src.slice(0, at[0]) + k.repl + src.slice(at[0] + k.needle.length));
  const t0 = Date.now();
  const r = sh(k.cmd, dir, timeoutFor(k.cmd));
  // 只 rc != 0 不算红；点名的那一行还必须是红行（FAIL）——标签被抄在一条通过的断言上不算闸认出了这把刀。
  const named = r.out.split('\n').filter(l => l.includes(k.expect) && /FAIL|RED/.test(l));
  const log = join(ROOT, `_tmp-herugolf-sab-${k.id}.log`);
  writeFileSync(log, `${k.cmd}（在 ${dir} 的副本里）\n针：${k.needle} → ${k.repl}\nGATE_RC=${r.rc} 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n${'='.repeat(60)}\n${r.out}`);
  rmSync(dir, { recursive: true, force: true }); // 只改临时副本，跑完删掉
  const okKnife = r.rc !== 0 && named.length > 0 && !r.timedOut;
  results.push({ id: k.id, rc: r.rc, named: named.length, secs: +(((Date.now() - t0) / 1000).toFixed(1)), log, ok: okKnife, timedOut: r.timedOut });
  console.log(`  ${okKnife ? '红得住' : '没红/没点名'} ${k.id} · rc=${r.rc} 点名 ${named.length} 行 · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${log.replace(ROOT + '/', '')}`);
  for (const l of named.slice(0, 2)) console.log(`      ${l.trim().slice(0, 140)}`);
  if (r.timedOut) console.log('      （超时被掐：这不是闸红）');
}

const bad = results.filter(x => !x.ok);
if (bad.length) die(`有 ${bad.length} 把刀没红或没点名（${bad.map(x => x.id).join(' ')}）：README 保持原样，不回写任何 rc`);
const subset = only.length > 0;
if (subset) {
  console.log('\n点名的调试跑：不跑对照整跑、不回写 README（台账要的是整跑一遍，不给参数才行）。');
  process.exit(0);
}

// ---- 不带刀整跑：台账的前提是"把刀拔了之后两道闸本来就是绿的" ----
const controls = [['check', 'node tools/check.mjs'], ['doctest', 'node tools/doctest.mjs']];
for (const [name, cmd] of controls) {
  const r = sh(cmd, ROOT, timeoutFor(cmd));
  writeFileSync(join(ROOT, `_tmp-herugolf-sab-control-${name}.log`), `${cmd}\nGATE_RC=${r.rc}\n${'='.repeat(60)}\n${r.out}`);
  if (r.rc !== 0) die(`不带刀整跑时 ${name} 竟然红了（rc=${r.rc}）：先看 _tmp-herugolf-sab-control-${name}.log`);
  console.log(`  对照 ${name} · rc=0（刀拔干净了，副本也没留下东西：${existsSync(join(SCRATCH_PARENT, '_tmp-herugolf-sab-K1')) ? '残留!' : '已删'}）`);
}

// ---- 回写实测 rc：只动每行末尾那一格 ----
let out = readme0;
for (const k of picked) {
  const idx = out.indexOf(k.raw);
  if (idx < 0) die(`回写时找不到台账那一行了：${k.id}`);
  const rc = results.find(x => x.id === k.id).rc;
  // 台账格既可能是首次的「?」，也可能是上一轮复跑的数：两种都要能改写，
  // 且改写前后不一样时要把「这一行变了」打印出来，而不是悄悄覆盖。
  const tail = k.raw.match(/([\d?]+) \|\s*$/);
  if (!tail) die(`${k.id} 那一行末尾不是「<rc> |」，不知道该怎么回写：${k.raw.slice(-40)}`);
  const newline = k.raw.replace(/([\d?]+) \|\s*$/, `${rc} |`);
  if (tail[1] !== String(rc)) console.log(`  台账 ${k.id} 的实测 rc 从「${tail[1]}」改成「${rc}」（以本轮实跑为准）`);
  out = out.slice(0, idx) + newline + out.slice(idx + k.raw.length);
}
writeFileSync(join(ROOT, readmePath), out);
console.log(`\n回写了 ${picked.length} 行的实测 rc；台账的每一行现在都带一个由脚本读回来的数。`);
