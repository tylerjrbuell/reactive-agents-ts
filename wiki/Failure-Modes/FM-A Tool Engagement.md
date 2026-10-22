---
aliases: [FM-A1, FM-A2, Tool Engagement]
tags: [failure-mode, tool-calling, empirical]
category: FM-A
---

# FM-A: Tool Engagement Failures

**Category:** Tool Engagement & Invocation

**Status:** ✅ Phase 1 Complete (8 reproducer tests)

**Evidence Base:** 50+ runs across 4 models (cogito:14b, qwen3:14b, claude-sonnet-4-6, gpt-4o)

---

## FM-A1: No-Tool Fabrication

**Manifestation:** Agent writes answer directly without using required tools, often confident in hallucinated details.

### Symptom

- Agent produces output that should come from tool invocation (e.g., file read, database query)
- No tool call in LLM response despite `tools` parameter provided
- Output is fabricated or generic placeholder
- Violates task requirement that tool must be used

### Reproduction

**Setup:**
```typescript
// Example: require FileRead tool
const task = "Read the file at ./data.json and summarize its contents";
const requiredTools = ["fileRead"];
```

**Expected:** Agent calls fileRead tool

**Actual:** Agent writes summary directly without calling tool

**Frequency:** ~15% of runs on cogito:14b (qwen3:14b, frontier: <2%)

### Root Cause

- **cogito:14b:** Instruction-following gaps; doesn't recognize required tool constraint
- **Solution seeking:** Agent "solves" by hallucinating instead of using tools
- **Token pressure:** When context is tight, agent may skip tool calls

### Evidence

- **Reproducer tests:** 12 tests in `packages/tools/tests/fm-a1-no-tool-fabrication.test.ts`
- **Spike data:** FM-A1 manifested in 8/50 runs on cogito:14b
- **Confidence:** HIGH (clear causation, reproducible)

---

## FM-A2: Persistent FC Failure

**Manifestation:** Agent makes repeated non-recoverable tool call errors and doesn't adapt.

### Symptom

- Agent invokes tool with malformed parameters (wrong type, missing required arg)
- Tool returns error
- Agent retries with same error (no recovery attempt)
- Loop continues for N iterations before giving up
- Result: Task incompleteness despite correct tool existing

### Reproduction

**Setup:**
```typescript
// Example: agent tries to use read() with missing path
const task = "Summarize the contents of report.md";
// Agent generates: { toolName: "read", parameters: {} } // missing 'path'
```

**Expected:** Agent fixes the error and retries

**Actual:** Agent repeats same error, then gives up

**Frequency:** ~12% of runs on local models

### Root Cause

- **Parsing gap:** Agent generates tool calls but doesn't understand error feedback
- **Healing unavailable:** No error recovery mechanism in early versions
- **Retry heuristic:** Agent doesn't know how to adapt after error

### Evidence

- **Reproducer tests:** 8 tests in `packages/tools/tests/fm-a2-persistent-fc-failure.test.ts`
- **Spike data:** FM-A2 manifested in 6/50 runs before M4 healing pipeline
- **Post-M4:** 86.7% recovery rate, 0% repeat failures (healing pipeline validates)
- **Confidence:** HIGH (mechanism validated, 0 post-mitigation failures)

---

## Mitigations

### ✅ M13 Guards & Meta-tools

**How it helps:** Enforces required tools via pre-execution gating

**Mechanism:**
```typescript
// Guards check: does this task have requiredTools?
if (requiredTools.length > 0) {
  if (!hasToolCallsFor(thought, requiredTools)) {
    // GUARD FAILS — return to agent with error message
    return { action: 'reject', reason: 'Missing required tool invocation' };
  }
}
```

**Effectiveness:** 100% accuracy, 0.001ms latency

**Verdict:** ✅ KEEP — guards prevent no-tool fabrication at compile time

**Status:** Shipped in v0.10.0

---

### ✅ M4 Healing Pipeline

**How it helps:** Recovers from tool call errors (FM-A2 specifically)

**Mechanism:**
1. **Stage 1:** Tool name healing (case sensitivity, aliases)
2. **Stage 2:** Parameter healing (type coercion, missing defaults)
3. **Stage 3:** Path resolution (for file-based tools)
4. **Stage 4:** Type healing (schema normalization)

**Effectiveness:**
- Recovery rate: 86.7% on full suite
- Recovery rate: 100% on recoverable errors (param mismatches, type coercion)
- False positives: 0% (unrecoverable errors correctly identified)

**Verdict:** ✅ KEEP — healing pipeline addresses FM-A2 root cause

**Status:** Shipped in v0.10.0

---

### 🔄 Phase 1.5: M3 Retry Context Tuning

**Gap:** cogito:14b still exhibits FM-A1 at ~15% even with guards

**Action:** Tune retry prompts and temperature for local model instruction-following

**Expected improvement:** <5% FM-A1 frequency on cogito:14b

---

## Integration Testing (Phase 2)

**Composition to test:** M4 + M13

- Scenario 1: No-tool fabrication detected by M13 guard → triggers M4 healing
- Scenario 2: Tool call error → M4 healing recovers → M13 validates result
- Scenario 3: Unrecoverable error (unknown tool) → both mechanisms defer to agent

---

## References

- [[Failure-Modes/00 FM Catalog|FM Catalog]] — All failure modes
- [[Experiments/M4 Healing Pipeline|M4 Healing Pipeline]] — Full validation details
- [[Experiments/M13 Guards and Meta-tools|M13 Guards & Meta-tools]] — Full validation details
- [[MOCs/Research MOC|Research MOC]] — Phase 1 results

---

**Last Updated:** May 4, 2026  
**Phase:** Phase 1 Complete  
**Confidence:** HIGH (50+ runs, clear causation, validated mitigations)

---

## FM-A3: Crash-Window Tool Re-Execution (Silent At-Least-Once)

## Symptom

A durable run (`.withDurableRuns()`) executes a side-effecting tool. The effect
succeeds in the world. The process is killed before the effect becomes durable
in the RunStore. A fresh process `resumeRun()`s: the act phase re-executes the
tool and the duplicate is unrecorded and uninspectable, because the receipt
aggregates (`toolsUsed`, `toolCallStats`) and the re-executed call looks like an
ordinary first execution. Also cost-bearing even for idempotent tools: the
resumed run re-pays LLM re-derivation with no recovery on record.

## Reproduction

`packages/runtime/tests/durable-tool-effect-crash.test.ts` (both tests):

1. A side-effecting tool records its dispatch count to disk; trigger faults in
   the RunStore commit the pre-effect and terminal write out of band.
2. Kill the child mid-run (SIGKILL) after the tool succeeded but before the
   next boundary checkpoint and effect row committed.
3. Fresh process, `resumeRun()`. Pre-fix: dispatch count 2 (silent duplicate)
   and zero `run_effects` rows.

## Root Cause (GH #262)

- The durable rail is boundary-only and fire-and-forget:
  `iterate-pass.ts` fires `onCheckpoint` at the start of each loop pass
  capturing pre-phase state; `run-controller.ts` writes persisted via
  fire-and-forget `Effect.runPromise`, awaited only via `flush()` at terminal
  events. A hard kill between "tool succeeded" (act, pass N) and the pass N+1
  boundary write committing loses the effect.
- The RunStore schema had no per-call record (`runs`, `run_checkpoints`,
  `run_approvals`, `run_events`, `run_interactions`), so nothing keyed
  `toolCallId` to a durable outcome.
- On resume, the kernel continues from the last committed checkpoint and
  re-derives calls (provider call ids get re-minted), so any toolCallId-based
  recovery keyed on ledger contents alone cannot survive the window.

## Fix (v0.18, this entry)

- Awaited pre-dispatch (`executing`) + awaited terminal (`succeeded`/`failed`)
  effect record per tool call in a new `run_effects` RunStore table, written
  through the core observer seam (`RunControllerLike.onToolEffectStart` /
  `onToolEffectEnd`), keyed by tool name + canonical key-sorted args
  (`toolEffectIdentityKey`), framework-minted `fx-<taskId>-<iteration>-<index>`
  ids rather than provider call ids.
- Resume reconciliation: a recorded-succeeded effect injects its stored result
  WITHOUT re-execution; a terminal-less `executing` row replays AND is named
  `ambiguous-then-replayed` on the receipt (`receipt.effects[]`).
- Residual honesty: a crash INSIDE a single tool call (effect happened, process
  died pre-record) is irreducible without tool cooperation; the stable call
  identity exists so tools can key idempotency on it. The ambiguous case is
  surfaced, never hidden.

## Evidence

- `packages/reasoning/src/kernel/capabilities/act/tool-observe.ts` (recovery
  consult + awaited observers), `packages/reasoning/tests/kernel/act/tool-effect-durability.test.ts`
- `packages/runtime/src/services/run-store.ts` (`run_effects` DDL +
  `putToolEffect`/`updateToolEffectOutcome`/`listToolEffects`),
  `packages/runtime/src/agent/durable-facade.ts` (`reconcileToolEffects`),
  `packages/runtime/tests/durable-tool-effect-crash.test.ts`
- GitHub issue #262 (raised externally by Raju Dandigam on the v0.16 launch
  post).
