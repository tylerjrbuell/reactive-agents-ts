#!/usr/bin/env bash
# usage: drive.sh <tier> [k] [arms] [tasks]  — one foreground pass (<= 585 s wall) over the
# long-horizon suite for one tier; run-h3 resumes, so re-invoke until remaining=0.
# arms: auto = RA_ACT_OR_ANSWER=auto ; ic = auto + RA_INPUT_COVERAGE=1 ; def = both unset.
# env: TAG (results-file tag, default lh), CELL_T (cell timeout s, default 240).
set -u
R=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp/abl-ic
tier=$1; k=${2:-3}; arms=${3:-"auto ic"}; tasks=${4:-rw-7,lh-debug-green,lh-enumerate-audit}; slug=${tier//:/-}
tag=${TAG:-lh}; cellT=${CELL_T:-240}; margin=$(( cellT < 190 ? 190 : cellT + 5 ))
if [ -n "$(git -C "$R" status --short packages)" ]; then echo DIRTY; exit 3; fi
case "$tier" in qwen3:4b|cogito:8b) entry=packages/benchmarks/src/h3/run-h3.ts ;; *) entry=$D/run-h3-extra.ts ;; esac
start=$(date +%s); cd "$R" || exit 4
for arm in $arms; do
  left=$(( 585 - ($(date +%s) - start) )); [ "$left" -lt 60 ] && { echo "[drive] out of wall"; exit 0; }
  unset RA_ACT_OR_ANSWER RA_INPUT_COVERAGE
  case "$arm" in auto) export RA_ACT_OR_ANSWER=auto ;; ic) export RA_ACT_OR_ANSWER=auto RA_INPUT_COVERAGE=1 ;; def) ;; esac
  log="$D/$arm-$tag-$slug.log"
  echo "CLEAN $(git -C "$R" rev-parse --short HEAD) arm=$arm AOA=${RA_ACT_OR_ANSWER:-unset} IC=${RA_INPUT_COVERAGE:-unset} cellT=$cellT $(date +%T)" >>"$log"
  timeout "$left" bun run "$entry" --out "$D/$arm-$tag-$slug.json" --trace-root "$D/traces-$arm-$tag-$slug" \
    --tier "$tier" --k "$k" --budget-sec "$((left - 5))" --start-margin-sec "$margin" --cell-timeout-sec "$cellT" --suite long-horizon --task "$tasks" >>"$log" 2>&1
  echo "exit=$?" >>"$log"
  echo "[drive] $arm: $(/usr/bin/grep -a '^\[h3\] ran=' "$log" | tail -1)"
done
