#!/bin/bash
# resumable foreground matrix. usage: run-matrix.sh DEADLINE_SECONDS "models..." 
OUT=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Research/Harness-Reports/2026-11-02-wire-corpus
HERE=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Research/Prototypes/wire-corpus-2026-11-02
end=$(( $(date +%s) + $1 )); cd /tmp
for rep in 0 1 2; do for model in $2; do for task in U1 U2 U3 U4 U5 S1 S2; do
  slug=$(echo "$model" | sed 's/[^a-zA-Z0-9]\+/_/g')
  [ -f "$OUT/cells/${slug}__${task}__r${rep}/cell.json" ] && continue
  left=$(( end - $(date +%s) )); [ $left -lt 200 ] && exit 0
  rm -rf "$OUT/cells/${slug}__${task}__r${rep}"
  timeout 190 bun run $HERE/wire-probe.ts "$model" $task $rep "$OUT" 2>&1 | grep '^CELL ' || echo "CELL timeout/fail ${slug} ${task} ${rep}"
done; done; done
