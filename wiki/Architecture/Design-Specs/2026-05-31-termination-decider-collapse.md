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
