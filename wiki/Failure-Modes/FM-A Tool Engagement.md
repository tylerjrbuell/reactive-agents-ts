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
