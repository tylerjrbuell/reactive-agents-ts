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
# Pinned extra: dispatch-think-response.ts (769 LOC — 800 → 769 on 2026-11-03,
# resolver call moved to the assistant-turn boundary; largest file in the think
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
#   2026-11-04 ratchet shrink (runtime-warden, GH #267):
#     - runtime/src/runtime.ts 1549->1194 (-355; buildToolsLayer, fallback LLM
#       cascade, memory layer, logger tap, gateway layer moved verbatim to
#       runtime-tools-layer / runtime-llm-fallback / runtime-memory-layer /
#       runtime-logger-tap-layer / runtime-gateway-layer .ts)
#   2026-10-29 (conversation-level to-do carry) ratchet shrink:
#     - runtime/src/chat/engine.ts 711->701 (nextSessionId moved verbatim to
#       chat/session-id.ts, -22; to-do carry +12)
#   2026-10-28 (todo guidance, ablation ruling V5) attributed raises, opt-in
#   checklistGuidance threaded builder -> kernel; follow-up: carry it on
#   RunEnvelope to drop the per-strategy sites:
#     - reasoning/src/strategies/plan-execute.ts 986->987 (+1)
#     - runtime/src/runtime.ts 1557->1558 (+1)
#     - reasoning/src/strategies/reflexion.ts 1206->1209 (+3)
#     - reasoning/src/strategies/tree-of-thought.ts 1110->1113 (+3)
#     - runtime/src/runtime-types.ts 1080->1083 (+3)
#     - runtime/src/types.ts 1048->1051 (+3)
#   2026-10-24 (introspective-loop Sprint A) attributed raises:
#     - runtime/src/builder.ts 2222->2224 (+2, maxIterationsExplicit plumbing, I2)
#     - runtime/src/runtime.ts 1540->1559 (+19, explicit-cap resolution seam, I2)
#     - tools/src/skills/shell-execution.ts 1053->1081 (+28, denial-as-failure
#       arms + actionable hint text, I7/I9)
#     Feature additions to the explicit-cap + denial-as-failure contract; the
#     next decomposition pass should fold the new runtime.ts helper into a
#     submodule and split shell-execution.ts denial arms into a helper.
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
#   2026-11-03 execution-engine.ts 984->983: kernelIteration delegate wiring (-1 net,
#            collapsed one spread; logic lives in engine/finalize/result-verification.ts).
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
#   2026-10-28 runner.ts 953->951: SHRINK by plan-and-goal-primitives Task 4
#            (kernel-warden): global _todo reset deleted; legacy-todo migrate
#            call + restored-ledger publish added.
#   2026-11-03 iterate-pass.ts 1315->1297: SHRINK by Plan 8 item 3 exit gate
#            (kernel-warden): low-delta / switching-exhausted / oracle-forced
#            terminate() blocks became one-line proposals to kernel/loop/exit-gate.ts.
#            runner.ts stays 944 (cap-proposal delegate line offset by a comment trim).
# 2026-11-04 runner.ts 944->927: D9 writing-tools resolution extracted to
#            kernel/contract/strategy-contract.ts.
# 2026-11-05 benchmarks/src/runner.ts 1599->984: SHRINK by GH #268 decomposition;
#            single-cell execution moved verbatim to run-internal.ts, result
#            aggregation to aggregate.ts, ALL_TASKS to all-tasks.ts (re-exported).
# 2026-11-05 runner.ts 927->859: SHRINK by Plan 9 Phase 2 one terminal path; the
#            post-loop fences + §7.9-§9 steps moved to kernel/loop/terminal-pipeline.ts.
#            reflexion.ts 989->988: unused decideSynthesisInput import dropped.
# 2026-11-04 plan-execute.ts 987->966: D9 grounded-terminal gate moved to
#            kernel/loop/strategy-exit-gate.ts; status cap folded into the shared rule.
# 2026-11-04 reflexion.ts 1209->1198: D9 delivery spine uses the shared judge.
# 2026-11-04 plan-execute.ts 966->951: D9 P7 plan checklist in plan-execute/plan-checklist.ts;
#            stale extracted-helper pointer comments condensed.
# 2026-11-04 tree-of-thought.ts 1113->906: strategy run substrate S1; spend,
#            pause and kernel-terminal relay moved to strategies/substrate/strategy-run.ts.
# 2026-11-04 reflexion.ts 1198->989: substrate S1b; pause, spend, ledger, envelope
#            cap and the claim rule moved to the substrate. Kept pinned below the bar.
# 2026-11-05 execution-engine.ts 983->973: ToolDefinition -> kernel ToolSchema projection
#            extracted to toKernelToolSchema (setup/tool-schemas.ts), now carries riskLevel.
# 2026-11-05 plan-execute.ts 950->875: substrate S2; ledger, pause, spend, envelope
#            join and the terminal cap/claim/relay moved to strategies/substrate/strategy-run.ts.
# 2026-11-05 plan-execute.ts 875->836: S4b reflect phase (with its deterministic
#            skip) extracted to plan-execute/reflect.ts.
# 2026-11-05 plan-execute.ts 836->833: plan-repair calls merged under one comment.
# 2026-11-05 reactive-agent.ts 2077->2073: runDurable binds its run state through
#            the run entry's runState (Plan 9 1R stage 2), not five Effect.locally.
# 2026-11-05 plan-execute.ts 833->832: StrategyEnd carries delivery directly.
# 2026-11-05 dispatch-think-response.ts 769->698: Plan 9 2b; model answers are exit
#            proposals via decide/model-exit-proposal.ts, auto-promote preconditions cut.
# 2026-11-05 execution-engine.ts 973->969: auto per-tool call budget
#            (buildAutoMaxCallsPerTool, minCalls+2) deleted with its wiring.
# 2026-11-05 dispatch-think-response.ts 698->681: tool-gate calls + refusal recording
#            moved to decide/tool-call-refusals.ts (refused calls are now visible).
# 2026-11-05 act.ts 1193->1174: Plan 9 2b follow-up; the final-answer tool is a model
#            exit proposal via decide/model-exit-proposal.ts (direct Arbitrator call cut).
# 2026-11-06 simplicity audit 2: arbitrator.ts 850->831 (intent->terminatedBy mapping
#            moved to decide/intent-terminated-by.ts, shared with the exit gate);
#            act.ts 1174->1136 (blockedCallSteps + one missing-required closure);
#            dispatch-think-response.ts 681->653 (guard takes the turn's gated result);
#            kernel-state.ts 1473->1474 (+1: NO_TOOL_EVIDENCE imported from its owner,
#            the tool-evidence-state.ts re-export deleted; ratified in the mission brief).
# 2026-11-06 withTools maxCallsPerTool: runtime.ts 1194->1151 (twin contextProfile blocks moved verbatim to context-profile-engine-field.ts; +2 for the new field).
# 2026-11-06 sub-agent maxCallsPerTool: builder.ts 2224->2209 (withAgentTool inline agent type replaced by AgentToolOptions['agent']).
# 2026-11-06 withTools workspace: reactive-agent.ts 2073->2069, execution-engine.ts 969->960 (executeStream's inline options types replaced by ExecuteStreamFn from engine/execute-stream.ts).
# 2026-11-06 shell-execution.ts 1081->1029: host spawn + env moved verbatim to skills/shell-host-process.ts (workspace cwd gets a scratch HOME).
# 2026-11-05 iterate-pass.ts 1297->1057: Plan 9 Phase 4 stage 1; the pass is the KERNEL_TURN_OPERATIONS list, unanchored groups moved verbatim to kernel/loop/turn-operations.ts.
# 2026-11-05 iterate-pass.ts 1057->263: Plan 9 Phase 4 stage 2; the nine script-anchored operations moved to kernel/loop/turn-guard-operations.ts (gate scripts follow); every run end proposes to the exit gate.
# 2026-11-06 chat/durable workspace + run evidence: reactive-agent.ts 2069->2049 (chat engines' runTask/runStreamTask closures replaced by chat-capabilities adapters), chat/engine.ts 679->677, builder/types.ts 1344->1341 (status JSDoc condensed).
SIZE_BASELINE=(
  "runtime/src/reactive-agent.ts:2049"
  "runtime/src/chat/engine.ts:677"
  "runtime/src/builder.ts:2209"
  "runtime/src/execution-engine.ts:960"
  "reasoning/src/kernel/capabilities/decide/arbitrator.ts:831"
  "reasoning/src/kernel/loop/runner.ts:859"
  "reasoning/src/kernel/loop/iterate-pass.ts:263"
  "reasoning/src/strategies/plan-execute.ts:832"
  "benchmarks/src/runner.ts:984"
  "core/src/services/event-bus.ts:190"
  "runtime/src/runtime.ts:1151"
  "benchmarks/src/tasks/real-world.ts:1531"
  "reasoning/src/kernel/state/kernel-state.ts:1474"
  "llm-provider/src/providers/local.ts:1410"
  "runtime/src/builder/types.ts:1341"
  "llm-provider/src/types.ts:1239"
  "reasoning/src/kernel/capabilities/act/act.ts:1136"
  "reasoning/src/strategies/reflexion.ts:988"
  "tools/src/mcp/mcp-client.ts:1125"
  "reasoning/src/strategies/tree-of-thought.ts:906"
  "runtime/src/runtime-types.ts:1083"
  "tools/src/skills/shell-execution.ts:1029"
  "runtime/src/types.ts:1051"
  "observability/src/exporters/console-exporter.ts:1042"
  "reasoning/src/kernel/capabilities/reason/dispatch-think-response.ts:653"
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
