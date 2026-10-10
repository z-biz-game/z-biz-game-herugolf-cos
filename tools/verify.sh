#!/usr/bin/env bash
# 本地与 CI 的同一个入口：把现有各道闸串起来，一条命令跑完。
#
#   bash tools/verify.sh
#
# 这一层刻意做薄：它**不新增判据、不改任何一道的判据**，只负责"跑齐"与"把每道的退出码原样记进日志工件"。
# 闸名单（九条，一条一个日志工件、工件里记自己的 GATE_RC）：
#   * tools/check.mjs        —— 总门：三道静态门 + 七套逻辑 RESULT 行（它对七套的判据比这里更严：
#                               自报名必须等于文件名算出的那一个、fails=0、checks>0、行数等于清单长度，
#                               且 tools/*-test.mjs 与 tests/*.test.mjs 是自动发现的）
#   * tools/doctest.mjs      —— 文档数字闸：README 里每个现值逐条对等式，每条配反空转的行数断言
#                               （它自己还会现场再跑一遍 check.mjs 与 generator-probe.mjs 取现值，
#                                 probe 的 ok=true ∧ fails=0 由它的 D6j/D6k 判 —— 所以 probe 早就在 CI 里）
#   * 七套逻辑套件            —— rule-test / pencil-test / counter-test / scenarios /
#                               r3-crossing / r4-pond / hole-two-balls：总门已经跑过它们，这里**再各跑一遍**
#                               不是为了重复判定，而是为了让每一套留下**自己的 rc 与自己的日志工件** ——
#                               挤在总门那一行里时，"哪一套红了"只能去翻整档输出，工件也就只是两坨聚合日志。
# 仍然不在这里跑的只有两条，理由各自不同（ci.yml 头部同一条口径）：
#   * `node tools/balance.mjs`：它的结论里有一条**绝对墙钟线**（balance.mjs 的 `墙钟 p95 ≤ 按球数的绝对线`），
#       那一列读的是跑它的那台机器的负载 —— 写进常驻门就是把本机负载读成回归。**不是嫌它慢**：
#       默认口径（每档 200 盘）本机这一趟 4s 量级就跑完了，慢这条理由被实测推翻了。
#   * `node tools/sabotage.mjs`：破坏台账要改文件、要把实测 rc 写回 README 的台账行，
#       属于"证明闸会红"的那一层，不是"这一轮没坏"。
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE" || exit 2

GATES=("node tools/check.mjs" "node tools/doctest.mjs" \
  "node tools/rule-test.mjs" "node tools/pencil-test.mjs" "node tools/counter-test.mjs" \
  "node tools/scenarios.js" "node tests/r3-crossing.test.mjs" "node tests/r4-pond.test.mjs" \
  "node tests/hole-two-balls.test.mjs")
RC_ALL=0
LOGS=0
for cmd in "${GATES[@]}"; do
  tag=$(echo "$cmd" | tr ' /.' '___')
  log="_tmp-herugolf-verify-${tag}.log"
  echo "▶ $cmd   （日志：${log}）"
  T0=$(date +%s)
  $cmd >"$log" 2>&1
  RC=$?
  echo "GATE_RC=$RC" >>"$log"
  LOGS=$((LOGS + 1))
  echo "  rc=$RC 用时 $(( $(date +%s) - T0 ))s"
  # 每一道自己报的那一行 RESULT（套件按文件名自报名）——总门那一跑就是把七套压成一行红，
  # 这里把它念回来，让"哪一套"出现在入口的输出里而不是只在日志工件里。
  # 没有 RESULT 行的那一道（doctest 交的是 rows/fail 那两行）就把档位输出末尾念回来，不许一片空白。
  if grep -qE '^RESULT ' "$log"; then
    grep -E '^RESULT ' "$log" | sed 's/^/  │ /'
  else
    tail -3 "$log" | sed 's/^/  │ /'
  fi
  if [ "$RC" -ne 0 ]; then
    RC_ALL=1
    echo "  ✗ $cmd 红了（rc=${RC}）：整档输出在 $log"
    grep -E '^\s*✗ ' "$log" | head -8 | sed 's/^/  ↳ 红因：/'
  fi
done

if [ "$LOGS" -ne "${#GATES[@]}" ]; then
  echo "RESULT verify ok=false gates=${#GATES[@]} logs=${LOGS}（有一条闸没跑成 —— 路径写错就是这样，别当绿）"
  exit 1
fi
if [ "$RC_ALL" -ne 0 ]; then
  echo "RESULT verify ok=false（有一道以上闸红，gates=${#GATES[@]} logs=${LOGS}：红因见上面点名的套件）"
  exit 1
fi
echo "RESULT verify ok=true gates=${#GATES[@]} logs=${LOGS}（总门 + 文档数字闸 + 七套逻辑套件都绿）"
