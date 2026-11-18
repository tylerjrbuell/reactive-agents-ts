---
type: harness-report
status: complete
created: 2026-11-18
tags: [measurement-overhaul, attribution, rax-diagnose]
---

# Attribution before/after (measurement overhaul 0.5)

`rax-diagnose attribute --all <dir>` on the saved v0.19 H3 traces (`packages/benchmarks/benchmark-traces/`), before and after three changes in `packages/trace`:

1. `harness:false-veto` now precedes `model:fabrication-vetoed` (a grader pass is ground truth).
2. `harness:forcing-unused` fires only when `run-started.config.mechanisms.actOrAnswer` is `true` or `"proactive"` (`leverAvailable`). The lever is opt-in (ledger 2026-11-07); off or unrecorded keeps the model label.
3. New `harness:honest-decline-mislabeled`: failed run, no abstention, every real tool call failed, final text an honest decline. Not an `environment:tool-failure`.

| corpus | reason | before | after |
|---|---|---|---|
| final-qwen3-4b (60 runs, 18 failed) | model:fabrication-vetoed | 2 | 0 |
| | harness:false-veto | 0 | 2 |
| | verdict harness / model | 0 / 13 | 2 / 11 |
| final-cogito-8b (60 runs, 33 failed) | harness:forcing-unused | 6 | 0 |
| | model:ignored-guidance | 0 | 5 |
| | model:evidence-not-gathered | 3 | 4 |
| | model:fabrication-vetoed | 4 | 3 |
| | harness:false-veto | 0 | 1 |
| | verdict harness / model | 8 / 23 | 3 / 28 |
| rerun-cogito-8b (60 runs, 31 failed) | harness:forcing-unused | 5 | 0 |
| | model:ignored-guidance | 0 | 5 |
| | model:fabrication-vetoed | 7 | 4 |
| | harness:false-veto | 0 | 3 |
| | verdict harness / model | 8 / 21 | 6 / 23 |

The three `harness:false-veto` cells on the final run are the ones audit 03 named (qwen rw-6 runs 0 and 1, cogito rw-6 run 1: `eval-graded passed=true`, verifier vetoed "125ms"). The six cogito `forcing-unused` cells (rw-6 x2, rw-7 x4) now read as model reasons: the lever was off in those runs.

`harness:honest-decline-mislabeled` fires on 0 saved cells: the gemma ab-trap-5 `dispatcher-early-stop` traces are not on disk, and every ab-trap-5 trace that is on disk ended `terminatedBy=abstained` (read `not-failed`). It is pinned by synthetic traces in `packages/trace/tests/attribution-honest-decline.test.ts`.

No "before" was captured for the rerun-qwen3-4b corpus; after: 69 runs, 28 failed, `harness:false-veto` 3, `model:fabrication-vetoed` 3.
