#!/usr/bin/env bash
# One slice of the A/B matrix: both arms for one tier up to run index K-1, arms
# alternated (committed, candidate). Resumable: runH3 skips finished cells, so re-issue
# the same command until both arms print remaining=0. Each arm call has its own budget
# so one slice stays under the 590 s foreground cap:
#   timeout 590 bash run-matrix.sh <qwen3:4b|cogito:8b> <K> [budgetSecPerArm=270] [cellTimeoutSec=200]
# Used: cogito:8b with cell timeout 200; qwen3:4b with 150 (its cells take ~80 s, so a
# 200 s timeout let only one cell start per arm per slice).
# cwd is a per-tier dir INSIDE the repo (results/traces-cwd-<tier>, gitignored):
# runSession() sweeps `.bench-run-*` in cwd, and a cwd outside the repo breaks git
# rev-parse (see ../2026-11-10-budget-answer-turn/run-matrix.sh).
set -u
REPO=/home/tylerbuell/Documents/AIProjects/reactive-agents-ts
D=$REPO/wiki/Research/Ablations/2026-11-11-calibration-v3-priors
export RA_ABL_SNAPSHOT=/home/tylerbuell/.reactive-agents/ablations/2026-11-11-calibration-v3-priors/snapshot
O=$D/results/matrix
T=$1; K=$2; BUD=${3:-270}; CT=${4:-200}
TASKS=rw-2,rw-3,h3-exact-value,h3-continuation,h3-required-tools,rw-9
W=$D/results/traces-cwd-$(echo "$T" | tr ':' '_')
mkdir -p "$W" "$O"; cd "$W" || exit 2
for arm in committed candidate; do
  dir=committed; [ "$arm" = candidate ] && dir=candidates
  RA_ABL_CAL_DIR=$D/$dir RA_ABL_ARM=$arm bun --env-file="$REPO/.env" --preload "$D/arm-plugin.ts" \
    "$D/run-arm.ts" --tier "$T" --k "$K" --out-dir "$O" --task "$TASKS" --cell-timeout-sec "$CT" --budget-sec "$BUD" 2>&1 \
    | /usr/bin/grep -a "^\[h3\|^\[arm-plugin\]"
done
