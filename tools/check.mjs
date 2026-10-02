#!/usr/bin/env node
// npm test / CI 的总门：三道静态门（语法、引擎禁词、清单自证）→ 逐个跑逻辑套件 → 逐条读它们打印的 RESULT 行。
//
// 为什么静态门跑在逻辑门前面：引擎里混进一个 Math.random 或 process.env，逻辑测试**当天**还是全绿的
// （node 恰好有那个环境变量、或者随机数恰好站在正确答案那边），红的是三个月后的部署站点或另一台机器。
// 所以这几条不许靠"跑一遍看看"，必须在读源码的门里就打死。
//
// 为什么要**数 RESULT 的行数**：套件被改名、被漏跑、spawn 失败但退出码没传上来，
// 这三种情况都会表现为"绿了，但少跑了一套"——而"少跑一套"正是这一族门禁最常见的腐化方式
// （上一轮这里只跑 node --check，六套逻辑全在门外面跑，红的那条 hole-two-balls 就没人接）。
// 所以：清单里的套件必须在磁盘上存在、必须真的跑起来、必须打 RESULT 行、RESULT 自报名必须等于
// 由文件名算出的那一个、ok 必须 true、fails 必须 0、checks 必须 > 0，且收到的行数必须等于清单长度。
//
// 第一阶段只有纯 Node 部分：没有 server.cjs、没有 tools/verify.sh（浏览器壳与 Electron 壳都还没开工，
// 它们的入口不许写进来，写了就是空头承诺）。仓根的 _tmp-* 临时探针一律跳过 —— 它们不归门禁管，
// 但也不许混进 commit（.gitignore 里那条是安全带，不是许可证）。
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// tests/ 是"从临时探针里救出来的证人"，语法门与逻辑门都要走一遍这个目录，
// 否则第一个红会变成"测试文件写坏了没人发现"。
const DIRS = ['js', 'tools', 'tests'];
const EXTS = ['.js', '.mjs', '.cjs'];
const EXTRA_JS = ['server.cjs']; // 浏览器壳落地的那一轮点名：根上的服务器不在 js/tools/tests 任何一棵树下
const SHELLS = ['tools/verify.sh']; // 统一入口落地的那一轮点名：树里出现的每个 shell 脚本都要过 bash -n
const SKIP = (name) => name.startsWith('_tmp-');
const MIN_SOURCE_FILES = 15; // js/engine 7 + tools 5 + tests 3（现测 15）：少了就是目录被清空/改名
const ENGINE_DIR = 'js/engine';
const ENGINE_MODULES = ['counter.js', 'generate.js', 'grid.js', 'pencil.js', 'rng.js', 'routes.js', 'verify.js'];
const MIN_TEST_FILES = 3; // tests/ 下至少三张证人（r3-crossing / r4-pond / hole-two-balls）

// 清单：tools 里点名的四套（三套逻辑 + 夹具的三条真值证人）+ 两处自动发现：
//   tools/*-test.mjs —— 下一轮加进来的 golden-test 一落地就自动进闸，不许出现"进了 package.json
//                        却没进门禁"的那种套件；
//   tests/*.test.mjs —— 同上，一张新证人不必改这里。
// 删一张则因为 MIN_*_SUITES 与「收到的 RESULT 行数 ≠ 清单长度」当场红 —— 漏跑比跑红更危险。
const REQUIRED_SUITES = ['tools/rule-test.mjs', 'tools/pencil-test.mjs', 'tools/counter-test.mjs', 'tools/scenarios.js'];
const MIN_TOOL_SUITES = 3; // tools/*-test.mjs 至少三套（rule/pencil/counter）

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile() && EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

// RESULT 的自报名由文件名算出：tools/rule-test.mjs → rule-test、tests/r3-crossing.test.mjs → r3-crossing-test。
// 改了文件名不改 RESULT 标签（或反过来）就是"两套证人变成一套 / 一套被当成没跑"，必须红。
function suiteName(rel) {
  const base = rel.split('/').pop().replace(/\.(mjs|js|cjs)$/, '');
  return rel.startsWith('tests/') ? `${base.replace(/\.test$/, '')}-test` : base;
}

let checks = 0;
let fails = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    fails++;
    console.error(`  ✗ ${msg}`);
  }
  return !!cond;
};

/* ---------- 1) 语法门 ---------- */
const files = DIRS.map((d) => join(ROOT, d))
  .filter((d) => existsSync(d))
  .reduce((acc, d) => walk(d, acc), []);
for (const rel of EXTRA_JS) if (existsSync(join(ROOT, rel))) files.push(join(ROOT, rel));
ok(files.length >= MIN_SOURCE_FILES, `只找到 ${files.length} 个源文件（至少 ${MIN_SOURCE_FILES}），目录名不对？`);
let jsBad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    jsBad++;
    ok(false, `node --check ${relative(ROOT, f)}\n${(r.stderr || '').trim()}`);
  }
}
let shellBad = 0;
const presentShells = SHELLS.filter((rel) => existsSync(join(ROOT, rel)));
for (const rel of presentShells) {
  const r = spawnSync('bash', ['-n', join(ROOT, rel)], { encoding: 'utf8' });
  if (r.status !== 0) {
    shellBad++;
    ok(false, `bash -n ${rel}\n${(r.stderr || '').trim()}`);
  }
}
const shellNote = presentShells.length
  ? `；bash -n：${presentShells.length - shellBad}/${presentShells.length} 个 shell 脚本${shellBad ? `，失败 ${shellBad} 个` : '，零失败'}`
  : '；bash -n：本阶段还没有 shell 脚本';
console.log(`语法门：node --check ${files.length - jsBad}/${files.length} 个文件通过（${DIRS.join('、')} 下所有 ${EXTS.join('/')}，跳过 _tmp-*）${shellNote}`);

/* ---------- 2) 引擎侧禁词：判定路径上不许有随机数、时间、环境 ----------
 * Math.random      : seed 必须是纯函数；一次随机 = node 与 Chrome 画出两张不同盘（家族里已经栽过）
 * Date.now / new Date / performance.now : 判定路径上不许有时间，也不许把墙钟当输入
 * process.env      : 测量口径属于调用方（tools/ 那一层），引擎读 env 就等于把出货口径交给部署环境
 * require / node:  : 引擎是纯 ESM 零运行时依赖；读了 Node 内置模块就带不进浏览器，也就进不了 Pages 产物
 */
const FORBID = [
  ['Math.random', /Math\.random/],
  ['Date.now / new Date', /Date\.now|\bnew Date\b/],
  ['performance.now', /performance\.now/],
  ['process.env', /process\.env/],
  ['require(', /\brequire\s*\(/],
  ['node: 内置模块（from）', /from\s+['"]node:/],
  ['node: 内置模块（动态 import）', /import\s*\(\s*['"]node:/],
];
const engineDir = join(ROOT, ENGINE_DIR);
ok(existsSync(engineDir), `没有 ${ENGINE_DIR} 目录：禁词门无源可查`);
const engineFiles = existsSync(engineDir) ? walk(engineDir, []) : [];
ok(engineFiles.length === ENGINE_MODULES.length, `${ENGINE_DIR} 应该有 ${ENGINE_MODULES.length} 个文件（${ENGINE_MODULES.join('/')}），实为 ${engineFiles.length} 个`);
for (const want of ENGINE_MODULES) ok(existsSync(join(engineDir, want)), `${ENGINE_DIR}/${want} 不在了（引擎七模块少一个，门禁的清单就得同步改）`);
let tokenHits = 0;
for (const f of engineFiles) {
  const src = readFileSync(f, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); // 注释里谈禁词是文档，不是违规
  for (const [name, re] of FORBID) {
    if (re.test(code)) {
      tokenHits++;
      ok(false, `${relative(ROOT, f)}：判定路径上出现「${name}」`);
    }
  }
}
console.log(`禁词门：${engineFiles.length} 个引擎文件 × ${FORBID.length} 个禁词，注释外命中 ${tokenHits} 处`);

/* ---------- 3) 清单门：package.json 的每条 scripts 必须指向磁盘上真的有的入口 ----------
 * 空头承诺的形状很具体：scripts 里写了 tools/ceiling.mjs，而那个文件还没落库。
 * 照 README 敲 `npm run ceiling` 的人拿到的是 ERR_MODULE_NOT_FOUND，而 npm test 全程绿灯 ——
 * 下面那道逻辑门只跑它自己清单里的套件，看不见清单外面那三条没落地的别名。
 */
const pkgPath = join(ROOT, 'package.json');
ok(existsSync(pkgPath), '没有 package.json：清单门无源可查');
let pkgScripts = {};
if (existsSync(pkgPath)) {
  try {
    pkgScripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts || {};
  } catch (e) {
    ok(false, `package.json 解析失败：${e.message}`);
  }
}
const ENTRY = /(?:^|\s)(?:node|bash)\s+(\S+\.(?:mjs|cjs|js|sh))\b/;
const namedEntries = Object.entries(pkgScripts).map(([name, cmd]) => [name, cmd, ENTRY.exec(String(cmd))]);
const withEntries = namedEntries.filter(([, , m]) => m);
ok(withEntries.length === namedEntries.length, `scripts 里有 ${namedEntries.length - withEntries.length} 条跑了 node/bash 却没点名文件入口（${namedEntries.filter(([, , m]) => !m).map(([n, c]) => `${n}=${c}`).join('、')}）：门拒绝猜它跑的是什么`);
for (const [name, cmd, m] of withEntries) ok(existsSync(join(ROOT, m[1])), `scripts.${name} =「${cmd}」指向 ${m[1]}，磁盘上没有这个文件`);
const missingEntries = withEntries.filter(([, , m]) => !existsSync(join(ROOT, m[1])));
console.log(`清单门：package.json 的 ${Object.keys(pkgScripts).length} 条 scripts 中 ${withEntries.length} 条点名了文件入口，${missingEntries.length ? `缺 ${missingEntries.length} 个（${missingEntries.map(([n]) => n).join('、')}）` : '全部在磁盘上'}`);

/* ---------- 4) 逻辑套件：逐条断言各自的 RESULT 行 ---------- */
const relOf = (p) => relative(ROOT, p).split('\\').join('/');
const discoveredTests = existsSync(join(ROOT, 'tests')) ? walk(join(ROOT, 'tests'), []).filter((p) => p.endsWith('.test.mjs')).map(relOf) : [];
const discoveredTools = existsSync(join(ROOT, 'tools')) ? walk(join(ROOT, 'tools'), []).filter((p) => p.endsWith('-test.mjs')).map(relOf) : [];
ok(discoveredTests.length >= MIN_TEST_FILES, `tests/ 下只发现 ${discoveredTests.length} 张 *.test.mjs（至少 ${MIN_TEST_FILES}）：证人被删了还是目录改名了？`);
ok(discoveredTools.length >= MIN_TOOL_SUITES, `tools/ 下只发现 ${discoveredTools.length} 套 *-test.mjs（至少 ${MIN_TOOL_SUITES}）：同上，套数少了就是闸松了。`);
for (const rel of REQUIRED_SUITES) ok(existsSync(join(ROOT, rel)), `清单里的套件 ${rel} 不在磁盘上（改名/删除就是漏跑，不许静默掉）`);

const suites = [...new Set([...REQUIRED_SUITES, ...discoveredTools, ...discoveredTests])];
const got = [];
for (const rel of suites) {
  const name = suiteName(rel);
  if (!existsSync(join(ROOT, rel))) continue; // 上面已经算红一次，这里不再 spawn
  const r = spawnSync(process.execPath, [rel], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const line = out.split('\n').reverse().find((l) => l.startsWith('RESULT ')) || '';
  const m = /^RESULT\s+(\S+)\s+ok=(\S+)\s+checks=(\d+)\s+fails=(\d+)/.exec(line);
  if (!ok(!!m, `${name}: 没打印 RESULT 行（退出码 ${r.status}）\n${out.slice(-800)}`)) continue;
  got.push(name);
  ok(m[1] === name, `${name}: RESULT 自称 ${m[1]}，与由文件名算出的套件名不符`);
  ok(m[2] === 'true' && Number(m[4]) === 0 && r.status === 0, `${name}: ok=${m[2]} fails=${m[4]} 退出码=${r.status}\n${out.split('\n').filter((l) => l.startsWith('  ✗')).slice(0, 8).join('\n')}`);
  ok(Number(m[3]) > 0, `${name}: checks=0，等于没断言`);
  // 把每套自己的 RESULT 行**原样**再念一遍：CI 那一侧数的就是这些行。
  // 只报一条聚合行的话，"少跑了一套"在门禁那一侧读不出来——它看到的永远是 1 行绿。
  console.log(line);
}
ok(got.length === suites.length, `只收到 ${got.length}/${suites.length} 套 RESULT（清单 ${suites.length} 条）：漏了 ${suites.filter((s) => !got.includes(suiteName(s))).join(' ') || '无'} —— 少跑一套就是这一族门禁最常见的腐化`);

console.log(`\n合计：源文件 ${files.length}、引擎 ${engineFiles.length}、套件 ${suites.length}（点名 ${REQUIRED_SUITES.length} + tools 自动发现 ${discoveredTools.length} + tests 自动发现 ${discoveredTests.length}）、跑成 ${got.length}`);
console.log(`RESULT check ok=${fails === 0} checks=${checks} fails=${fails}`);
process.exit(fails === 0 ? 0 : 1);
