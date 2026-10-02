#!/usr/bin/env bash
# 本地与 CI 的同一个入口：把现有各道闸串起来，一条命令跑完。
#
#   bash tools/verify.sh
#
# 这一层刻意做薄：它**不新增判据、不改任何一道的判据**，只负责"跑齐"与"把每道的退出码原样记进日志工件"。
# 各道闸住在自己的文件里：
#   * tools/check.mjs        —— 语法门 + 禁词门 + 清单门 + 七套逻辑 RESULT 行（本仓唯一的自动闸）
#   * tools/doctest.mjs      —— 文档数字闸：README 里每个现值逐条对等式，每条配反空转的行数断言
#   * tools/sabotage.mjs     —— 破坏台账（把每一类谎各写回一遍看闸会不会点名变红）：不在这里跑，
#                               它要改文件、要写回台账的实测 rc，属于"证明闸会红"的那一层，不是"这一轮没坏"。
# balance / generator-probe 也不在这里跑：它们的样本量口径（每档 200 盘 / REP=120）是给线定重量用的，
# 墙钟那条线的绝对值跟着本机负载走 —— 写进常驻门就变成每天重测一次结论（README 里同一条口径）。
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE" || exit 2

GATES=("node tools/check.mjs" "node tools/doctest.mjs")
RC_ALL=0
for cmd in "${GATES[@]}"; do
  tag=$(echo "$cmd" | tr ' /.' '___')
  log="_tmp-herugolf-verify-${tag}.log"
  echo "▶ $cmd   （日志：$log）"
  T0=$(date +%s)
  $cmd >"$log" 2>&1
  RC=$?
  echo "GATE_RC=$RC" >>"$log"
  echo "  rc=$RC 用时 $(( $(date +%s) - T0 ))s"
  tail -3 "$log" | sed 's/^/  │ /'
  if [ "$RC" -ne 0 ]; then
    RC_ALL=1
    echo "  ✗ $cmd 红了（rc=$RC）：整档输出在 $log"
  fi
done

if [ "$RC_ALL" -ne 0 ]; then
  echo "RESULT verify ok=false（有一道以上闸红）"
  exit 1
fi
echo "RESULT verify ok=true gates=${#GATES[@]}（check.mjs 与 doctest.mjs 都绿）"
