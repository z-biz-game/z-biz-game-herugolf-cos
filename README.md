# ヘルゴルフ / Herugolf

Nikoli 的"逻辑高尔夫"。题面给你一张盘面，上面只有三种东西：**带数字的球**、**H（球洞）**、**池（灰格）**。
内部没有粗线，区块不用求解。要把每一颗球都走进一个 H：

1. **R1** 所有球都移动到 H，每个 H 恰好落一球 ⇒ 球与 H 一一对应，且每球至少动一次。
2. **R2** 每动一次：沿上下左右**直线**走「球里的数字」那么多个格；走完这一动数字减 1（方向可以换）
   ⇒ 一颗 `k` 的球的动长度序列严格是 `k, k-1, k-2, …`；停在 H 上的球不再动。
3. **R3** 线不许穿过别的球、不许穿过 H（停在它上面不算穿过）、不许自交；线两两不许交叉或重叠
   （janko 的正表述：每格最多被一条线通过）。
4. **R4** 不许出界；不许**停在**池上，但**可以从池上穿过**。

四条正文逐条抄自 Nikoli 官方页 <https://www.nikoli.co.jp/ja/puzzles/herugolf/>（EN 站同名）与
<https://www.janko.at/Raetsel/Herugolf/index.htm>，学术侧参照 LIPIcs FUN 2018 的 NP-completeness 那篇。
抄录处钉在 `js/engine/routes.js` 与 `js/engine/grid.js` 的文件头 —— 这一族的坑是"转述时把规则写松半格"：
比如把 R4 写成"池一格都不许碰"，反例照样红、正例（穿过池）却被误杀，出货器会系统性漏掉一大类合法走法，
玩家看到的是"这盘无解"。所以 R4 的证人在**两侧**都有（`tests/r4-pond.test.mjs`）。

**本仓现在交付到第二阶段：纯 Node 引擎（`js/engine/` 七模块）+ 逻辑门禁（`tools/` + `tests/`）+ 文档数字闸（`tools/doctest.mjs`）+ 浏览器壳（`index.html` / `css/game.css` / `js/main.js` / `js/store.js` / `js/theme.js` / `js/audio/synth.js` / `js/render/board.js` / `js/ui/game.js` / `server.cjs` / `tools/playtest.cjs`）。**
浏览器壳**已在树里、已能开局玩到通关**（下面「第二阶段」那一节是真事件读数）。
这一轮补上的两件：`tools/verify.sh`（薄总入口，只串闸不加判据）与 `.github/workflows/ci.yml`（check job 跑的就是
同一条 `bash tools/verify.sh`）—— 所以"本仓没有 CI"这句**已作废**，站点那句还没有：仍然**没有**的东西照原样写着：
Electron 壳、GitHub Pages、任何线上 URL。`npm test` 仍是唯一的**逻辑**自动闸，文档里的数字另由 `tools/doctest.mjs` 守。
这一句是承诺表之外最重要的一条：下面所有读数都来自本机跑逻辑闸与本机 headless Chrome，
没有一个来自部署件。

---

## 八条承诺，每条都是一条会红的命令

读数那一列全部来自**本轮复跑**（本机 2026-10-02，`npm test` 交出的八行 RESULT，以及
`node tools/balance.mjs`、`node tools/generator-probe.mjs` 各自的结论行），不是引用上一轮的记录。
这句话现在不再只由自觉守着：有代码出处的每个现值被 `tools/doctest.mjs` 钉成等式，没有代码出处的
逐条进那张 unpinned 清单（见「文档数字闸与破坏试验台账」那一节）。

| 承诺 | 谁在判 | 现在的读数 |
| --- | --- | --- |
| 出货的每一盘**唯一解由第二套穷举器数过**，"没数完"绝不算唯一 | `node tools/counter-test.mjs`（判据 1、3：官方盘数到恰好 1 解；`count===1 ∧ stopped` 并排打出两个数）＋ `js/engine/generate.js` 的出货双条件 | 59 条断言 0 红；balance 每档 200 张 `stopped=0`；`count===1 && stopped` 在引擎里写死不出货 |
| 出货的每一盘**零猜测推到底**（五条命名规则，一次都不试走法） | `node tools/pencil-test.mjs`（判据 3、5、6）＋ `node tools/balance.mjs` 的零猜测那条 | 89 条断言 0 红；balance 每档 铅笔零猜测 200/200，同表打印拒铺率 1.28~5.37 |
| 铅笔的每一条**结论**都被独立计数器复核 | `node tools/rule-test.mjs`（每条规则 ①fire ②被 `pins` 钉在"不成立"上必须 0 解 ③真候选不许被杀 ④在别人的夹具上必须闭嘴） | 194 条断言 0 红；五条规则各有一张夹具盘 + 一张 `silentOn` 分工表（量出来的，不是愿望） |
| **模型与出版物对齐**：Nikoli 官方 5×5 例题的三条真值证人 | `node tools/scenarios.js`（`verify` 无错 / 候选表给那一解留位置 / 数到恰好 1 解）＋ 三套各自那一条 | 13 条断言 0 红；官方盘的格号全部由 `OFFICIAL.at(r,c)` 现算，没有一个下标是手抄的 |
| **难度按球数长，不是按格数长**（这一族的命门） | `node tools/balance.mjs` 轴 1（尺寸钉死 10x10，球数 3/4/5/6/7/9）与轴 2（球数钉死 5，尺寸 8x8→18x18，稀有规则发火盘数按每 100 格归一） | 176 条断言 0 红；必经格 12/200 → 145/200、两球两洞 0/200 → 83/200（3 球 → 11 球）；最高档严格大于最低档且不为 0 |
| **每颗线索（球 / H / 池）都单独摘除复核过** | `node tools/balance.mjs` 的极小性那条（摘完必须"不再唯一"或"铅笔推不完"至少一条成立）＋ `js/engine/generate.js:auditClueNecessity` | 每档 多余 0 颗 / 没证到 0 颗 / 已证 200/200；口径是**单颗摘除意义的极小**，不是线索最少 |
| **几何规则有两份互不抄的实现** | `node tests/r3-crossing.test.mjs`、`node tests/r4-pond.test.mjs`、`node tests/hole-two-balls.test.mjs`（`routes.js` 的候选枚举 vs `verify.js` 从题面文字从头再走一遍） | 81 / 53 / 174 条断言 0 红；官方 5×5 的 10 条变异逐条被拒，且逐条对上**实测的归因规则集合** |
| **清单里没有空头命令** | `node tools/check.mjs` 的清单门（读 `package.json` 自己） | 14 条 scripts 指向的入口全部在磁盘上；这一门落地时先跑了一次阴性自证：注入 `tools/ceiling.mjs` 等三个不存在的入口，它当场报 3 条红且 rc≠0 |

一条命令跑全部（三道静态门 + 七套逻辑 RESULT 行，另加总门自己那一行）：

```
npm test                     # = node tools/check.mjs
bash tools/verify.sh         # 本地与 CI 的同一条入口：先总门，再文档数字闸
```

结论行是 `RESULT check ok=true checks=61 fails=0`，而**整趟交出八行 RESULT**：
`rule-test 194 / pencil-test 89 / counter-test 59 / scenarios 13 / hole-two-balls-test 174 /
r3-crossing-test 81 / r4-pond-test 53 / check 61`，全部 `ok=true fails=0`。
总门把每套**自报的 RESULT 行原样再念一遍**，所以"少跑了一套"在日志里读得出来：清单里的套件必须在磁盘上、
必须真的跑起来、必须打 RESULT 行、RESULT 的自报名必须等于由文件名算出的那一个、`checks>0`、
且收到的行数必须等于清单长度。`tools/*-test.mjs` 与 `tests/*.test.mjs` 是自动发现的 ——
新增一张证人不必改清单，**删一张**则同时撞 `MIN_*_SUITES` 和行数那条，当场红。

单独跑：

```
node tools/check.mjs                 # 总门（= npm test）
node tools/doctest.mjs               # 文档数字闸：README 的每个现值对代码现值
node tools/sabotage.mjs              # 破坏台账：把每一类谎写回一遍，看闸会不会点名变红
bash tools/verify.sh                 # 上面两条的总入口（CI 跑的就是这一条）
node tools/rule-test.mjs             # 五条命名规则 × 独立复核
node tools/pencil-test.mjs           # 铅笔侧：官方盘 + 出货盘批对账
node tools/counter-test.mjs          # 计数侧：与候选笛卡尔积 × verify 逐盘相等
node tools/scenarios.js              # 夹具自检：官方盘那三条真值证人原样打出来
node tests/hole-two-balls.test.mjs   # R1 的证人（一洞两球 + 官方盘全部变异）
node tests/r3-crossing.test.mjs      # R3 的证人（几何层：交叉 / 自交 / 共用格）
node tests/r4-pond.test.mjs          # R4 的证人（停在池上必红、穿过池必须放行）
node tools/balance.mjs               # 难度实测：把承诺写成会红的线（默认每档 200 盘）
node tools/balance.mjs --samples=40  # 同一口径少抽一点（注意：分位数随 n 挪格，线不是按 40 定的）
node tools/balance.mjs --calibrate   # 额外打印"绝对线建议值"，用于回填线表
node tools/balance.mjs --dose=10x10/6#3   # 摘掉第 3 盘一颗线索：红线必须咬住（闸不咬就是假绿）
node tools/generator-probe.mjs       # 观测器：只打出货通道的账，不做难度判断
node tools/generator-probe.mjs --rep=24 --only=8x8/4
```

`balance` 与 `generator-probe` **不在 `npm test` 里**，这是有意的：它们的样本量口径（每档 200 盘 / 120 盘）
是"给线定重量"用的，写进 CI 就变成每天重测一次结论，而墙钟那条线的绝对值跟着本机负载走。
本轮 `node tools/generator-probe.mjs` 交出 `RESULT generator-probe ok=true checks=116 fails=0`
（REP=120 × 六个菜单档）；`node tools/balance.mjs` 交出 `RESULT balance ok=true checks=176 fails=0`。

## 第二阶段：浏览器壳落库后，可玩性是怎么被证明的

启动与闸（**都不在 `npm test` 里**：它们要一个真的 Chrome，CI 那一层还不存在）：

```
node server.cjs            # 默认 5340（本仓预留的第一号）
node server.cjs 5341       # 端口被占就点第二号；本轮跑的就是 5341
BASE_URL=http://127.0.0.1:5341/ node tools/playtest.cjs leg mouse
```

本轮实跑（本机 headless Chrome 154 + CDP 9350，服务器 5341；**5340 当时被本仓上一轮遗留的
`node server.cjs 5340` 进程占着，没有动它，改用同一对里预留的 5341**）：

| 腿 | 命令 | 读数 |
| --- | --- | --- |
| 开机 | `node tools/playtest.cjs open http://127.0.0.1:5341/` | `window.herugolf` 在、零 console 输出、零异常 |
| 鼠标真事件 | `… leg mouse` | 28 条断言 fail=0：100 格每格中心都命中 canvas、四个按钮中心都命中自己、落子 0→1、斜对面被 R2 拒、撤销退回 0、换一局 seed 自增、提示计数 1 |
| 触屏真事件 | `… leg touch`（390×844·dpr3 覆写） | 31 条断言 fail=0：同上 + 窄屏整盘留在视口里 |
| 键盘真事件 | `… leg keys` | 21 条断言 fail=0：四只键各「1 seen/1 handled/0 repeat/1 total」、方向键落子、退格清空、H 出提示、空格换球 |
| 深链 / 重载 | `… nav … same`、`… reload` | 各 4 条 fail=0：片段导航 timeOrigin 与文档身份不变；reload 两个都换 |
| 通关 | `… eval`（引擎那一解逐动走界面唯一入口 `write()`） | `10x10/5` seed 5：17 笔全被接受（`refused=0`）、`status=won`、`verify()` 0 错、5/5 进洞、胜利遮罩有矩形、纪录写进 `best` 与 `totals.solved=1` |
| 续局 | `… eval` 存档 → `reload` → `… eval` 按「继续」 | 换文档（`doc11umgm0i`→`doc1h56uyr6`）后读回同一串 `4:1-17-25;8:32-48-56`、动数 6、画布 384×384 且渲染层绑到这一盘 |
| 场景腿 | `… scenario play` | **红（rc=1），原样记着不粉饰**：`tools/scenarios.js` 是纯 Node 夹具（带 `from 'node:process'`，且从不定义 `window.__ng`），注进页面就是 `SyntaxError: Cannot use import statement outside a module`。浏览器侧场景模块**没有落地**，所以这条不是承诺，也不进上面那张表 |

落库时抓到的四处「整局不可玩 / 假绿」，都在这一轮修掉了：

1. `js/main.js` 的 `begin()` 原来在容器还 `hidden`（`display:none`）时调 `view.layout()` ⇒
   `clientWidth` 读到 0 ⇒ 格边长退到最小档，**玩家第一眼是一张 200px 的小盘**，而下一次 layout
   又把面板整体推下去 ⇒ 真事件坐标全漂（它的红长在「按提示计一次数 got 0」那一行上）。
   改成先 `showGame()` 再 `view.layout(game)`，`js/render/board.js` 也不再把 0 宽当成容器宽度。
2. `resumeSaved()` 从来不调 `view.layout()` ⇒ 从菜单直接按「继续」时渲染层的 `game` 还是 null，
   `draw()` 第一行就收工：**档续上了、盘整个不画**（300×150 空画布）。
3. `js/store.js` 的 `record()` 一个调用者都没有，`#win-record` 也没人写过 ⇒ 界面印着
   「纪录（同档比：先看提示几次，再看动数，最后看时间）」而那张表永远是一列「—」。现在赢的那一刻记一次档。
4. `tools/playtest.cjs` 里 `ck('提示说出的是命名规则之一', window_is(…))` 把一个 Promise 交给判定函数
   ⇒ Promise 恒真、**那条断言永远不可能红**。已改成 `await window_is(…)`；白名单仍由引擎那张表现算。

## 三道静态门，跑在逻辑门前面

`npm test` 的头三段在读源码的那一层打死东西，因为逻辑测试**当天**照样全绿：

```
语法门：node --check 27/27 个文件通过（js、tools、tests 下所有 .js/.mjs/.cjs，跳过 _tmp-*，另点名根上的 server.cjs）；bash -n：1/1 个 shell 脚本，零失败
禁词门：7 个引擎文件 × 7 个禁词，注释外命中 0 处
清单门：package.json 的 14 条 scripts 中 14 条点名了文件入口，全部在磁盘上
```

- **禁词**是 `Math.random`、`Date.now`/`new Date`、`performance.now`、`process.env`、`require(`、
  `from 'node:…'`、动态 `import('node:…')`。判定路径上有一个随机数，node 与 Chrome 就画两张盘；
  有一个时间输入，"这一局是…"那句话就开始说谎；读一个环境变量，出货口径就交给部署环境了。
  引擎是纯 ESM 零运行时依赖 —— 带不进浏览器就进不了 Pages 产物，所以这一门也是第二阶段的预支。
- **清单门**是这一轮补的：`package.json` 曾经挂着 `ceiling` / `golden` / `golden:remint` 三条别名，
  指向 `tools/ceiling.mjs`、`tools/golden-test.mjs`、`tools/write-golden.mjs` —— 三个文件都不在树里，
  而 `npm test` 全程绿灯，因为总门只跑它自己清单里的套件，看不见清单外面那三条没落地的别名。
  现在别名已删，门在读清单：任何一条 `scripts` 指向不存在的入口就是红。
  那三个工具本身仍然是**计划**（`balance.mjs` 文件头写着"ceiling（下一轮）答尺寸天花板在哪一档"），
  计划不是承诺，不进清单。

## 文档数字闸与破坏试验台账

上面每一格的读数、档位清单、两张绝对线表、端口、样本量、断言条数，现在由 `tools/doctest.mjs` 逐条对等式：
它把 README 里的每个「现值」用正则解析出来，与代码或闸的**现在值**一比，每条解析都配一条「解析到几行」的
反空转断言 —— 正则没命中不是绿，是红（文档改形状、删句子都算红）。真值从三处取：`js/engine/*` 与
`tools/*` 的常数与数组、`tools/check.mjs` 这一趟现场打出的八行 RESULT 与三道静态门那一三行、
`tools/generator-probe.mjs` 这一趟的 RESULT 行。这里**不比秒数**：文档第「复跑这些数字」那一节自己写着
"本 README 不写多少秒跑完" —— 于是这两趟只取 RESULT 行，墙钟量既不写进文档也不写进等式。

它对两类东西刻意不钉：

- **墙钟与本机测量的绝对值**：只比"文档写的数 vs 代码里的线"的来源与方向，不重新计时，绝不把新测的 ms
  写回文档（`med / p95 / 最慢` 三个数从来不在等式里）。
- **没有代码出处的数**：要么要 `tools/balance.mjs` 跑满每档 200 盘才有现值（计时口径，不拖进文档闸），
  要么只有 workspace 根的桌面筛探针 `_tmp-herugolf-{model,counter,gen,pencil}.mjs` 量过 —— 那些探针
  **不在仓里、clone 不到**。这类数不硬钉，进 doctest 里那张显式 unpinned 清单，unpinned 清单 18 条，
  每条带一个 needle 断言"这句话原样还在 README 里"：**删掉那句话来变绿，就是那一条红**。

台账的四把刀由 `tools/sabotage.mjs` 从下面这张表里解析（文档改了，跑的就是改后的那一版）。每把只改
workspace 根下的一份临时副本（`../_tmp-herugolf-sab-<刀号>/`），跑完删掉，**不动工作树**；任何一把没弄红
就整体判红并点名。最后一列不是抄的，是脚本把退出码读回来写进去的。

| 刀 | 打在哪 | 文件 | 针 | 改成 | 期望点名的断言 | 命令 | 实测 rc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K1 | 文档的一个数字：重铺上限 | `README.md` | `tries=30` | `tries=31` | D6i | `node tools/doctest.mjs` | 1 |
| K2 | 代码的一个常数：nodes 线最低档 | `tools/balance.mjs` | `const NODES_P95_LINE = { 3: 50,` | `const NODES_P95_LINE = { 3: 60,` | D7c nodes线 球数 3 | `node tools/doctest.mjs` | 1 |
| K3 | 解析器的一个 needle：线表那一行 | `tools/doctest.mjs` | `^墙钟 p95 线（ms）\s+球数` | `^墙钟 p95 线（秒）\s+球数` | D7b | `node tools/doctest.mjs` | 1 |
| K4 | 代码的另一个常数：probe 的默认 REP | `tools/generator-probe.mjs` | `argOf('rep', 120)` | `argOf('rep', 121)` | D6g | `node tools/doctest.mjs` | 1 |

## 目录

```
js/engine/  grid.js（Board + 全仓唯一的 DIRS 方向表）rng.js（hashSeed/mulberry32/shuffle）
            routes.js（一个球的全部合法走法：R2/R3/R4 判在这里）
            verify.js（把答案当 (起点,落点序列) 从题面文字从头再走一遍）
            counter.js（独立穷举计数器：球 × 候选路径上的不相交代表系，MRV 挑球）
            pencil.js（五条命名规则的零猜测求解器）
            generate.js（出货通道：由解铺题面 → 反例驱动补池挖唯一 → 摘池极小化 → 双条件闸）
tools/      check.mjs（总门）rule-test pencil-test counter-test scenarios.js
            generator-probe.mjs（观测器）balance.mjs（难度实测 + 绝对线表 + ANTI-DRIFT）
            playtest.cjs（最小 CDP 台架：open/leg mouse|touch|keys/nav/reload/witness/answer/eval/logs）
tests/      hole-two-balls.test.mjs r3-crossing.test.mjs r4-pond.test.mjs   ← 三张规则证人
index.html  css/game.css  server.cjs（零依赖静态服务器，同时答根路径与 /z-biz-game-herugolf-cos/ 前缀）
js/         main.js（接线层：指针+键盘+计时+存档+闸要的 window.herugolf 面）
            store.js（localStorage：设置/纪录/seed 游标/续局快照）theme.js（调色板 → CSS 变量）
            audio/synth.js（零依赖 WebAudio 三个音）render/board.js（单 canvas，格坐标只有一份）
            ui/game.js（界面状态机：只做点击几何与拒绝理由，赢不赢交给 verify()）
```

`合计：源文件 27、引擎 7、套件 7（点名 4 + tools 自动发现 3 + tests 自动发现 3）、跑成 7` 是总门自己报的账。

引擎里最硬的一条结构约束是 **`verify.js` 一条 `routesFor` 的代码都不许 import**：连方向表都不用，
动与动之间的几何是从（起点格, 落点格）现算的。它是全仓唯一一条"不许抄自己"的通道 ——
候选枚举那份实现如果写错了，`verify` 必须给出不同的答案，出货盘才过得了这一关。
`counter.js` 与 `pencil.js` 同样互不信任：一个不做任何推理只试组合，一个不穷举只删候选。

第二条纪律在 `rng.js`：**比较器里不许抽随机数**（`arr.sort(() => rnd()-0.5)` 在 V8 的两条排序路径上
会给出两种结果），打乱一律走 `shuffle()`；**默认种子不许按日期算**，"下一局"= `seed + k` 自增，
并把 `k` 记进 `stats.attempts`，让"为了出这一盘重试了几次"是一条可对账的数。

## 难度与成本是怎么定出来的

`routesFor` 的先验上界是判据的底气：第一动 ≤4 个方向、之后每动 ≤3 个（原路回头就是自交），
一动比一动短 ⇒ 一颗 `k` 的球最多 `4·3^(k-1)` 条候选。穷举发生在「球 × 候选路径」上而不是格子状态上
⇒ 搜索空间 ≈ ∏(该球候选数)，**与格数几乎无关，只与球数有关**；它不是 2^格数的暴力。
实测支持这句话：球数钉死 5、尺寸从 64 格到 324 格（5.1 倍），计数器 nodes 的 p95 只从 11 走到 16。

`balance` 的绝对线按球数写死在 `tools/balance.mjs` 里：

```
墙钟 p95 线（ms）   球数 3/4/5/6/7/9/11 = 10 / 10 / 20 / 10 / 10 / 10 / 40
nodes p95 线        球数 3/4/5/6/7/9/11 = 50 / 50 / 100 / 100 / 100 / 100 / 200
```

两条口径值得单独说，因为它们都是别的仓栽过之后抬进来的：

- **墙钟基线取尾巴，不取中位**：`band = [max(1,⌊med×0.4⌋), max(lo+1,⌈p95×1.6⌉)]`、
  `budgetMs = max(10, ⌈p95×4⌉ 向上取整到 10ms)`。出题墙钟是双峰的（一次就出货 ≈0.1ms、
  烧到十几次 attempt ≈5ms），拿"中位×2"当基线会一绿一红。每轮把 med / p95 / 最慢三个**绝对值**原样打印。
- **线表自己也在被测（ANTI-DRIFT）**：写死的线松到实测公式值（⌈p95×4⌉）的 2 倍以上就红，
  线表里缺一个球数档位也算红（缺线 = 不判 = 漏网，不是宽容）。所以"红了把线调松"这条路是走不通的：
  撞线只许动 `balls/maxK/tries`，不许调大 `budgetNodes`、不许删判据、不许把 p95 换成中位。
  ANTI-DRIFT 在 `--samples < 50` 时跳过（nearest-rank 分位数会跳到更尾的格，公式值不可比），正式口径是 200。

`generate.js` 里 `TIERS` 那六档（`8x8/4 10x10/5 10x10/6 12x12/7 15x15/9 18x18/11`，`inMenu` 全为 true）
带的 `band` / `budgetMs` **目前仍是占位值，而且没有任何判定路径吃它们** —— `shipPuzzle` 只读
`w/h/balls/maxK/tries`。真正会红的墙钟线在上面那张表里，位于 `tools/balance.mjs`。

## 这个仓**不承诺**什么

- **不承诺"这个品类都能纯逻辑解"**。铅笔**不完备**：存在"多候选杀不完"的盘（不矛盾、仍然唯一，但推不完）。
  `tools/rule-test.mjs` 里就养着一张这样的证人（整张规则表都闷、题面却多解）。所以出货是**双条件**：
  计数器认证唯一 ∧ 铅笔零猜测推完，推不完的那一类在这里作废重铺，而不是拿去教玩家"再想想"。
- **不承诺大尺寸**。线表最远写到 11 球（18x18）。20x20·14 球只在立项探针里量过（40 颗种子：唯一出货 15/40，
  nodes med 67 / p95 139，撞预算 0），本仓的闸**没有**为它钉线；"天花板在哪一档"是 `ceiling` 那一轮的问题。
- **不承诺"更大就更难"**。尺寸轴（球数钉死）的稀有规则发火盘数按每 100 格归一后，最高档 ≤ 最低档×1.5 ——
  绝对盘数一定涨（格数 5.1 倍），涨得比格数慢就是没更深。这句话是量出来的，不是文案。
- **不承诺线索最少**。极小性是**单颗摘除**意义的：摘掉任意一颗线索后必须"不再唯一"或"铅笔推不完"至少一条成立。
  它不等于"这颗数目的线索不可能更少"，也不检查两组线索能不能同时去掉。
- **不承诺发火规则的球数下限措辞**。洞唯一来客 / 一球一洞 在 3 球盘上就能发火，不许说成"3 球不可能"；
  两球两洞在 3 球出货盘上实测 0/200 发火、在 4 球上 11/200（balance 与 pencil-test 的表为准）。
- **不承诺出货很快**。`tries=30` 是每档的重铺上限；本轮拒铺率 1.28~5.37（18x18/11 那档最贵），
  最慢一张出货 16.96ms。这是通道成本，不是难度承诺。
- **不承诺站点**。没有 GitHub Pages、没有任何线上 URL。CI 这一轮落地了（`.github/workflows/ci.yml` 的 check job
  跑 `bash tools/verify.sh`，与本地同一条命令，没有只在 CI 才有的门），但它只判绿不部署任何东西；
  上面那些浏览器读数全部来自**本机**一次 headless Chrome 手跑，既不进 `npm test` 也不进 CI，也就不构成"每轮都被守着"。
  `tools/check.mjs` 里 `SHELLS` 现在点名 `tools/verify.sh`（语法门对它 `bash -n`，脚本落地了就归语法门管），
  `EXTRA_JS` 仍然只点名磁盘上真有的 `server.cjs`。
- **不承诺 Electron 壳**（树里没有）、**不承诺 playtest 的场景腿**（`scenario <name>` 实测 rc=1，见上面那张表最后一行）。

## 端口

**5340 / 5341** 分给本仓，立项时查实过空闲（全 workspace 无文件提及、无进程监听）。
第二阶段在用：`server.cjs` 默认监听 **5340**，**5341** 是同一对里预留的备用号（`node server.cjs 5341`）。
本轮 5340 被上一轮遗留在本仓目录里的 `node server.cjs 5340` 进程占着，没有动那个进程，整趟 playtest 跑在 5341 上。
CDP 口 9350（`tools/playtest.cjs` 的默认值，本轮实测空闲后才用）。
为什么要写死专属号：别的车道同时在跑各自的服务器，端口撞了就会拿到**另一个仓**的 index.html ——
那种绿比红更糟。

## 复跑这些数字

```
npm test                                  # 八行 RESULT，全部 ok=true fails=0
node tools/doctest.mjs                      # 文档数字闸：条数 + 失败清单（rc=0 才算守住）
node tools/sabotage.mjs                     # 破坏台账：四把刀必须各把一条 FAIL 弄红
node tools/balance.mjs                    # 每档 200 盘：出货率/墙钟/nodes/零猜测/极小性/两条阶梯
node tools/generator-probe.mjs            # 只打账不判（含"复跑一致"摘要断言）
node server.cjs 5341                      # 浏览器壳：本机起页面（5340 被占就用号对里的第二号）
BASE_URL=http://127.0.0.1:5341/ node tools/playtest.cjs leg mouse   # 真事件那条腿（要 Chrome）
node tools/balance.mjs --dose=10x10/6#3   # 线的自证：摘掉一颗线索，红线必须咬住
node tools/generator-probe.mjs            # 只打账不判（含"复跑一致"摘要断言）
```

上面那些读数里，**只有纯整数计数是可复现的**：断言条数、结点数、候选数、步数、种子数、题面串。
墙钟的三个绝对值（med / p95 / 最慢）是本机争用的影子，同一批 seed 跑两趟本来就不该逐字相同
（`generator-probe` 的"复跑一致"摘要里根本没有它）。`balance` 的绝对线照判，但那一列读的是跑它的那台机器。
所以本 README 不写"多少秒跑完"，也不写"最新一轮"—— 每次复跑都会推翻它。

改任何出题配置（尺寸、`maxK`、`tries`、线索密度）之后，两张绝对线表必须 `--calibrate` 重量再回填；
`tools/check.mjs` 里 `MIN_SOURCE_FILES` / `MIN_TEST_FILES` / `MIN_TOOL_SUITES` 那三条下限也要跟着看 ——
它们是"证人只许增不许失踪"的那条线。
