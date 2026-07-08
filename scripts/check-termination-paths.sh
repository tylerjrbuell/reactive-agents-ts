#!/usr/bin/env bash
# Stage 5 W4 — Single-owner termination invariant guard (FIX-18 / NS §2.5).
#
# The kernel had 9 termination paths (8 in runner.ts + 1 oracle in arbitrator.ts).
# That scatter was the failure-corpus root cause. W4 routed all imperative
# terminations through `kernel/loop/terminate.ts`. This script fails CI if a
# new direct `status: "done"` transition appears outside the two authorized
# owners — protecting the invariant from regression.
#
# Authorized owners:
# - packages/reasoning/src/kernel/loop/terminate.ts      (the imperative helper)
# - packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts (the verdict oracle)
#
# Usage: bash scripts/check-termination-paths.sh
# Exit: 0 if invariant holds; 1 with the offending lines if violated.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEARCH_DIR="$ROOT/packages/reasoning/src"

ALLOWED_FILES=(
  "kernel/loop/terminate.ts"
  "kernel/capabilities/decide/arbitrator.ts"
)

# Build grep -v exclude pattern from the allowed list.
EXCLUDE=""
for f in "${ALLOWED_FILES[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done

# Search for any direct status:"done" or status:'done' transition.
#
# Filter to REAL code transitions only:
#  - drop the authorized owner files (terminate.ts / arbitrator.ts)
#  - drop *.test.ts / *.spec.ts (they assert ABOUT terminal state, never perform it)
#  - drop comment lines: where the code (after `path:lineno:`) begins with
#    `//`, `*`, or `/*`, or where `//` precedes the `status:"done"` match
#    (inline comment). These mention the string in prose, not as a transition.
HITS="$(grep -rn -E 'status:\s*"done"|status:\s*'\''done'\''' \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -E -v "$EXCLUDE" \
  | grep -E -v '\.(test|spec)\.ts:' \
  | awk -F: '{ code=$0; sub(/^[^:]*:[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code);
              if (code !~ /^(\/\/|\*|\/\*)/ && code !~ /\/\/.*status:[ \t]*["'\'']done/) print $0 }' \
  || true)"

if [ -n "$HITS" ]; then
  echo "❌ Termination invariant violated. Direct status:'done' transitions outside the helpers:"
  echo ""
  echo "$HITS"
  echo ""
  echo "Use \`terminate(state, { reason, output })\` from kernel/loop/terminate.ts instead,"
  echo "or — for verdict-driven exits — go through the Arbitrator."
  exit 1
fi

echo "✅ Termination invariant holds — all status:'done' transitions route through terminate() or Arbitrator."

# ── Phase 3 (Terminal Authority): single-owner terminal-gate decisions ────────
#
# The accept/redirect/abstain decision for a candidate final answer is owned by
# kernel/capabilities/decide/terminal-gate.ts. No other file may construct a
# gate-decision literal — strategies and the arbitrator consume gate output
# (mapping `gate.decision` variables is fine; deciding locally is not). This is
# what killed the F1/B1/P3 three-implementations drift.
GATE_HITS="$(grep -rn -E 'decision:\s*"(redirect|abstain)"' \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -v 'kernel/capabilities/decide/terminal-gate.ts' \
  | grep -E -v '\.(test|spec)\.ts:' \
  || true)"

if [ -n "$GATE_HITS" ]; then
  echo "❌ Terminal-gate invariant violated. Gate-decision literals constructed outside terminal-gate.ts:"
  echo ""
  echo "$GATE_HITS"
  echo ""
  echo "Route the decision through \`evaluateTerminalGate()\` from"
  echo "kernel/capabilities/decide/terminal-gate.ts and map its output instead."
  exit 1
fi

echo "✅ Terminal-gate invariant holds — accept/redirect/abstain decisions constructed only in terminal-gate.ts."
exit 0
