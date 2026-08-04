#!/usr/bin/env bash
# Move 2 / Sys-audit 2026-07-29 RC#1 — single ground-truth success authority.
#
# The post-condition success authority was filesystem-blind: it judged whether a
# deliverable was produced from a RECONSTRUCTION (ledger + steps) and never from
# disk, producing an 88% false-failure rate on correct deliverables. The fix
# routes BOTH delivery-decision paths through ONE owner that wires disk ground
# truth in by default:
#
#   owner:   kernel/capabilities/verify/delivery-authority.ts  (verifyDelivery)
#   callers: kernel/loop/terminate.ts                          (imperative hard-stop)
#            kernel/capabilities/decide/terminal-gate.ts        (verdict gate)
#
# This script fails CI if either invariant regresses, so a NEW delivery path
# cannot silently fall back to the filesystem-blind pure verify() (Face A —
# "fixed where we were looking").
#
# Usage: bash scripts/check-success-authority.sh
# Exit: 0 if the invariants hold; 1 with the offending detail otherwise.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/reasoning/src"
OWNER="$SRC/kernel/capabilities/verify/delivery-authority.ts"
CALLERS=(
  "$SRC/kernel/loop/terminate.ts"
  "$SRC/kernel/capabilities/decide/terminal-gate.ts"
)

fail() { echo "❌ $1"; echo ""; exit 1; }

# ── Invariant 1: the owner wires disk ground truth ON BY DEFAULT ──────────────
# Require the DEFAULT-wiring pattern (`?? nodeFileExists`), not a mere mention —
# a commented-out or doc-comment reference must not satisfy the invariant.
[ -f "$OWNER" ] || fail "delivery authority missing: $OWNER"
if ! grep -qE '\?\?[[:space:]]*nodeFileExists' "$OWNER"; then
  fail "delivery-authority.ts does not default fileExists to nodeFileExists
(\`?? nodeFileExists\`) — disk ground truth is not wired ON by construction, so a
caller that omits it gets the filesystem-blind pure verify() again (RC#1)."
fi

# ── Invariant 2: every delivery path routes through the owner ─────────────────
for f in "${CALLERS[@]}"; do
  rel="${f#"$ROOT"/}"
  [ -f "$f" ] || fail "delivery caller missing: $rel"

  if ! grep -q "verifyDelivery(" "$f"; then
    fail "$rel decides delivery post-conditions but does NOT call verifyDelivery().
Route it through kernel/capabilities/verify/delivery-authority.ts so disk +
ledger ground truth is applied — do not call the pure verify() directly."
  fi

  # The pure verify()/verifyPostConditions() must not be used for the delivery
  # decision in these files — that is the filesystem-blind path. `verifyDelivery`
  # is explicitly allowed (it composes verify() internally). Comment lines that
  # merely NAME verify() in prose (doc-comments start with // * or /*) are not a
  # call and are filtered out.
  RAW="$(grep -nE 'verify(PostConditions)?\(' "$f" \
    | grep -v 'verifyDelivery' \
    | awk -F: '{ code=$0; sub(/^[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code);
                if (code !~ /^(\/\/|\*|\/\*)/) print $0 }' \
    || true)"
  if [ -n "$RAW" ]; then
    echo "❌ $rel calls the pure verify() for a delivery decision (filesystem-blind):"
    echo ""
    echo "$RAW"
    echo ""
    echo "Use verifyDelivery() from delivery-authority.ts instead."
    exit 1
  fi
done

echo "✅ Success-authority invariant holds — verifyDelivery() is the single owner;"
echo "   disk ground truth is wired and both delivery paths route through it."
exit 0
