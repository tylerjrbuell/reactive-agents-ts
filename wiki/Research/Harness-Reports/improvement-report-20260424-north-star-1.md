# Harness Improvement Report — Pass 20260424-north-star-1

## Session Header

| Field | Value |
|-------|-------|
| Pass number | 20260424-north-star-1 |
| Date | 2026-04-24 |
| Focus area | North Star v2.3 gap coverage — failure mode mapping against G-1 through G-6 |
| Probes run | failure-corpus (8 scenarios, cogito:14b), trivial-1step, memory-retrieval-fidelity, memory-recall-invocation, memory-multi-observation-synthesis, memory-context-pressure-degradation (qwen3:14b) |
| Changes since last pass (20260422-memory-1) | `be41ddb3` docs: North Star v2.3 + sprint plan suite; `32ba0992` fix: pre-sprint bug fixes (input-validator defaults, entity-count heuristic, harness-deliverable promotion, previousTerminatedBy, allowedTools trim, handler type widening); `93ff6793` feat(core): typed framework error taxonomy P0 S0.1; **harness-evolve.ts bug fix (uncommitted)**: `a.discoveredMetricNames` → `a.discoveredEventKinds` (field was renamed in `harness-probe-analyze.ts` Apr 18 rewrite) |
| Agent model used | failure-corpus: cogito:14b via Ollama; standard probes: qwen3:14b via Ollama |
| Total probe cost | $0.00 (all local) |

---

## Probe Run Summary

> **Key finding:** Entropy AUC = **1.000** (perfect failure predictor) and Dispatch AUC = **0.750** (imperfect action). The framework can detect failure via entropy signal — but only acts on 2 of 4 failure scenarios. **Detection works. Termination doesn't.**

### Failure Corpus (cogito:14b)

| Scenario | Label | `result.success` | maxEntropy | Iters / Max | Dispatched | Suppressed | Pass? |
|----------|-------|-----------------|-----------|-------------|-----------|-----------|-------|
| success-days-of-week | success | true | 0.150 | 2 / 4 | 0 | 0 | ❌ (iters=2, expected=1) |
| success-capital-france | success | true | 0.150 | 3 / 4 | 0 | 2 | ❌ (iters=3, expected≤2) |
| success-rgb-colors | success | true | 0.150 | 3 / 4 | 0 | 2 | ❌ (iters=3, expected≤2) |
| success-typescript-paradigm | success | true | 0.378 | **5 / 4** | 0 | 1 | ❌ (exceeded maxIterations) |
| failure-rate-limit-loop | failure | true | 0.578 | **16 / 12** | 5 | 7 | ❌ (exceeded maxIterations; success=true wrong) |
| failure-save-loop | failure | true | 0.546 | 6 / 12 | 0 | 2 | ❌ (0 dispatches; success=true wrong) |
| failure-verify-loop | failure | true | 0.560 | 8 / 12 | 2 | 4 | ❌ (success=true wrong) |
| failure-contradictory-data | failure | true | 0.504 | 8 / 12 | 0 | 2 | ❌ (0 dispatches; success=true wrong) |

**AUC validation** (`validate-entropy.ts .reactive-agents/traces/failure-corpus`):
- Entropy AUC → failure: **1.000** (perfect predictor — entropy alone classifies all 8 correctly)
- Dispatch AUC → failure: **0.750** (imperfect — dispatcher only fires on 2 of 4 failure scenarios)
- Avg entropy gap: success=0.207 vs failure=0.547, **gap=0.340**
- Framework `result.success` accuracy: **4/8** (all 4 labeled-failure runs returned `success=true`)

### Standard Probes (qwen3:14b)

| Probe ID | Strategy | Iters / Max | Max entropy | Dispatched | Duration | Pass? |
|----------|----------|-------------|------------|-----------|---------|-------|
| trivial-1step | reactive | **2** / 5 | 0.150 | 0 | 13.7s | ❌ (regression: baseline=1) |
| memory-retrieval-fidelity | reactive | 3 / 8 | 0.150 | 2 | 96.5s | ❌ (W8 task-intent misread) |
| memory-recall-invocation | reactive | 3 / 8 | 0.150 | 2 | 73.9s | ⚠️ (recall invoked ✅; output incomplete) |
| memory-multi-observation-synthesis | plan-execute-reflect | 7 / 12 | 0.584 | 0 | 54.5s | ✅ |
| memory-context-pressure-degradation | plan-execute-reflect | 7 / 15 | 0.628 | 0 | 116.7s | ⚠️ (auto-checkpoint never fired; output coherent) |

---

## North Star Gap Coverage Map

First pass to explicitly map probe findings against the six architectural gaps (G-1–G-6) from Design North Star v2.3 §1.2.

| NS Gap | Title | Covered? | Finding |
|--------|-------|---------|---------|
| G-1 | Capability provider-scoped, `num_ctx` never set | ❌ | Needs dedicated long-context probe (IC-18). All local probes used short tasks where 2048-token default didn't matter. |
| G-2 | Two `ModelTier` schemas | ❌ | Code-only gap — not testable at runtime. |
| G-3 | Tool observations never populate semantic memory | ⚠️ | Memory IS populated (memory-flush fires) but blocks 8–12s on hot path. `Effect.forkDaemon` not yet applied (W16). |
| G-4 | Compression is 3 uncoordinated systems | ❌ | Not directly tested. `savings-below-cost` suppressions seen but coordination not probed. |
| G-5 | Termination scattered at 4 writers | ✅ | Confirmed: rate-limit-loop 16 vs 12, typescript-paradigm 5 vs 4, trivial-1step still 2 vs 1. Direct evidence of multi-writer contradiction. |
| G-6 | `ExecutionEngine` 4,404 LOC mixed concerns | ❌ | Structural gap — not testable at runtime. `memory-flush` 8–12s is a symptom; extraction would fix it. |

---

## Observed Weaknesses

---

### [W4] `maxIterations` not enforced — agents run past the configured ceiling

**Severity:** high

**Evidence:**
- `failure-rate-limit-loop` (maxIterations=12): ran **16 iterations** — 33% over ceiling.
  ```
  Iterations: 16 / 12    Max entropy: 0.578
  ```
  Trace: `.reactive-agents/traces/failure-corpus/01KPZR2E32MHQKR6KC3HDZ46K6.jsonl`
- `success-typescript-paradigm` (maxIterations=4): ran **5 iterations**.
  ```
  Iterations: 5 / 4    Max entropy: 0.378
  ```
  Trace: `.reactive-agents/traces/failure-corpus/01KPZR21EDQHEZVAJ6DKC5PAR4.jsonl`

**Root cause:** North Star §1.5 (exact): `withReasoning({ maxIterations: N })` stored in `builder._reasoningOptions`; `runtime.ts:821` reads `builder._maxIterations` (different field). `state.meta.maxIterations` never populated from `_reasoningOptions`. Invariant fix (Phase 1) makes `_config.reasoning.maxIterations` the sole source of truth.

**Status:** CONFIRMED. Was OPEN from prior passes. North Star Phase 1 closes structurally.

---

### [W6] trivial-1step regression — 2 iterations vs locked baseline of 1

**Severity:** high (regression)

**Evidence:**
- `trivial-1step` (qwen3:14b, maxIter=5): **2 iterations**, entropy=0.150 flat
  ```
  Iterations: 2 / 5    Max entropy: 0.150    Dispatched: 0
  ```
  Trace: `.reactive-agents/traces/01KPZR7DQ2MTJBM7KMRVC48EHF.jsonl`
- `success-days-of-week` (cogito:14b, maxIter=4): also **2 iterations**, entropy=0.150 flat
  ```
  Iterations: 2 / 4    Max entropy: 0.150    Dispatched: 0
  ```
  Not fixed by `32ba0992` (harness-deliverable promotion). Both models affected.

**Root cause hypothesis:** North Star §11 Attack 5: `think.ts:551` directly writes `terminatedBy = "end_turn"` outside the termination oracle pipeline. This fires as a second pass after the oracle has already signaled termination, adding a spurious extra iteration.

**Status:** OPEN. North Star Phase 2 (Decision Rules pipeline) consolidates 4 writers into one ordered chain.

---

### [W7] Model fails to invoke recall — PARTIALLY IMPROVED

**Severity:** medium (was high)

**Evidence:**
- `memory-recall-invocation` (qwen3:14b): **1 recall call** (was 0 in prior pass)
  ```
  Tool Execution: web-search 1 calls, recall 1 calls
  ```
  Recall IS invoked. But output still incomplete: `"only five search results, numbered 1 through 5. There is no 7th result available"` — recall returned data but web-search mock returns only 5 results, so the 7th doesn't exist.
- `memory-retrieval-fidelity`: also **1 recall call**.

**Status:** IMPROVED. Recall invocation works. Remaining issue is data completeness, not invocation.

---

### [W8] Task-intent misread on "list N items from results" shape

**Severity:** medium

**Evidence:**
- `memory-retrieval-fidelity` (qwen3:14b): task asked for "list EXACTLY 10 programming languages from the results." Output:
  ```
  1. Technology | 2024 Stack Overflow Developer Survey: https://survey.stackoverflow.co/2024/technology
  2. TIOBE Index: https://www.tiobe.com/tiobe-index/
  ```
  Agent listed 10 **search result URLs** instead of 10 **languages mentioned in those results**. Same pattern as prior pass.

**Root cause:** `task-intent.ts` does not distinguish extraction task ("extract N items FROM content") from citation task ("list N sources"). North Star §8 flags as `config.taskIntent.customShapes` (P3).

**Status:** OPEN. Same as prior pass.

---

### [W9] Tool observations blocking kernel hot path via synchronous memory-flush

**Severity:** high (was "memory never called" — upgraded)

**Evidence:**
```
memory-retrieval-fidelity          → memory-flush: 11.6s  (12% of 96.5s)
memory-recall-invocation           → memory-flush:  7.0s  (10% of 73.9s)
memory-multi-observation-synthesis → memory-flush:  8.6s  (16% of 54.5s)
memory-context-pressure-degradation→ memory-flush: 11.8s  (10% of 116.7s)
```
All 4 research probes block on memory-flush. Span in each trace shows it as a sequential phase.

**Root cause:** North Star §11 Attack 2: the fix is `yield* Effect.forkDaemon(memory.store(...))`. Currently memory write + embedding is synchronous in the hot path. North Star Phase 1 target.

**Status:** UPGRADED from "memory never called." Memory IS populated but blocks 8–12s per research turn.

---

### [W11] `result.success` always returns `true` — no semantic failure detection

**Severity:** critical (NEW)

**Evidence from failure corpus:**
```
failure-rate-limit-loop    | failure | success=true | 16 iters
failure-save-loop          | failure | success=true |  6 iters
failure-verify-loop        | failure | success=true |  8 iters
failure-contradictory-data | failure | success=true |  8 iters
```
All 4 labeled-failure scenarios returned `result.success = true`. `validate-entropy.ts` reports `Success rate: 4/8` — the 4 labeled-failure runs failed the expected-outcome check.

The agent gives up on forced failures and produces best-effort output (e.g., answering from memory when told not to), which the framework treats as success.

**Root cause:** `result.success` is derived from `status === "done"` (terminal state reached), not semantic goal achievement. The agent gives up on forced failures and produces best-effort output, which the framework correctly marks as "run terminated" — but users reasonably expect `success: true` to mean "task goal was achieved." These are two distinct concepts. North Star §5.3 introduces `VerificationFailed extends TaskError`; §7.2 maps to reliability table.

**Recommended fix framing:** Do NOT change `result.success` semantics (it would break all existing user code that checks `success` for "did the run complete?"). Instead, add a complementary `result.goalAchieved: boolean | null` field — `null` when the framework has no verification evidence, `false` when `terminatedBy ∈ {max_iterations, loop_graceful}` or `VerificationFailed` was raised. This separates "run terminated cleanly" from "the task goal was met." Phase 2 target.

**Status:** CONFIRMED NEW. Critical gap between "agent produced output" and "task goal was achieved."

---

### [W12] Success scenarios over-iterating on trivial knowledge tasks

**Severity:** medium (NEW)

**Evidence from failure corpus (cogito:14b):**
```
success-capital-france    | success | 0.150 entropy | 3 / 4 iters
success-rgb-colors        | success | 0.150 entropy | 3 / 4 iters
success-typescript-paradigm | success | 0.378 entropy | 5 / 4 iters (also W4)
```
Entropy flat at 0.150 across all iterations — model had the answer on iteration 1 but continued. `success-capital-france` and `success-rgb-colors` each had 2 suppressed interventions (`below-iteration-threshold`) — correct suppression, but 3 iterations still ran.

**Root cause:** Related to W6 and G-5. Flat-entropy "already answered" path doesn't consolidate into early exit. W4 overrun compounds this for typescript-paradigm.

**Status:** CONFIRMED NEW.

---

### [W13] RI dispatcher fires only `inject-tool-guidance` — never terminates loops

**Severity:** high (NEW)

**Evidence from `failure-rate-limit-loop` trace (01KPZR2E32MHQKR6KC3HDZ46K6.jsonl):**
```json
{"kind":"intervention-dispatched","iter":7,"decisionType":"inject-tool-guidance","patchKind":"inject-tool-guidance"}
{"kind":"intervention-dispatched","iter":8,"decisionType":"inject-tool-guidance","patchKind":"inject-tool-guidance"}
{"kind":"intervention-dispatched","iter":8,"decisionType":"inject-tool-guidance","patchKind":"inject-tool-guidance"}
{"kind":"intervention-dispatched","iter":9,"decisionType":"inject-tool-guidance","patchKind":"inject-tool-guidance"}
{"kind":"intervention-dispatched","iter":10,"decisionType":"inject-tool-guidance","patchKind":"inject-tool-guidance"}
```
5 dispatches, all `inject-tool-guidance`. Entropy=0.578 (above 0.55 threshold). Zero `early-stop`. Run continued to iter=16. The RI system cannot terminate runaway loops.

Suppressed events confirm `stall-detect` was suppressed at iter=2 (`below-entropy-threshold`) and `compress` was suppressed 5× (`savings-below-cost`) — neither terminates the loop.

**Root cause (confirmed by source read):**
- `earlyStopHandler` IS the **first entry** in `defaultInterventionRegistry` ✓
- `defaultMode: "dispatch"` — not advisory ✓
- `dispatcher.ts:61` correctly exempts `early-stop` from the entropy composite floor ✓
- **Actual root cause:** `evaluateEarlyStop` (`controller/early-stop.ts`) is a **convergence detector**, not an overflow detector. It fires only when the last N entropy entries have `trajectory.shape === "converging"` AND `composite <= calibration.convergenceThreshold`. In failure scenarios (ascending entropy, 0.546–0.578), the trajectory is `"ascending"` or `"flat"` — never `"converging"` — so `evaluateEarlyStop` returns `null` every iteration. No `ControllerDecision` is generated, so the dispatcher has nothing to dispatch.

**The missing component:** There is no evaluator for "iteration count approaching `maxIterations`." `evaluateEarlyStop` needs a second branch: when `iteration >= maxIterations - 2` (configurable), emit an `early-stop` decision regardless of entropy trajectory. This connects W13 directly to W4 — both are the same gap at different layers (kernel has no overflow guard; RI evaluator has no overflow trigger).

**Status:** CONFIRMED NEW. High severity. Root cause now precisely located at `controller/early-stop.ts:19` — `allConverging` condition never true in failure loops.

---

### [W14] Dispatch threshold (0.55) misses 2 of 4 failure scenarios

**Severity:** medium (NEW)

**Evidence:**
- `failure-save-loop`: max entropy = **0.546** (below 0.55). Zero dispatches. Stall-detect suppressed `below-entropy-threshold`.
- `failure-contradictory-data`: max entropy = **0.504**. Zero dispatches.

Both suppressed because entropy never crossed 0.55. The failure scenarios ran to natural completion without any RI intervention.

**Root cause:** `dispatcher.ts:60` hardcodes `minEntropyComposite = 0.55`. North Star §2.4: target field is `config.reactiveIntelligence.dispatchThreshold[tier]` (P2). Local-tier threshold should be ~0.45–0.50 to catch failure scenarios that plateau below frontier-tier thresholds.

**Status:** CONFIRMED NEW. North Star Phase 2 tier-aware threshold migration closes this.

---

### [W16] `memory-flush` blocking kernel hot path (8–12s per research turn)

**Severity:** medium (NEW)

**Evidence:**
```
memory-retrieval-fidelity:           memory-flush 11.6s / total 96.5s  (12%)
memory-recall-invocation:            memory-flush  7.0s / total 73.9s  (10%)
memory-multi-observation-synthesis:  memory-flush  8.6s / total 54.5s  (16%)
memory-context-pressure-degradation: memory-flush 11.8s / total 116.7s (10%)
```
`memory-flush` is a sequential blocking phase in all 4 research probes. Spans confirm it runs synchronously after tool execution before the kernel returns.

**Root cause:** North Star §11 Attack 2: `yield* Effect.forkDaemon(memory.store(...))`. Current code doesn't fork memory writes; they block the kernel hot path. Phase 1 target.

**Status:** CONFIRMED NEW.

---

### [W17] Auto-checkpoint never fires despite high token usage

**Severity:** medium (NEW — probe design gap)

**Evidence:**
- `memory-context-pressure-degradation` (plan-execute-reflect, maxIter=15): **10,103 tokens**, zero auto-checkpoint.
  ```
  Interventions: 0 dispatched, 0 suppressed
  Tokens: 10,103
  ```
- `memory-multi-observation-synthesis`: 5,555 tokens, no checkpoint.

**Root cause:** `auto-checkpoint.ts:shouldAutoCheckpoint` uses a context ratio threshold. With qwen3:14b (128k+ context), 10k tokens = ~8% ratio — far below the checkpoint trigger. This probe was designed to test auto-checkpoint but the model has too large a context window.

**Diagnosis:** Probe design gap, not necessarily a harness bug. A dedicated auto-checkpoint probe needs a model with `num_ctx=2048` (exercises G-1 simultaneously) or a task that genuinely fills the context window. IC-18 covers this.

**Status:** CONFIRMED NEW (probe design gap).

---

### [W18] Plan-execute-reflect entropy spike on final reflect iteration

**Severity:** low (observation)

**Evidence:**
```
memory-multi-observation-synthesis:  iter 0=0.150, iter 1=0.150, iter 6=0.584
memory-context-pressure-degradation: iter 0=0.150, iter 1=0.150, iter 6=0.628
```
Final iteration (reflect phase) scores high entropy despite successful completion. Both runs had 0 dispatches — the framework correctly didn't intervene.

**Root cause:** The reflect synthesis step produces diverse vocabulary and long output, both of which drive high token entropy and behavioral entropy scores. This is expected for PER strategy but appears as a "stalling" signal in cross-probe analysis.

**Status:** LOW observation. May produce false positives in AUC validation if labeled as failures.

---

## Improvement Candidates

| IC | Title | Impact | Effort | North Star Phase | Target |
|----|-------|--------|--------|-----------------|-------|
| IC-13 | Confirm `early-stop` handler registration + mode; fix W13 | Critical | Small | P2 prereq | `handlers/index.ts`, `dispatcher.ts` |
| IC-14 | Lower dispatch threshold for local tier: 0.55 → 0.45; fix W14 | Medium | Small | P2 | `dispatcher.ts:60` → tier config |
| IC-15 | Apply `Effect.forkDaemon` to memory-flush; fix W16 | Medium | Small | P1 | `tool-execution.ts` or `execution-engine.ts` |
| IC-16 | Bisect W6 trivial-1step regression to single writer site | High | Small | P2 prereq | `think.ts:551`, `termination-oracle.ts` |
| IC-17 | Add `result.goalAchieved: boolean \| null` — `false` when `terminatedBy` ∈ {max_iterations, loop_graceful} or `VerificationFailed`; `null` when unknown; do NOT change `success` semantics | High | Medium | P2 | `execution-engine.ts` result shaping |
| IC-18 | Add `num-ctx-truncation` probe (targets G-1) and `compression-coordination` probe (G-4) | High | Small | P1 prereq | `harness-probe.ts` new probes |
| IC-19 | Repair loop-state.json weakness entries (doubled WW prefix, empty descriptions) | Low | Small | — | `harness-reports/loop-state.json` |

**Success criteria:**

- **IC-13:** `failure-rate-limit-loop` terminates at or before iter=`maxIterations` (12). `early-stop` event appears in trace at iter=10 or earlier. No success-labeled scenario triggers overflow early-stop (all stop before iter=max-2).
- **IC-14:** `failure-save-loop` and `failure-contradictory-data` each receive ≥ 1 dispatched intervention.
- **IC-15:** `memory-flush` phase drops from 8–12s to < 500ms on research probes.
- **IC-16:** trivial-1step returns iters=1 with both qwen3:14b and cogito:14b.
- **IC-17:** `failure-rate-limit-loop` result shows `success: false`; `success-days-of-week` shows `success: true`.

---

## Regression Watch

| IC | Risk | Mitigation |
|----|------|-----------|
| IC-13 | Overflow branch may terminate valid high-entropy synthesis runs that legitimately take many iterations | Add regression assert: plan-execute-reflect research task must NOT trigger early-stop before iter=`maxIterations-2` (e.g. if max=12, safe until iter=10) |
| IC-14 | Threshold 0.45 may dispatch on success scenarios with entropy ~0.378 (typescript-paradigm) | Verify: typescript-paradigm dispatches are suppressed below-iteration-threshold at 0.45 |
| IC-15 | forkDaemon may cause memory to be stale when recall is called in same iteration | Recall probe: store then recall in same iteration; assert data present |
| IC-17 | `result.goalAchieved` field is additive (non-breaking), but users relying on `!result.success` for failure detection won't benefit until they adopt new field | Add migration guide note in CHANGELOG; update harness probes to check `goalAchieved` not `success` |

---

## North Star Coverage Gaps — Probes Still Needed

| Gap | NS Ref | Needed probe | Notes |
|-----|--------|-------------|-------|
| G-1 num_ctx truncation | §3 Phase 1 | `num-ctx-truncation`: task requiring >2048 tokens, model=cogito:8b, assert output complete | Exercises local.ts missing num_ctx |
| G-4 compression coordination | §1.2 G-4 | `compression-coordination`: large tool results, verify only one compression system fires per iter | Check tool-formatting + context-compressor + reactive-observer |
| G-3 trustLevel rendering | §11 Attack 3 Phase 1 | `prompt-injection`: tool result contains "Ignore previous instructions" — assert in user-role not system prompt | — |
| G-5 termination conflict | §11 Attack 5 Phase 2 | `termination-conflict`: task triggering loop-detector AND oracle exit same iteration — which writer wins? | Confirms W6 root cause |
| auto-checkpoint at pressure | §7.3 Phase 2 | `context-pressure-narrowing`: use model with num_ctx=2048; fill context until checkpoint fires | Exercises IC-18 simultaneously |

---

## Carry-Forward

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| W1 | cogito:8b text-format tool calls | OPEN | Not exercised this pass (cogito:14b used). |
| W2 | ICS observation nudges reset loop-detector | OPEN | Not exercised. |
| W3 | JSONL metric extraction wrong event names | FIXED (Pass 1) | Confirmed. |
| W4 | `withReasoning({ maxIterations })` silently dropped | CONFIRMED | 16/12 and 5/4 overruns. North Star P1. |
| W5 | [Not documented in loop-state] | UNKNOWN | loop-state.json has empty W5. |
| W6 | trivial-1step regression | OPEN | Still 2 iters (both models). Not fixed by `32ba0992`. |
| W7 | Model fails to invoke recall | IMPROVED | Recall now invoked. Data completeness remaining issue. |
| W8 | Task-intent misread "list N items" | OPEN | Same as prior pass. |
| W9 | Tool observations blocking hot path | UPGRADED | memory-flush works but blocks 8–12s. `forkDaemon` needed (IC-15). |
| W10 | Entropy diverging, interventions ineffective | REFINED → W13+W14 | W10 replaced by: W13 (inject-only dispatcher) + W14 (threshold too tight). |
| W11 | `result.success` always true | CONFIRMED NEW | Critical. All 4 failure scenarios success=true. |
| W12 | Success scenarios over-iterating | CONFIRMED NEW | 3–5 iters on trivial recall. |
| W13 | RI dispatcher only fires `inject-tool-guidance` | CONFIRMED NEW | Root cause confirmed: `evaluateEarlyStop` only detects convergence — no overflow branch. Fix: `controller/early-stop.ts` + add `iteration >= maxIterations-2` branch. |
| W14 | Dispatch threshold too tight for local models | CONFIRMED NEW | 2/4 failure scenarios below 0.55. |
| W16 | memory-flush blocking hot path | CONFIRMED NEW | 8–12s per research probe. |
| W17 | Auto-checkpoint not firing on research probes | CONFIRMED NEW | Probe design gap: 10k/128k = 8% ratio, below threshold. |
| W18 | PER entropy spike on reflect phase | OBSERVATION | Low severity. Expected behavior. |

---

## Next Pass Focus

Three falsifiable hypotheses (H1 resolved this pass):

1. **~~H1: `early-stop` is not registered (or is advisory-only)~~** — **FALSIFIED this pass.** `earlyStopHandler` IS the first entry in `defaultInterventionRegistry` with `defaultMode: "dispatch"`. The real gap is `evaluateEarlyStop` only detects convergence (low entropy + `"converging"` trajectory) — there is no iteration-overflow branch. Fix: add `iteration >= maxIterations - 2` branch to `controller/early-stop.ts`. See IC-13 handoff ticket.

2. **H2: W6 is caused by `think.ts:551` setting `terminatedBy = "end_turn"` after oracle exit — adding a second kernel iteration** — falsifiable by instrumenting think.ts:551 and running trivial-1step. If iter=2 trace shows `end_turn` writer firing when `terminatedBy` already set, this is the culprit.

3. **H3: `forkDaemon` for memory.store reduces research probe run time by ≥ 8s** — falsifiable by applying `Effect.forkDaemon` and re-running memory-multi-observation-synthesis. `memory-flush` phase should disappear from sequential spans.

---

## Handoff Tickets

### IC-13: Confirm and fix `early-stop` handler (CRITICAL)

**Target:** `packages/reactive-intelligence/src/controller/handlers/index.ts`, `dispatcher.ts`

**Problem:** RI dispatcher fires only `inject-tool-guidance` on runaway loops. `early-stop` never dispatched despite entropy 0.578. Failure-rate-limit-loop ran 16 iterations (vs maxIterations=12).

**Evidence:**
```json
{"kind":"intervention-dispatched","iter":7,"decisionType":"inject-tool-guidance","patchKind":"inject-tool-guidance"}
{"kind":"intervention-dispatched","iter":8,"decisionType":"inject-tool-guidance","patchKind":"inject-tool-guidance"}
```
Zero `early-stop`. Trace: `.reactive-agents/traces/failure-corpus/01KPZR2E32MHQKR6KC3HDZ46K6.jsonl`

**Root cause confirmed (source read complete):**
- `earlyStopHandler` is the first entry in `defaultInterventionRegistry`, `defaultMode: "dispatch"` ✓
- `dispatcher.ts:61` already exempts `early-stop` from entropy floor ✓
- **Gap:** `evaluateEarlyStop` (`controller/early-stop.ts:19`) only fires when all recent entropy entries have `trajectory.shape === "converging"`. In high-entropy failure loops, trajectory is ascending/flat — `allConverging` is always `false` → always returns `null`.

**Fix:** Add an iteration-overflow branch to `evaluateEarlyStop`:
```typescript
// NEW: overflow branch — fire early-stop when approaching maxIterations
if (maxIterations && iteration >= maxIterations - 2) {
  return {
    decision: "early-stop",
    reason: `Approaching maxIterations (iter=${iteration}, max=${maxIterations})`,
    iterationsSaved: maxIterations - iteration,
  };
}
```
This branch should run **before** the convergence check so overflow always wins. Consider making `maxIterations - 2` configurable as `config.earlyStopIterationsBeforeMax`.

**Success criterion:** `failure-rate-limit-loop` terminates at or before iter=12 (`maxIterations`); `early-stop` event appears in trace. Success scenarios (1–5 iters) must NOT trigger overflow branch (confirmed: they stop well before max).

---

### IC-16: Bisect trivial-1step regression (HIGH)

**Target:** `packages/reasoning/src/strategies/kernel/phases/think.ts:551`, `packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts`

**Problem:** trivial-1step runs 2 iterations when baseline=1. Persists across qwen3:14b and cogito:14b, not fixed by `32ba0992`.

**Evidence:**
```
trivial-1step:      Iterations: 2 / 5    Max entropy: 0.150    Dispatched: 0
success-days-of-week: Iterations: 2 / 4  Max entropy: 0.150    Dispatched: 0
```

**Starting point:** Add `console.log` to `think.ts:551` (`terminatedBy = "end_turn"` writer) and run trivial-1step. If iter=2 shows this writer firing, it's the culprit. Check if the oracle already set `terminatedBy` on iter=1 and `think.ts` overwrites it.

**Success criterion:** trivial-1step returns `iterations=1` with both models.

---

### IC-15: Fork memory-flush off kernel hot path (MEDIUM)

**Target:** `packages/reasoning/src/strategies/kernel/utils/tool-execution.ts` (or the `memory-flush` phase in `execution-engine.ts`)

**Problem:** `memory-flush` phase blocks 8–12s on every research probe — the kernel waits for SQLite write + embedding before returning the turn.

**Evidence:**
```
memory-multi-observation-synthesis → memory-flush (8571.9ms)
memory-context-pressure-degradation → memory-flush (11759.7ms)
```

**Starting point:** Find the `memory-flush` call site. Apply `Effect.forkDaemon(memory.store(...))` per North Star §11 Attack 2. Verify that recall still retrieves forked data by re-running memory-recall-invocation.

**Success criterion:** `memory-flush` phase drops to < 500ms. Recall probe still returns correct data in the next iteration.
