# Harness Improvement Report — Pass 1

---

## Session Header

| Field | Value |
|-------|-------|
| Pass number | 1 |
| Date | 2026-04-11 |
| Focus area | Full sweep — establishing baseline |
| Probes run | trivial-1step, multistep-research, tool-heavy, context-pressure, termination-quality |
| Changes since last pass | First pass |
| Agent model used | claude-sonnet-4-6 (analysis); cogito:8b via Ollama (probes) |
| Total probe cost | $0.00 (local Ollama) |

---

## Probe Run Summary

| Probe ID | Strategy | Iterations Used / Max | Wasted Iters | Duplicate Tool Calls | Context Peak | Quality Score | Duration | Cost | Pass? |
|----------|----------|----------------------|---------------|---------------------|--------------|----------------|----------|------|-------|
| trivial-1step | reactive | 1 / 5 | 0 | 0 | ? | ? | 4.8s | $0 | ✅ |
| multistep-research | plan-execute-reflect | 5 / 15 | 0 | 0 | ? | ? | 8.8s | $0 | ✅ |
| tool-heavy | adaptive | 21 / 12 | ? | 0 | ? | ? | 7.1s | $0 | ❌ |
| context-pressure | plan-execute-reflect | 6 / 20 | 0 | 0 | ? | ? | 31.6s | $0 | ✅ |
| termination-quality | adaptive | 41 / 10 | ? | 0 | ? | ? | 29.1s | $0 | ❌ |

Context Peak and Quality Score are `?` across all probes — the JSONL metric extraction is broken (see W3). Wasted iterations for tool-heavy and termination-quality are `?` for the same reason.

**Pass/Fail notes:**
- `trivial-1step` ✅ — 1 iteration, no tools called, correct answer (180)
- `multistep-research` ✅ — 5 iterations, plan-execute-reflect completed within budget
- `tool-heavy` ❌ — ran 21 iterations against maxIterations=12; final output is a raw text tool call string, not a real answer; zero actual tool executions
- `context-pressure` ✅ — 6 iterations, correct answer, within budget
- `termination-quality` ❌ — ran 41 iterations against maxIterations=10; entropy flat (0.598) from iter 3 through end; 1 tool call total across 41 iterations

---

## Baseline Metrics (first pass only — carry forward unchanged)

| Metric | Measured Value | How Measured |
|--------|---------------|-------------|
| Avg iterations — trivial task | 1 | trivial-1step probe |
| Avg iterations — research task | 5 | multistep-research probe |
| Avg iterations — adaptive task (tool-heavy) | 21 (expected ≤ 5) | tool-heavy probe, execution.iteration metric |
| Avg iterations — adaptive task (termination-quality) | 41 (expected ≤ 10) | termination-quality probe, execution.iteration metric |
| Quality score at termination | ? (null in all probes) | JSONL — not extractable with current format |
| Context peak ratio | ? (null in all probes) | JSONL — not extractable with current format |
| Native FC success rate — cogito:8b/Ollama | 0 out of 21 think steps (tool-heavy) | model-io debug log: only text-format calls observed |
| Loop detector fire rate | 0 out of 21+ consecutive text-format iterations | loop-detector.ts — ICS observations masked streak |

---

## Observed Weaknesses

---

### [W1] cogito:8b on Ollama generates text-format tool calls instead of native function calls

**Severity:** `high`

**Probe(s) where observed:** tool-heavy, termination-quality

**Observed behavior:**
```
17:15:18.705 DEBUG   ┄ [model-io:reactive:main]
  ── raw response ──
  Let me search for the latest TypeScript release notes:

  ```
  web-search(query="TypeScript latest release notes", maxResults=5)
  ```

17:15:18.709 INFO  ◉ [think] 21 steps | 18,490 tok | 0.0s
17:15:18.726 INFO  Execution completed {"success":true,"tokensUsed":18490}

--- RESULT ---
Output preview:
web-search(query="TypeScript latest release notes", maxResults=5)
```

Execution timeline for tool-heavy shows NO `act` phase span — only `bootstrap`, `strategy-select`, `think`, `memory-flush`, `complete`. All 21 iterations were pure think steps. The final agent output is the raw text of a tool call, not an answer.

Also on every probe run:
```
[allowedTools] These tools were specified but are NOT registered: checkpoint, final-answer.
Registered tools: web-search, http-get
```

**Expected behavior:**
cogito:8b should emit native function calls that trigger the act phase, call web-search, and return actual search results within 1–2 iterations.

**Measured delta:**
- Actual tool executions: 0 (expected 1–2)
- Wasted think iterations: ~21 (all were text-format tool calls never executed)
- Output quality: incorrect (raw tool call string passed as final answer)

**Root cause hypothesis:**
cogito:8b's function calling on Ollama is unreliable or disabled for this model variant. The model formats tool calls as markdown code blocks instead of native FC JSON. The `think.ts` stream parser (`stream-parser.ts`) parses native FC events from the LLM stream but has no fallback text-format parser. When the model generates a text-format call, no `ToolCallSpec` is produced, the act phase is skipped, and the kernel adds an ICS "still needed" nudge. With no native FC support and `final-answer` not in the tool schema, the loop runs until maxIterations.

Supporting: `packages/reasoning/src/strategies/kernel/utils/stream-parser.ts` — parses `tool_use_start` / `tool_use_delta` events only. Text-format backtick calls are not parsed.

**Impact:** 100% of tool-dependent tasks using Ollama models that don't emit native FC will produce wrong answers. Affects any user with a local Ollama model that uses text-format tool calls.

**Status:** `OPEN`

---

### [W2] ICS observation steps break the consecutive-thoughts loop detector, allowing unlimited think-only loops

**Severity:** `high`

**Probe(s) where observed:** tool-heavy

**Observed behavior:**
```
# Thread grows with one ICS nudge per think iteration:
── thread (8 msg) ──
[USER] Still needed: web-search. Call the next one now.
[USER] Still needed: web-search. Call the next one now.
[USER] Still needed: web-search. Call the next one now.
...
── thread (10 msg) ──
[USER] Still needed: web-search. (2 iterations remaining)
── thread (11 msg) ──
[USER] Still needed: web-search. (1 iterations remaining)

# 21 consecutive think steps, zero act steps
[think] 21 steps | 18,490 tok
# No loop detection message in output
```

**Expected behavior:**
`detectLoop` should fire at `maxConsecutiveThoughts=3` (default) and terminate the kernel with a loop message.

**Measured delta:**
- Expected loop detection: iteration 3
- Actual loop detection: never fired (21 iterations)
- Extra iterations burned: ~18 (3 needed, 21 used)

**Root cause hypothesis:**
In `loop-detector.ts` L91–96, the consecutive-thoughts check iterates backwards and breaks the streak on ANY non-"thought" step:

```typescript
for (let i = steps.length - 1; i >= 0; i--) {
  if (steps[i]!.type === "thought") consecutiveThoughts++;
  else break; // any non-thought resets the streak
}
```

The ICS coordinator (`ics-coordinator.ts`) injects a "Still needed: web-search" step with `type: "observation"` after each think iteration that doesn't call a required tool. This observation step appears in `state.steps`, and `else break` resets the consecutive count to 0. The streak never accumulates beyond 1. `maxConsecutiveThoughts=3` is never reached.

**Source evidence:**
```bash
grep -n "consecutiveThoughts\|else break" packages/reasoning/src/strategies/kernel/utils/loop-detector.ts
# → L91-96: the break resets on any non-thought type

grep -n "makeStep.*observation\|observation.*nudge\|Still needed" packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts
# → ICS injects "observation" steps between think iterations
```

**Impact:** Any task where a required tool is specified but the model can't call it via native FC will run to maxIterations with no loop detection. Compounds W1 — together they produce unlimited spinning loops on Ollama models.

**Status:** `OPEN`

---

### [W3] JSONL observability format does not match Phase 3 jq extraction commands

**Severity:** `medium`

**Probe(s) where observed:** all probes

**Observed behavior:**
```bash
# All jq commands in the skill's Phase 3 return empty:
jq 'select(.event == "ThinkStart")' harness-reports/probe-trivial-1step.jsonl
# → (no output)

# Actual JSONL structure:
jq -r '._type' harness-reports/probe-trivial-1step.jsonl | sort | uniq -c
#    17 NO_TYPE (spans with traceId, status, startTime fields)
#    19 counter
#     9 histogram
#     9 gauge
#     8 log

# probe-summary-*.json shows null for all extractable fields:
"qualityScore": null,
"contextPeakRatio": null,
"wastedIterations": 0  # (never incremented — ThinkStart not found)
```

**Expected behavior:**
Phase 3 jq commands should return structured kernel events (ThinkStart, FinalAnswer, TerminationDecision, ToolCallStart, etc.) enabling analysis of quality scores, context ratios, and iteration patterns.

**Root cause hypothesis:**
The observability layer emits `_type: "metric"` (gauge/counter/histogram with metric `name` field) and `_type: "log"` (structured log lines with `message` field), plus OpenTelemetry spans. No structured kernel-phase events with an `event` field are emitted. The `harness-probe.ts` `extractMetricsFromJsonl` function attempts to count `ThinkStart` events, which don't exist. Phase 3 jq commands in the skill were written for a hypothetical event format that was never implemented.

Metric name for iteration count: `execution.iteration` (gauge, final value).
Quality score: not emitted as a metric — only visible in the `reasoning.steps` counter and entropy composite gauge.

**Impact:** Blocks all structured post-run analysis. The skill's Phase 3 analysis section is non-functional. `qualityScore`, `contextPeakRatio`, and `wastedIterations` are permanently null in probe summaries until fixed.

**Status:** `OPEN`

---

### [W4] `withReasoning({ maxIterations })` does not reach the kernel's iteration guard

**Severity:** `medium`

**Probe(s) where observed:** tool-heavy (configured 12, ran 21), termination-quality (configured 10, ran 41)

**Observed behavior:**
```
# Probe configured:
.withReasoning({ defaultStrategy: "adaptive", maxIterations: 12 })

# Kernel ran:
[think] 21 steps | 18,490 tok
"execution.iteration": 21    # from JSONL metric

# ICS at iteration 19:
"Still needed: web-search. Call the next one now. (2 iterations remaining)"
# → implies kernel's maxIterations ≈ 21, not 12
```

**Expected behavior:**
`withReasoning({ maxIterations: 12 })` should limit the kernel loop to 12 iterations.

**Root cause hypothesis:**
In `builder.ts`, `withReasoning(options)` stores options at `this._reasoningOptions = options` (L1328). But `createRuntime` at L2454 uses `maxIterations: self._maxIterations` (not `_reasoningOptions.maxIterations`). `_maxIterations` is only set by `withMaxIterations()`, defaulting to 10. 

The reactive strategy then uses `contextProfile?.maxIterations ?? config.strategies.reactive.maxIterations`, which comes from the mid-tier profile (10) or defaultReasoningConfig (10), not from the user's `withReasoning` call.

Note: the kernel running 21 iterations instead of 10 remains partially unexplained — the exact mechanism (ICS redirect loop or execution engine retry) needs a targeted pass-2 investigation.

**Source evidence:**
```bash
grep -n "_maxIterations\|_reasoningOptions\|withMaxIterations" packages/runtime/src/builder.ts | head -10
# L751: private _maxIterations: number = 10;
# L1165: this._maxIterations = n;  ← only set by withMaxIterations()
# L1328: if (options) this._reasoningOptions = options;  ← withReasoning stores here
# L2454: maxIterations: self._maxIterations,  ← createRuntime uses _maxIterations, not _reasoningOptions
```

**Impact:** Every user who sets `maxIterations` via `withReasoning()` (the documented API) gets the default (10) instead of their configured value. The fix for this alone should be low-risk and high-value.

**Status:** `OPEN`

---

### [W5] Tree-of-thought candidate expansion inflates the global `execution.iteration` counter

**Severity:** `low`

**Probe(s) where observed:** termination-quality

**Observed behavior:**
```
# termination-quality (adaptive → tree-of-thought):
17:15:51.004 DEBUG   ┄ [thought]  [ADAPTIVE] Heuristic: tree-of-thought
17:15:52.592 DEBUG   ┄ [thought]  [TOT d=1] score=0.80: Use web-search to research...
17:15:52.727 DEBUG   ┄ [thought]  [TOT d=1] score=0.70: Look up real-world examples...
# ... 9 candidates at d=1, 9 at d=2, 9 at d=3 = 27 total ToT LLM calls

# Then kernel execution:
17:16:09.227 DEBUG   ┄ [model-io:tree-of-thought:main] ...

# execution.iteration metric: 41
# Probe summary: "iterationsUsed": 41 / "maxIterationsAllowed": 10
```

**Expected behavior:**
The probe summary's `iterationsUsed` should reflect kernel execution iterations only, not ToT candidate generation. The configured maxIterations=10 is for kernel loops, not ToT breadth expansion.

**Root cause hypothesis:**
`execution.iteration` is a global LLM-call counter maintained by the ExecutionEngine (or reactive-intelligence telemetry). ToT candidate generation (27 LLM calls) + kernel execution iterations (14) = 41. The `harness-probe.ts` `extractMetricsFromJsonl` reads this global counter and reports it as `iterationsUsed`, making the "21 / 12" and "41 / 10" summaries misleading — the kernel did not actually run 41 iterations.

The real signal: entropy flat from iter 3 (0.598) for 22 logged entries; only 1 tool called (web-search, 856ms avg).

**Impact:** Misleading probe summaries overstate the severity of iteration overruns when ToT is selected. Low severity since it doesn't affect actual task execution.

**Status:** `OPEN`

---

## Improvement Candidates

Ranked by impact × inverse-effort (higher = do first).

| IC ID | Weakness Ref | Change Required | File:Line | Impact | Effort | Score | Risk | Success Criteria |
|-------|-------------|----------------|-----------|--------|--------|-------|------|-----------------|
| IC-1 | W2 | In `detectLoop` consecutive-thoughts check, only reset streak on `type === "action"` — not "observation" | `loop-detector.ts:91-96` | 5 | 5 | **25** | low | tool-heavy loop fires at iteration 3, not 21 |
| IC-2 | W4 | In `withReasoning()`, also set `this._maxIterations = options.maxIterations` when provided | `builder.ts:~1328` | 4 | 5 | **20** | low | tool-heavy probe with `maxIterations: 12` stops at ≤12 iterations |
| IC-3 | W1 | Parse text-format tool calls in `think.ts` as fallback when no native FC events fire | `think.ts:~handleThinking` | 5 | 3 | **15** | med | tool-heavy act phase fires at least once; final output is not a raw tool call string |
| IC-4 | W3 | Update `extractMetricsFromJsonl` in `harness-probe.ts` to read `_type: "metric"` entries by name | `scripts/harness-probe.ts:142-196` | 3 | 5 | **15** | low | qualityScore and contextPeakRatio non-null in probe summary |
| IC-5 | W3 | Update skill Phase 3 jq commands to match `_type: "log"` / `_type: "metric"` JSONL schema | `.agents/skills/harness-improvement-loop/SKILL.md` | 3 | 4 | **12** | low | Phase 3 jq commands return non-empty results |

---

## Regression Watch

| IC ID | Passing Probes at Risk | What to Re-Run After Fix |
|-------|----------------------|--------------------------|
| IC-1 | trivial-1step, multistep-research | Re-run trivial-1step: confirm loop detector doesn't fire prematurely on real observations |
| IC-2 | trivial-1step, multistep-research, context-pressure | Re-run all 3 passing probes with `maxIterations` set — confirm they still complete within budget |
| IC-3 | trivial-1step | Re-run trivial-1step: confirm text-format fallback parser doesn't trigger on clean text responses |
| IC-4 | (none — probe tooling only) | No production regression risk |
| IC-5 | (none — skill docs only) | No production regression risk |

---

## Carry-Forward from Prior Reports

| Weakness ID | First Seen | Title | Severity | Status | IC ID |
|-------------|-----------|-------|----------|--------|-------|
| W1-P1 | Pass 1 | cogito:8b generates text-format tool calls, not native FC | high | OPEN | IC-3 |
| W2-P1 | Pass 1 | ICS observations break consecutive-thoughts loop detector | high | OPEN | IC-1 |
| W3-P1 | Pass 1 | JSONL format mismatch — metric extraction broken | medium | OPEN | IC-4, IC-5 |
| W4-P1 | Pass 1 | `withReasoning({ maxIterations })` not propagated to kernel | medium | OPEN | IC-2 |
| W5-P1 | Pass 1 | ToT expansion inflates global iteration counter | low | OPEN | (none — logging/reporting issue) |

---

## Next Pass Focus

1. **Hypothesis:** Fixing IC-1 (loop detector consecutive-thoughts check) alone is sufficient to make tool-heavy terminate at iteration 3 instead of 21, even without native FC.
   **Test:** Apply IC-1, re-run tool-heavy. Look for `detectLoop: 3 consecutive thinking steps` in the log within the first 4 iterations. Verify iteration count ≤ 5.
   **Why now:** Highest-score IC (25), low-risk, one-line change. If confirmed, eliminates the spin loop entirely for all Ollama models regardless of FC support.

2. **Hypothesis:** `withReasoning({ maxIterations: N })` currently uses a different path to the kernel than `withMaxIterations(N)`, but both should reach the same kernel guard.
   **Test:** Apply IC-2, re-run tool-heavy with `maxIterations: 5`. Verify `execution.iteration` metric is ≤ 5 in probe summary.
   **Why now:** IC-2 is also trivial (score 20). Without it, the iteration budget configured in the probe is silently ignored — a correctness bug affecting all users.

3. **Hypothesis:** The `extractMetricsFromJsonl` fix (IC-4) will unblock quality score and context peak ratio extraction, enabling the Phase 3 analysis commands to produce real data.
   **Test:** Apply IC-4, re-run all 5 probes. Verify `qualityScore` and `contextPeakRatio` are non-null in at least 3 of 5 probe summaries.
   **Why now:** Without this, every future pass has null quality and context metrics. W3 blocks the analysis loop.

---

## Handoff Tickets

### Ticket: IC-1

**From report:** `harness-reports/improvement-report-20260411-1.md`
**Weakness:** W2-P1 — The loop detector's consecutive-thoughts check resets its counter on ANY non-"thought" step, including ICS "observation" nudges. This means the model can think indefinitely as long as the ICS keeps injecting nudges between iterations.
**File:** `packages/reasoning/src/strategies/kernel/utils/loop-detector.ts`
**Change:** In the consecutive-thoughts loop (L91-96), change the break condition from "any non-thought step" to "only action steps":

```typescript
// BEFORE:
for (let i = steps.length - 1; i >= 0; i--) {
  if (steps[i]!.type === "thought") consecutiveThoughts++;
  else break;
}

// AFTER:
for (let i = steps.length - 1; i >= 0; i--) {
  const stepType = steps[i]!.type;
  if (stepType === "thought") consecutiveThoughts++;
  else if (stepType === "action") break;  // only real tool calls reset the streak
  // "observation" (ICS nudges, errors) do NOT reset the streak
}
```

**Test to write:**
- File: `packages/reasoning/tests/strategies/kernel/utils/loop-detector.test.ts`
- Scenario: steps array with pattern [thought, observation, thought, observation, thought, observation, thought] (4 thoughts, 3 ICS observations interleaved)
- Expected: `detectLoop` returns a loop message (consecutiveThoughts = 4 ≥ maxConsecutiveThoughts = 3)
- Currently: `detectLoop` returns null (each observation resets the streak to 0)

**Regression guard:** Run probe `trivial-1step` after fix. The trivial probe uses no required tools, so no ICS observations fire — the fix should be a no-op for it. Expect 1 iteration (unchanged from baseline).

---

### Ticket: IC-2

**From report:** `harness-reports/improvement-report-20260411-1.md`
**Weakness:** W4-P1 — `withReasoning({ maxIterations: N })` stores N in `_reasoningOptions` but `createRuntime` uses `_maxIterations` (default 10). The configured maxIterations is silently ignored.
**File:** `packages/runtime/src/builder.ts`
**Change:** In `withReasoning()` (L~1326-1330), when `options.maxIterations` is provided, also set `this._maxIterations`:

```typescript
withReasoning(options?: ReasoningOptions): this {
  if (options) {
    this._reasoningOptions = options;
    if (options.maxIterations !== undefined) {
      this._maxIterations = options.maxIterations;  // ← add this
    }
  }
  return this;
}
```

**Test to write:**
- File: `packages/runtime/tests/builder-max-iterations.test.ts` (or add to existing builder tests)
- Scenario: build agent with `.withReasoning({ maxIterations: 7 })`, inspect `toConfig().maxIterations`
- Expected: `config.maxIterations === 7`
- Currently: `config.maxIterations === 10` (default, withReasoning value ignored)

**Regression guard:** Run probe `trivial-1step` with `maxIterations: 3`. Expect 1 iteration — confirms the fix doesn't break clean termination when the budget is set below the natural completion point.
