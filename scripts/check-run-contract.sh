#!/usr/bin/env bash
# Meta-loop Phase 4a (B2) — RunContract single-owner invariant guard.
#
# "What does DONE mean for this run?" is compiled ONCE, at kernel start, into the
# frozen RunContract (kernel/contract/run-contract.ts) and then CONSUMED by the
# terminal gate (check 2.5), the receipt (deliverables[]), and — later waves —
# the projector + assessment. Before B2 the same question was re-derived
# independently in a scatter of sites (each `deriveConditions(...)` call, each
# ad-hoc requiredTools-set done-ness inference). That scatter is exactly the
# drift the meta-loop DAG exists to kill.
#
# This script fails CI if a NEW `deriveConditions(` call appears outside the
# contract home (kernel/contract/) — every legacy call site is grandfathered
# below and the list SHRINKS each wave (Wave C folds condition derivation fully
# into the contract compiler). It mirrors check-termination-paths.sh /
# check-llm-gateway.sh.
#
# Usage: bash scripts/check-run-contract.sh
# Exit: 0 if the invariant holds; 1 with the offending lines if violated.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEARCH_DIR="$ROOT/packages/reasoning/src"

# The contract compiler's home + the derivation primitive's definition file are
# the SANCTIONED owners of condition/deliverable derivation.
ALLOWED_FILES=(
  "kernel/contract/"
  "kernel/capabilities/verify/derive-conditions.ts"
)

# Grandfathered legacy call sites (meta-loop Phase 4a snapshot). Each is a
# pre-existing consumer that still derives conditions locally; Wave C migrates
# them onto the contract compiler. DO NOT ADD to this list — new derivation
# belongs in kernel/contract/. The list must SHRINK, never grow.
GRANDFATHERED=(
  "kernel/loop/runner.ts"                     # postConditions seed (pre-contract spine)
  "kernel/capabilities/decide/arbitrator.ts"  # applyPostConditionGate fallback
  "strategies/reflexion.ts"                    # reflexion required-completion gate
)

# Build a single grep -v exclude pattern from allowed + grandfathered lists.
EXCLUDE=""
for f in "${ALLOWED_FILES[@]}" "${GRANDFATHERED[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done

# Any `deriveConditions(` CALL outside the sanctioned/grandfathered set.
#  - drop the allowed owners + grandfathered sites
#  - drop *.test.ts / *.spec.ts (they assert about derivation, never own it)
#  - drop comment lines (code after `path:lineno:` starts with // or * or /*)
HITS="$(grep -rn -E 'deriveConditions\(' \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -E -v "$EXCLUDE" \
  | grep -E -v '\.(test|spec)\.ts:' \
  | awk -F: '{ code=$0; sub(/^[^:]*:[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code);
              if (code !~ /^(\/\/|\*|\/\*)/) print $0 }' \
  || true)"

if [ -n "$HITS" ]; then
  echo "❌ RunContract invariant violated. New deriveConditions() call outside kernel/contract/:"
  echo ""
  echo "$HITS"
  echo ""
  echo "Compile the run's DONE-ness through the RunContract compiler"
  echo "(kernel/contract/run-contract.ts → compileRunContract) instead of deriving"
  echo "conditions locally. If this is a sanctioned legacy site, it must be added to"
  echo "the GRANDFATHERED list in this script WITH a migration note — but prefer"
  echo "migrating it onto the contract."
  exit 1
fi

echo "✅ RunContract invariant holds — deriveConditions() confined to the contract compiler + grandfathered sites."
exit 0
