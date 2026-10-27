# ヘルゴルフ / Herugolf · 交付卡

> 本文件由 `003_辅助能力/audit/script/gen_deliverable.py` 从本仓 README、package.json 与 `git ls-files` 生成，**不要手改**；改源后重跑，`--check` 必须逐字节一致。
> 读数取自本仓 `git ls-files` 与 package.json，均不含本文件自身；这里不写提交号，所以 `--check` 比的是内容，不是时间。

## 一句话

Nikoli 的"逻辑高尔夫"。题面给你一张盘面，上面只有三种东西：带数字的球、H（球洞）、池（灰格）。

- 仓名：`z-biz-game-herugolf-cos`　组别：E · 生成艺术与交互视觉
- 技术栈：Electron + Canvas

## 怎么跑

package.json 没有 `start` / `dev` 脚本；入口是 `index.html`。

## 怎么验

| 层 | 命令 |
| --- | --- |
| 整仓门禁 | `bash tools/verify.sh` |
| 单元/规则测试 | `npm test` |
| npm verify | `npm run verify` |
| 文档腿 | `node tools/doctest.mjs` |

## 规模

| 指标 | 读数 |
| --- | ---: |
| 跟踪文件 | 73 |
| 应用代码 | 8,154 行（JS 7,224 / CSS 782 / HTML 148） |
| 测试/工具文件 | 17 个 |
| 依赖 | `dependencies` 0 / `devDependencies` 0 |
| 位图资产（不含 shots） | 23 个 / 2081 KB |

## 目录

```
.github .gitignore LICENSE README.md assets css icons index.html js manifest.webmanifest package.json server.cjs sw.js tests tools web
```

## 已知边界

README 没有单列“未实现/限制”小节；以 README 正文与仓内闸为准。

## 证据

- 重跑：在 lead 仓根执行 `python3 003_辅助能力/audit/script/gen_deliverable.py ../z-biz-game-herugolf-cos --check`，应与本文件逐字节一致。
- 漂了就重跑并复核读数变化：新增文件、改 README 的边界小节、加/删闸都会让它变，这些变化本身就是要看的内容。
