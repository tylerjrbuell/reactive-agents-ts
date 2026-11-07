#!/usr/bin/env bash
# usage: drive.sh <tier> [k] [arms]   — one foreground pass (<= 585 s wall) over every
# (arm, suite) chunk of one tier; run-h3 resumes, so re-invoke until all report remaining=0.
# arms default "off auto"; "on" = RA_ACT_OR_ANSWER=1 (retry). Refuses if packages/ is dirty.
set -u
R=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts
D=/home/tylerbuell/.claude/jobs/eaddf328/tmp/abl-auto
tier=$1; k=${2:-3}; arms=${3:-"off auto"}; slug=${tier//:/-}
LH_TASKS=${LH_TASKS:-rw-7,lh-1,lh-debug-green}; H3_TASKS=${H3_TASKS:-h3-plan-only}
if [ -n "$(git -C "$R" status --short packages)" ]; then echo DIRTY; exit 3; fi
case "$tier" in qwen3:4b|cogito:8b) entry=packages/benchmarks/src/h3/run-h3.ts ;; *) entry=$D/run-h3-extra.ts ;; esac
start=$(date +%s); cd "$R" || exit 4
for arm in $arms; do
  for suite in h3 lh; do
    if [ "$suite" = h3 ]; then [ -z "$H3_TASKS" ] && continue; extra=(--task "$H3_TASKS"); else extra=(--suite long-horizon --task "$LH_TASKS"); fi
    left=$(( 585 - ($(date +%s) - start) )); [ "$left" -lt 60 ] && { echo "[drive] out of wall"; exit 0; }
    case "$arm" in auto) export RA_ACT_OR_ANSWER=auto ;; on) export RA_ACT_OR_ANSWER=1 ;; off) unset RA_ACT_OR_ANSWER ;; esac
    log="$D/$arm-$suite-$slug.log"
    echo "CLEAN $(git -C "$R" rev-parse --short HEAD) arm=$arm RA_ACT_OR_ANSWER=${RA_ACT_OR_ANSWER:-unset} $(date +%T)" >>"$log"
    timeout "$left" bun run "$entry" --out "$D/$arm-$suite-$slug.json" --trace-root "$D/traces-$arm-$suite-$slug" \
      --tier "$tier" --k "$k" --budget-sec "$((left - 5))" --start-margin-sec 190 --cell-timeout-sec 240 "${extra[@]}" >>"$log" 2>&1
    echo "exit=$?" >>"$log"
    echo "[drive] $arm/$suite: $(/usr/bin/grep -a '^\[h3\] ran=' "$log" | tail -1)"
  done
done
