---
title: Termination-Decider Collapse — map + design (first refactor cluster)
date: 2026-05-31
status: design (read-only map done; collapse not yet built)
branch: overhaul/agentic-core-2026-05-31
feedback-loop: "@reactive-agents/trace compareCohorts gates the collapse (honesty-gated). Baseline cohort on current code required before any edit."
---

# Termination-Decider Collapse

First cluster of the thick-mesh refactor. The map below is read-only fact; the
collapse is gated on a baseline cohort + comparator verdict (not yet run).

## The map — every termination DECISION site
`terminate.ts` is the single *writer* of `status=done/failed` (+ arbitrator's own
`transitionState`), enforced by `scripts/check-termination-paths.sh`. But the
*decision to terminate* is made at ~10 scattered sites. That split — one writer,
ten deciders — is the redundancy.

| # | Site | Reason code | Confidence (intended) | Nature |
|---|------|-------------|----------------------|--------|
| 1 | think/act/arbitrator — model final-answer | `final_answer`, `final_answer_tool`, `end_turn`, `llm_end_turn`, `final_answer_regex`, `content_stable`, `entropy_converged` | high | LEGITIMATE (model/oracle decides) |
| 2 | `iterate-pass.ts:471` low-delta guard | `low_delta_guard` | low/med | heuristic give-up |
| 3 | `iterate-pass.ts:519` dispatcher early-stop → arbitrator | `dispatcher_early_stop` | varies | reactive controller (ALREADY via arbitrator) |
| 4 | `iterate-pass.ts:576` strategy-switch exhausted | `switching_exhausted` | med | heuristic give-up |
| 5 | `stall-deliverable.ts:124,246` | `harness_deliverable`, `harness_synthesis` | med | harness assembles + delivers |
| 6 | `iterate-pass.ts:705` oracle hard gate | `oracle_forced` | med | pulse readyToAnswer 2-stage |
| 7 | `loop-resolution.ts:142,170,198` | `loop_graceful`, `loop_detected:*` | med | loop-detector recovery/deliver/fail |
| 8 | `iterate-pass.ts` in-loop + `runner.ts` post-loop required-tools | `failed` (missing_required_tool) | high | hard gate |
| 9 | arbitrator BudgetSignal | `budget_exceeded` | high | hard gate |
| 10 | while-loop cap + post-loop | `max_iterations` | n/a | exhaustion |
| + | killswitch hooks (bootstrap/before-think) | killswitch | high | external abort |
| + | `runner.ts §9.0` verifier gate | `failed` (verifier reject) | high | post-loop output gate |

## The overlap (the disease)
Sites 2,4,5,6,7 are all the SAME judgment — "the model is stuck or done-ish, the
harness should stop/deliver" — implemented as five independent heuristics that fire
in fixed call-order in `iterate-pass.ts`, each imperatively calling `terminate()`.
They race: whichever's condition trips first in the call sequence wins, regardless
of which has the strongest evidence. There is no shared precedence over evidence
strength. (The intervention-analyzer's overlap-storm metric will quantify how often
≥2 of these trip the same iteration — pending the per-site guard emits, folded into
this collapse.)

## The collapse — converge onto the arbiter that ALREADY exists
`decide/arbitrator.ts` is already a `TerminationSignalEvaluator[]` chain with a
resolver that aggregates verdicts by `{action: continue|exit|fail|redirect,
confidence: high|medium|low}`, short-circuits high-confidence verdicts, and ranks
`fail` over `exit` at equal confidence. This IS the "one ordered arbiter with
explicit precedence." Sites 2,4,5,6,7 bypass it and decide imperatively.

**Design:** convert each of sites 2,4,5,6,7 from an imperative `terminate()` call
into a `TerminationSignalEvaluator` returning a `SignalVerdict`, registered in the
arbitrator chain. The resolver then makes ONE decision per iteration with one
precedence policy. Net effect:
- One decision point (the resolver), not five racing call-sites.
- Evidence-ranked precedence (confidence bands) instead of call-order.
- Sites 1,3 already flow through the oracle/arbitrator — they stay.
- Sites 8,9 (required-tools, budget) are hard gates — keep as high-confidence
  `fail` evaluators (or pre-resolver guards); do not weaken.
- `terminate()` stays the single writer; the arbitrator stays the single decider.

This is convergence onto an existing mechanism, NOT a new build — the lowest-risk
possible collapse.

## Confidence assignment (the precedence policy to make explicit)
- `fail` high: required-tools-missing, budget-exceeded, killswitch, verifier-reject.
- `exit` high: model final-answer / oracle readyToAnswer-confirmed.
- `exit` medium: stall-with-deliverable, loop-graceful-with-deliverable.
- `exit` low: low-delta, switching-exhausted (weakest give-ups — should lose to any
  medium+ signal, and should NOT fire if a deliverable is still being produced).
The current race has no such ordering; low-delta can pre-empt a stall-deliverable
that would have shipped real artifacts. Making this explicit is the capability win.

## Risk / what the comparator must catch
- A collapse that ships FEWER faithful deliverables (deliverable-produced ↓) or more
  prose-lies (dishonest-suspected ↑) is a REGRESSION even if tokens drop — the
  comparator's honesty gate enforces this.
- Plan-execute/ToT sub-kernels invoke the same loop — verify the evaluator chain
  behaves under those outer loops (cohort must include a plan-heavy task).
- `loop_detected:*` templated reasons + strategy-switch interaction (switch happens
  BEFORE loop-resolution today) — preserve: switch-if-enabled THEN evaluate-to-stop.

## Execution sequence (gated)
1. **Baseline cohort** on current code — failure-mode tasks, cross-tier (frontier/mid/
   local), N≥3, traces grouped by `taskId`. Lock thick-baseline CohortStats.
2. **Instrument** sites 2,4,5,6,7 with `emitGuardFired` (kernel-warden, emit-only) —
   folded into this collapse, gives real overlap-storm numbers on the baseline.
3. **Collapse** sites 2,4,5,6,7 → arbitrator evaluators (kernel-warden).
4. **Re-run cohort** → `compareCohorts(baseline, collapsed)`.
5. Merge ONLY if verdict = "B improves" or "B neutral" (honesty held); revert on
   "B regresses"; wire the blind signal if "inconclusive (blind)".

---

## ⚠ BASELINE-SMOKE FINDING (2026-05-31) — re-aim the first cluster
Step 2 instrumentation landed (7 emit-only guards at sites 2,5,6,7 via kernel-warden,
build+1557 tests green). Then **3 baseline smokes** (qwen3:4b ×2, qwen3.5 ×1, reactive,
across stuck/overflow tasks) before spending the full grid. Result: **ZERO of sites
2,5,6,7 fired in any run.** The traces show why — and it relocates the refactor.

### What actually terminates runs (the hot path)
All 3 runs ended at **iter 2–3** via the **reactive-observer's `stall-detect`
intervention** (`decisionType: stall-detect`, "Entropy flat at ≤0.2 for 2 consecutive
iterations — model appears stuck") → **dispatcher-early-stop** (`iterate-pass.ts` L525-542)
→ arbitrator. Terminal reasons observed: `final_answer` (site 1),
`controller_signal_veto` + `controller_early_stop:dispatcher_early_stop` (site 3, the
arbitrator — ALREADY the collapse target), `max_iterations` (site 10).

### Why sites 5,6,7 are masked (not cold)
`iterate-pass.ts` call order is decisive:
- L469 `shouldExitOnLowDelta` (site 2) — runs first, but **accumulation-starved**:
  needs 2 consecutive sub-threshold deltas; runs resolve before it accumulates.
- L517 `runReactiveObserver` → L525 `dispatcher-early-stop` → **L542 `return "break"`**.
- L647 `runStallDeliverableStep` (5), L707 `shouldForceOracleExit` (6), L850
  `resolveDetectedLoop` (7) — **all sit AFTER L542's break**. When the dispatcher
  early-stops (the common case), they are **never reached**. Masked, not cold.

So the premise "5 deciders race + bypass the arbitrator" is **refuted in practice**:
the arbitrator (via dispatcher-early-stop) wins by firing first/early at iter 2. It is
already the de facto single decider. The give-up guards only get a turn on runs that
survive past iter 2 without an early-stop — which these tasks/tiers don't produce.

### The real failure modes (on the HOT path)
1. **Premature early-stop:** `stall-detect` fired at iter 2 on the overflow task with
   **17k tokens of genuine work** in hand — "model appears stuck" after 2 flat-entropy
   iters is too trigger-happy; it gives up on productive runs.
2. **Incoherent terminal state:** the overflow early-stop produced
   `success:false` + `goalAchieved:true` + `outputLen:0` + `error:"Reasoning failed"`
   + `terminatedBy:final_answer` simultaneously — finalization downstream of the
   early-stop emits garbage (M7 status/output coherence territory).
3. **`terminatedBy` provenance disagreement:** `analyzeRun` reads
   `lastSnapshot.terminatedBy` (raw internal, e.g. `controller_signal_veto`);
   `result.terminatedBy` reports the post-loop mapped value (e.g. `max_iterations`).
   Two subsystems disagree on *why* a run ended. Comparator is internally consistent
   (keys on snapshot) but this is a real coherence smell.
4. **Fabrication-honesty:** qwen3.5 on the stuck task (nonexistent file) **fabricated**
   a summary and claimed `success:true` / `final_answer_tool` — the dishonest-success
   the trace honesty-check was built to catch.

### Recommendation — re-aim cluster 1
From "collapse the 5 give-up guards" → **"the dispatcher-early-stop / `stall-detect`
path + finalization coherence."** That is the hot path (where termination actually
happens) AND where the live failure modes are. The 7 emit-only guards stay (behavior-
neutral; they fire when those paths trigger; `terminal_decision` already instruments
the hot path). Sites 5,6,7 collapse becomes downstream cleanup once the dispatcher is
the explicit single decider. **Genuine scope change — pending user confirm.**

### Evidence (trace runIds)
- `01KSZJMT8GMJ1YW8G0TANDN6PW` — qwen3.5 stuck → fabricated success (honesty fail).
- `01KSZJRR2DNTP859CF66AHX8DK` — qwen3:4b stuck → controller_signal_veto / result says max_iterations (provenance).
- `01KSZJTSPJG4MXA636ZATXSGDD` — qwen3:4b overflow → dispatcher-early-stop iter 2 → incoherent terminal state.

---

## ROOT-CAUSE INVESTIGATION (2026-05-31) — cluster-1 target, defined
Read-only dive into the hot path. Source lives in **`packages/reactive-intelligence/`**
(RI controller), NOT the reasoning kernel — the flow is: RI evaluators →
`controller-service.ts` → kernel `reactive-observer.ts` builds `ControllerEvalParams`
+ consumes patches → `dispatcher-early-stop`. Three concrete defects, ranked by leverage.

### DEFECT 1 — stall-detect tier-gating is DEAD (root cause of iter-2 give-up)
`reactive-intelligence/src/controller/evaluators/stall-detect.ts:28`:
```ts
const tier = "local"; // conservative default — actual tier not in params yet
const window = STALL_WINDOW_BY_TIER[tier] ?? 3;
```
`tier` is **hardcoded "local"** → `window` is **always 2** → stall-detect fires after 2
flat-entropy iters on EVERY tier. The `STALL_WINDOW_BY_TIER` table (local:2, mid:3,
large:4, frontier:5) is **dead scaffold** — never reached. Confirmed: `ControllerEvalParams`
(`types.ts:229`) carries no `tier`/`modelTier`; the kernel builder
(`reactive-observer.ts:222-238`) passes `maxIterations`/`hasUserOutput` but NOT tier.
**Effect:** premature give-up at iter 2 on mid/large/frontier (should be 3/4/5).
**Fix (cross-package):** add `tier` to `ControllerEvalParams` (RI, direct edit) + populate
from `profile.tier` in `reactive-observer.ts` (kernel → kernel-warden) + read it in
stall-detect. Clean, testable, high-confidence. Directly explains the observed iter-2 stop.

### DEFECT 2 — low-flat entropy ≠ "stuck" (false-positive give-up)
`stall-detect.ts:35` treats `composite ≤ 0.20` as stuck. But low/flat entropy also means
**converged/confident** — a productively-progressing run (steady read→write) has low flat
entropy. The overflow run had **17k tokens of genuine work** and was flagged "stuck."
The doc comment (lines 12-17) claims the intent includes "no new tool calls," but the code
checks only entropy + `consecutiveToolFailures` — the **progress/tool-call guard described
is not implemented** (second dead intent). Fix: gate stall-detect on an actual
no-progress signal (no new tool calls / token-delta flat / no artifact growth), not just
low entropy.

### DEFECT 3 — empty-output early-stop slips the FM-A3 backstop (incoherent terminal state)
`early-stop.ts` has `suppressForEmptyOutput` (the FM-A3 backstop), but it's bypassed when
`atLastIteration` (`iteration >= maxIterations-1`) — and `hasUserOutput`
(`reactive-observer.ts:238`, checks `s.output` non-empty) **diverges from the finalizer's
user-visible-output notion**: a non-user-visible thought counts as "output," early-stop
exits `done`, the finalizer then nulls it (output-boundary discipline) → the observed
`success:false` + `goalAchieved:true` + `outputLen:0` + `error:"Reasoning failed"`. Also the
`terminatedBy` provenance split (snapshot=`controller_signal_veto` vs result=`max_iterations`).
Fix: align the backstop's "has output" notion with the finalizer's, and reconcile the
terminatedBy provenance (single source).

### ⚠ DISCRIMINATING-CHECK FINDING (2026-05-31, post-DEFECT-1) — D2 mis-targeted, do D3 first
Before building D2 (a stall-detect progress signal), ran the terminator+behavioral check
on the false-positive traces (advisor-mandated). Result relocates the work again:

| Trace | Terminating evaluator | `behavioralLoopScore` | Reality |
|---|---|---|---|
| `01KSZJTSPJG4` (overflow "false-pos") | **`evaluateEarlyStop`** (`controller_early_stop:dispatcher_early_stop`) | 0.5→0.33 | empty output → `"Reasoning failed"` = **DEFECT 3**, not a stall |
| `01KSZJRR` (qwen3:4b stuck) | arbitrator repeated-stall (`controller_signal_veto`) | 0.5→0.33 | model genuinely stuck (retrying nonexistent file) — NOT a clean false-pos |
| `01KSZNHX` (haiku, post-D1) | `low_delta_guard` → `harness_synthesis` | 0.5 | clean |

- **stall-detect never TERMINATED a run** in any trace — it only dispatched a nudge. The
  overflow harm (the incoherent empty-output terminal state) was caused by **`evaluateEarlyStop`**,
  which is exactly DEFECT 3. Fixing a stall-detect progress signal would NOT move the
  overflow case (early-stop still terminates it).
- **`behavioralLoopScore` is non-discriminating** — clusters 0.33–0.5 across progressing,
  genuinely-stuck, AND clean runs. No clean one-line reuse exists (advisor option (a) dead by data).
- **Verdict:** D2 (stall-detect semantic) is real-but-MINOR (a wasted nudge; zero termination
  harm observed). **DEFECT 3 (early-stop empty-output coherence) is the evidenced failure → do it
  next.** D2 deferred (fold a progress gate into stall-detect later if the cohort shows nudge-loop
  cost). Third evidence-driven relocation this cluster — the observability is doing its job.

### Cluster-1 plan (re-aimed, evidence-backed)
1. **DEFECT 1 first** — dead tier-gating. Highest leverage, cleanest fix, directly causes
   the premature iter-2 give-up. TDD: RED test asserting mid-tier needs window=3.
   Cross-package (RI direct + reactive-observer via kernel-warden).
2. **DEFECT 2** — add a real no-progress signal to stall-detect (kill the false positive
   on converged-but-working runs).
3. **DEFECT 3** — finalization coherence + terminatedBy provenance.
4. **Baseline cohort** then runs against the re-aimed target with the 7 emits + the
   `terminal_decision` instrumentation already capturing the hot path; comparator gates
   each fix (honesty held, fewer premature give-ups, coherent terminal state).
