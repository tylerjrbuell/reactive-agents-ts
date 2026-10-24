#!/usr/bin/env bash
# Quality program — file-size ratchet gate (GH #259).
#
# The regrowth disease, three times proven: reactive-agent.ts, builder.ts and
# think.ts each REBLOATED (+226 / +267 / +310 LOC in ~4 weeks) after their
# previous trims, because "never re-monolith" lived only in prose. This gate
# ends the disease: every file in the ledger is pinned at a LOC ceiling, and
# the ledger may only shrink. A file that grows past its ceiling FAILS. A file
# that SHRINKS below its ceiling also FAILS until the ceiling is edited down —
# the same deliberate-ledger law as check-orphans.sh, so a completed
# decomposition always shows up as a visible, reviewable baseline edit.
#
# A new file at/above 1000 LOC under a package's src/ that is not in the ledger
# FAILS (new giants are forbidden at birth). Test files are exempt (they grow
# legitimately). The scan is SCAN-EMPTY-guarded: zero scanned files is a
# failure, never a vacuous green.
#
# Pinned extra: dispatch-think-response.ts (800 LOC, largest file in the think
# pipeline, next split candidate per the 2026-10-22 audit) sits BELOW the 1000
# bar deliberately — its ceiling exists to hold it there.
#
# Type-declaration entries (builder/types.ts, llm-provider/types.ts,
# runtime-types.ts, runtime/types.ts): ceiling-only; decomposition not required.
#
# Usage: bash scripts/check-file-size.sh [SCAN_DIR]
#   SCAN_DIR  tree root holding package dirs (default: <repo>/packages).
#             The mutation test points it at a /tmp fixture tree.
#
# Rides the auto-globbed CI lane (ci.yml runs every scripts/check-*.sh;
# packages/reasoning/tests/enforcement-scripts.test.ts discovers it, and
# packages/reasoning/tests/enforcement-scripts-file-size.test.ts pins it
# red-on-cut). Baseline captured 2026-10-22 (wc -l, *.ts under */src, non-test).

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_DIR="${1:-$ROOT/packages}"
GIANT_BAR=1000

# path-relative-to-SCAN_DIR : ceiling. RATCHET: values may only SHRINK, and
# entries may only be removed by deliberate edit. Keep NO '#' characters inside
# the array literal — the mutation test patches this block by regex.
#
# Ledger edit history:
#   2026-10-22 capture at 23 sites + dispatch-think-response (initial).
#   2026-10-23 (d) arbitrator.ts 1970->850: SHRINK by program Task 7 (kernel-
#            warden, GH #220, PR #275): 10 verbatim decide/* modules +
#            re-export shim (all 31 export names resolve unchanged); every
#            script-anchored region (sole termination authority, grounding-
#            redirect budget, applyPostConditionGate, exit-success literal)
#            stayed inline per the anchor audit - single-termination-owner
#            invariant untouched.
#   2026-10-22 (c) reactive-agent.ts 2340->2344: +6 structural cost of the D1
#            bridge family pattern (shared runFacadeEffect module + delegate
#            boundary docs, GH PR #274). Deliberate attributed raise; families
#            2-4 reuse the shared helper so the per-family shell cost is one
#            import line, not another 25-line bridge copy.
#   2026-10-22 (b) execution-engine.ts 1976->991: SHRINK by program Task 4
#            decomposition (runtime-warden, 11 verbatim engine/execute-* modules).

#   2026-10-22 reactive-agent.ts 2338->2340 (+2, #262 run_effects wiring
#            07a3649db) and act.ts 1235->1267 (+32, #262 durable effect
#            recording 08458a4f3): feature additions landed the same week the
#            gate shipped; attributed deliberate raises, not regressions.
#   2026-10-23 (e) runner.ts 1903->953 AND iterate-pass.ts 1896->1266: SHRINK
#            by program Task 9 (kernel-warden, GH #222): 14 verbatim kernel/loop/*
#            seam modules; main-loop spine, control-plane/termination seams,
#            counter write-backs, policy-compile and the run-assessment-pinned
#            blocks stayed inline per the anchor audit; every export name still
#            resolves from its original file (re-export shims). Adapter lines
#            (10x loop-control break/continue -> returned flags) documented in
#            the upward report.
SIZE_BASELINE=(
  "runtime/src/reactive-agent.ts:2449"
  "runtime/src/chat/engine.ts:701"
  "runtime/src/builder.ts:2222"
  "runtime/src/execution-engine.ts:994"
  "reasoning/src/kernel/capabilities/decide/arbitrator.ts:850"
  "reasoning/src/kernel/loop/runner.ts:953"
  "reasoning/src/kernel/loop/iterate-pass.ts:1266"
  "reasoning/src/strategies/plan-execute.ts:1714"
  "benchmarks/src/runner.ts:1599"
  "core/src/services/event-bus.ts:1576"
  "runtime/src/runtime.ts:1540"
  "benchmarks/src/tasks/real-world.ts:1531"
  "reasoning/src/kernel/state/kernel-state.ts:1468"
  "llm-provider/src/providers/local.ts:1410"
  "runtime/src/builder/types.ts:1339"
  "llm-provider/src/types.ts:1239"
  "reasoning/src/kernel/capabilities/act/act.ts:1267"
  "reasoning/src/strategies/reflexion.ts:1206"
  "tools/src/mcp/mcp-client.ts:1125"
  "reasoning/src/strategies/tree-of-thought.ts:1110"
  "runtime/src/runtime-types.ts:1080"
  "tools/src/skills/shell-execution.ts:1053"
  "runtime/src/types.ts:1048"
  "observability/src/exporters/console-exporter.ts:1046"
  "reasoning/src/kernel/capabilities/reason/dispatch-think-response.ts:800"
)

# SCAN-EMPTY guard: the tree must contain what we claim to scan.
SCANNED="$(find "$SCAN_DIR" -path '*/src/*' -name '*.ts' ! -name '*.test.ts' \
  ! -name '*.spec.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' \
  -not -path '*/__tests__/*' 2>/dev/null)"
if [ -z "$SCANNED" ]; then
  echo "❌ check-file-size: SCAN-EMPTY — no *.ts files under $SCAN_DIR — a guard that cannot fail is theater."
  exit 1
fi

FAIL=0

for entry in "${SIZE_BASELINE[@]}"; do
  file="${entry%:*}"
  cap="${entry##*:}"
  path="$SCAN_DIR/$file"
  if [ ! -f "$path" ]; then
    echo "❌ check-file-size: $file MISSING — baselined file no longer exists. A rename/delete is a deliberate ledger edit: update SIZE_BASELINE."
    FAIL=1
    continue
  fi
  loc=$(wc -l < "$path" | tr -d ' ')
  if [ "$loc" -gt "$cap" ]; then
    echo "❌ check-file-size: $file GREW to $loc LOC (ceiling $cap). Decompose into submodules instead — that is what agent/*, builder/* and reason/* are for."
    FAIL=1
  elif [ "$loc" -lt "$cap" ]; then
    echo "❌ check-file-size: $file shrank to $loc LOC but the ceiling is still $cap. Update the baseline to $loc (the ledger may only shrink by deliberate edit)."
    FAIL=1
  fi
done

# New-giant scan: anything >= GIANT_BAR under a src/ that the ledger does not pin.
while IFS= read -r tsfile; do
  [ -z "$tsfile" ] && continue
  rel="${tsfile#"$SCAN_DIR"/}"
  loc=$(wc -l < "$tsfile" | tr -d ' ')
  [ "$loc" -lt "$GIANT_BAR" ] && continue
  pinned=0
  for entry in "${SIZE_BASELINE[@]}"; do
    [ "${entry%:*}" = "$rel" ] && { pinned=1; break; }
  done
  if [ "$pinned" -eq 0 ]; then
    echo "❌ check-file-size: NEW GIANT $rel ($loc LOC) is not baselined. Split it into submodules, or (exception review) add a ceiling line — since v0.14 giants are born decomposed."
    FAIL=1
  fi
done <<< "$SCANNED"

if [ "$FAIL" -eq 0 ]; then
  echo "✅ check-file-size: ${#SIZE_BASELINE[@]} baselined files at ceiling; no new giants (>=${GIANT_BAR} LOC) outside the ledger."
fi
exit "$FAIL"
