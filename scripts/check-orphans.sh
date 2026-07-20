#!/usr/bin/env bash
# Wave 4 — declaration-orphan guard (the disease dies here).
#
# The ledger-entry KIND union is already drift-proof at the type level
# (`LedgerEntryKind = LedgerEntry["kind"]`, derived — a kind literal no entry
# interface declares is a compile error). This guard catches the residue types
# CANNOT: a kind interface that EXISTS but that nothing ever appends. Such a
# kind is an always-empty projection — a reader filters for it, gets [], and
# renders nothing, which reads as a silent lie ("no handoffs happened" when in
# truth no handoff was ever recorded).
#
# Rule: every declared ledger-entry kind must have >=1 non-test WRITER (a site
# that mints `kind: "<kind>"`) outside the declaration file itself. A kind with
# zero writers FAILS — UNLESS it is on ORPHAN_BASELINE, a ratcheted list of
# known declared-but-unwritten kinds. The baseline may only SHRINK: if a
# baselined kind GAINS a writer, the guard fails and demands you delete it from
# the list (the doc-example-gate ratchet pattern). NEW orphans are forbidden.
#
# This script rides the auto-globbed scripts/check-*.sh CI lane (so the guard
# cannot itself be orphaned) and is pinned red-on-cut by a fixture-based
# mutation test: packages/reasoning/tests/kernel/ledger/declaration-orphans.test.ts.
# Mirrors check-ledger-writes.sh / check-control-plane.sh.
#
# Usage: bash scripts/check-orphans.sh [SEARCH_DIR] [LEDGER_FILE]
#   SEARCH_DIR  where writers live (default: packages/reasoning/src)
#   LEDGER_FILE where the kind interfaces are declared (default: run-ledger.ts)
# The two args exist so the mutation test can point the SAME logic at a fixture.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEARCH_DIR="${1:-$ROOT/packages/reasoning/src}"
LEDGER_FILE="${2:-$ROOT/packages/reasoning/src/kernel/ledger/run-ledger.ts}"
LEDGER_BASE="$(basename "$LEDGER_FILE")"

# Known declared-but-unwritten kinds. RATCHET: this list may only SHRINK.
#   handoff — the read/render/compaction-protect path is real (standing-frame.ts
#   filters + renders it; compaction.ts protects it) but no writer mints it yet.
#   The intended cross-strategy context handoff ("carried context never
#   renders", audit 03-F5) awaits its emit in a later feature wave (a default-on
#   prompt change that must be bench-gated, not wired blind here). Tracked, not
#   enshrined — delete this entry the moment a writer lands.
ORPHAN_BASELINE=(
  "handoff"
)

is_baselined() {
  local k="$1"
  for b in "${ORPHAN_BASELINE[@]}"; do [ "$b" = "$k" ] && return 0; done
  return 1
}

# Declared kinds = the literal `kind:` discriminants on the entry interfaces.
KINDS="$(grep -oE 'readonly kind: "[a-z-]+"' "$LEDGER_FILE" \
  | sed -E 's/.*"([a-z-]+)".*/\1/' | sort -u)"

if [ -z "$KINDS" ]; then
  echo "❌ check-orphans: found no declared kinds in $LEDGER_FILE — pattern drift?"
  exit 1
fi

FAIL=0
NEW_ORPHANS=""
STALE_BASELINE=""

for k in $KINDS; do
  # Non-test writer sites: `kind: "<k>"` outside the declaration file + tests.
  writers="$(grep -rn "kind: \"$k\"" "$SEARCH_DIR" --include='*.ts' 2>/dev/null \
    | grep -v "/$LEDGER_BASE:" \
    | grep -Ev '\.(test|spec)\.ts:' \
    | wc -l | tr -d ' ')"

  if [ "$writers" -eq 0 ]; then
    if is_baselined "$k"; then
      continue  # known orphan, tolerated (ratcheted)
    fi
    NEW_ORPHANS="${NEW_ORPHANS} $k"
    FAIL=1
  else
    if is_baselined "$k"; then
      # It was a known orphan but now has a writer — ratchet forward.
      STALE_BASELINE="${STALE_BASELINE} $k"
      FAIL=1
    fi
  fi
done

if [ -n "$NEW_ORPHANS" ]; then
  echo "❌ Declaration-orphan guard: ledger kind(s) declared with NO non-test writer:"
  echo "  ${NEW_ORPHANS# }"
  echo ""
  echo "A ledger kind interface that nothing ever appends is an always-empty"
  echo "projection. Either mint it at a real site (\`kind: \"<kind>\"\`) or delete the"
  echo "interface. If it is genuinely intended-but-unwired, add it to"
  echo "ORPHAN_BASELINE in this script WITH a note — but prefer wiring or deleting."
fi

if [ -n "$STALE_BASELINE" ]; then
  echo "❌ Declaration-orphan guard: baselined kind(s) now HAVE a writer — remove from ORPHAN_BASELINE:"
  echo "  ${STALE_BASELINE# }"
  echo ""
  echo "The baseline may only shrink. You wired one — delete it from ORPHAN_BASELINE."
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "✅ Declaration-orphan guard: every declared ledger kind has a writer (baseline: ${ORPHAN_BASELINE[*]})."
exit 0
