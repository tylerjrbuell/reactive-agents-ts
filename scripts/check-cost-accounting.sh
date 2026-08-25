#!/usr/bin/env bash
# Check N — cost accounting is cache-aware (2026-08-24 amendment §4).
#
# Two invariants:
#   1. LLMRequestCompleted has at least one producer. It shipped with nine
#      consumers and zero producers for months (spec finding F-1); this makes
#      that regression loud.
#   2. The lift gate's cost leg reads a `billed` figure, not a raw one.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

producers=$(grep -rn '_tag: "LLMRequestCompleted"' packages/*/src apps/*/  \
  --include='*.ts' 2>/dev/null | grep -v '/dist/' | grep -v '\.test\.ts' | wc -l)
if [ "$producers" -lt 1 ]; then
  echo "FAIL: LLMRequestCompleted has no producer. The per-call cost stream is dead."
  fail=1
else
  echo "ok: LLMRequestCompleted producers: $producers"
fi

if ! grep -q 'billedTokenOverheadPct' packages/benchmarks/src/gate/gate.ts; then
  echo "FAIL: gate.ts does not compute billedTokenOverheadPct — cost leg is cache-blind."
  fail=1
else
  echo "ok: gate computes the billed token leg"
fi

if ! grep -q 'tokenLeg' packages/benchmarks/src/gate/types.ts; then
  echo "FAIL: LiftPolicy has no tokenLeg field."
  fail=1
else
  echo "ok: LiftPolicy declares tokenLeg"
fi

exit $fail
