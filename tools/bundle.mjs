#!/usr/bin/env node
// 把 ESM 源码打成一份**经典脚本** bundle：js/bundle/herugolf.js
//
// 为什么要有这一步（不是"顺手加个打包"）：
//   ① 官方关卡探针 cos_frame_probe.js 在 node vm 里跑 index.html，它只执行
//      `<script src>` 经典脚本与内联脚本 —— 全文没有一处 module 处理。用 type="module"
//      的仓在它眼里等于"游戏从没跑起来"，判据只能落"结论：无法比对"。
//   ② file:// 下浏览器拒绝加载 ES 模块（CORS），双击 index.html 就是一片白。
//      本仓 README 承诺的是"没有站点也能跑"，所以经典脚本是这条路唯一的形状。
//   ③ 引擎侧的禁词门（tools/check.mjs）要求引擎"带得进浏览器"，这一步就是那条承诺的落地件。
//
// 口径：
//   · 源码仍是 ESM 单一真相 —— 本文件只认这几种写法：import { a, b as c } from './x.js'、
//     export function/class/const/let、export { A, B }。出现别的形状（default、* as、
//     export ... from、顶层 await）就**当场报错不出货**，而不是打出一个跑不动的 bundle。
//   · 产物不带时间戳：要能逐字节比对（tools/web-test.mjs 拿这条当闸用 —— 生成物与源码脱钩
//     是这类"提交打包产物"做法唯一的病，比对了就没这个病）。
//   · 模块键 = 文件名去扩展名，重名即报错（两条 grid.js 会互相吃掉，那种 bug 最难查）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'bundle', 'herugolf.js');

// 依赖序（被依赖的在前）。__req 会自己按需要实例化，这个顺序只为让"读得懂"这件事成立。
const MODULES = [
  'js/engine/rng.js',
  'js/engine/grid.js',
  'js/engine/routes.js',
  'js/engine/verify.js',
  'js/engine/counter.js',
  'js/engine/pencil.js',
  'js/engine/generate.js',
  'js/core/game.js',
  'js/core/save.js',
  'js/core/audio.js',
  'js/render/board.js',
  'js/ui/hud.js',
  'js/main.js',
];

const UNSUPPORTED = [
  [/^import\s+[\w$]+\s*(?:,\s*\{)?\s*from/m, 'default import'],
  [/import\s*\*/, 'namespace import'],
  [/^export\s+default/m, 'export default'],
  [/^export\s*\{[^}]*\}\s*from/m, 'export ... from'],
  [/^export\s+\*\s+from/m, 're-export *'],
  [/^\s*await\s+import\s*\(/m, 'dynamic import'],
];

const key = (p) => basename(p).replace(/\.js$/, '');

function transform(rel) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  for (const [re, name] of UNSUPPORTED) {
    if (re.test(src)) throw new Error(`${rel}: 未支持的模块语法「${name}」——  bundler 不出货，请改源码或扩这里（扩了要补 tools/web-test.mjs 的证人）`);
  }
  const exportsList = [];
  const requires = [];
  let body = src;

  // import { a, b as c } from './x.js'  →  const { a, b: c } = __req('x')
  body = body.replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (_all, names, from) => {
    const parts = names.split(',').map((s) => s.trim()).filter(Boolean).map((spec) => {
      const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(spec);
      if (!m) throw new Error(`${rel}: 认不出的 import 成员「${spec}」`);
      return m[2] ? `${m[1]}: ${m[2]}` : m[1];
    });
    requires.push(key(from));
    return `const { ${parts.join(', ')} } = __req('${key(from)}');`;
  });

  const grab = (re, kind) => {
    body = body.replace(re, (_all, ...g) => {
      const name = g.find((x) => typeof x === 'string' && /^[\w$]+$/.test(x));
      exportsList.push(name);
      return _all.replace(/^export\s+/, '');
    });
    if (kind) return;
  };
  grab(/^export\s+async\s+function\s+([\w$]+)/gm);
  grab(/^export\s+function\s*\*\s*([\w$]+)/gm);
  grab(/^export\s+function\s+([\w$]+)/gm);
  grab(/^export\s+class\s+([\w$]+)/gm);
  grab(/^export\s+const\s+([\w$]+)/gm);
  grab(/^export\s+let\s+([\w$]+)/gm);

  // export { A, B as c };  →  记进导出表，语句本身删掉
  body = body.replace(/^export\s*\{([^}]*)\}\s*;?\s*$/gm, (_all, names) => {
    for (const spec of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(spec);
      if (!m) throw new Error(`${rel}: 认不出的 export 成员「${spec}」`);
      exportsList.push(m[2] ? `${m[1]}: ${m[2]}` : m[1]);
    }
    return '';
  });

  // 自证：打完还留着 import/export 关键字就是漏了形状，不许蒙混出货
  const leftover = body.match(/^\s*(?:import|export)\b.*$/m);
  if (leftover) throw new Error(`${rel}: 转换后仍有模块语法「${leftover[0].trim()}」`);

  const returned = exportsList.map((spec) => {
    const [local, alias] = spec.includes(': ') ? spec.split(': ') : [spec, spec];
    return `${alias}: ${local}`;
  });
  return { key: key(rel), body, exports: returned, requires };
}

function build() {
  const seen = new Map();
  const mods = [];
  for (const rel of MODULES) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) throw new Error(`清单里的模块不在磁盘上：${rel}`);
    const m = transform(rel);
    if (seen.has(m.key)) throw new Error(`模块重名：${rel} 与 ${seen.get(m.key)} 都叫 ${m.key}.js`);
    seen.set(m.key, rel);
    mods.push({ ...m, rel });
  }
  for (const m of mods) {
    for (const r of m.requires) {
      if (!seen.has(r)) throw new Error(`${m.rel}: 依赖「${r}」不在清单里`);
    }
  }

  const head = [
    '// ヘルゴルフ / Herugolf —— 浏览器壳的**生成物**，不要手改。',
    `// 由 ${relative(ROOT, join(ROOT, 'tools', 'bundle.mjs'))} 从 ${mods.length} 个 ESM 源模块打成经典脚本；`,
    '// 重跑：node tools/bundle.mjs   （产物不带时间戳，逐字节可比对，比对那条闸在 tools/web-test.mjs）',
    '// 为什么要 bundle：官方帧率探针只执行经典脚本，且 file:// 拒绝 ES 模块 —— 见本文件生成器的文件头。',
    '',
    '/* eslint-disable */',
    'var HerugolfBundle = (function () {',
    "  'use strict';",
    '  var __cache = Object.create(null);',
    '  var __factories = Object.create(null);',
    '  function __def(name, fn) { __factories[name] = fn; }',
    '  function __req(name) {',
    '    if (__cache[name]) return __cache[name];',
    "    if (!__factories[name]) throw new Error('bundle: 没有模块 ' + name);",
    '    var mod = { exports: {} };',
    '    __cache[name] = mod.exports;',
    '    var ret = __factories[name](__req) || {};',
    '    for (var k in ret) mod.exports[k] = ret[k];',
    '    return mod.exports;',
    '  }',
    '',
  ].join('\n');

  const bodies = mods.map((m) => `  __def('${m.key}', function (__req) {\n${m.body.split('\n').map((l) => (l ? '  ' + l : '')).join('\n')}\n    return { ${m.exports.join(', ')} };\n  });\n`).join('\n');

  // 入口必须在这里真的实例化一次：__req 是惰性的，不打这一枪 js/main.js 里那段
  // "DOM 就绪就 boot" 的自我引导永远不执行，window.Herugolf / window.HerugolfState
  // 也就永远挂不上 —— 官方帧率探针读不到状态时给的正是"未找到挂在 window 上的游戏状态"。
  const tail = [
    '  var __entry = __req(' + JSON.stringify(key(MODULES[MODULES.length - 1])) + ');',
    '  return { __req: __req, boot: __entry.boot, keys: ' + JSON.stringify(mods.map((m) => m.key)) + ' };',
    '})();',
    "if (typeof window !== 'undefined') { window.HerugolfBundle = HerugolfBundle; }",
    '',
  ].join('\n');

  return head + bodies + '\n' + tail;
}

const out = process.argv.includes('--print') ? null : build();
if (out) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  console.log(`WROTE ${relative(ROOT, OUT)} bytes=${out.length} modules=${MODULES.length}`);
} else {
  process.stdout.write(build());
}
