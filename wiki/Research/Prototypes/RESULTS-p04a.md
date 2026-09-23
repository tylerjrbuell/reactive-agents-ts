---
type: measurement
status: complete
created: 2026-09-23
tags: [research, prototypes, judgment, spike]
---

# RESULTS — p04a: batched fan-out across the 3 run-start judgment shadow sites

**Date:** 2026-09-23
**Spike:** [`p04a-batched-fanout.ts`](./p04a-batched-fanout.ts)
**Outcome:** **NOT-WORTH-IT** — batching gives a ~15% latency edge, not the ~66%+ needed, because the real call sites are already concurrent

## Hypothesis (locked before run)

> Strategy-selection (adaptive.ts), complexity-router (cost package), and
> task-comprehension (kernel comprehend phase) all fire on the same agent run
> in the same run-start window, each independently calling `JudgmentService.ask()`.
> Merging their state + questions into ONE `ask()` call should cut latency
> ~3x vs 3 separate calls, with no answer-quality loss.
>
> PROMOTE: batched latency <= 50% of unbatched summed latency, AND >=90%
> per-question answer agreement (batched vs unbatched).
> KILL: batched latency >= 80% of unbatched, OR agreement < 80%.

## Method

20 synthetic-but-realistic task descriptions spanning the same range as the
2026-09-23 shadow-site-exit-gate report's 31-task set (that report's raw
per-case data was never committed to the repo — confirmed by grep — so this
probe authored its own set in the same spirit, disclosed as synthetic). For
each case: 3 separate real `jev` `ask()` calls (run via `Promise.all`, i.e.
concurrently — the fairest baseline, since production code already fires
these via `Effect.forkDaemon`, not sequentially) vs 1 merged `ask()` call
over a superset state + all 3 sites' `QuestionSpecs` (10 questions total).
Real state/question builders imported verbatim from
`adaptive-judgment-questions.ts` and `judgment-comprehend-questions.ts`;
complexity-router's builder (not exported from `@reactive-agents/cost`'s
public index) was inlined verbatim from `judgment-complexity-questions.ts`.

Per-question agreement used bucketed comparison (Noul -> boolean at 0.5,
Score -> rounded integer, Choice -> exact string) — the same tolerance the
shadow-site production code itself applies (`answerToBoolean`,
`answerToComplexity`), not raw float equality (raw floats never match
bit-for-bit across two separate API calls even with zero real behavior
difference — this was caught and fixed mid-run: a first pass using raw
float `===` reported 49.2% "agreement" purely from float noise, before the
bucketed comparison was substituted).

## Result

```
SUMMARY: unbatched total=4680ms batched total=3973ms ratio=0.849
Per-question agreement: 232/240 (96.7%)
```

- **Latency ratio 0.849** — batching is only ~15% faster, far short of the
  50%-or-better promotion bar. Root cause: the unbatched baseline runs its 3
  calls **concurrently** (matching how production actually fires these
  shadows, via `Effect.forkDaemon`), so there's no serial-call tax to
  eliminate — the batched call's advantage is limited to avoiding 2 extra
  HTTP round-trip setups, not 2 extra sequential waits.
- **Answer agreement 96.7%** (232/240) — clears the quality bar cleanly.
  Batching multiple sites' questions into one request does not measurably
  degrade individual answers.

## What this does and doesn't justify

- **Does not justify building a batched-fan-out mechanism.** The
  latency win (~15%) is real but small, and the production sites already
  get the parallelism benefit for free via `Effect.forkDaemon` — batching
  would trade a modest latency win for real complexity (a new merged-state
  builder spanning 3 packages' shadow-site ownership, a new call site to
  maintain, coupling 3 currently-independent shadow sites together).
- **Confirms the shadow sites' current fire-and-forget-per-site design is
  already close to latency-optimal** for this specific concern. If a future
  measurement finds concurrent forked daemons contending for backend
  rate-limit slots under real production load (not tested here — this probe
  ran serially per case, not under concurrent-run load), that would be a
  different, separate finding worth its own spike.
- The 96.7% agreement result is a useful side-finding: it says jev's answers
  are robust to being asked alongside other questions in the same request,
  which is reassuring for any future batching decision unrelated to this
  specific latency question (e.g. batching for cost/request-count reasons).

## Limitations

- n=20, single measurement session, authored by the same person writing this
  report (same caveat the 2026-09-23 report itself notes for its own cases).
- Latency numbers reflect one machine/network path on one day; TypeSafe API
  latency variance was not characterized (no repeated-run variance study).
- Did not test batching under concurrent multi-run production load, where
  forked-daemon contention (connection pool limits, rate limits) could shift
  the calculus in batching's favor — flagged as a real gap, not dismissed.

## Verdict

**NOT-WORTH-IT.** The batching mechanism doesn't clear its own promotion
bar; the concurrency the production code already has via `forkDaemon`
captures most of the available win.
