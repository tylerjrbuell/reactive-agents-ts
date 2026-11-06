#!/usr/bin/env bash
# Plan 9 item 1R — one run scope (2026-11-05).
#
# Per-run state lives in ONE FiberRef (core/src/internal/run-scope.ts) as typed
# run slots, bound only by withRunScope / childRunScope / ensureRunScope. A new
# FiberRef, or a new Effect.locally / FiberRef.set binding, is how run state
# leaked across runs and agents before (tool stores, document store, file root:
# 2026-11-05). Declare a run slot instead (runSlot(...) in the owning package).
#
# Allowed FiberRef.unsafeMake sites (file:symbol), each with its reason:
# - core/src/internal/run-scope.ts:CurrentRunScope  the run scope itself
# - llm-provider/src/structured-parse-retry.ts:StructuredUsageRef
#     per CALL: usage of one structured-output call, read once by its wrapper
# - reasoning/src/kernel/llm-gateway.ts:CurrentModelRouting
#     per CALL: the model pool one ReasoningService.execute dispatch routes over
# - reasoning/src/kernel/run-budget.ts:CurrentRunBudget, CurrentRunBudgetLimits
#     per RUN: bound once per run (armRunBudget -> withRunBudgetMeter, around
#     execute). A run slot needs budgetLimits in startRun's spec (Plan 9 1R;
#     deferred 2026-11-05: low value, the binding is already once per run)
#
# Allowed binding sites (Effect.locally / FiberRef.set) are the same refs, at
# the files listed in ALLOWED_BINDS below.
#
# Usage: bash scripts/check-run-scope.sh [scan-root]   (default: packages)
# Exit: 0 if the invariant holds; 1 with the offending lines if violated.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="${1:-packages}"

ALLOWED_REFS=(
  "core/src/internal/run-scope.ts:CurrentRunScope"
  "llm-provider/src/structured-parse-retry.ts:StructuredUsageRef"
  "reasoning/src/kernel/llm-gateway.ts:CurrentModelRouting"
  "reasoning/src/kernel/run-budget.ts:CurrentRunBudget"
  "reasoning/src/kernel/run-budget.ts:CurrentRunBudgetLimits"
)
ALLOWED_BINDS=(
  "core/src/internal/run-scope.ts"
  "llm-provider/src/structured-parse-retry.ts"
  "reasoning/src/kernel/observable-llm.ts"
  "reasoning/src/services/reasoning-service.ts"
  "reasoning/src/kernel/run-budget.ts"
  "runtime/src/engine/finalize/debrief-synthesis.ts"
)

src_files() {
  find "$ROOT" -path '*/node_modules' -prune -o -path '*/dist' -prune -o \
    -path '*/src/*' -name '*.ts' ! -name '*.test.ts' -print
}

violations=""
while IFS= read -r file; do
  rel="${file#"$ROOT"/}"
  # Comment lines never count.
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    line="${hit#*:}"
    sym=$(sed -nE 's/.*(const|let) ([A-Za-z_][A-Za-z0-9_]*).*FiberRef\.unsafeMake.*/\2/p' <<<"$line")
    ok=false
    for a in "${ALLOWED_REFS[@]}"; do [[ "$a" == "$rel:$sym" ]] && ok=true; done
    $ok || violations+="new FiberRef: $file:$hit"$'\n'
  done < <(grep -n "FiberRef\.unsafeMake" "$file" | grep -vE '^[0-9]+:\s*(//|\*)' || true)

  if grep -nE "Effect\.locally|locallyScoped|FiberRef\.set\(" "$file" | grep -vqE '^[0-9]+:\s*(//|\*)'; then
    ok=false
    for a in "${ALLOWED_BINDS[@]}"; do [[ "$a" == "$rel" ]] && ok=true; done
    if ! $ok; then
      while IFS= read -r hit; do
        violations+="new binding: $file:$hit"$'\n'
      done < <(grep -nE "Effect\.locally|locallyScoped|FiberRef\.set\(" "$file" | grep -vE '^[0-9]+:\s*(//|\*)')
    fi
  fi
done < <(src_files)

scanned=$(src_files | wc -l)
if [[ "$scanned" -eq 0 ]]; then
  echo "check-run-scope: SCAN-EMPTY under $ROOT (no vacuous green)"
  exit 1
fi

if [[ -n "$violations" ]]; then
  echo "Run-scope invariant VIOLATED — per-run state must be a run slot (core/internal/run-scope):"
  printf '%s' "$violations"
  echo
  echo "Declare runSlot(name, { child, initial|fresh }) in the owning package and bind it at the run entry (runtime/src/engine/start-run.ts)."
  exit 1
fi

echo "check-run-scope: $scanned source files; per-run state is in run slots (no new FiberRef or binding)."
