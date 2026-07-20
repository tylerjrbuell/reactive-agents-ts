#!/usr/bin/env bash
# Meta-loop Phase 5b (F1) — Control Plane single-decider invariant guard.
#
# "Which ONE control action does the harness take this iteration?" is decided by
# the control plane's resolver (kernel/control/control-plane.ts → resolveControlPlane)
# over typed ControlProposals emitted by each control component (kernel/control/
# emitters.ts). Before F1 each component FORCED its own action at its own site —
# the loop detector switched strategy, forced abstention fired post-loop, F3
# redirected — with nothing reconciling them, so two could fire in one iteration
# (the P5 race: abstention vs strategy-switch). That scatter is exactly the drift
# the meta-loop DAG exists to kill.
#
# This script fails CI if a NEW direct control-forcing call appears outside the
# control home (kernel/control/). The forcing primitives it tracks are the
# strategy-switch actuator (`applyStrategySwitch(`) and the forced-abstention
# decision (`decideForcedAbstention(`) — the two clearest "force a control action
# directly" seams F1 consolidates. Every legacy direct-decision site is
# grandfathered below and the list SHRINKS as later waves route the remaining
# forcing sites through the resolver. New control decisions belong in
# kernel/control/, resolved via resolveControlPlane — not re-forced at a new site.
# Mirrors check-run-assessment.sh / check-run-contract.sh / check-ledger-writes.sh.
#
# Usage: bash scripts/check-control-plane.sh
# Exit: 0 if the invariant holds; 1 with the offending lines if violated.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEARCH_DIR="$ROOT/packages/reasoning/src"

# The direct control-forcing primitives. A CALL to either outside the sanctioned
# home + grandfathered set is a new un-reconciled control decision.
PRIMITIVES='applyStrategySwitch\(|decideForcedAbstention\('

# The primitives' own definitions are NOT forcing calls — they are the actuator
# and the decision function the resolver drives. Skip the definition lines so the
# guard matches CALLS only. (This also hardens the guard: a stray CALL added
# inside a definition file is still caught, whereas a blanket file-level
# grandfather would have missed it.)
DEFINITIONS='export function (applyStrategySwitch|decideForcedAbstention)\('

# The control plane home — the ONE sanctioned owner of control-action decisions
# (the resolver, the proposal emitters, and the in-loop abstain derivation).
ALLOWED_FILES=(
  "kernel/control/"
)

# Grandfathered legacy direct-decision sites (F1 snapshot). Each still forces a
# control action locally; later waves route them through resolveControlPlane. DO
# NOT ADD to this list — a NEW control decision belongs in kernel/control/,
# resolved via the resolver. The list must SHRINK, never grow.
#
# Was 4 entries; the two DEFINITION files (strategy-switch.ts / force-abstention.ts)
# were never migration targets — they define the primitives the resolver drives —
# and are now excluded structurally via $DEFINITIONS, leaving the 2 real forcing
# sites below (iterate-pass.ts calls applyStrategySwitch ×2; runner.ts calls
# decideForcedAbstention ×1). These are the true one-per-PR ratchet target.
GRANDFATHERED=(
  "kernel/loop/iterate-pass.ts"                     # dispatcher switch seam — 2 applyStrategySwitch calls (loop-detected seam, resolver-gated)
  "kernel/loop/runner.ts"                           # §7.5 post-loop forced abstention — 1 decideForcedAbstention call
)

# Build a single grep -v exclude pattern from allowed + grandfathered lists.
EXCLUDE=""
for f in "${ALLOWED_FILES[@]}" "${GRANDFATHERED[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done

# Any control-forcing CALL outside the sanctioned/grandfathered set.
#  - drop the allowed owners + grandfathered sites
#  - drop *.test.ts / *.spec.ts (they exercise the primitives, never own the decision)
#  - drop comment lines (code after `path:lineno:` starts with // or * or /*)
HITS="$(grep -rn -E "$PRIMITIVES" \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -E -v "$EXCLUDE" \
  | grep -E -v "$DEFINITIONS" \
  | grep -E -v '\.(test|spec)\.ts:' \
  | awk -F: '{ code=$0; sub(/^[^:]*:[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code);
              if (code !~ /^(\/\/|\*|\/\*)/) print $0 }' \
  || true)"

if [ -n "$HITS" ]; then
  echo "❌ Control Plane invariant violated. New direct control-forcing call outside kernel/control/:"
  echo ""
  echo "$HITS"
  echo ""
  echo "Decide control actions through the control plane resolver"
  echo "(kernel/control/control-plane.ts → resolveControlPlane) over typed"
  echo "ControlProposals (kernel/control/emitters.ts) instead of forcing the action"
  echo "directly. If this is a sanctioned legacy site, it must be added to the"
  echo "GRANDFATHERED list in this script WITH a migration note — but prefer"
  echo "routing it through the resolver."
  exit 1
fi

echo "✅ Control Plane invariant holds — control forcing confined to the resolver + grandfathered sites."
exit 0
