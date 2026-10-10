// 文档是被断言的面：README 里印出去的每一个「现值」都必须等于代码或闸的现在值。
//
// 为什么要有这个文件：上一轮那条车道自己写了"读数全部来自本机复跑"，而这句话只由它的自觉守着。
// 引擎断言有 tools/check.mjs 复测，难度线有 balance 复测，页面文案有 playtest 复测 —— 只有散文没有。
// 散文可以一直抄下去，直到某天代码改了字、文档还在引用上一个世界的数。
//
// 规矩（照 z-biz-game-kurotto-cos/tools/doctest.mjs 的机制，不自创一套）：
//   * 每一条等式都配一条「解析到几行」的反空转断言 —— 正则没命中不是绿，是红；
//   * 只比现值，不复测读数：墙钟 ms 这类会漂的量在这里只比"文档写的数 vs 代码里的线"的方向与来源，
//     绝不重新计时，也绝不把新测的 ms 写回文档；
//   * 只有探针（workspace 根的 `_tmp-herugolf-*.mjs`，不在仓里、clone 不到）或 200 盘的 balance
//     才能证的数，一律进下面的 UNPINNED 清单：不硬钉成等式，但每条都带一个 needle 断言它**还在文档里**。
//     删掉那句话来变绿 = 红。
//   * 抽样量与命中量是两个分母（每档 200 盘 / 发火 12 盘），这里只把分母钉成 SAMPLES 现值，
//     绝不跨分母比出"相对结论"。
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS, SIZES, parseTier } from '../js/engine/generate.js';
import { RULE_ORDER, RARE_RULES } from '../js/engine/pencil.js';
import { DIRS } from '../js/engine/grid.js';
import { OFFICIAL, RULE_FIXTURES, OFFICIAL_MUTATIONS } from '../tools/scenarios.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
const emitted = new Set();
let rows = 0;
const ok = (cond, label, detail) => {
  rows++;
  emitted.add(label.match(/^D\d+/)[0]);
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const README = read('README.md');
const LEDGER_RE = /^\| K\d+ \| .*$/gm;
const DOC = README.replace(LEDGER_RE, ''); // 台账行会把针与"改成"各抄一遍：数字扫描不许撞上它们
const FLAT = README.replace(/[\s\n]+/g, ' ');
const FLATDOC = DOC.replace(/[\s\n]+/g, ' '); // 台账那类的读数会被 markdown 折行，比对时先压平
const PKG = JSON.parse(read('package.json'));
const CHECK_SRC = read('tools/check.mjs');
const SAB_SRC = read('tools/sabotage.mjs');
const BAL = stripComments(read('tools/balance.mjs'));
const BAL_RAW = read('tools/balance.mjs');
const PROBE_SRC = stripComments(read('tools/generator-probe.mjs'));
const GEN = stripComments(read('js/engine/generate.js'));
const PLAY = read('tools/playtest.cjs');
const SERVER = read('server.cjs');
const SCEN = read('tools/scenarios.js');
const ROUTES = read('js/engine/routes.js');

const run = (rel, ms) => {
  const r = spawnSync(process.execPath, [join(ROOT, rel)], { encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024 });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const CHECK = run('tools/check.mjs', 180000); // 1.2s：本仓唯一的自动闸，跑得起
const PROBE = run('tools/generator-probe.mjs', 300000); // 1.8s：REP=120 × 六个菜单档，纯函数口径

// ---- D1 逻辑套件的断言条数：文档抄的每个数 == check.mjs 现场跑出来的 RESULT 行 ----
const results = [...CHECK.out.matchAll(/^RESULT (\S+) ok=(\S+) checks=(\d+) fails=(\d+)$/gm)]
  .map(m => ({ name: m[1], green: m[2] === 'true' && m[4] === '0', checks: +m[3] }));
const byName = Object.fromEntries(results.map(r => [r.name, r.checks]));
const totalLine = CHECK.out.match(/合计：源文件 (\d+)、引擎 (\d+)、套件 (\d+)（点名 (\d+) \+ tools 自动发现 (\d+) \+ tests 自动发现 (\d+)）、跑成 (\d+)/);
ok(totalLine, 'D1a0 check.mjs 的「合计」行解析到了（跑不出这一行就没有真值可对）', totalLine ? `源文件 ${totalLine[1]} · 套件 ${totalLine[3]} · 跑成 ${totalLine[7]}` : `解析不到，rc=${CHECK.rc}`);
ok(results.length === (totalLine ? +totalLine[7] + 1 : -1), `D1a 跑出来的 RESULT 行 = 跑成 ${totalLine ? totalLine[7] : '?'} 套 + 总门自己`,
  `${results.length} 行：${results.map(r => r.name).join(' ')}`);
ok(results.length > 0 && results.every(r => r.green), 'D1b 被引用的这些条数出自一趟全绿的复跑（红行的条数不算现值）',
  results.filter(r => !r.green).map(r => r.name).join(' ') || `${results.length} 行全部 ok=true fails=0`);
const resBlock = (DOC.match(/八行 RESULT\*\*：\n?`([^`]+)`/) || [])[1];
ok(!!resBlock, 'D1c README 里那张「八行 RESULT」清单解析到了（解析不到就是表格/反引号改了形状）', resBlock ? `抓了 ${resBlock.split('/').length} 段` : '没有这一段');
const docCounts = resBlock ? [...resBlock.matchAll(/([a-z0-9][a-z0-9-]*) (\d+)/g)].map(m => ({ name: m[1], n: +m[2] })) : [];
ok(docCounts.length === results.length, `D1d 那张清单解析到 ${results.length} 个「套件 条数」对`, `解析 ${docCounts.length} 对`);
for (const d of docCounts) ok(byName[d.name] === d.n, `D1 ${d.name} 文档写 ${d.n} 条 == 总门跑出来的 ${byName[d.name] ?? '（没有这一套）'}`,
  byName[d.name] === undefined ? `套件 ${d.name} 不在清单里` : `文档 ${d.n} vs 运行时 ${byName[d.name]}`);
const eightCn = DOC.match(/(?:交出|是)八行 RESULT/);
ok(!!eightCn && results.length === 8, 'D1e 文档说「八行 RESULT」，就跑出八行（中文数词也是现值）', `跑成 ${results.length} 行`);
const gateSentence = DOC.match(/（三道静态门 \+ 七套逻辑 RESULT 行，另加总门自己那一行）/);
ok(!!gateSentence && results.length === 8, 'D1f 「三道静态门 + 七套逻辑 + 总门自己那一行」加起来就是那八行',
  gateSentence ? `${results.length - 1} 套逻辑 + 1 总门` : '解析不到那句');

// ---- D2 承诺表：每行的「N 条断言」必须等于该行点名的那套闸的现值 ----
const promiseSection = DOC.slice(DOC.indexOf('## 八条承诺'), DOC.indexOf('一条命令跑全部'));
const promiseRows = [...promiseSection.matchAll(/^\| (.+?) \| (.+?) \| (.+?) \|$/gm)].filter(m => m[1] !== '承诺' && !/^[-\s]+$/.test(m[1]));
ok(promiseRows.length === 8, `D2a 承诺表解析到 8 行（不是 8 行就是表格形状改了）`, `${promiseRows.length} 行`);
const suiteName = p => p.replace(/^.*\//, '').replace(/\.(mjs|cjs|js|sh)$/, '').replace(/\.test$/, '-test');
const NOTRUN = new Set(['balance']); // 要跑满 200 盘/档才有现值，doctest 不许把计时口径拖进来
for (const m of promiseRows) {
  const suites = [...new Set([...m[2].matchAll(/(?:tools|tests)\/([\w.-]+\.(?:mjs|js))/g)].map(x => suiteName(x[1])))];
  const nums = [...m[3].matchAll(/((?:\d+ \/ )*\d+) 条断言/g)].flatMap(x => x[1].split(' 条断言')[0].split(' / ').map(Number));
  if (!nums.length) continue;
  const judged = suites.filter(s => !NOTRUN.has(s));
  if (!judged.length) {
    ok(suites.length >= 1 && nums.length >= 1,
      `D2 ${m[1].slice(0, 16)}…：这一行的断言条数只有「跑满 200 盘/档」的闸能证 ⇒ 不在 doctest 里复测，由 U1 的 needle 断言它还在文档里`,
      `点名的闸 ${suites.join('/')} 全是无代码现值那一类 · 文档条数 ${nums.join('/')} · doctest 不复测计时口径`);
    continue;
  }
  ok(judged.length === nums.length, `D2 ${m[1].slice(0, 16)}…：${nums.length} 个断言条数对得上 ${judged.length} 套点名的闸`,
    `点名的闸 ${suites.join('/')} · 文档条数 ${nums.join('/')} · 判掉的（无现值）${suites.filter(s => NOTRUN.has(s)).join('/') || '无'}`);
  judged.forEach((s, i) => ok(byName[s] === nums[i], `D2b ${s} 的断言条数：文档 ${nums[i]} == 运行时 ${byName[s] ?? '（跑不出这一套）'}`,
    byName[s] === undefined ? `运行时没有 ${s} 这一行` : `文档 ${nums[i]} vs 运行时 ${byName[s]}`));
}

// ---- D3 三道静态门：README 抄的三行 == 总门自己打出来的三行 ----
const docStatic = [DOC.match(/语法门：node --check (\d+)\/(\d+) 个文件通过/), README.match(/禁词门：(\d+) 个引擎文件 × (\d+) 个禁词，注释外命中 (\d+) 处/),
  README.match(/清单门：package.json 的 (\d+) 条 scripts 中 (\d+) 条点名了文件入口，全部在磁盘上/)];
const runStatic = [CHECK.out.match(/语法门：node --check (\d+)\/(\d+) 个文件通过/), CHECK.out.match(/禁词门：(\d+) 个引擎文件 × (\d+) 个禁词，注释外命中 (\d+) 处/),
  CHECK.out.match(/清单门：package.json 的 (\d+) 条 scripts 中 (\d+) 条点名了文件入口，全部在磁盘上/)];
docStatic.forEach((d, i) => ok(!!d, `D3a${i} README 的第 ${i + 1} 道静态门那一行解析到了（解析不到就是那句话被删了或改了形状）`, d ? `文档 ${d.slice(1).join('/')}` : '解析不到'));
runStatic.forEach((d, i) => ok(!!d, `D3b${i} 总门这一趟打出的第 ${i + 1} 道静态门那一行读到了`, d ? `运行时 ${d.slice(1).join('/')}` : `读不到（rc=${CHECK.rc}）`));
docStatic.forEach((d, i) => ok(!!d && !!runStatic[i] && d.slice(1).join('/') === runStatic[i].slice(1).join('/'),
  `D3 第 ${i + 1} 道静态门的数逐格等于总门现场跑的（${runStatic[i] ? runStatic[i].slice(1).join('/') : '没读到'}）`,
  d && runStatic[i] ? `文档 ${d.slice(1).join('/')} vs 运行时 ${runStatic[i].slice(1).join('/')}` : '有一边没解析到'));
const forbidCode = [...CHECK_SRC.matchAll(/\['([^']+)', (?:\/|`)/g)].length;
const forbidDoc = (README.match(/- \*\*禁词\*\*是 (.+?)。\n/s) || [])[1];
ok(forbidCode === 7 && !!forbidDoc, 'D3c 禁词门确实有 7 个禁词、README 也逐条点名了它们', `代码 ${forbidCode} 条 · 文档那一句${forbidDoc ? '在' : '不在'}`);
const extraDoc = (DOC.match(/另点名根上的 ([\w./-]+)/) || [])[1];
const extraCode = (CHECK_SRC.match(/const EXTRA_JS = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g) || [];
ok(!!extraDoc && extraCode.length === 1 && extraCode[0].slice(1, -1) === extraDoc && extraDoc.includes('server.cjs'),
  `D3d 「另点名根上的 ${extraDoc || '？'}」等于 check.mjs 的 EXTRA_JS 现值`, `代码 ${extraCode.join(' ')} vs 文档 ${extraDoc || '没解析到'}`);
const shellsCode = (CHECK_SRC.match(/const SHELLS = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g) || [];
const shellNoteDoc = DOC.match(/bash -n：(本阶段还没有 shell 脚本|(\d+)\/\2 个 shell 脚本)/);
const shellNoteRun = CHECK.out.match(/bash -n：(本阶段还没有 shell 脚本|(\d+)\/\2 个 shell 脚本)/);
ok(!!shellNoteDoc && !!shellNoteRun && shellNoteDoc[1] === shellNoteRun[1], `D3e bash -n 那一格的文案等于总门现值（SHELLS 现在点名 ${shellsCode.length} 个）`,
  `文档「${shellNoteDoc ? shellNoteDoc[1] : '没解析到'}」vs 运行时「${shellNoteRun ? shellNoteRun[1] : '没解析到'}」`);
const shellNamesDoc = [...DOC.matchAll(/`tools\/check\.js`|SHELLS`? 现在点名 `([\w./-]+)`/g)].map(m => m[1]);
ok(shellsCode.length !== 1 || (shellNamesDoc.length === 1 && shellNamesDoc[0] === shellsCode[0].slice(1, -1)),
  `D3f SHELLS 里那一个脚本被 README 点名（谁进了语法门不许只有代码知道）`, `代码 ${shellsCode.join(' ') || '空'} vs 文档 ${shellNamesDoc.join(' ') || '没点名'}`);
const totalDoc = DOC.match(/`合计：源文件 (\d+)、引擎 (\d+)、套件 (\d+)（点名 (\d+) \+ tools 自动发现 (\d+) \+ tests 自动发现 (\d+)）、跑成 (\d+)`/);
ok(!!totalDoc && !!totalLine && totalDoc.slice(1).join('/') === totalLine.slice(1).join('/'),
  'D4 文档里那句「合计」逐格等于总门自己报的账', totalDoc && totalLine ? `文档 ${totalDoc.slice(1).join('/')} vs 运行时 ${totalLine.slice(1).join('/')}` : '有一边没解析到');
const reqSuitesCode = (CHECK_SRC.match(/const REQUIRED_SUITES = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g) || [];
ok(!!totalDoc && totalDoc[4] === String(reqSuitesCode.length), `D4b 「点名 ${totalDoc ? totalDoc[4] : '?'}」等于 REQUIRED_SUITES 的条数`,
  `代码 ${reqSuitesCode.length} 条：${reqSuitesCode.map(x => suiteName(x)).join(' ')}`);
const engineMods = (CHECK_SRC.match(/const ENGINE_MODULES = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g) || [];
ok(!!totalDoc && totalDoc[2] === String(engineMods.length) && engineMods.length === 7, `D4c 「引擎 ${totalDoc ? totalDoc[2] : '?'}」等于 ENGINE_MODULES 的条数（七模块）`,
  `代码 ${engineMods.length}：${engineMods.map(x => x.slice(1, -1)).join(' ')}`);
ok(/`js\/engine\/` 七模块/.test(README) && (!totalDoc || +totalDoc[2] === 7), 'D4d 文档那句「js/engine/ 七模块」等于引擎目录的现值', `运行时 ${totalDoc ? totalDoc[2] : '?'} 个`);

// ---- D5 清单门：package.json 的 scripts 条数与入口存在性（代码就是真值）----
const scriptCount = Object.keys(PKG.scripts || {}).length;
const scriptDocs = [...DOC.matchAll(/(\d+) 条 scripts/g)].map(m => +m[1]);
ok(scriptDocs.length >= 2 && scriptDocs.every(x => x === scriptCount), `D5a README 两处「N 条 scripts」都等于 package.json 的现值 ${scriptCount}`,
  `文档 ${scriptDocs.join('/')} vs 现在 ${scriptCount} 条`);
ok(!runStatic[2] || +runStatic[2][1] === scriptCount, `D5b 总门读到的 scripts 条数也等于 ${scriptCount}（它读的就是同一份文件）`,
  runStatic[2] ? `运行时 ${runStatic[2][1]}` : '没读到');
const entryCmds = [...new Set([...DOC.matchAll(/`((?:node|bash) (?:tools|tests|js)\/[\w./-]+[^\n`]*)`/g)].map(m => m[1]))];
const cmdFiles = [...new Set(entryCmds.map(c => (c.match(/^(?:node|bash) ([\w./-]+)/) || [])[1]).filter(Boolean))];
const noWhere = cmdFiles.filter(f => !existsSync(join(ROOT, f)));
ok(entryCmds.length >= 6 && cmdFiles.length >= 6 && noWhere.length === 0,
  `D5c 文档用反引号点名的 ${entryCmds.length} 条命令（落在 ${cmdFiles.length} 个入口）指的文件都在磁盘上`,
  noWhere.length ? `空头命令：${noWhere.join('，')}` : `${cmdFiles.join(' / ')}`);

// ---- D6 档位与样本量：generate.js 的 TIERS / balance 的 SAMPLES / probe 的 REP ----
const tierKeysDoc = (DOC.match(/那六档（`([\d/x ]+)`/) || [])[1];
ok(!!tierKeysDoc, `D6a TIERS 那一行的档位清单解析到了（解析不到就是括号或反引号改了形状）`, tierKeysDoc || '解析不到');
const tierKeys = tierKeysDoc ? tierKeysDoc.trim().split(/\s+/) : [];
ok(tierKeys.length === TIERS.length && tierKeys.join(' ') === TIERS.map(t => t.key).join(' '),
  'D6 TIERS 的档位键逐条逐序等于文档抄的那一串', `代码 ${TIERS.map(t => t.key).join(' ')} vs 文档 ${tierKeys.join(' ')}`);
const menuKeys = TIERS.filter(t => t.inMenu).map(t => t.key);
ok(!!tierKeysDoc && menuKeys.length === 6 && /`inMenu` 全为 true/.test(README) && TIERS.every(t => t.inMenu),
  `D6b 文档说「inMenu 全为 true」：六档全在菜单里（${menuKeys.length} 档）`, `inMenu=true 的有 ${menuKeys.length} 档，共 ${TIERS.length} 档`);
const DEMO = new Set(['哪','那','这','每','上','下','首','末','高','低','最','两','第','应','顶','同','换','本','该']);
const cnTiersRaw = [...DOC.matchAll(/([一二三四五六七八九十])(档|个菜单档)/g)];
const cnTiers = cnTiersRaw.filter(m => !DEMO.has(m.input[m.index - 1] || ''))
  .map(m => ({ w: m[1], ctx: m.input.slice(Math.max(0, m.index - 8), m.index + 6) }));
ok(cnTiersRaw.length >= 3 && cnTiers.length >= 1 && cnTiersRaw.length - cnTiers.length <= cnTiersRaw.length,
  `D6c0 反空转：文档里解析到 ${cnTiersRaw.length} 处「N 档」字样（其中 ${cnTiers.length} 处是在数菜单档位，另 ${cnTiersRaw.length - cnTiers.length} 处是「哪一档」这类指示词）`,
  cnTiersRaw.map(m => m[0]).join(' / '));
ok(cnTiers.length >= 1 && cnTiers.every(x => CN[x.w] === TIERS.length), `D6c 文档里所有「N 档 / N 个菜单档」都等于 ${TIERS.length}`,
  cnTiers.map(x => x.ctx).join(' · ') + ` vs 代码 ${TIERS.length}`);
const samplesCode = +(BAL.match(/argOf\('samples', (\d+)\)/) || [])[1];
const repCode = +(PROBE_SRC.match(/argOf\('rep', (\d+)\)/) || [])[1];
ok(samplesCode === 200 && repCode === 120, `D6d balance 的默认样本量与 probe 的默认 REP 解析到了（${samplesCode}/${repCode}）`,
  `balance SAMPLES=${samplesCode} · probe REP=${repCode}`);
const samplesDocs = [...FLATDOC.matchAll(/每档 (\d+) [盘张]/g)].map(m => +m[1]);

ok(samplesDocs.length >= 3 && samplesDocs.every(x => x === samplesCode),
  `D6e 文档每一处「每档 N 盘/张」（${samplesDocs.length} 处）都等于 balance 的 SAMPLES 现值（${samplesCode}）`, `文档 ${samplesDocs.join('/')} vs 代码 ${samplesCode}`);
const repDocs = [...DOC.matchAll(/REP=(\d+)/g)].map(m => +m[1]);
ok(repDocs.length >= 1 && repDocs.every(x => x === repCode), `D6f 文档写的 REP=${repDocs.join('/')} 等于 probe 的默认值 ${repCode}`, `代码 ${repCode}`);
const mixDocs = [...DOC.matchAll(/每档 (\d+) 盘 \/ (\d+) 盘/g)];
ok(mixDocs.length === 1 && +mixDocs[0][1] === samplesCode && +mixDocs[0][2] === repCode,
  'D6g 「样本量口径（每档 200 盘 / 120 盘）」那一格把两个分母分别对上 balance 与 probe（不许混成一个数）',
  mixDocs.length ? `文档 ${mixDocs[0][1]}/${mixDocs[0][2]} vs 代码 ${samplesCode}/${repCode}` : '解析不到那句');
const triesDocs = [...DOC.matchAll(/`tries=(\d+)`/g)].map(m => +m[1]);
ok(triesDocs.length >= 1 && triesDocs.every(x => TIERS.every(t => t.tries === x) && parseTier('9x9/5').tries === x),
  `D6i 文档那句 tries=${triesDocs.join('/')} 等于 TIERS 每档的 tries 与表外档的默认值`, `代码里全是 ${TIERS[0].tries}/${parseTier('9x9/5').tries}`);
const probeResult = PROBE.out.match(/^RESULT generator-probe ok=(\S+) checks=(\d+) fails=(\d+)$/m);
ok(!!probeResult, `D6j probe 这一趟跑出了 RESULT 行（跑不出来 D6k 就是在空转）`, probeResult ? `checks=${probeResult[2]} fails=${probeResult[3]}` : `rc=${PROBE.rc}`);
const probeDocChecks = [...DOC.matchAll(/RESULT generator-probe ok=true checks=(\d+) fails=0/g)].map(m => +m[1]);
ok(probeDocChecks.length === 1 && !!probeResult && probeResult[1] === 'true' && probeResult[3] === '0' && probeDocChecks[0] === +probeResult[2],
  `D6k 文档抄的 probe checks=${probeDocChecks[0] ?? '?'} 等于 probe 现场跑出来的数`, probeResult ? `运行时 ${probeResult[2]}（fails=${probeResult[3]}）` : '没跑到');

// ---- D7 绝对线表：两张表逐格等于 balance.mjs 里写死的常数 ----
const balNum = src => Object.fromEntries([...src.matchAll(/(\d+): (\d+)/g)].map(m => [+m[1], +m[2]]));
const wallCode = balNum((BAL.match(/const WALL_P95_LINE_MS = \{([^}]*)\}/) || [, ''])[1]);
const nodesCode = balNum((BAL.match(/const NODES_P95_LINE = \{([^}]*)\}/) || [, ''])[1]);
ok(Object.keys(wallCode).length === 7 && Object.keys(nodesCode).length === 7, `D7a balance 的两张线表各解析到 7 个球数档`,
  `墙钟 ${Object.keys(wallCode).join('/')} · nodes ${Object.keys(nodesCode).join('/')}`);
const wallDoc = DOC.match(/^墙钟 p95 线（ms）\s+球数 ([\d/]+) = ([\d /]+)$/m);
const nodesDoc = DOC.match(/^nodes p95 线\s+球数 ([\d/]+) = ([\d /]+)$/m);
ok(!!wallDoc && !!nodesDoc, 'D7b README 那张线表的两行都解析到了（少一行就是被删了或改了列名）', wallDoc && nodesDoc ? '两行都在' : `墙钟行${wallDoc ? '在' : '不在'} · nodes 行${nodesDoc ? '在' : '不在'}`);
for (const [label, doc, code] of [['墙钟', wallDoc, wallCode], ['nodes', nodesDoc, nodesCode]]) {
  if (!doc) continue;
  const keys = doc[1].split('/').map(Number);
  const vals = doc[2].trim().split(/\s*\/\s*/).map(Number);
  ok(keys.join(',') === Object.keys(code).sort((a, b) => a - b).join(',') && vals.length === keys.length,
    `D7 ${label} p95 线那一行的球数档位集合等于代码里的表（${keys.join('/')}）`, `代码 ${Object.keys(code).sort((a, b) => a - b).join('/')} vs 文档 ${keys.join('/')}`);
  keys.forEach((b, i) => ok(code[b] === vals[i], `D7c ${label}线 球数 ${b}：文档 ${vals[i]} == 代码 ${code[b] ?? '（缺档）'}`,
    code[b] === undefined ? `代码里没有球数 ${b} 的${label}线` : `文档 ${vals[i]} vs 代码 ${code[b]}`));
}
const lineBallsDoc = DOC.match(/线表最远写到 (\d+) 球（(\d+)x\2）/);
const maxBall = Math.max(...Object.keys(wallCode).map(Number));
ok(!!lineBallsDoc && +lineBallsDoc[1] === maxBall && TIERS.some(t => t.balls === maxBall && `${t.w}x${t.h}` === `${lineBallsDoc[2]}x${lineBallsDoc[2]}`),
  `D7d 「线表最远写到 ${lineBallsDoc ? lineBallsDoc[1] : '?'} 球（${lineBallsDoc ? `${lineBallsDoc[2]}x${lineBallsDoc[2]}` : '?'}）」等于线表上界与 TIERS 顶档`,
  `线表上界 ${maxBall} 球 · TIERS 顶档 ${TIERS[TIERS.length - 1].key}`);
const driftDocs = [...DOC.matchAll(/松到实测公式值（⌈p95×4⌉）的 (\d+) 倍以上|ANTI-DRIFT 在 `--samples < (\d+)` 时跳过/g)].map(m => +(m[1] || m[2]));
const driftCodeFactor = (BAL.match(/w\.budgetMs \* (\d+)/) || [])[1];
const driftCodeSkip = (BAL.match(/if \(SAMPLES >= (\d+)\)/) || [])[1];
ok(driftDocs.length === 2 && driftCodeFactor === '2' && driftCodeSkip === '50',
  `D7e ANTI-DRIFT 的两个常数（${driftCodeFactor} 倍与 ${driftCodeSkip} 盘）都被文档点名，且文档点名的就是这两个`,
  `代码 ${driftCodeFactor}/${driftCodeSkip} vs 文档 ${driftDocs.join('/')}`);
const ratioDocs = [...DOC.matchAll(/最高档 ≤ 最低档×([\d.]+)/g)].map(m => +m[1]);
const ratioCode = +(BAL.match(/s\[0\]\) \* ([\d.]+)/) || [])[1];
ok(ratioDocs.length === 1 && Number.isFinite(ratioCode) && ratioDocs[0] === ratioCode,
  `D7f 尺寸轴归一那条线（×${ratioDocs[0] ?? '?'}）等于 balance 里的归一系数 ${ratioCode}`, `代码 ${ratioCode}`);

// ---- D8 三条轴：轴 1 球数、轴 2 尺寸、轴 3 菜单，全部按 balance 的数组现值对 ----
const ballAxis = (BAL.match(/const BALL_AXIS = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
const sizeAxis = (BAL.match(/const SIZE_AXIS = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
ok(ballAxis.length === 6 && sizeAxis.length === 5, `D8a 两条轴的档数解析到了（球数轴 ${ballAxis.length} 档、尺寸轴 ${sizeAxis.length} 档）`,
  `${ballAxis.join(' ')} ｜ ${sizeAxis.join(' ')}`);
const ballDoc = DOC.match(/轴 1（尺寸钉死 (\d+)x\1，球数 ([\d/]+)）/);
const sizeDoc = DOC.match(/轴 2（球数钉死 (\d+)，尺寸 (\d+)x\2→(\d+)x\3/);
ok(!!ballDoc && !!sizeDoc, 'D8b README 里那两条轴的括号都解析到了', `轴1${ballDoc ? '在' : '缺'} · 轴2${sizeDoc ? '在' : '缺'}`);
const axisBalls = ballAxis.map(k => parseTier(k).balls);
ok(!!ballDoc && +ballDoc[1] === parseTier(ballAxis[0]).w && axisBalls.join('/') === ballDoc[2],
  `D8 轴 1 的「尺寸钉死 ${ballDoc ? ballDoc[1] : '?'}、球数 ${ballDoc ? ballDoc[2] : '?'}」逐格等于 BALL_AXIS 现值`,
  `代码 ${parseTier(ballAxis[0]).w}x${parseTier(ballAxis[0]).h}，球数 ${axisBalls.join('/')} vs 文档 ${ballDoc ? `${ballDoc[1]}，${ballDoc[2]}` : '没解析到'}`);
const axisSizes = sizeAxis.map(k => `${parseTier(k).w}x${parseTier(k).h}`);
ok(!!sizeDoc && +sizeDoc[1] === parseTier(sizeAxis[0]).balls && +sizeDoc[2] === parseTier(sizeAxis[0]).w && +sizeDoc[3] === parseTier(sizeAxis[sizeAxis.length - 1]).w,
  `D8c 轴 2 的「球数钉死 ${sizeDoc ? sizeDoc[1] : '?'}，尺寸 ${sizeDoc ? `${sizeDoc[2]}→${sizeDoc[3]}` : '?'}」逐格等于 SIZE_AXIS 现值`,
  `代码 ${sizeDoc ? `${sizeDoc[1]} 球，` : ''}${axisSizes.join('→')} vs 文档 ${sizeDoc ? `${sizeDoc[1]} 球，${sizeDoc[2]}x${sizeDoc[2]}→${sizeDoc[3]}x${sizeDoc[3]}` : '没解析到'}`);
const cellDocs = [...FLAT.matchAll(/尺寸从 (\d+) 格到 (\d+) 格（([\d.]+) 倍）/g)];
const cellLo = parseTier(sizeAxis[0]).w * parseTier(sizeAxis[0]).h, cellHi = parseTier(sizeAxis[sizeAxis.length - 1]).w ** 2;
ok(cellDocs.length >= 1 && cellDocs.every(m => +m[1] === cellLo && +m[2] === cellHi && Math.abs(+m[3] - cellHi / cellLo) < 0.05),
  `D8d 「${cellDocs[0] ? `${cellDocs[0][1]} 格到 ${cellDocs[0][2]} 格（${cellDocs[0][3]} 倍）` : '没解析到'}」等于 SIZE_AXIS 首末档的格数与倍数`,
  `代码 ${cellLo}→${cellHi}（${(cellHi / cellLo).toFixed(2)} 倍）`);
const menuAxis = BAL.match(/const MENU_AXIS = TIERS\.filter\(\(t\) => t\.inMenu\)/);
ok(!!menuAxis, 'D8e 第 3 轴＝菜单本身这条在 balance 里是代码（不是文档里的一句话）', menuAxis ? menuAxis[0] : '解析不到 MENU_AXIS');

// ---- D9 五条命名规则：条数、名字、夹具与 silentOn 分工表 ----
const ruleDocs = [...FLATDOC.matchAll(/([一二三四五六七八九十])条(?:\*\*)?命名规则/g)].map(m => CN[m[1]]);
const ruleDocs2 = [...FLATDOC.matchAll(/([一二三四五六七八九十])条命名规则|([一二三四五六七八九十])条规则/g)].map(m => +(m[1] ? CN[m[1]] : CN[m[2]]));
ok(ruleDocs.length >= 1 && ruleDocs2.length >= 3 && ruleDocs.every(x => x === RULE_ORDER.length) && ruleDocs2.every(x => x === RULE_ORDER.length),
  `D9a 文档里所有「N 条命名规则 / N 条规则」都等于 pencil.js 的 RULE_ORDER（${RULE_ORDER.length} 条）`,
  `文档 ${[...ruleDocs, ...ruleDocs2].join('/')} vs 代码 ${RULE_ORDER.length}：${RULE_ORDER.join(' ')}`);
const fixtureKeys = Object.keys(RULE_FIXTURES);
ok(fixtureKeys.length === RULE_ORDER.length && fixtureKeys.join('|') === RULE_ORDER.join('|'),
  'D9b 每条规则各有一张夹具盘（RULE_FIXTURES 的键逐条逐序等于 RULE_ORDER）', `夹具 ${fixtureKeys.join(' ')} vs 规则 ${RULE_ORDER.join(' ')}`);
const noSilent = fixtureKeys.filter(k => !(RULE_FIXTURES[k].silentOn || []).length);
ok(noSilent.length === 0, 'D9c 每张夹具都带 silentOn 分工表（量出来的，不是愿望）', noSilent.length ? `没有分工表：${noSilent.join(' ')}` : `${fixtureKeys.length} 条全有`);
const rareMentions = RARE_RULES.map(r => (DOC.match(new RegExp(r, 'g')) || []).length);
const rareGateText = (BAL_RAW.match(/稀有规则发火盘数按\*\*每 100 格归一\*\*后/g) || []).length;
ok(rareMentions.length === RARE_RULES.length && rareMentions.every(x => x >= 1) && /稀有规则/.test(DOC),
  `D9d pencil.js 的 RARE_RULES（${RARE_RULES.join('/')}）每一颗都在文档里点了名`, `文档点名次数 ${rareMentions.join('/')} · 代码 ${RARE_RULES.join('/')}`);
ok(rareGateText >= 1, 'D9e 归一那条判据在 balance 里是代码（不是文档里的一句话）', `balance 的 GATES 里 ${rareGateText} 处`);
const namedRules = RULE_ORDER.filter(r => DOC.includes(r));
ok(namedRules.length >= 3, `D9f 「${namedRules.join(' / ')}」这些规则名在文档里是点得出的（改名不点名就是漂）`, `${RULE_ORDER.length} 条里文档点名了 ${namedRules.length} 条`);

// ---- D10 官方盘：5×5 的边长、变异条数、格号现算 ----
const offDocs = [...DOC.matchAll(/官方 (\d+)×(\d+)/g)];
ok(offDocs.length >= 2 && offDocs.every(m => +m[1] === OFFICIAL.w && +m[2] === OFFICIAL.h),
  `D10a 文档 ${offDocs.length} 处「官方 N×N」逐处等于 scenarios.js 的 OFFICIAL 边长 ${OFFICIAL.w}×${OFFICIAL.h}`,
  `文档 ${offDocs.map(m => m[1] + '×' + m[2]).join(' / ')} vs 代码 ${OFFICIAL.w}×${OFFICIAL.h}`);
const mutDoc = [...DOC.matchAll(/官方 \d+×\d+ 的 (\d+) 条变异逐条被拒/g)].map(m => +m[1]);
ok(mutDoc.length === 1 && mutDoc[0] === OFFICIAL_MUTATIONS.length, `D10b 「官方 5×5 的 ${mutDoc[0] ?? '?'} 条变异逐条被拒」等于 OFFICIAL_MUTATIONS 的条数`,
  `代码 ${OFFICIAL_MUTATIONS.length} 条：${OFFICIAL_MUTATIONS.join(' ')}`);
const atUses = [...SCEN.matchAll(/OFFICIAL\.at\(/g)].length;
const handIdx = [...SCEN.matchAll(/(?:balls|holes|ponds):\s*\[[\s\S]*?\]/g)];
ok(atUses >= 10 && /格号全部由 `OFFICIAL\.at\(r,c\)` 现算，没有一个下标是手抄的/.test(FLAT),
  `D10c 「格号全部由 OFFICIAL.at(r,c) 现算」有代码作证（scenarios.js 里 ${atUses} 处调用）`, `at() ${atUses} 处 · 题面字面量 ${handIdx.length} 段`);

// ---- D11 端口：文档 == server.cjs / playtest.cjs 的现值（5341 只在文档里 → 见 UNPINNED）----
const serverPort = +(SERVER.match(/const PORT = (\d+);/) || [])[1];
const argvOverride = /Number\(process\.argv\[2\]\) \|\| Number\(process\.env\.PORT\) \|\| PORT/.test(SERVER);
const cdpDoc = +(DOC.match(/CDP 口 (\d+)（`tools\/playtest\.cjs` 的默认值/) || [])[1];
const cdpCode = +(PLAY.match(/CDP_PORT \|\| (\d+)/) || [])[1];
const baseCode = +(PLAY.match(/BASE_URL \|\| 'http:\/\/127\.0\.0\.1:(\d+)\//) || [])[1];
const portDocPair = DOC.match(/\*\*(\d+) \/ (\d+)\*\* 分给本仓/);
const portDocDefault = DOC.match(/`server\.cjs` 默认监听 \*\*(\d+)\*\*/);
ok(serverPort > 0 && cdpCode > 0 && baseCode > 0 && cdpDoc > 0 && !!portDocPair && !!portDocDefault && argvOverride,
  `D11a 端口的六个来源全解析到了（server ${serverPort} · argv 覆写 ${argvOverride ? '在' : '不在'} · playtest ${baseCode}/${cdpCode} · 文档 ${portDocPair ? portDocPair[1] + '/' + portDocPair[2] : '?'} · CDP ${cdpDoc}）`,
  `解析到的个数：${[serverPort, cdpCode, baseCode, cdpDoc, portDocPair, portDocDefault, argvOverride].filter(Boolean).length}/7`);
ok(!!portDocPair && +portDocPair[1] === serverPort && !!portDocDefault && +portDocDefault[1] === serverPort,
  `D11 文档的默认号等于 server.cjs 的 PORT（${serverPort}）`, `代码 ${serverPort} vs 文档 ${portDocPair ? portDocPair[1] : '?'}／${portDocDefault ? portDocDefault[1] : '?'}`);
ok(cdpDoc === cdpCode, `D11b 文档的 CDP 口 ${cdpDoc} 等于 playtest.cjs 的默认值`, `代码 ${cdpCode}`);
ok(baseCode === serverPort, `D11c playtest 的 BASE_URL 默认号跟着 server.cjs 的默认号（${baseCode}）`, `server ${serverPort} vs playtest ${baseCode}`);
ok(argvOverride && !!portDocPair && +portDocPair[2] !== serverPort,
  `D11d 备用号 ${portDocPair ? portDocPair[2] : '?'} 只能靠 argv/env 覆写得到（server.cjs 里 ${argvOverride ? 'argv[2] || env.PORT || PORT 这条链在' : '没有覆写链，文档那句跑不通'}）`,
  `默认 ${serverPort} · 备用 ${portDocPair ? portDocPair[2] : '?'}`);

// ---- D12 引擎结构承诺：互不抄的通道、band/budgetMs 无判定路径、双条件写死 ----
const bandRefs = [...GEN.matchAll(/\b(?:t|tier)\.(?:band|budgetMs)\b/g)];
ok(bandRefs.length === 0 && /band: \[1, 3\]/.test(GEN) && /budgetMs: 20/.test(GEN),
  `D12a TIERS 的 band/budgetMs 没有任何判定路径吃它们（读引用 ${bandRefs.length} 处），值仍是占位`,
  bandRefs.length ? `被读处：${bandRefs.map(x => x[0]).join(' ')}` : `占位值 band=[1,3] budgetMs=20 只在字面量里`);
ok(/目前仍是占位值/.test(FLAT) && /没有任何判定路径吃它们/.test(FLAT), 'D12b 文档那句「占位值 / 没有判定路径吃」还在（这条是被上面证的现值）', '两句都在');
const stoppedBeforeUnique = /if \(c\.stopped\)[\s\S]{0,120}if \(c\.count === 1\)/.test(GEN);
ok(stoppedBeforeUnique && /count===1 && stopped` 在引擎里写死不出货/.test(FLAT),
  'D12c 「count===1 ∧ stopped 写死不出货」是真接线：stopped 的检查排在 count===1 之前', stoppedBeforeUnique ? '顺序对' : 'stopped 那条不在 count===1 之前');
const shipReads = ['w', 'h', 'balls', 'maxK', 'tries'].every(k => new RegExp(`tier\\.${k}\\b|maxAttempts = tries == null \\? tier\\.tries`).test(GEN));
ok(shipReads, 'D12d shipPuzzle 只读 w/h/balls/maxK/tries（文档点名的那五个字段全读到了）', ['w', 'h', 'balls', 'maxK', 'tries'].map(k => `${k}:${new RegExp(`tier\\.${k}\\b`).test(GEN) ? '✓' : '✗'}`).join(' '));
const verifyNoRoutes = !stripComments(read('js/engine/verify.js')).includes('routesFor');
ok(verifyNoRoutes && /一条 `routesFor` 的代码都不许 import/.test(FLAT), `D12e verify.js 一条 routesFor 都不 import（"两份互不抄的实现"有代码作证）`,
  verifyNoRoutes ? '非注释行里没有 routesFor' : 'import 了候选枚举那份实现');
const dirsDocs = [...DOC.matchAll(/第一动 ≤(\d+) 个方向、之后每动 ≤(\d+) 个/g)];
ok(dirsDocs.length === 1 && +dirsDocs[0][1] === DIRS.length && +dirsDocs[0][2] === DIRS.length - 1,
  `D12f 「第一动 ≤${dirsDocs[0] ? dirsDocs[0][1] : '?'}、之后每动 ≤${dirsDocs[0] ? dirsDocs[0][2] : '?'}」等于 grid.js 的方向表现值`,
  `DIRS ${DIRS.length} 个 ⇒ 回头少一个 ${DIRS.length - 1}`);
const boundDoc = DOC.match(/最多 `(\d+)·(\d+)\^\(k-1\)` 条候选/);
ok(!!boundDoc && +boundDoc[1] === DIRS.length && +boundDoc[2] === DIRS.length - 1 && new RegExp(`${boundDoc[1]}·${boundDoc[2]}\\^`).test(ROUTES),
  `D12g 文档与 routes.js 文件头写的是同一个上界 ${boundDoc ? `${boundDoc[1]}·${boundDoc[2]}^(k-1)` : '（解析不到）'}`,
  boundDoc ? `文档 ${boundDoc[1]}·${boundDoc[2]}^` : '解析不到那句');

// ---- D12' 墙钟基线那三个系数：文档抄的是 balance 的代码，不是别的仓的愿望 ----
const bandDoc = FLATDOC.match(/band = \[max\(1,⌊med×([\d.]+)⌋\), max\(lo\+1,⌈p95×([\d.]+)⌉\)\]/);
const budgetDoc = FLATDOC.match(/budgetMs = max\((\d+), ⌈p95×(\d+)⌉ 向上取整到 (\d+)ms\)/);
const bandLoCode = +(BAL.match(/Math\.floor\(medMs \* ([\d.]+)\)/) || [])[1];
const bandHiCode = +(BAL.match(/Math\.ceil\(p95Ms \* ([\d.]+)\)/) || [])[1];
const budgetCode = [...(BAL.match(/Math\.max\((\d+), Math\.ceil\(\(p95Ms \* (\d+)\) \/ (\d+)\) \* \3\)/) || [])].slice(1).map(Number);
ok(!!bandDoc && !!budgetDoc && +bandDoc[1] === bandLoCode && +bandDoc[2] === bandHiCode &&
  +budgetDoc[1] === budgetCode[0] && +budgetDoc[2] === budgetCode[1] && +budgetDoc[3] === budgetCode[2],
  `D12h 文档那句 band/budgetMs 的四个系数（${bandDoc ? `${bandDoc[1]}/${bandDoc[2]}` : '?'}/${budgetDoc ? budgetDoc.slice(1).join('/') : '?'}）逐格等于 balance 的现值 ${bandLoCode}/${bandHiCode}/${budgetCode.join('/')}`,
  `代码 ${BAL.match(/Math\.floor\(medMs \* [\d.]+\)/)[0]} · ${BAL.match(/Math\.ceil\(p95Ms \* [\d.]+\)/)[0]} · ${budgetCode.join('/')}`);

// ---- D13 落地/未落地：文档点名的文件存在性双向对账 ----
const planned = ['tools/ceiling.mjs', 'tools/golden-test.mjs', 'tools/write-golden.mjs'];
const mentioned = [...new Set([...README.matchAll(/`((?:tools|tests|js|css)\/[\w./-]+\.(?:js|mjs|cjs)|index\.html|server\.cjs)`/g)].map(m => m[1]))];
const missing = mentioned.filter(p => !planned.includes(p) && !existsSync(join(ROOT, p)));
const ghostPresent = planned.filter(p => existsSync(join(ROOT, p)));
ok(mentioned.length >= 20 && missing.length === 0, `D13a 文档点名的 ${mentioned.length} 个源码路径都在树里（除了明写未落地的那三个）`,
  missing.length ? `不在树里却被当现值引用：${missing.join('，')}` : `全部存在`);
ok(ghostPresent.length === 0, `D13b 文档明写"计划不是承诺、不进清单"的那三个工具确实还没落地`,
  ghostPresent.length ? `已经存在但文档还说不落地：${ghostPresent.join(' ')}` : `${planned.join(' / ')} 都不在树里`);
const landed = ['tools/doctest.mjs', 'tools/sabotage.mjs', 'tools/verify.sh', '.github/workflows/ci.yml'];
const landedDoc = landed.filter(p => existsSync(join(ROOT, p)));
ok(landedDoc.length === landed.length && landedDoc.every(p => README.includes(p)),
  `D13c 这一轮落地的 ${landed.length} 个门禁件都在树里、且都被文档逐字点名`,
  `${landed.map(p => `${p}:${existsSync(join(ROOT, p)) ? '在' : '不在'}/${README.includes(p) ? '点名' : '没点名'}`).join(' · ')}`);
const ciExists = existsSync(join(ROOT, '.github/workflows/ci.yml'));
const ciDenies = /没有 `\.github\/workflows\/`/.test(FLAT);

ok(ciExists && !ciDenies && /GitHub Actions|check job/.test(README),
  'D13d CI 已落地：workflow 在树里、文档没有再说"没有 .github/workflows/"、并且点名了它跑什么',
  `${ciExists ? 'ci.yml 在树里' : 'ci.yml 不在'} · 文档仍在否认：${ciDenies}`);
const verifyDoc = FLAT.match(/`tools\/verify\.sh`(（[^）]*）)?/g) || [];
ok(verifyDoc.length >= 1 && existsSync(join(ROOT, 'tools/verify.sh')) === !/没有 `tools\/verify\.sh`/.test(README),
  `D13e tools/verify.sh 的存在性与文档那句一致（文档里出现 ${verifyDoc.length} 次）`,
  `${existsSync(join(ROOT, 'tools/verify.sh')) ? '在树里' : '不在树里'}`);
const electronDoc = /不承诺 Electron 壳/.test(README) && /树里没有/.test(README);
ok(electronDoc && !existsSync(join(ROOT, 'electron')) && !/electron/.test(read('package.json')), 'D13f 「不承诺 Electron 壳」这句与树里情况一致',
  `文档说了：${electronDoc ? '是' : '否'} · 树里有 electron：${existsSync(join(ROOT, 'electron'))}`);
ok(!/https?:\/\/[\w.-]*github\.io/.test(README), 'D13g 文档里没有本站点的线上 URL（有任何一条就该被文档自己点名）',
  '没有 github.io 链接');

// ---- D14 接线：npm script / CI / verify.sh 三条入口跑的是同一套东西 ----
const verifySh = read('tools/verify.sh');
const ciYml = read('.github/workflows/ci.yml');
const shCmds = [...new Set((verifySh.match(/(?:node|bash) tools\/[\w.]+/g) || []))];
ok(shCmds.length >= 2, `D14a verify.sh 里串起来的闸解析到了 ${shCmds.length} 条命令`, shCmds.join(' ｜ '));
const ciRun = ciYml.split('\n').filter(l => /^\s*run:/.test(l)).join('\n');
const ciCmds = [...new Set((ciRun.match(/(?:node|bash) tools\/[\w.-]+/g) || []))];
ok(ciCmds.length >= 1 && ciCmds.every(c => shCmds.includes(c) || c === `bash tools/verify.sh`),
  `D14b CI 跑的每一件事都是本地 verify.sh 里的事件（不许有只在 CI 才有的门）`, `CI ${ciCmds.join(' / ')} ｜ 本地 ${shCmds.join(' / ')}`);
ok(['check', 'test', 'doctest', 'verify'].every(k => PKG.scripts[k]), `D14c package.json 有 check/test/doctest/verify 四条入口`,
  Object.keys(PKG.scripts).join(' '));
ok(PKG.scripts.verify === 'bash tools/verify.sh' && /bash tools\/verify\.sh/.test(ciYml),
  `D14d 本地入口（npm run verify）与 CI 入口是同一个脚本`, `npm=${PKG.scripts.verify} · ci.yml 里有 bash tools/verify.sh：${/bash tools\/verify\.sh/.test(ciYml)}`);
ok(shCmds.includes('node tools/check.mjs') && shCmds.includes('node tools/doctest.mjs'),
  'D14e verify.sh 这一层没把任何一道既有闸换掉：总门与文档数字闸都在', shCmds.join(' ｜ '));
const docVerify = FLAT.match(/(npm run verify|bash tools\/verify\.sh)[^。]{0,80}/);
ok(!!docVerify, 'D14f 文档写了统一入口那一条命令（改了接线不改文档就是红）', docVerify ? docVerify[0].slice(0, 70) : '解析不到');

// ---- D16 台账本身：刀数与「实测 rc 已由脚本回写」不是散文 ----
const LEDGER = README.split('\n').filter(l => /^\| K\d+ \| /.test(l));
const knifeCn = DOC.match(/台账的([一二三四五六七八九十]|\d+)把刀/);
const knifeMinCode = +(SAB_SRC.match(/if \(knives\.length < (\d+)\)/) || [])[1];
ok(!!knifeCn && LEDGER.length >= 3 && (CN[knifeCn[1]] ?? +knifeCn[1]) === LEDGER.length && knifeMinCode === 3,
  `D16 文档说「台账的${knifeCn ? knifeCn[1] : '?'}把刀」等于台账真正解析到的行数（${LEDGER.length}），且 sabotage 的下界是 ${knifeMinCode}`,
  `台账 ${LEDGER.length} 行 · 代码下界 ${knifeMinCode} 把 · 文档 ${knifeCn ? knifeCn[1] : '没解析到'}`);
const rcCells = LEDGER.map(l => (l.match(/\|\s*(\S+)\s*\|\s*$/, ) || [])[1]);
ok(rcCells.length === LEDGER.length && rcCells.every(x => /^[0-9]+$/.test(x)),
  'D16b 台账每行最后一格都是一个读回来的退出码（还是「?」就是这一轮没真跑过）', rcCells.join(' / '));
const knifeCmds = LEDGER.map(l => l.split('|').map(c => c.trim()).filter(Boolean).slice(-2, -1)[0].replace(/`/g, ''));
ok(knifeCmds.length === LEDGER.length && knifeCmds.every(c => /^node tools\/(doctest|check|generator-probe|sabotage)\.mjs$/.test(c)),
  'D16c 台账每行的命令格都指向仓里真实存在的闸（不是随手写的一条）', knifeCmds.join(' ｜ '));
const knifeExpects = LEDGER.map(l => l.split('|').map(c => c.trim()).filter(Boolean)[5]);
ok(knifeExpects.every(e => /^[A-Z]\d+/.test(e)) && knifeExpects.every(e => SAB_SRC.includes('doctest')),
  `D16d 台账每行都点了一条具体的断言名（${knifeExpects.join('/')}），不许写成「会红」这种不可核对的话`, knifeExpects.join(' ｜ '));

// ---- D15 UNPINNED 清单：没有代码出处的数，一条一条点名，并断言它们还在文档里 ----
const UNPINNED = [
  ['U1', 'balance 的 checks=176', '176 条断言 0 红', '要跑满每档 200 盘才有现值；本机 load 5.9/15 核，计时口径的重跑不进 doctest'],
  ['U2', '球数阶梯的发火盘数', '必经格 12/200 → 145/200', 'balance 200 盘实测读数（分母 200 已由 D6e 钉成 SAMPLES 现值）'],
  ['U3', '阶梯末档的两球两洞', '两球两洞 0/200 → 83/200', '同上；这一条与 U7 是同一件事的两个口径，不许互相换算'],
  ['U4', '铅笔零猜测与拒铺率', '铅笔零猜测 200/200，同表打印拒铺率 1.28~5.37', 'balance 读数；拒铺率是比值，分母是烧掉的种子不是盘数'],
  ['U5', '极小性逐档', '每档 多余 0 颗 / 没证到 0 颗 / 已证 200/200', 'balance 的单颗摘除审计读数'],
  ['U6', '3 球 / 4 球的两球两洞', '两球两洞在 3 球出货盘上实测 0/200 发火、在 4 球上 11/200', 'balance 与 pencil-test 的表；两处都是运行时打印，没有代码常数'],
  ['U7', '尺寸轴的 nodes p95', '计数器 nodes 的 p95 只从 11 走到 16', 'balance 200 盘读数；本仓复跑同批 seed 读到 11（8x8/5）→ 16（18x18/5），但分母必须一起走'],
  ['U8', '立项探针 20x20·14 球', '唯一出货 15/40', '桌面筛阶段的探针在 workspace 根（_tmp-herugolf-model/counter/gen/pencil.mjs），不在仓里、clone 不到 ⇒ 没有代码出处'],
  ['U9', '最慢一张出货的墙钟', '最慢一张出货 16.96ms', '墙钟绝对值是本机争用的影子；文档自己写明不进可复现那一类'],
  ['U10', '鼠标腿断言数', '28 条断言 fail=0', '要真 Chrome + 本机服务器；playtest 的腿不在 npm test 里'],
  ['U11', '触屏腿断言数', '31 条断言 fail=0', '同上'],
  ['U12', '键盘腿断言数', '21 条断言 fail=0', '同上'],
  ['U13', '深链/重载腿断言数', '各 4 条 fail=0', '同上'],
  ['U14', '通关腿的笔数', '17 笔全被接受', '同上（走的是本机起的那台服务器与 seed 5 那一盘）'],
  ['U15', '续局腿的档与画布', '4:1-17-25;8:32-48-56', '同上；这一串是浏览器 localStorage 里读回的存档，代码里没有第二份'],
  ['U16', '续局腿的画布尺寸', '画布 384×384', '同上；384 由那一趟的视口/layout 决定，不是代码常数'],
  ['U17', '本轮浏览器版本与端口占用', 'headless Chrome 154 + CDP 9350', '进程与版本观察（5340 被上一轮遗留进程占着是同一类），不是仓内可复跑的现值'],
  ['U18', '清单门落地时的阴性自证', '注入 `tools/ceiling.mjs` 等三个不存在的入口，它当场报 3 条红且 rc≠0', '一次性的历史跑：那三个入口已按承诺不在树里，阴性自证没有常驻命令'],
];
UNPINNED.forEach(([id, what, needle, why]) => {
  const hits = FLAT.split(needle).length - 1;
  ok(hits >= 1, `D15 ${id} 未钉死的数「${what}」还写在文档里（删掉那句话来变绿就是这一条红）`, `${hits} 处 · ${why}`);
});
const unpinnedNeedleHits = UNPINNED.filter(([, , n]) => FLAT.includes(n)).length;
ok(unpinnedNeedleHits === UNPINNED.length, `D15a 反空转：${UNPINNED.length} 条 unpinned 逐条在文档里找到 needle`, `${unpinnedNeedleHits}/${UNPINNED.length}`);
const pinnedDup = UNPINNED.filter(([, , needle]) => /条 scripts|每档 \d+ 盘|RESULT generator-probe/.test(needle));
ok(pinnedDup.length === 0, 'D15b unpinned 清单里没有和 D5/D6 的等式重复的数（同一件事不许既钉又松', pinnedDup.map(x => x[2]).join(' ｜ ') || '没有重叠');
const unpinnedCountDoc = [...DOC.matchAll(/unpinned[^\d]{0,12}(\d+) 条/g)].map(m => +m[1]);
ok(unpinnedCountDoc.length >= 1 && unpinnedCountDoc.every(x => x === UNPINNED.length),
  `D15d 文档写的 unpinned 条数（${unpinnedCountDoc.join('/')} || '?'）等于本文件里那张清单的长度 ${UNPINNED.length}`,
  `文档 ${unpinnedCountDoc.join('/')} vs 清单 ${UNPINNED.length} 条：${UNPINNED.map(u => u[0]).join(' ')}`);
const docNums = [...README.matchAll(/(\d{2,4})/g)].length;
ok(docNums >= 60, `D15c 文档里两位以上的数解析到 ${docNums} 处（少于 60 处说明那一节被整段删了，不是"没数字了"）`, `${docNums} 处`);

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
console.log(`钉成等式的文档现值：${rows - UNPINNED.length} 项 · 显式 unpinned：${UNPINNED.length} 项`);
if (fail.length) {
  for (const f of fail) console.log(`  未过：${f}`);
  process.exit(1);
}
