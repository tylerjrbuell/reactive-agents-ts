#!/usr/bin/env bash
# Meta-loop Phase 4b (Wave C) — RunLedger single-writer invariant guard.
#
# The RunLedger (kernel/ledger/run-ledger.ts) is the append-only event store the
# meta-loop projects from (Assessment / Projector / Control). Its integrity
# depends on ONE thing: entries are only ever added through the ledger's own
# append API (appendEntry / appendEntries), and those primitives are called only
# from the ledger's home (kernel/ledger/) plus the small, named dual-emit seam in
# act.ts. If arbitrary code across the kernel could splice entries onto
# state.ledger directly, the seq density + append-only guarantees the codec and
# every projector rely on would rot — exactly the drift the DAG exists to kill.
#
# This script fails CI if appendEntry(/appendEntries( is called anywhere outside
# kernel/ledger/ except the grandfathered act.ts seam (C2 artifact + C3 dedup),
# where act.ts appends entries that were MINTED by kernel/ledger/ helpers
# (deriveArtifactEntries, gather-dedup) — it appends, it never hand-builds entry
# literals. Mirrors check-run-contract.sh / check-termination-paths.sh.
#
# NOTE (scope): Wave C ships dual-emit — steps[] stays authoritative and the
# ledger is grown FROM it at the transitionState chokepoint. The stronger
# invariant "steps/scratchpad/plan are mutated ONLY via ledger projection"
# lands at C-final (when steps becomes a projection of the ledger); this script
# will tighten to that then. For now it enforces the append-API single-writer
# rule, which is what holds today.
#
# Usage: bash scripts/check-ledger-writes.sh
# Exit: 0 if the invariant holds; 1 with the offending lines if violated.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEARCH_DIR="$ROOT/packages/reasoning/src"

# The ledger's home — the sanctioned owner of the append primitives and of every
# entry-minting helper (run-ledger, step-projection, artifact-projection, emit,
# gather-dedup all live here).
ALLOWED_FILES=(
  "kernel/ledger/"
)

# Grandfathered dual-emit seam: act.ts appends helper-DERIVED entries (artifact
# entries from deriveArtifactEntries, gather-dedup signals) onto the patch.ledger
# it hands to transitionState. It calls the append API but never mints an entry
# literal itself. DO NOT ADD to this list — new ledger writers belong behind a
# kernel/ledger/ emitter (recordX) that returns a RunLedger the caller threads
# via patch.ledger.
GRANDFATHERED=(
  "kernel/capabilities/act/act.ts"  # C2 artifact + C3 gather-dedup dual-emit seam
)

EXCLUDE=""
for f in "${ALLOWED_FILES[@]}" "${GRANDFATHERED[@]}"; do
  EXCLUDE+="${EXCLUDE:+|}$f"
done

# Any appendEntry(/appendEntries( CALL outside the sanctioned/grandfathered set.
#  - drop the ledger home + grandfathered seam
#  - drop *.test.ts / *.spec.ts (they exercise the API, never own production writes)
#  - drop comment lines
HITS="$(grep -rn -E 'appendEntr(y|ies)\(' \
  --include='*.ts' "$SEARCH_DIR" 2>/dev/null \
  | grep -E -v "$EXCLUDE" \
  | grep -E -v '\.(test|spec)\.ts:' \
  | awk -F: '{ code=$0; sub(/^[^:]*:[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code);
              if (code !~ /^(\/\/|\*|\/\*)/) print $0 }' \
  || true)"

if [ -n "$HITS" ]; then
  echo "❌ RunLedger invariant violated. appendEntry/appendEntries called outside kernel/ledger/:"
  echo ""
  echo "$HITS"
  echo ""
  echo "Add ledger entries through a kernel/ledger/ emitter (recordX / deriveX) that"
  echo "returns a RunLedger, then thread it via patch.ledger — do not call the append"
  echo "primitives from outside the ledger home. If this is a sanctioned dual-emit"
  echo "seam, add it to GRANDFATHERED in this script WITH a note (the list should"
  echo "shrink toward zero as C-final makes steps a ledger projection)."
  exit 1
fi

echo "✅ RunLedger invariant holds — append API confined to kernel/ledger/ + the act.ts dual-emit seam."
exit 0
