#!/usr/bin/env bash
# One run index of the A/B matrix for one tier, arms alternated (on, off) per task group.
# Task set = the live trigger census's firing variants (see the ablation note):
#   custom @mi2: umami-explore, wide-metric   custom @mi3: umami-explore
#   H3 @mi2:     h3-continuation, h3-exact-value
# Each tier runs in its OWN cwd: runSession() sweeps every `.bench-run-*` dir in cwd at
# start (runner.ts cleanupStaleBenchDirs), which deleted a concurrent tier's live H3
# fixture in the first pass (2 ENOENT cells; that pass was voided). The cwd stays INSIDE
# the repo (results/traces-cwd-<tier>, gitignored): a cwd outside it broke `git rev-parse`
# (gitSha "unknown") and added ~146 s per H3 cell (second pass, voided). The repo .env is
# loaded explicitly because bun only auto-loads .env from cwd.
#   bash run-matrix.sh <tier: mimo|grok|cogito> <run> [all|h3]
set -u
REPO=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts
D=$REPO/wiki/Research/Ablations/2026-11-10-budget-answer-turn
export RA_ABL_SNAPSHOT=/home/tylerbuell/.reactive-agents/ablations/2026-11-10-budget-answer-turn/snapshot
O=$D/results/matrix
T=$1; R=$2; ONLY=${3:-all}
case $T in
  mimo) C=(--tier mimo-v2.6 --num-ctx 16384); H=mimo-v2.6@16384 ;;
  grok) C=(--tier grok-4); H=grok-4 ;;
  cogito) C=(--tier cogito:8b); H=cogito:8b ;;
esac
W=$D/results/traces-cwd-$T
mkdir -p "$W"; cd "$W" || exit 2
B=(bun --env-file="$REPO/.env" --preload "$D/arm-plugin.ts")
for arm in on off; do
  if [ "$ONLY" != h3 ]; then
    RA_ABL_ARM=$arm "${B[@]}" "$D/run-custom.ts" "${C[@]}" --runs "$R" --out-dir "$O" --task umami-explore,wide-metric --max-iter 2 --cell-timeout-sec 150 2>&1 | grep -a "^\[arm\]"
    RA_ABL_ARM=$arm "${B[@]}" "$D/run-custom.ts" "${C[@]}" --runs "$R" --out-dir "$O" --task umami-explore --max-iter 3 --cell-timeout-sec 180 2>&1 | grep -a "^\[arm\]"
  fi
  RA_ABL_ARM=$arm "${B[@]}" "$D/run-h3-arm.ts" --tier "$H" --run "$R" --out-dir "$O" --task h3-continuation,h3-exact-value --max-iter 2 --cell-timeout-sec 120 2>&1 | grep -a "^\[h3"
done
