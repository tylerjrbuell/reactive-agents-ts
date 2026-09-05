#!/usr/bin/env bash
# Check N — cost accounting is cache-aware (2026-08-24 amendment §4).
#
# Two invariants:
#   1. LLMRequestCompleted has at least one producer. It shipped with nine
#      consumers and zero producers for months (spec finding F-1); this makes
#      that regression loud.
#   2. The lift gate's cost leg reads a `billed` figure, not a raw one.
#
# event-bus.ts is excluded from the producer grep: it only ever DECLARES the
# `_tag: "LLMRequestCompleted"` field on the event's type
# (`readonly _tag: "LLMRequestCompleted";`), it never publishes one. Without
# this exclusion that declaration alone satisfies the producer count even if
# the real publish call (kernel/utils/diagnostics.ts) is deleted, so the gate
# could never observe the F-1 regression it exists to catch.
#
# `|| true` on the producers pipeline (and the `${producers:-0}` fallback)
# keep this under `set -e`: when the grep finds zero matches the pipeline
# itself exits non-zero, which would otherwise abort the script at this
# assignment — before the FAIL diagnostic below ever runs.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

producers=$(grep -rn '_tag: "LLMRequestCompleted"' packages/*/src apps/*/  \
  --include='*.ts' 2>/dev/null | grep -v '/dist/' | grep -v '\.test\.ts' \
  | grep -v 'event-bus.ts' | wc -l || true)
producers=${producers:-0}
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
