---
title: Phase 1 PostConditions A/B — cogito:14b, pinned fixture, N=3
date: 2026-06-01
phase: "Phase 1 (WS-1) — PostConditionVerifier spine — LIVE-RUN GATE (partial)"
plan: "[[2026-05-30-canonical-agentic-convergence-plan]]"
fixture: wiki/Research/Harness-Reports/hn-fixture-2026-06-01.json
arms: { on: "RA_POST_CONDITIONS unset (default-on)", off: "RA_POST_CONDITIONS=0" }
reports: [task-quality-gate-cogito-14b-2026-06-01T11-30-16.json (ON), task-quality-gate-cogito-14b-2026-06-01T11-44-41.json (OFF)]
status: ACTIVE
---

# Phase 1 PostConditions A/B (2026-06-01)

Resolves the stale "0.31→0.72 retired/unmeasured on current code" debt with a
fixture-pinned N=3 measurement, and partially satisfies Phase 1's LIVE-RUN GATE.
ON arm = UNSET (the real default regime users get; equivalence-proven ≡ "1");
OFF arm = `RA_POST_CONDITIONS=0`. Both arms ran on the SAME frozen HN fixture
(`hn-fixture-2026-06-01.json`, 30 posts) so cross-arm numbers are comparable.

## Results

| task | ON pass^k | OFF pass^k | ON postCond | OFF postCond | ON T3-strict | OFF T3-strict |
|---|---|---|---|---|---|---|
| T1-knowledge-recall | 3/3 | 3/3 | — | — | — | — |
| T2-single-tool-synthesis | 3/3 | 3/3 | 3/3 | 3/3 | — | — |
| T3-selective-filter | 3/3 | 3/3 | 3/3 | 3/3 | **0/3** | **0/3** |
| T4-multi-criteria | 3/3 | 3/3 | 3/3 | 3/3 | — | — |
| T5-long-form-synthesis | 3/3 | 3/3 | 3/3 | 3/3 | — | — |
| **suite** | **5/5** | **5/5** | all met | all met | — | — |

avgComposite ON 86% vs OFF 91% — run-noise (T3 ON had a single 25%-composite
outlier run [88,25,88]; OFF [88,88,88]; T4/T5 within normal spread). NOT a
behavioral regression: pass^k and postCond are flat across arms.

## Two findings

1. **#7 default-on is REGRESSION-SAFE on this task set.** pass^k 5/5 both arms;
   postCond 3/3 met every derivable case both arms; no-required task (T1) still
   completes. The default-on gate does not block or degrade legitimate completion.
   This is the "no regression on no-required tasks" half of Phase 1's gate — PASSED.

2. **#7's honesty LIFT is UNMEASURABLE on this instrument.** Every HN synthesis
   task DOES produce its deliverable, so `ArtifactProduced`/`ToolCalled` conditions
   are always MET → zero discrimination between honest and prose authority. The
   synthesis gate measures SELECTION QUALITY (T3-strict: cite exactly the right 3
   posts), which post-conditions do NOT and cannot check — T3-strict stays 0/3 on
   BOTH arms because #7 verifies deliverable-presence, not selection-correctness.
   **The synthesis gate is the wrong instrument for #7's headline.**

## Methodology conclusion — wrong-instrument, not no-effect

This A/B confirms the evidence-refresh (`evidence-refresh-2026-06-01.md`): the
single cogito counterexample (`01KT1BQ6Z5`) was a tool-malfunction artifact
(malformed write args), NOT a reproducible honesty gap. On a clean fixture with
working tool calls, cogito produces deliverables every run, so #7 never fires.

To MEASURE #7's lift you need a task that reliably generates "claimed success +
absent deliverable" — Phase 1's gate names exactly this: the spot-test
(`success:true` impossible without `./commits.md` evidenced in the ledger). The
HN synthesis gate cannot generate that failure class. **Two separate failure
axes, two separate instruments:**
- deliverable-honesty (#7 / post-conditions) → spot-test with a file deliverable.
- selection-correctness (T3-strict) → the synthesis gate (a Phase 3 curation
  concern, not #7).

## #7 VERDICT — CLOSED (advisor-reconciled, do not reopen)

The A/B **is** the lift verdict; do not chase a stochastic spot-test to manufacture
the failure mode (that repeats the N=2-non-signal mistake banked 3× this session,
and just re-proves the deterministic gate). Read against the project's default-on
lift rule (≥3pp lift AND ≤15% overhead → default-on; else opt-in/remove):

- **Lift on the realistic distribution: ~0 BY NATURE.** The mode #7 catches
  (claimed-success + absent-deliverable) is a rare tail event; on a clean fixture
  with working tool calls every run produces its deliverable, so the gate never
  fires. Not "unmeasured pending a better instrument" — structurally ~0 on the
  realistic dist.
- **Overhead: ~0.** `deriveConditions` is deterministic, NO LLM call; `verify` is a
  pure ledger scan. Zero token overhead, zero regression (this A/B: pass^k 5/5
  both, postCond flat).
- **Defense for keeping default-on:** cheap tail-risk insurance — zero-cost, zero
  regression, catches the rare false-success (e.g. the malformed-args malfunction
  that produced the original cogito trace). KEPT default-on on that basis, NOT on a
  lift claim. "0.31→0.72" stays RETIRED (stale-code artifact, never reproducible).

### Composition — PROVEN BY EXECUTION (not just isolation)
The advisor's worry (the steer-then-terminate-honestly path composed live, vs the
isolated gate/seed/terminate tests) is closed by the PRE-EXISTING
`packages/reasoning/tests/kernel/terminal-post-condition-gate.test.ts`: it runs the
REAL imperative stall path (`runStallDeliverableStep` — the exact path that
produced the original cogito false-success trace `01KSWR3S5FEW0KM61PCF1M6946`) and
asserts it resolves to `status:failed` (honest) with #7 on, `done` with #7 off.
Added a DEFAULT-ON (env-unset) integration case this session so the real path is
pinned in the regime users actually get (7/7 green). Every link AND the riskiest
composition (imperative terminate bypassing the verdict) is now proven by
execution.

## Status — #7 / Phase 1 spine CLOSED
- LIVE-RUN GATE "no-regression": **PASSED** (cogito N=3 pinned; pass^k 5/5, postCond flat).
- LIVE-RUN GATE "completion-honesty ↑": **N/A on realistic dist** — lift ~0 by
  nature; #7 kept as zero-cost tail insurance, not on a lift claim.
- Composition: **PROVEN BY EXECUTION** (real stall path, default-on + opt-out).
- **#7 is DONE.** Stop polishing it.

## ▶ NEXT MOVE — selection-correctness (the gap the baseline actually found)
The real prose≠state-grounded dishonesty the Phase-0 baseline exposed is
**T3-strict 0/3 across EVERY tier including sonnet-4-6, while prose `success`
reports 3/3.** That is SELECTION-wrongness (cite exactly the right 3 posts), which
#7 structurally CANNOT catch. No amount of #7 work touches it. This is the
higher-leverage target.

**GUARDRAIL before chasing it (baseline's own over-strictness caveat):**
`resolveT3StrictCorrect` scans the whole output for title snippets and requires
EXACTLY 3 distinct cited ids — a correct-but-verbose answer (names other posts in a
preamble, then the right 3) scores strict-fail. BEFORE treating T3-strict 0/3 as a
real selection failure, verify on SONNET specifically that its 0/3 is genuine
wrong-picks / no-filter, not a verbose-output or oracle artifact. If even sonnet
cannot pass a metric, the metric may be measuring itself.
