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

**本仓现在交付到第一阶段：纯 Node 引擎（`js/engine/` 七模块）+ 逻辑门禁（`tools/` + `tests/`）。**
浏览器壳（`index.html` / `css` / `js/main.js` / `js/render` / `js/ui` / `server.cjs` / `tools/verify.sh`）
和 `.github/workflows/` 都**还没开工**，因此本仓**没有 CI、没有站点、没有任何线上 URL**，
`npm test` 是它唯一的闸。这一句是承诺表之外最重要的一条：下面所有读数都来自本机跑逻辑闸，
没有一个来自部署件。

---

## 八条承诺，每条都是一条会红的命令

读数那一列全部来自**本轮复跑**（本机 2026-09-29，`npm test` 交出的八行 RESULT，以及
`node tools/balance.mjs`、`node tools/generator-probe.mjs` 各自的结论行），不是引用上一轮的记录。

| 承诺 | 谁在判 | 现在的读数 |
| --- | --- | --- |
| 出货的每一盘**唯一解由第二套穷举器数过**，"没数完"绝不算唯一 | `node tools/counter-test.mjs`（判据 1、3：官方盘数到恰好 1 解；`count===1 ∧ stopped` 并排打出两个数）＋ `js/engine/generate.js` 的出货双条件 | 59 条断言 0 红；balance 每档 200 张 `stopped=0`；`count===1 && stopped` 在引擎里写死不出货 |
| 出货的每一盘**零猜测推到底**（五条命名规则，一次都不试走法） | `node tools/pencil-test.mjs`（判据 3、5、6）＋ `node tools/balance.mjs` 的零猜测那条 | 89 条断言 0 红；balance 每档 铅笔零猜测 200/200，同表打印拒铺率 1.28~5.37 |
| 铅笔的每一条**结论**都被独立计数器复核 | `node tools/rule-test.mjs`（每条规则 ①fire ②被 `pins` 钉在"不成立"上必须 0 解 ③真候选不许被杀 ④在别人的夹具上必须闭嘴） | 194 条断言 0 红；五条规则各有一张夹具盘 + 一张 `silentOn` 分工表（量出来的，不是愿望） |
| **模型与出版物对齐**：Nikoli 官方 5×5 例题的三条真值证人 | `node tools/scenarios.js`（`verify` 无错 / 候选表给那一解留位置 / 数到恰好 1 解）＋ 三套各自那一条 | 13 条断言 0 红；官方盘的格号全部由 `OFFICIAL.at(r,c)` 现算，没有一个下标是手抄的 |
| **难度按球数长，不是按格数长**（这一族的命门） | `node tools/balance.mjs` 轴 1（尺寸钉死 10x10，球数 3/4/5/6/7/9）与轴 2（球数钉死 5，尺寸 8x8→18x18，稀有规则发火盘数按每 100 格归一） | 176 条断言 0 红；必经格 12/200 → 145/200、两球两洞 0/200 → 83/200（3 球 → 11 球）；最高档严格大于最低档且不为 0 |
| **每颗线索（球 / H / 池）都单独摘除复核过** | `node tools/balance.mjs` 的极小性那条（摘完必须"不再唯一"或"铅笔推不完"至少一条成立）＋ `js/engine/generate.js:auditClueNecessity` | 每档 多余 0 颗 / 没证到 0 颗 / 已证 200/200；口径是**单颗摘除意义的极小**，不是线索最少 |
| **几何规则有两份互不抄的实现** | `node tests/r3-crossing.test.mjs`、`node tests/r4-pond.test.mjs`、`node tests/hole-two-balls.test.mjs`（`routes.js` 的候选枚举 vs `verify.js` 从题面文字从头再走一遍） | 81 / 53 / 174 条断言 0 红；官方 5×5 的 10 条变异逐条被拒，且逐条对上**实测的归因规则集合** |
| **清单里没有空头命令** | `node tools/check.mjs` 的清单门（读 `package.json` 自己） | 11 条 scripts 指向的入口全部在磁盘上；这一门落地时先跑了一次阴性自证：注入 `tools/ceiling.mjs` 等三个不存在的入口，它当场报 3 条红且 rc≠0 |

一条命令跑全部（三道静态门 + 七套逻辑 RESULT 行，另加总门自己那一行）：

```
npm test                     # = node tools/check.mjs
```

结论行是 `RESULT check ok=true checks=58 fails=0`，而**整趟交出八行 RESULT**：
`rule-test 194 / pencil-test 89 / counter-test 59 / scenarios 13 / hole-two-balls-test 174 /
r3-crossing-test 81 / r4-pond-test 53 / check 58`，全部 `ok=true fails=0`。
总门把每套**自报的 RESULT 行原样再念一遍**，所以"少跑了一套"在日志里读得出来：清单里的套件必须在磁盘上、
必须真的跑起来、必须打 RESULT 行、RESULT 的自报名必须等于由文件名算出的那一个、`checks>0`、
且收到的行数必须等于清单长度。`tools/*-test.mjs` 与 `tests/*.test.mjs` 是自动发现的 ——
新增一张证人不必改清单，**删一张**则同时撞 `MIN_*_SUITES` 和行数那条，当场红。

单独跑：

```
node tools/check.mjs                 # 总门（= npm test）
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

## 三道静态门，跑在逻辑门前面

`npm test` 的头三段在读源码的那一层打死东西，因为逻辑测试**当天**照样全绿：

```
语法门：node --check 17/17 个文件通过（js、tools、tests 下所有 .js/.mjs/.cjs，跳过 _tmp-*）；bash -n：本阶段还没有 shell 脚本
禁词门：7 个引擎文件 × 7 个禁词，注释外命中 0 处
清单门：package.json 的 11 条 scripts 中 11 条点名了文件入口，全部在磁盘上
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
tests/      hole-two-balls.test.mjs r3-crossing.test.mjs r4-pond.test.mjs   ← 三张规则证人
```

`合计：源文件 17、引擎 7、套件 7（点名 4 + tools 自动发现 3 + tests 自动发现 3）、跑成 7` 是总门自己报的账。

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
- **不承诺界面、CI 或站点**。第一阶段没有浏览器壳，也就没有浏览器闸、没有 GitHub Pages、没有线上 URL；
  `tools/check.mjs` 里的 `EXTRA_JS` 与 `SHELLS` 两个空数组是留给第二阶段的口子，现在写进去就是空头承诺。

## 端口

**5340 / 5341** 分给本仓，立项时查实过空闲（全 workspace 无文件提及、无进程监听）。
第一阶段**没有在用** —— 没有任何服务器、没有 CDP 口，这两个号只是占位以免第二阶段撞车。

## 复跑这些数字

```
npm test                                  # 八行 RESULT，全部 ok=true fails=0
node tools/balance.mjs                    # 每档 200 盘：出货率/墙钟/nodes/零猜测/极小性/两条阶梯
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
