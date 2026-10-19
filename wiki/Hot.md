---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-10-17
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## 2026-10-17 — #240 classifier-skip gate (execute-backlog singleton bundle)

Executed `execute-backlog` on open issue #240 (area:reasoning, p3 chore). Grounded the premise
on `origin/main`: `adaptive.ts:219` and `decompose.ts:118` each call
`gatewayComplete({purpose:"classify"})` ungated; the `shouldSkipClassifierEvaluation` gate
primitive did NOT exist on this base (it lives only on `dev`, which is 174 commits ahead).
Created the shared primitive (`CLASSIFIER_SKIP_RELIABILITIES = ["low","skip"]` +
`shouldSkipClassifierEvaluation`) in `strategy-evaluator.ts` and gated both named sites.
Behavior for trusted/absent reliability unchanged.

Commit `71a5d4f1` on branch `bundle/reasoning-classifier-skip-gate` (off origin/main).
- reasoning suite: 2945 pass / 0 fail; typecheck green; cast ceiling green (0 new `as unknown as`)
- Tests: new `shouldSkipClassifierEvaluation` predicate cases; `shouldDecompose` classifierReliability
  cases; `adaptive-classifier-skip.test.ts` (low skips the LLM call with no classify response
  provided; high still consults the LLM)
- Not on this base: strategy-evaluator.ts's OWN classify call (line 165) remains ungated — a
  disclosed follow-up (already done on dev; needs calibration threaded from iterate-pass).
- Plan: wiki/Planning/Implementation-Plans/2026-10-17-reasoning-classifier-skip-gate.md

---

## 2026-10-15 — W567 live verdict captured (W5 PASS / W6 PASS / W7 PASS+gap)

Second true-0 capture (`fixtures/post-w567/`, 11 live + 5 spots, scoreboard
POST-W567 section): W5 honesty 0/11 fabricated (S1 3/3 abstain, S2 3/3 '3052',
terminate 3/3 abstain; S3 r2 under-claim filed — correct report.md on disk but
final-answer success=false on stale read tallies — safe direction, N=2, no
regression claimed); W6 spots 3/3 (gateway 0 exec, guardrail clean, timeoutAfter
386 ms); W7 tier1 checks present, shadow 0 events live (structural — site behind
unwired InteractionService; suites 8/8 green; non-gating). No-regression vs
post-w4-fixed HOLDS. Spot runner `scripts/lift/w567-spots.ts`. Report:
`.superpowers/sdd/.../w567-verdict-report.md`.

---
