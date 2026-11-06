#!/usr/bin/env bash
# usage: chunk.sh <suite:h3|lh> <tier> <arm:a0|a1|a2|a3> <tasks> [k]  — one foreground chunk (<=590s)
# Resumable: run-h3 appends to --out and skips cells already recorded.
SUITE="$1"; TIER="$2"; ARM="$3"; TASKS="$4"; K="${5:-3}"; SAFE="${TIER//:/_}"
R=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Research/Ablations/2026-11-06-progress-aware-exit
T=/home/tylerbuell/.claude/jobs/eaddf328/tmp/pae
case "$ARM" in
  a0) H="" ;;
  a1) H="--harness loopProgressAware" ;;
  a2) H="--harness progressAwareExit" ;;
  a3) H="--harness loopProgressAware,progressAwareExit" ;;
esac
if [ "$SUITE" = lh ]; then S="--suite long-horizon --arm a0"; else S=""; fi
echo "chunk $SUITE $TIER $ARM start $(date +%T)" >> "$T/log-$SUITE-$SAFE-$ARM.txt"
timeout 590 bun --cwd /home/tylerbuell/.claude/jobs/eaddf328/tmp/wt-h3/packages/benchmarks src/h3/run-h3.ts \
  $S $H --tier "$TIER" --k "$K" --budget-sec 585 --start-margin-sec 250 --cell-timeout-sec 240 \
  --task "$TASKS" \
  --out "$R/results-$SUITE-$SAFE-$ARM.json" --trace-root "$T/traces-$SUITE-$SAFE-$ARM" 2>&1 \
  | /usr/bin/grep -a --line-buffered "^\[h3\]\|H3:\|rror" | tee -a "$T/log-$SUITE-$SAFE-$ARM.txt"
