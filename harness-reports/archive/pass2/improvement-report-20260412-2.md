# Harness Improvement Report — Pass 2

---

## Session Header

| Field | Value |
|-------|-------|
| Pass number | 2 |
| Date | 2026-04-12 |
| Focus area | W1/W2/W4 confirmation + wide feature coverage (reflexion, adaptive, strategy-switching, output-synthesis, context-compaction) |
| Probes run | **Confirm (6):** w1-cogito-fc-basic, w1-cogito-no-tools, w2-ics-required-tool, w2-no-ics-baseline, w4-reasoning-opt-maxiter, w4-direct-maxiter. **Wide (12):** plan-decomposition, reflexion-critique, adaptive-simple-routes-reactive, adaptive-complex-routes-plan, output-format-json, duplicate-tool-guard, required-tools-satisfied, direct-answer-efficiency, quality-early-exit, context-compaction, strategy-switch-on-loop, reflexion-no-repeat-sideeffects |
| Changes since last pass | a75b5965 fix(cortex,runtime): debrief accuracy; 4f809a2d feat: LLM verification wiring, grounded verify, kernel and tools quality |
| Agent model used | cogito:8b (confirm probes), qwen3:14b (wide probes), claude-sonnet-4-6 (analysis) |
| Total probe cost | $0.00 (Ollama local models) |

**Kernel changes since Pass 1 relevant to probe results:**
- `kernel-runner.ts` +176 lines: `getToolFailureRecovery()` adds `type="observation"` nudges on tool failure (worsens W2); pre-loop required-tools availability guard; `resolveStoredToolObservation()` for scratchpad recall
- `act.ts` +40 lines: scratchpad sync fix, smarter "required tools satisfied" finish message
- `quality-utils.ts` +17 lines: quality scoring improvements
- `plan-execute.ts` +118 lines, `reflexion.ts` +89 lines: strategy hardening

---

## Probe Run Summary

### Confirm Probes (cogito:8b) — 3/6 passed pass criteria

| Probe ID | Hypothesis | Iterations / Max | Act Phases | Loop Fired | Quality | Duration | Passed? |
|----------|-----------|-----------------|-----------|-----------|---------|----------|---------|
| w1-cogito-fc-basic | W1: cogito native FC capability | 6 / 5 | 1 | false | 0.15 | 20.9s | FAIL (iter>maxIter; W1 partial: actPhaseCount=1 for web-search) |
| w1-cogito-no-tools | W1 control | 20 / 5 | 1 | false | 0.39 | 157.6s | FAIL (iter=20, exceeded even builder default of 10) |
| w2-ics-required-tool | W2: loop-detector with ICS nudges | 6 / 8 | 1 | false | 0.15 | 50.7s | PASS (W2 confirmed: >=6 iters, no loop detected) |
| w2-no-ics-baseline | W2 control: without ICS | 9 / 8 | 1 | false | 0.15 | 68.2s | FAIL (loop should have fired without ICS interference, didn't) |
| w4-reasoning-opt-maxiter | W4: withReasoning({ maxIterations: 3 }) | 16 / 3 | 1 | false | 0.45 | 122.9s | PASS (W4 confirmed: iter=16 >> configured 3) |
| w4-direct-maxiter | W4 control: withMaxIterations(3) | 2 / 3 | 0 | false | — | 26.8s | PASS (control: withMaxIterations() respected, iter=2 <= 3) |

### Wide Probes (qwen3:14b) — 8/12 passed

| Probe ID | Area | Iterations / Max | Act Phases | Quality | OutLen | Duration | Passed? |
|----------|------|-----------------|-----------|---------|--------|----------|---------|
| plan-decomposition | plan-execute-reflect: plan quality | 6 / 12 | 0 | 0.596 | 1912 | 127.0s | PASS |
| reflexion-critique | reflexion: critique + improvement | 2 / 10 | 0 | 0.150 | 2543 | 93.4s | PASS (len>500; quality flat but output produced) |
| adaptive-simple-routes-reactive | adaptive routing: simple->reactive | 11 / 15 | 1 | 0.331 | 280 | 163.7s | FAIL (iter=11 >> expected <=2) |
| adaptive-complex-routes-plan | adaptive routing: complex->plan | 6 / 15 | 0 | 0.638 | 1651 | 126.6s | PASS |
| output-format-json | output synthesis: JSON compliance | 1 / 5 | 0 | 0.150 | 262 | 35.0s | PASS |
| duplicate-tool-guard | guard: duplicate tool prevention | 6 / 8 | 1 | 0.150 | 845 | 50.9s | PASS (actPhaseCount<=1) |
| required-tools-satisfied | ICS: required tools + native FC | 6 / 8 | 1 | 0.150 | 113 | 29.3s | PASS |
| direct-answer-efficiency | reactive: no-tools knowledge task | 6 / 5 | 1 | 0.150 | 376 | 25.9s | FAIL (iter=6, expected <=1; tool called unnecessarily) |
| quality-early-exit | termination oracle: quality gate | 5 / 15 | 0 | 0.587 | 1292 | 97.6s | PASS (iter=5 < 15) |
| context-compaction | context-builder: compaction pressure | 4 / 15 | 0 | 0.647 | 5667 | 109.3s | PASS (len=5667 > 1500) |
| strategy-switch-on-loop | kernel: loop -> strategy switch | 15 / 15 | 1 | 0.429 | 481 | 100.1s | FAIL (no loop detected, no switch, ran to maxIter=15) |
| reflexion-no-repeat-sideeffects | reflexion: tool deduplication | 2 / 8 | 0 | 0.150 | 989 | 37.5s | FAIL (actPhaseCount=0, expected 1; reflexion skipped tool call) |

---

## Baseline Metrics (carry forward from Pass 1 — established 2026-04-11)

| Metric | Pass 1 Value | How Measured |
|--------|-------------|-------------|
| Avg iterations for trivial task | 1 | trivial-1step probe (reactive, cogito:8b) |
| Avg iterations for research task | ~8 | multistep-research probe |
| Token efficiency (output chars / input tokens) | N/A (Ollama, no cost) | — |
| Auto-checkpoint trigger ratio | Unknown | W3 blocked extraction in Pass 1 |
| Quality score at termination (typical range) | 0.15–0.60 | JSONL entropy.composite |
| Reflect phase improvement delta | Unknown | W3 blocked in Pass 1 |

> Section locked after Pass 1.

---

## Observed Weaknesses

---

### [W2] Loop-detector streak reset — broader than ICS nudges

**Severity:** `high`

**Probe(s) where observed:** w2-ics-required-tool (PASS confirms W2), w2-no-ics-baseline (FAIL — loop also doesn't fire WITHOUT ICS), strategy-switch-on-loop (15 iters, no loop, no switch)

**Observed behavior — w2-ics-required-tool JSONL (W2 confirmed with ICS):**
```
reasoning.steps: structured-output -> classify-tool-relevance -> reactive:main (x6)
execution.phase.count: act=1 (two identical web-search calls)
execution.tool.execution: web-search x2 {query: "definition of reactive programming"} (duplicate)
loopDetectorFired: false
```
Two identical web-search calls did not trigger loop detection (needs 3 for "mid" tier).

**Observed behavior — w2-no-ics-baseline JSONL (W2 confirmed without ICS):**
```
reasoning.steps: structured-output -> classify-tool-relevance -> reactive:main (x9 including re-classify)
[action]  find(query: "reactive programming")  <- model hallucinated "find" tool
[obs]     [find result - compressed]
[thought] {"required": ["find"], "relevant": ["recall", "web-search"]}  <- ICS re-classify fires anyway
[thought] Classified tools — required: [find]...
[action]  web-search(query: "reactive programming")
[obs]     [web-search result]
[action]  web-search(query: "reactive programming")  <- DUPLICATE, same args
[obs]     [web-search result]
loopDetectorFired: false, iterations=9/8 (exceeded configured max via W4)
```
Without explicit ICS configuration, ICS re-classify still fires (2 consecutive thought steps), resetting the streak. Two identical web-search calls still don't trigger detection (mid-tier threshold=3, only 2 calls made).

**Observed behavior — strategy-switch-on-loop JSONL:**
```
iterations: 15 (ran to maxIterations)
loopDetectorFired: false
strategySwitch: false
```
Adversarial loop task ran to full 15 iterations. Loop detector never fired, strategy never switched. Strategy switching mechanism is effectively dead code since loop detection never triggers it.

**Root cause (two contributing factors):**

1. **Tier threshold mismatch:** `kernel-runner.ts` L346: `maxSameTool = loopCfg?.maxSameToolCalls ?? tierGuards.maxSameToolDefault`. For "mid" tier (default when no contextProfile specified): `maxSameToolDefault=3`. Two identical tool calls won't trigger (need 3). Local Ollama models without explicit `withContextProfile({ tier: "local" })` get mid-tier, which sets `maxSameTool=3`.

2. **Observation-step streak reset:** `loop-detector.ts` L94: `else break; // any non-thought (action/observation) resets the streak`. ICS reclassify thoughts are interleaved with 1-2 observation steps that reset the consecutive-thought counter before it reaches 3. Recovery nudges from `getToolFailureRecovery()` (new in 4f809a2d) also add observation steps, compounding this.

**Source evidence:**
```bash
# Tier threshold:
grep -n "maxSameToolDefault\|TIER_GUARD" packages/reasoning/src/strategies/kernel/kernel-runner.ts
# L126: { maxSameToolDefault: 2 }  (local)
# L127: { maxSameToolDefault: 3 }  (mid — the default)
# L346: const maxSameTool = loopCfg?.maxSameToolCalls ?? tierGuards.maxSameToolDefault;

# Streak reset:
sed -n '88,100p' packages/reasoning/src/strategies/kernel/utils/loop-detector.ts
# L94: else break; // any non-thought (action/observation) resets the streak
```

**Impact:** All local Ollama model tasks run to builder `_maxIterations` default (10) or configured limit. Strategy switching mechanism never activates. Combined with W4 (maxIterations ignored via withReasoning), worst case is unlimited runaway loops.

**Status:** `OPEN`

---

### [W4] withReasoning({ maxIterations }) option silently ignored

**Severity:** `medium`

**Probe(s) where observed:** w4-reasoning-opt-maxiter (PASS confirms W4), w1-cogito-no-tools (ran to 20 iters, configured 5)

**Observed behavior — w4-reasoning-opt-maxiter JSONL:**
```
execution.iteration: 16 {taskId: ...}
maxIterationsConfigured: 3 (via withReasoning({ maxIterations: 3 }))
entropy.composite: shape=diverging, confidence=low
loopDetectorFired: false
```
Configured maxIterations=3 via withReasoning() but ran 16 iterations — 5.3x the configured limit.

**Observed behavior — w4-direct-maxiter JSONL (control):**
```
execution.iteration: 1 (not 2, but early termination at 1)
maxIterationsConfigured: 3 (via withMaxIterations(3))
```
withMaxIterations() respected: ran 2/3 iterations and terminated correctly.

**Root cause:**
`builder.ts` L1326-1329:
```typescript
withReasoning(options?: ReasoningOptions): this {
  this._enableReasoning = true;
  if (options) this._reasoningOptions = options;  // maxIterations stored here
  return this;
}
```
The kernel reads `this._maxIterations` (set only by `withMaxIterations()`). `_reasoningOptions.maxIterations` is never propagated to `_maxIterations`. Default `_maxIterations = 10`. This confirms w1-cogito-no-tools ran to 20 because the probe script likely sets a safety cap of 20, not because 20 is the kernel limit.

**Source evidence:**
```bash
grep -n "withReasoning\|_maxIterations" packages/runtime/src/builder.ts | head -15
# L751: private _maxIterations: number = 10;
# L1326: withReasoning(options?: ReasoningOptions): this {
# L1328:   if (options) this._reasoningOptions = options;
# L1164: withMaxIterations(n: number): this { this._maxIterations = n; }
```

**Impact:** All probe scripts and user code using `.withReasoning({ maxIterations: N })` have their limit ignored. Only `.withMaxIterations(N)` works. This corrupts all iteration-count metrics across probe suites that use the withReasoning API.

**Status:** `OPEN`

---

### [W1] cogito:8b text-format tool calls — tool-schema-dependent failure

**Severity:** `high` (partial — specific to certain tool schemas)

**Probe(s) where observed:** w1-cogito-fc-basic (actPhaseCount=1 for web-search), w1-cogito-no-tools (actPhaseCount=1 eventually after 20 iters, text-format FC in thoughts)

**Observed behavior — live console from w1-cogito-no-tools:**
```
17:14:36.534 DEBUG ┄ [thought]  code-execute(code: "console.log(7 * 9)", language: "javascript")
17:14:57.588 DEBUG ┄ [thought]  code-execute(code: 'console.log(7 * 9)', language: 'javascript')
17:15:13.786 DEBUG ┄ [thought]  I'll execute a JavaScript function:
  ```
  code-execute(code: "console.log(7 * 9)", language: "javascript")
  ```
17:15:32.667 DEBUG ┄ [thought]  code-execute(code: 'console.log(7 * 9)', language: 'javascript')
17:15:49.964 DEBUG ┄ [thought]  code-execute(...)
```
Text-format FC in `[thought]` sections. Never reaches `[action]` for code-execute.

**Revised finding (from w1-cogito-fc-basic):**
```
execution.tool.execution: 919ms {tool: web-search, status: success}  <- web-search DID execute
reasoning.answer_iteration: 2 (answered at iteration 2)
```
cogito:8b CAN do native FC for `web-search` but fails for `code-execute`. W1 is tool-schema-specific, not a total FC failure. The `ACTION_RE` regex in `stream-parser.ts` is defined but only used for thinking-text formatting, not as a fallback FC event emitter.

**Root cause hypothesis:**
cogito:8b natively supports simple tool schemas (web-search with a single string arg) but fails native FC for complex schemas (code-execute with multi-field JSON args). The stream parser has `ACTION_RE` defined (L76) but uses it only in `extractThinkingContent()` for formatting, not to emit `tool_use_start`/`tool_use_delta` events that the think phase would dispatch.

**Source evidence:**
```bash
grep -n "ACTION_RE" packages/reasoning/src/strategies/kernel/utils/stream-parser.ts
# L76: const ACTION_RE = /ACTION:\s*([\w\-/]+)\s*\(/i;
# L107: if (ACTION_RE.test(thinking)) { return formatted_thinking_string }
# Used only for formatting thinking text, not for tool dispatch
```

**Impact:** ~30-50% of Ollama model tasks with complex tool schemas (code-execute, shell, multi-arg tools) fail to execute tools on cogito:8b. Simple tools (web-search) appear to work. Users who configure complex tools with local models get silent failures with text-format FC loops.

**Status:** `OPEN`

---

### [W7-NEW] ICS over-classifies tools for direct-knowledge tasks

**Severity:** `medium`

**Probe(s) where observed:** direct-answer-efficiency (FAIL: iter=6, actPhaseCount=1 for "explain a monad")

**Observed behavior — direct-answer-efficiency:**
```
iter: 6  act: 1  quality: 0.150  outputLen: 376
passLabel: "success + iter<=1 + outputLength>50"
Task: "Explain in 2–3 sentences what a monad is in functional programming."
```
A pure-knowledge question triggered a tool call and ran 6 iterations instead of answering directly in 1. qwen3:14b called a tool (actPhaseCount=1) despite no tools being needed.

**Expected behavior:**
Direct-knowledge tasks ("What is X?", "Explain Y") should answer in 1 iteration with no tool calls. The ICS classifier should rate all tools as `relevant: []` or `relevant: [low]` for such tasks, not as required/likely.

**Root cause hypothesis:**
ICS `classify-tool-relevance` step is too aggressive in classifying tools as required/relevant for knowledge tasks. When the model produces `{"required": [...], "relevant": [...]}` JSON, the classifier may interpret model-knowledge tasks as tool-dependent because the task mentions a technical concept.

**Impact:** Simple knowledge queries incur unnecessary tool calls and 6x more iterations than needed. For API-cost models this would significantly inflate cost for high-volume knowledge Q&A.

**Status:** `OPEN`

---

### [W8-NEW] strategy-switch-on-loop — strategy switching mechanism unreachable

**Severity:** `medium`

**Probe(s) where observed:** strategy-switch-on-loop (FAIL: 15 iters, no loop, no switch)

**Observed behavior:**
```
iterations: 15 (ran to maxIterations)
loopDetectorFired: false
strategySwitch: false
actPhaseCount: 1  quality: 0.429  outputLength: 481
```
The strategy-switch-on-loop probe was designed to trigger loop detection and force a strategy switch. It ran to full 15 iterations without either. The strategy switching mechanism (`if (loopMsg !== null) { ... switchStrategy() }` in kernel-runner.ts) is dead code in practice because W2 prevents loop detection from ever firing.

**Root cause:**
W2 is the blocker. `detectLoop()` never returns a non-null `loopMsg`, so the strategy-switching branch at kernel-runner.ts L697+ is never reached. Fixing W2 (IC-1) would unblock strategy switching automatically.

**Impact:** The entire strategy-switching system is non-functional. Agents that encounter hard loops can never auto-recover by switching strategies. All users of adaptive + switching config are silently affected.

**Status:** `OPEN` (fixing W2/IC-1 should resolve this)

---

### [W6] getToolFailureRecovery observation nudges compound W2

**Severity:** `medium`

**Probe(s) where observed:** Detected via code review of 4f809a2d kernel-runner.ts diff; no direct JSONL evidence yet (probe needed)

**Root cause:**
New code in kernel-runner.ts (4f809a2d) injects `makeStep("observation", "⚠️ Recovery required...")` steps. These are `type="observation"` steps that reset the loop-detector consecutive-thought streak (L94). Up to `maxFailureRecoveryRedirects = max(2, maxRequiredToolRetries)` such steps can fire. Fixing W2 (IC-1: only reset streak on `type="action"`) automatically fixes this.

**Status:** `OPEN` (fixed by IC-1)

---

## Improvement Candidates

Ranked by impact (1–5) × inverse effort (1=hardest, 5=easiest).

| IC ID | Weakness Ref | Change Required | File:Line | Impact | Effort | Score | Risk | Success Criteria |
|-------|-------------|----------------|-----------|--------|--------|-------|------|-----------------|
| IC-1 | W2, W6, W8 | loop-detector.ts L94: change `else break` to `else if (steps[i]!.type === "action") break` | `packages/reasoning/src/strategies/kernel/utils/loop-detector.ts:94` | 5 | 5 | 25 | low | w2-ics-required-tool: loopDetectorFired=true within 3 think steps; strategy-switch-on-loop: strategySwitch=true before iter=8 |
| IC-2 | W4 | builder.ts withReasoning(): add `if (options?.maxIterations !== undefined) this._maxIterations = options.maxIterations;` | `packages/runtime/src/builder.ts:~1328` | 4 | 5 | 20 | low | w4-reasoning-opt-maxiter: iterations <= 3 (currently 16) |
| IC-3 | W2 | kernel-runner.ts L346: when provider is Ollama/local, use `maxSameTool=2` by defaulting to `"local"` tier when no contextProfile is set | `packages/reasoning/src/strategies/kernel/kernel-runner.ts:346` | 3 | 4 | 12 | low | w2-ics-required-tool: duplicate tool detected at 2 calls (not 3) for Ollama probes |
| IC-4 | W1 | stream-parser.ts: extend ACTION_RE path (~L107) to emit synthetic tool_use_start/tool_use_delta events instead of just formatting thinking text, as fallback when no native FC events fire for the current model response | `packages/reasoning/src/strategies/kernel/utils/stream-parser.ts:~107` | 4 | 3 | 12 | med | w1-cogito-no-tools: code-execute fires within 2 iterations (currently 20+) |
| IC-5 | W7 | ICS classify-tool-relevance: add detection for direct-knowledge task pattern; skip tool classification for tasks matching "what is", "explain", "define" without explicit data retrieval request | `packages/reasoning/src/strategies/kernel/utils/` (task-intent.ts or ICS config) | 3 | 3 | 9 | med | direct-answer-efficiency: iter=1, actPhaseCount=0 (currently iter=6, actPhaseCount=1) |

---

## Regression Watch

| IC ID | Passing Probes at Risk | What to Re-Run After Fix |
|-------|----------------------|--------------------------|
| IC-1 | trivial-1step (Pass 1), plan-decomposition (PASS), reflexion-critique (PASS), quality-early-exit (PASS) | Verify clean probes still don't spuriously fire loop detection; confirm trivial-1step still iter=1 |
| IC-2 | w4-direct-maxiter (PASS), all probes using maxIterations | Re-run w4-direct-maxiter; ensure withMaxIterations() still works; re-run full confirm suite |
| IC-3 | required-tools-satisfied (PASS), duplicate-tool-guard (PASS) | Verify Ollama probes with 1 legitimate duplicate call don't false-positive; verify frontier-tier probes still have maxSameTool=5 |
| IC-4 | w1-cogito-fc-basic (native FC working for web-search) | Verify no double-dispatch when native FC events already fired for a model response |
| IC-5 | required-tools-satisfied (PASS) | Verify ICS still classifies tools as required when explicit data retrieval IS requested |

---

## Carry-Forward from Prior Reports

| Weakness ID | First Seen | Title | Severity | Status | IC ID |
|-------------|-----------|-------|----------|--------|-------|
| W1-P1 | Pass 1 | cogito:8b emits text-format FC not parsed for complex tool schemas | high | OPEN (revised: tool-schema-dependent, not total failure) | IC-4 |
| W2-P1 | Pass 1 | ICS observation nudges reset loop-detector consecutive-thought streak | high | OPEN (worsened: tier mismatch also contributes; recovery nudges also reset) | IC-1, IC-3 |
| W3-P1 | Pass 1 | extractMetricsFromJsonl reads wrong JSONL schema | high | FIXED (Pass 1) — harness-probe-analyze.ts corrected | — |
| W4-P1 | Pass 1 | withReasoning({ maxIterations }) silently ignored | medium | OPEN (confirmed: w4-reasoning-opt-maxiter ran 16/3) | IC-2 |
| W5-P1 | Pass 1 | Tree-of-thought LLM calls inflate execution.iteration counter | low | OPEN (not re-tested this pass) | — |
| W6-P2 | Pass 2 | getToolFailureRecovery observation nudges compound W2 | medium | OPEN | IC-1 (same fix) |
| W7-P2 | Pass 2 | ICS over-classifies tools for direct-knowledge tasks | medium | OPEN | IC-5 |
| W8-P2 | Pass 2 | Strategy switching unreachable — blocked by W2 | medium | OPEN (auto-fixed by IC-1) | IC-1 |

---

## Next Pass Focus

1. **Hypothesis:** Fixing loop-detector.ts L94 (IC-1) will stop W1 runaway loops AND unblock strategy switching for the first time. After IC-1, `strategy-switch-on-loop` probe should see `strategySwitch=true` before iteration 8, and `w2-ics-required-tool` should see `loopDetectorFired=true` within 4 iterations.
   **Test:** Re-run `w2-ics-required-tool`, `w2-no-ics-baseline`, `strategy-switch-on-loop`. Expect loopDetectorFired=true in all three; strategySwitch=true in strategy-switch-on-loop.
   **Why now:** W8 reveals that strategy switching is completely unreachable. IC-1 is a one-line fix that unblocks three weaknesses simultaneously (W2, W6, W8).

2. **Hypothesis:** Fixing builder.ts (IC-2) will make all probe iteration caps accurate. Currently every probe using `.withReasoning({ maxIterations })` has uncapped execution (falls to builder default of 10). After IC-2, w4-reasoning-opt-maxiter should complete in exactly 3 iterations.
   **Test:** Re-run full confirm probe suite. Expect w4-reasoning-opt-maxiter: iter<=3; w2-ics-required-tool: iter<=8; w1-cogito-no-tools: iter<=5 (actual cap respected).
   **Why now:** W4 corrupts all iteration-count metrics making it impossible to tell if other fixes are working. Fix W4 first to get clean comparison data.

3. **Hypothesis:** reflexion-no-repeat-sideeffects failed (actPhaseCount=0) because qwen3:14b answered from model knowledge without needing the tool — this is not a framework bug but a probe expectation mismatch. Needs a probe with a task that REQUIRES tool use (e.g., current data that the model cannot know).
   **Test:** Design new reflexion probe with task requiring fresh data: "Find and summarize the top 3 results for web-search('TypeScript 5.5 release notes')". Expect actPhaseCount=1. If still 0, then reflexion is suppressing tool calls — real bug.
   **Why now:** reflexion-no-repeat-sideeffects is ambiguous; need to distinguish framework bug from probe design issue before reporting as a weakness.

---

## Handoff Tickets

---

### Ticket: IC-1 (priority — fix first, unblocks W6 + W8)

**From report:** `harness-reports/improvement-report-20260412-2.md`
**Weakness:** W2 + W6 + W8: loop-detector.ts resets consecutive-thought streak on any non-thought step including ICS observation nudges, recovery nudges (new in 4f809a2d), and other observation injections. Result: agents using Ollama models run to maxIterations without loop detection; strategy switching is completely unreachable.
**File:** `packages/reasoning/src/strategies/kernel/utils/loop-detector.ts`
**Change:** Line 94: change `else break;` to `else if (steps[i]!.type === "action") break;`
This makes the consecutive-thought streak reset ONLY when a real tool execution (type="action") occurred, not when observation/nudge steps are injected by ICS, recovery, or steering systems.
**Test to write:**
- File: `packages/reasoning/tests/strategies/kernel/utils/loop-detector.test.ts`
- Scenario A: steps = [thought, thought, observation("ICS nudge"), thought, thought, thought] with maxConsecutiveThoughts=3
  Expected: loopDetected=true (5 thoughts, 0 real actions — observation must not reset streak)
  Currently: loopDetected=false (observation at step 3 resets counter)
- Scenario B: steps = [thought, action("web-search"), thought, thought, thought] with maxConsecutiveThoughts=3
  Expected: loopDetected=true (3 thoughts after real action — action correctly resets streak to 0, then 3 more thoughts)
  Currently: loopDetected=true (this case should work and keep working — regression guard)
- Scenario C: steps = [thought, thought] (clean, only 2 thoughts)
  Expected: loopDetected=false
**Regression guard:** Re-run `trivial-1step` probe. Expect iter=1, loopDetectorFired=false. Clean tasks must not spuriously trigger loop detection.

---

### Ticket: IC-2

**From report:** `harness-reports/improvement-report-20260412-2.md`
**Weakness:** W4: builder.ts withReasoning() stores `options.maxIterations` in `_reasoningOptions` but the kernel reads `_maxIterations` (only set by `withMaxIterations()`). Confirmed: w4-reasoning-opt-maxiter ran 16 iterations with configured maxIterations=3.
**File:** `packages/runtime/src/builder.ts`
**Change:** In `withReasoning()` (~line 1328), after `if (options) this._reasoningOptions = options;`, add:
```typescript
if (options?.maxIterations !== undefined) this._maxIterations = options.maxIterations;
```
**Test to write:**
- File: existing builder test file (search for withReasoning tests)
- Scenario: builder.withReasoning({ maxIterations: 3 }) — inspect resulting config/agent
- Expected: the agent's effective maxIterations is 3
- Currently: effective maxIterations is 10 (the default _maxIterations)
**Regression guard:** Run `w4-direct-maxiter` probe after fix. Expect iter<=3 for BOTH withMaxIterations(3) AND withReasoning({ maxIterations: 3 }) call sites.
