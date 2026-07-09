#!/usr/bin/env bash
# Meta-loop Phase 6 (G1/G3) — Policy Compiler single-home invariant guard.
#
# "Given THIS model on THIS task, run the harness like THIS" is decided ONCE, by
# the Policy Compiler (kernel/policy/harness-plan.ts). `compileHarnessPlan` turns
# what a run KNOWS about itself — capability tier + calibration + contract horizon
# + task classification — into ONE compiled `HarnessPlan` (strategy, budget class
# + maxIterations, guard horizonProfile + scaffolding depth, tool surface,
# verifier tier, memory posture). `applyExplicitOverrides` lets withers override
# it; `recompileOnAssessment` deepens/leans it mid-run on RunAssessment evidence.
# Before the compiler these choices were scattered across a dozen opt-in withers
# and per-guard constants — exactly the "no single object says how to run" drift
# audit 05-#9 (three maxIterations formulas) and audit 06 (guard constants
# absolute) named.
#
# This script fails CI if the plan-CONSTRUCTION primitives appear OUTSIDE the
# policy home. The primitives it tracks are the three functions that build a
# HarnessPlan — the only sanctioned way harness config is assembled:
#   1. `compileHarnessPlan(`     — assemble the plan from run inputs.
#   2. `applyExplicitOverrides(` — merge wither overrides onto a compiled plan.
#   3. `recompileOnAssessment(`  — rebuild the plan from mid-run evidence.
# A CALL to any of these outside kernel/policy/ + the grandfathered wiring sites
# means harness config is being assembled somewhere that is NOT the compiler.
# Every legacy call site is grandfathered below; the list must SHRINK, never grow.
# Mirrors check-control-plane.sh / check-run-assessment.sh / check-projection.sh.
#
# Usage: bash scripts/check-policy-compiler.sh
# Exit: 0 if the invariant holds; 1 with the offending lines if violated.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEARCH_DIR="$ROOT/packages/reasoning/src"

# The plan-construction primitives. A CALL to any outside the sanctioned home +
# grandfathered set is harness-config assembly that bypassed the compiler.
PRIMITIVES='compileHarnessPlan\(|applyExplicitOverrides\(|recompileOnAssessment\('

# The policy home — the ONE sanctioned owner of harness-config assembly (the
# compiler, the override merge, and the mid-run recompile all live here).
ALLOWED_FILES=(
  "kernel/policy/"
)

# Grandfathered legacy call sites (G1 snapshot). Each is a pre-existing WIRING
# consumer that invokes the compiler at the sanctioned seam — they delegate TO
# the policy home, they do not re-derive config. DO NOT ADD to this list — a NEW
# consumer should route through the existing run-start / iterate-pass seams, not
# call the compiler at a fresh site. The list must SHRINK, never grow.
GRANDFATHERED=(
  "kernel/loop/runner.ts"        # run-start: compileHarnessPlan + applyExplicitOverrides → state.meta.harnessPlan
  "kernel/loop/iterate-pass.ts"  # mid-run: recompileOnAssessment on live RunAssessment evidence
)

# Build a single grep -v exclude pattern from allowed + grandfathered lists.
EXCLUDE=""
for f in "${ALLOWED_FILES[@]}" "${GRANDFATHERED[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done

# Any plan-construction CALL outside the sanctioned/grandfathered set.
#  - drop the allowed owner (kernel/policy/) + grandfathered sites
#  - drop *.test.ts / *.spec.ts (they exercise the compiler, never own the config)
#  - drop comment lines (code after `path:lineno:` starts with // or * or /*)
HITS="$(grep -rn -E "$PRIMITIVES" \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -E -v "$EXCLUDE" \
  | grep -E -v '\.(test|spec)\.ts:' \
  | awk -F: '{ code=$0; sub(/^[^:]*:[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code);
              if (code !~ /^(\/\/|\*|\/\*)/) print $0 }' \
  || true)"

if [ -n "$HITS" ]; then
  echo "❌ Policy Compiler invariant violated. Harness-config assembly outside kernel/policy/:"
  echo ""
  echo "$HITS"
  echo ""
  echo "Compile the per-run harness config through the Policy Compiler"
  echo "(kernel/policy/harness-plan.ts → compileHarnessPlan) instead of assembling"
  echo "strategy/budget/guard/verifier/memory choices ad-hoc. Withers override the"
  echo "compiled plan via applyExplicitOverrides; mid-run adaptation goes through"
  echo "recompileOnAssessment. If this is a sanctioned legacy wiring site, add it to"
  echo "the GRANDFATHERED list in this script WITH a migration note — but prefer"
  echo "routing it through the existing run-start / iterate-pass seams."
  exit 1
fi

echo "✅ Policy Compiler invariant holds — harness-config assembly confined to kernel/policy/ + grandfathered wiring sites."
exit 0
