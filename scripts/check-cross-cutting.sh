#!/usr/bin/env bash
# Cross-cutting cascade invariant guard (design spec §4.4 / 09-UNIFIED-PROGRAM §6).
#
# The RunEnvelope (kernel/envelope/run-envelope.ts) is the ONE run-wide carrier
# for the seven cross-cutting harness concerns (approvalPolicy, approvalDecision,
# interactionResponse, grounding, fabricationGuard, stallPolicy, taskContract).
# Before the cascade these were hand-declared on every strategy's own input
# interface and threaded by hand at N call sites — the exact "silently dropped
# wherever one is missed" defect class the cascade exists to end. Its integrity
# now depends on three things holding at once:
#
#   1. No strategy input interface re-declares an envelope field. The envelope
#      is the only carrier; a re-declared field is a strategy quietly growing
#      its own copy of state that belongs to the run, not to it.
#   2. No raw `KernelInput` object literal is hand-built outside the canonical
#      assembly module (kernel/state/build-kernel-input.ts) and the small set
#      of sanctioned reference sites below — a hand-built literal can omit a
#      cross-cutting field with no compiler signal.
#   3. RunEnvelope is `Effect.provideService`'d at exactly the two sanctioned
#      seams: production (services/reasoning-service.ts, the strategy-dispatch
#      boundary) and test (provideTestEnvelope in run-envelope.ts itself). A
#      second provision site is two competing sources of truth for one run.
#
# This script fails CI if any of the three break. Mirrors check-ledger-writes.sh
# / check-run-contract.sh; discovered + run by the CI "Enforce architectural
# invariants" step (`for s in scripts/check-*.sh`) and by
# packages/reasoning/tests/enforcement-scripts.test.ts.
#
# Usage: bash scripts/check-cross-cutting.sh
# Exit: 0 if all three invariants hold; 1 with the offending lines if violated.

set -euo pipefail
cd "$(dirname "$0")/.."
FAIL=0

STRATEGIES_DIR="packages/reasoning/src/strategies"
REASONING_SRC="packages/reasoning/src"

# ── Check 1/3: strategy input interfaces must not re-declare envelope fields ──
DECLS="$(grep -rnE '^[[:space:]]*(readonly[[:space:]]+)?(approvalPolicy|approvalDecision|interactionResponse|fabricationGuard|stallPolicy|grounding|taskContract)\??:' \
  --include='*.ts' "$STRATEGIES_DIR" 2>/dev/null \
  | grep -v '\.test\.ts:' || true)"
if [ -n "$DECLS" ]; then
  echo "FAIL (1/3): strategy input interface re-declares a cross-cutting field"
  echo "(the RunEnvelope is the only carrier):"
  echo ""
  echo "$DECLS"
  echo ""
  echo "Remove the field from the strategy's input interface — it rides RunEnvelope"
  echo "(packages/reasoning/src/kernel/envelope/run-envelope.ts) and is merged onto"
  echo "KernelInput by runKernel. A re-declared field is exactly the 'silently"
  echo "dropped at one of N boundaries' defect class this gate exists to end."
  FAIL=1
else
  echo "OK (1/3): no strategy re-declares a cross-cutting envelope field."
fi

# ── Check 2/3: no raw KernelInput literal outside sanctioned sites ──
# Sanctioned:
#   - kernel/state/build-kernel-input.ts — the canonical assembly module
#     (buildKernelInput; returns a KernelInput, doesn't match this literal
#     shape today, but stays listed so it can never accidentally be flagged).
#   - strategies/reactive.ts / strategies/direct.ts — reference strategies
#     that assemble the ReAct-kernel's first-pass KernelInput directly.
#   - kernel/loop/runner-helpers/strategy-switch.ts — strategy-switch handoff:
#     spreads an ALREADY-assembled `priorInput` (envelope fields already merged
#     by runKernel) with two field overrides (priorContext, requiredTools). It
#     never hand-authors a cross-cutting field, so it is not the defect this
#     check exists to catch.
ALLOWED_KERNEL_INPUT_SITES=(
  "kernel/state/build-kernel-input.ts"
  "strategies/reactive.ts"
  "strategies/direct.ts"
  "kernel/loop/runner-helpers/strategy-switch.ts"
)
EXCLUDE=""
for f in "${ALLOWED_KERNEL_INPUT_SITES[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done
LITERALS="$(grep -rnE 'const [a-zA-Z_][a-zA-Z0-9_]*: KernelInput = \{' \
  --include='*.ts' "$REASONING_SRC" 2>/dev/null \
  | grep -v '\.test\.ts:' \
  | grep -E -v "$EXCLUDE" || true)"
if [ -n "$LITERALS" ]; then
  echo "FAIL (2/3): raw KernelInput literal outside the sanctioned assembly sites:"
  echo ""
  echo "$LITERALS"
  echo ""
  echo "Assemble via buildKernelInput() (kernel/state/build-kernel-input.ts) instead"
  echo "of hand-building a KernelInput literal — a hand-built literal can omit a"
  echo "cross-cutting field with no compiler signal. If this is a genuinely"
  echo "sanctioned site, add it to ALLOWED_KERNEL_INPUT_SITES in this script WITH"
  echo "a comment explaining why it cannot silently drop an envelope field."
  FAIL=1
else
  echo "OK (2/3): no raw KernelInput literal outside the sanctioned sites."
fi

# ── Check 3/3: RunEnvelope provided at exactly the two sanctioned seams ──
# Sanctioned:
#   - kernel/envelope/run-envelope.ts — provideTestEnvelope (the test seam).
#   - services/reasoning-service.ts — the ONE production provision site, at the
#     strategy-dispatch boundary:
#       Effect.provideService(strategyFn({...}), RunEnvelope,
#         params.envelope ?? emptyRunEnvelope)
#     Prettier wraps that call so `RunEnvelope` lands on its own line — a
#     same-line `provideService(.*RunEnvelope` grep alone would miss it. The
#     awk pass below catches a bare `RunEnvelope,` line that follows a
#     `provideService(` line within a small window — that combination is what
#     "providing the tag" looks like once wrapped, and it does NOT fire on the
#     `RunEnvelope,` in index.ts's re-export list or on `import { RunEnvelope,
#     ... }` lines (neither follows a provideService( line).
PROVIDES_SAMELINE="$(grep -rnE 'provideService\([^)]*RunEnvelope|RunEnvelope\.of\(' \
  --include='*.ts' packages 2>/dev/null \
  | grep -v '/dist/' | grep -v '\.test\.ts:' | grep -v '__tests__' | grep -v '/tests/' || true)"

PROVIDES_MULTILINE=""
while IFS= read -r -d '' file; do
  hit="$(awk -v file="$file" '
    /provideService\(/ { lastProvide = NR }
    /^[ \t]*RunEnvelope,[ \t]*$/ {
      if (lastProvide != "" && (NR - lastProvide) <= 6) {
        print file ":" NR ": " $0
      }
    }
  ' "$file" 2>/dev/null || true)"
  if [ -n "$hit" ]; then
    PROVIDES_MULTILINE+="$hit"$'\n'
  fi
done < <(find packages -name '*.ts' \
  ! -path '*/dist/*' ! -path '*/node_modules/*' \
  ! -name '*.test.ts' ! -path '*__tests__*' ! -path '*/tests/*' \
  -print0)

PROVIDES="$(printf '%s\n%s\n' "$PROVIDES_SAMELINE" "$PROVIDES_MULTILINE" \
  | grep -v '^$' \
  | grep -v 'kernel/envelope/run-envelope.ts' \
  | grep -v 'services/reasoning-service.ts' || true)"

if [ -n "$PROVIDES" ]; then
  echo "FAIL (3/3): RunEnvelope provided outside the two sanctioned seams:"
  echo ""
  echo "$PROVIDES"
  echo ""
  echo "RunEnvelope must be provided at exactly one production site"
  echo "(services/reasoning-service.ts, the strategy-dispatch boundary) plus the"
  echo "test seam (provideTestEnvelope in kernel/envelope/run-envelope.ts). A"
  echo "second provision site is two competing sources of truth for the same run."
  FAIL=1
else
  echo "OK (3/3): RunEnvelope provided only at the two sanctioned seams."
fi

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Cross-cutting cascade invariant VIOLATED — see failures above."
  exit 1
fi

echo ""
echo "Cross-cutting cascade invariants hold."
exit 0
