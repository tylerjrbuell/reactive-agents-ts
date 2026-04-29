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
HITS="$(grep -rn -E 'status:\s*"done"|status:\s*'\''done'\''' \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -E -v "$EXCLUDE" || true)"

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
exit 0
