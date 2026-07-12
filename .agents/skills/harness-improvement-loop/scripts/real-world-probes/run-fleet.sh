#!/usr/bin/env bash
# Real-world probe fleet runner. Run from the REPO ROOT (relative ./qa-out
# paths + workspace package resolution both depend on it):
#   bash .agents/skills/harness-improvement-loop/scripts/real-world-probes/run-fleet.sh [probe-substring ...]
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/../../../../.."
PROBES=(p1-research-writer p2-multi-file p3-structured-output p4-error-recovery p5-long-horizon p6-abstention p7-code-action p8-streaming p9-strategy-matrix p10-multi-turn)
for probe in "${PROBES[@]}"; do
  if [ $# -gt 0 ]; then
    match=0
    for want in "$@"; do case "$probe" in *"$want"*) match=1 ;; esac; done
    [ $match -eq 0 ] && continue
  fi
  echo ""
  echo "──────── running $probe ────────"
  timeout 420 bun "$DIR/$probe.ts" 2>&1 | tail -25
  echo "──────── $probe done (exit $?) ────────"
done
echo ""
echo "Reports: wiki/Research/Harness-Reports/real-world-probes-2026-07-11/"
