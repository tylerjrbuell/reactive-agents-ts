#!/usr/bin/env bash
# usage: drive.sh <tier> [k] [arms] [tasks] — one foreground pass (<=585 s); resumes, re-invoke until remaining=0.
# arms: base = RA_ACT_OR_ANSWER=auto ; shell = same + shell-execute on rw-7/lh-debug-green.
set -u
R=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp/shell-ab
tier=$1; k=${2:-3}; arms=${3:-"base shell"}; tasks=${4:-rw-7,lh-debug-green}; slug=${tier//:/-}
tag=${TAG:-ab}; cellT=${CELL_T:-240}; margin=$(( cellT < 190 ? 190 : cellT + 5 ))
if [ -n "$(git -C "$R" status --short packages)" ]; then echo DIRTY; exit 3; fi
start=$(date +%s); cd "$R" || exit 4
for arm in $arms; do
  left=$(( 585 - ($(date +%s) - start) )); [ "$left" -lt 60 ] && { echo "[drive] out of wall"; exit 0; }
  export RA_ACT_OR_ANSWER=auto; unset RA_INPUT_COVERAGE
  case "$arm" in shell) export SHELL_ARM=1 ;; *) unset SHELL_ARM ;; esac
  log="$D/$arm-$tag-$slug.log"
  echo "CLEAN $(git -C "$R" rev-parse --short HEAD) arm=$arm SHELL=${SHELL_ARM:-0} cellT=$cellT $(date +%T)" >>"$log"
  timeout "$left" bun run "$D/run-shell.ts" --out "$D/$arm-$tag-$slug.json" --trace-root "$D/traces-$arm-$tag-$slug" \
    --tier "$tier" --k "$k" --budget-sec "$((left - 5))" --start-margin-sec "$margin" --cell-timeout-sec "$cellT" --task "$tasks" >>"$log" 2>&1
  echo "exit=$?" >>"$log"
  echo "[drive] $arm: $(/usr/bin/grep -a '^\[h3\] ran=' "$log" | tail -1)"
done
