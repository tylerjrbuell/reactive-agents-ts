#!/usr/bin/env bash
# Meta-loop Phase 5a (E2) — RunAssessment single-home invariant guard.
#
# "Where does this run stand?" — how much NEW progress it made, what phase it is
# in, how healthy it is (recent failures, stall proximity, repeat waste) — is
# computed ONCE per iteration by the RunAssessment estimator (kernel/assessment/
# assess.ts) and CONSUMED by the guards through the sanctioned assessment READERS
# (kernel/assessment/guard-adapters.ts). Before E2 each guard held its OWN private
# run-progress counter (consecutiveStalled, consecutiveLowDeltaCount,
# consecutiveIgnoredNudges, ...) and they drifted: audit 02 found 8 HIGH-severity
# guards misfire on long runs precisely because none shared a progress currency.
#
# This script fails CI if a NEW private run-progress counter is maintained
# (assigned / incremented / declared) OUTSIDE the assessment home. Every legacy
# counter site is GRANDFATHERED below and the list SHRINKS as later waves fold the
# counters into assess() (steps→ledger→assessment projections). New run-progress
# state belongs in kernel/assessment/, READ by guards via guard-adapters.ts — not
# re-invented as another private streak counter. Mirrors check-run-contract.sh /
# check-ledger-writes.sh.
#
# Usage: bash scripts/check-run-assessment.sh
# Exit: 0 if the invariant holds; 1 with the offending lines if violated.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The private run-progress counters E2 is migrating onto RunAssessment. Each is a
# streak/count/threshold field that a guard used to maintain on its own; the goal
# is for every guard to READ the equivalent RunAssessment field instead.
COUNTERS=(
  "consecutiveLowDeltaCount"   # low_delta guard        → assessment.evidenceDelta (E2)
  "consecutiveStalled"         # stall-deliverable       → evidenceDelta / health.iterationsSinceEvidence (E2)
  "consecutiveIgnoredNudges"   # required-tool nudge      → assessment.phase (E2)
  "requiredToolNudgeCount"     # required-tool nudge cap
  "requiredToolRedirects"      # required-tool redirect budget
  "failureRecoveryRedirects"   # F3 / recovery-steering   → health.failureArgVariety (E2)
  "readyToAnswerNudgeCount"    # oracle nudge streak
  "groundingRedirectCount"     # grounded-terminal redirect budget
)

# The assessment home — the ONE sanctioned owner of run-progress state + the
# guard-side readers that consume it.
ALLOWED_FILES=(
  "kernel/assessment/"
)

# Grandfathered legacy counter sites (E2 snapshot). Each still maintains a private
# counter that a later wave folds into assess() (steps→ledger→assessment
# projections make these projections, not private state). DO NOT ADD to this list
# — a NEW run-progress counter belongs in kernel/assessment/, READ via
# guard-adapters.ts. The list must SHRINK, never grow.
GRANDFATHERED=(
  "kernel/loop/iterate-pass.ts"                        # spine locals: low-delta/stall/nudge/redirect counters
  "kernel/loop/runner.ts"                              # counter carrier init
  "kernel/loop/runner-helpers/stall-deliverable.ts"   # nudge/redirect + ignored-nudge streak
  "kernel/loop/runner-helpers/strategy-switch.ts"     # counter reset on switch
  "kernel/loop/runner-helpers/loop-resolution.ts"     # nudge/redirect budget on loop resolution
  "kernel/loop/runner-helpers/recovery-steering.ts"   # redirect budget helper param
  "kernel/loop/runner-helpers/tier-guards.ts"         # low-delta / oracle-nudge threshold params
  "kernel/state/kernel-state.ts"                       # counter FIELD declarations + init + codec
  "kernel/capabilities/decide/arbitrator.ts"          # grounding-redirect budget on the terminal gate
)

SEARCH_DIR="$ROOT/packages/reasoning/src"

# Build the counter-name alternation and the allowed/grandfathered exclude set.
NAMES=""
for c in "${COUNTERS[@]}"; do NAMES+="${NAMES:+|}$c"; done

EXCLUDE=""
for f in "${ALLOWED_FILES[@]}" "${GRANDFATHERED[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done

# A counter WRITE = the identifier immediately followed by `++`, an assignment
# `= x` (not `==`/`===`/`>=`/`<=` — those are reads), or a `:` (object-literal
# value / interface field declaration). Comparisons and destructuring reads do
# not match, so guards that READ a counter are never flagged.
#  - drop the assessment home + grandfathered sites
#  - drop *.test.ts / *.spec.ts (they assert about counters, never own production state)
#  - drop comment lines
HITS="$(grep -rn -E "\b(${NAMES})\b[[:space:]]*(\+\+|=[^=]|:)" \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -E -v "$EXCLUDE" \
  | grep -E -v '\.(test|spec)\.ts:' \
  | awk -F: '{ code=$0; sub(/^[^:]*:[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code);
              if (code !~ /^(\/\/|\*|\/\*)/) print $0 }' \
  || true)"

if [ -n "$HITS" ]; then
  echo "❌ RunAssessment invariant violated. New private run-progress counter outside kernel/assessment/:"
  echo ""
  echo "$HITS"
  echo ""
  echo "Run-progress state (streaks, counts, thresholds) is computed ONCE by the"
  echo "RunAssessment estimator (kernel/assessment/assess.ts) and READ by guards via"
  echo "kernel/assessment/guard-adapters.ts. Do not re-invent a private counter. If"
  echo "the signal you need is missing, extend assess()'s RunHealth and read it —"
  echo "do not maintain a parallel counter. If this is a sanctioned legacy site,"
  echo "add it to GRANDFATHERED in this script WITH a migration note (the list must"
  echo "SHRINK as later waves fold the counters into assessment projections)."
  exit 1
fi

echo "✅ RunAssessment invariant holds — private run-progress counters confined to the assessment home + grandfathered sites."
exit 0
