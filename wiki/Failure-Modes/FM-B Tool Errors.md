---
aliases: [FM-B1, FM-B2, Tool Error Handling]
tags: [failure-mode, tool-calling, empirical]
category: FM-B
---

# FM-B: Tool Error Handling

**Category:** Tool Error Handling & Recovery

**Status:** ✅ Phase 1 Complete (error triage validated)

**Evidence Base:** 40+ runs with intentional error injection across 4 models

---

## FM-B1: Unrecoverable Errors

**Manifestation:** Tool error indicates permanent failure (missing required arg, unknown tool) but agent continues trying same call.

### Symptom

- Tool returns error: "Unknown tool: 'invalid-read'" or "Missing required parameter: path"
- Agent attempts same call again without variation
- Repeated errors exhaust token budget
- Task incompleteness despite clear error signal

### Reproduction

**Setup:**
```typescript
// Agent tries to use unknown tool
const task = "Read a configuration file and summarize it";
const availableTools = ["fileWrite", "bash"]; // 'fileRead' missing
// Agent generates: { toolName: "fileRead", parameters: { path: "config.json" } }
```

**Expected:** Agent detects tool is unavailable, adapts strategy

**Actual:** Agent retries same call, gets same error, repeats N times

**Frequency:** ~8% of runs on local models (qwen3:14b, cogito:14b)

### Root Cause

- **Error classification gap:** Agent doesn't recognize "unrecoverable" vs "recoverable"
- **Missing adaptation:** No logic to switch tools or request available tools list
- **Retry loop:** Agent retries indefinitely until budget exhausted

### Evidence

- **Reproducer tests:** 8 tests in `packages/tools/tests/fm-b1-unrecoverable-errors.test.ts`
- **Spike data:** FM-B1 manifested in 3/40 runs with intentional error injection
- **Post-M11 Diagnostic:** 100% unrecoverable errors correctly classified (no false negatives)
- **Confidence:** HIGH (clear error messages, reproducible, well-mitigated)

---

## FM-B2: Cascade Failures

**Manifestation:** Tool error triggers downstream errors in multi-tool workflows (error in step N breaks steps N+1...).

### Symptom

- Tool 1 returns error: "Database connection failed"
- Agent invokes Tool 2 assuming Tool 1 succeeded
- Tool 2 fails: "Cannot process null input from Tool 1"
- Error propagates through multi-step chain
- Final output corrupted or incomprehensible

### Reproduction

**Setup:**
```typescript
// Multi-step workflow: read → parse → summarize
const task = "Summarize the current deployment status";
const workflow = [
  { tool: "bash", cmd: "curl deployment.api" }, // Fails: no network
  { tool: "parse", input: "{{ prev }}" },        // Fails: null input
  { tool: "summarize", input: "{{ prev }}" }     // Fails: null input
];
```

**Expected:** Agent detects Tool 1 failure, halts workflow, adapts

**Actual:** Cascade of failures as each tool assumes previous succeeded

**Frequency:** ~5% of runs in multi-tool scenarios

### Root Cause

- **Implicit assumptions:** Agent assumes tool succeeded unless told otherwise
- **Missing error propagation:** Errors don't bubble up explicitly
- **No rollback:** Agent doesn't undo partial changes

### Evidence

- **Reproducer tests:** 6 tests in `packages/tools/tests/fm-b2-cascade-failures.test.ts`
- **Spike data:** FM-B2 manifested in 2/40 multi-step runs
- **Post-M4/M11:** Cascade failures reduced 80% via error triage + early detection
- **Confidence:** HIGH (clear error chains, reproducible, preventable)

---

## Mitigations

### ✅ M4: Healing Pipeline

**How it helps:** Recovers from recoverable errors (param typos, path issues)

**Coverage:** FM-B1 (tool name healing), FM-B2 (early detection prevents cascade)

**Effectiveness:** 86.7% recovery rate on recoverable errors

**Verdict:** ✅ KEEP (massive accuracy lift)

---

### ✅ M11: Diagnostic System

**How it helps:** Real-time error classification (unrecoverable vs recoverable vs transient)

**Coverage:** FM-B1 (classify unrecoverable), FM-B2 (detect cascade early)

**Effectiveness:** 100% accuracy on error classification, 0% false positives

**Verdict:** ✅ KEEP (enables automation)

---

### ✅ M13: Guards & Meta-tools

**How it helps:** Pre-execution validation prevents unknown tools, guards availability

**Coverage:** FM-B1 (prevent unknown tool invocation), FM-B2 (validate tool prerequisites)

**Effectiveness:** 100% accuracy, 0.001ms latency

**Verdict:** ✅ KEEP (zero false positives)

---

## Integration Testing (Phase 2)

**Composition to test:** M4 + M11 + M13

- Scenario 1: Unknown tool detected by M13 guard → rejected before execution
- Scenario 2: Tool error → M11 classifies → M4 attempts recovery
- Scenario 3: Unrecoverable error → M11 detects → agent adapts (via M1 RI)
- Scenario 4: Multi-step workflow → error in step N → M11 halts workflow before cascade

---

## References

- [[Failure-Modes/00 FM Catalog|FM Catalog]] — All failure modes
- [[Experiments/M4 Healing Pipeline|M4 Healing Pipeline]] — Error recovery
- [[Experiments/M11 Diagnostic System|M11 Diagnostic System]] — Error classification
- [[Experiments/M13 Guards and Meta-tools|M13 Guards]] — Prevention

---

**Last Updated:** 2026-05-04  
**Phase:** Phase 1 Complete  
**Confidence:** HIGH (40+ runs, clear causation, validated mitigations)
