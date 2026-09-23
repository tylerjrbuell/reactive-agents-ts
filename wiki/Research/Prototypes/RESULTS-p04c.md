---
type: measurement
status: complete
created: 2026-09-23
tags: [research, prototypes, judgment, spike]
---

# RESULTS — p04c: hierarchical (2-stage) vs single-shot strategy-selection Choice

**Date:** 2026-09-23
**Spike:** [`p04c-hierarchical-router.ts`](./p04c-hierarchical-router.ts)
**Outcome:** **NOT-WORTH-IT** — agreement borderline-clears its bar but latency clearly regresses with no compensating benefit

## Scope correction (made before running, not after seeing results)

The MissionBrief asked for "8-way Choice (strategy-selection / complexity-
router)". Reading the actual code first: strategy-selection
(`adaptive-judgment-questions.ts`) is a **5-way** Choice
(reactive/reflexion/plan-execute-reflect/tree-of-thought/blueprint), and
complexity-router is a 3-way Choice (haiku/sonnet/opus) that doesn't
decompose further into a meaningful coarse/fine split. This probe tests the
5-way strategy-selection Choice, the site where a coarse-then-fine split
actually makes structural sense.

Also: the 2026-09-23 shadow-site-exit-gate report's 31 real cases for this
site were not committed as raw data to the repo (its Method section says
"scoring script not committed"; confirmed no case file exists via grep).
This probe reuses the same 20-case synthetic set authored for p04a/p04b
rather than the unavailable original cases — disclosed here, not silently
substituted for "the same cases."

## Hypothesis (locked before run)

> A 2-stage coarse-then-fine Choice (Stage 1: 3-way group Choice over
> "direct"/"iterative-loop"/"exploratory"; Stage 2: fine Choice within the
> chosen group, only fired when the group has >1 member) should match the
> single-shot 5-way Choice's pick closely, while being cheaper/faster since
> each individual call is smaller.
>
> PROMOTE: final-pick agreement with 1-stage >= 85%, AND either latency or
> token count improves >=20%.
> KILL: agreement < 70%, or 2-stage costs MORE latency with no compensating
> benefit.

## Method

Same 20 tasks as p04a. Groups derived from `STRATEGY_CRITERIA`'s own intent
text: `direct` = {reactive}, `iterative-loop` = {reflexion,
plan-execute-reflect}, `exploratory` = {tree-of-thought, blueprint}. Stage 1
always fires (1 call); Stage 2 fires only when the Stage-1 group has >1
member (11/20 cases here). Both conditions used the real
`buildAdaptiveJudgmentState`/`answerToStrategy` production helpers.

## Result

```
SUMMARY (n=20):
  agreement: 17/20 (85.0%)
  latency: 1-stage total=3967ms  2-stage total=5135ms  ratio=1.294
  avg 2-stage call count: 1.35
```

Agreement lands exactly at the 85% promotion threshold — a marginal pass on
that criterion alone. But latency is **29% WORSE** for 2-stage (ratio 1.294),
not the required 20%+ improvement — the second criterion fails outright.
The 3 disagreements were all cases where the 5-way single-shot call picked a
more specific/exploratory strategy (`plan-execute-reflect`, `blueprint`,
`tree-of-thought`) than the coarse Stage-1 grouping led to (`reactive`,
`reactive`, `reactive`) — i.e. **collapsing to 3 coarse buckets loses signal
the 5-way Choice was using directly**, not just adding latency.

## What this does and doesn't justify

- **Does not justify building a hierarchical router.** It fails its own
  combined bar: agreement is marginal (exactly at threshold, not comfortably
  above it) and the cost side is negative, not positive — 2 sequential real
  API round trips (even smaller ones) cost more wall-clock than 1 larger
  one, the same lesson p04a's concurrency finding points at from a different
  angle: splitting a judgment call into multiple sequential real network
  round trips is a latency tax, not a latency win, unless the split calls
  can run concurrently (which a genuinely hierarchical/dependent decision,
  by definition, cannot — Stage 2 needs Stage 1's answer).
- **A secondary finding worth flagging separately:** all 3 disagreements
  moved in the same direction (coarse grouping under-selected exploratory
  strategies vs the direct 5-way call) — an echo of the 2026-09-23 report's
  own finding that jev's strategy-selection disagreements with the *regex*
  heuristic were also directionally consistent (always toward more
  exploratory strategies). This probe's disagreement is a different
  comparison (2-stage-jev vs 1-stage-jev, not jev vs heuristic) but the
  same directional-collapse pattern recurring is a mild signal that coarse
  grouping schemes in general lose the "should this be more exploratory"
  signal, independent of which baseline they're compared to.

## Limitations

- n=20, single session, one specific 3-group split design (a different
  grouping scheme was not tested and could plausibly do better or worse).
- Latency figures are single-run wall-clock on one network path, not a
  variance study.

## Verdict

**NOT-WORTH-IT.** Fails its own latency/cost criterion cleanly; agreement
passes only marginally. The core mechanism problem — a genuinely dependent
2-stage decision can't be parallelized, so splitting one API call into two
sequential ones is a pure latency cost — makes this an unfavorable trade
regardless of case-set specifics.
