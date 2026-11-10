---
type: ablation
status: complete
created: 2026-11-09
tags: [ablation, lift-gate, write-coverage, progress-aware-exit, exit-gate, lh-debug-green, rw-7, workstream-h, opt-in]
---

# Ablation: `writeCoverage` (+ progress-aware soft exit), 3 local tiers. Verdict OPT-IN

Follows [[../../Harness-Reports/2026-11-07-feedback-loop-spike]]: in failed code-task runs 58 % (`lh-debug-green`) and 32 % (`rw-7`) of the edit targets were never written, and runs ended at iteration ~5 of 24.

**Arms.** `base` = `RA_ACT_OR_ANSWER=auto`. `wc` = the same plus `RA_WRITE_COVERAGE=1`. Tiers: cogito:8b, qwen3:14b, qwen3:4b. Tasks: `rw-7`, `lh-debug-green`. k = 5, 300 s cells.
**SHA.** `wc` at `59001bcd0`. `base` ran at its parent `33885cb2d`. The only difference is flag-gated (off = identical), so the gate input was normalised to one SHA. Predictions were written before the first cell (`PREDICTIONS.md`).
**Ledger.** Two entries (2-tier and 3-tier). Use the 3-tier one.

## Verdict

```
  cogito:8b   26.7  33.3   +6.7pp  +171.6%  BELOW
  qwen3:14b   58.3  93.1  +34.7pp  +185.0%  INCONCLUSIVE   (2 of 5 wc lh cells hit the 300 s cap)
  qwen3:4b    38.3  58.3  +20.0pp    +6.1%  BELOW
  AGGREGATE  +13.3pp · 88.9% billed tok · tiers=3 · DECISION: OPT-IN
```

Positive on all three tiers. No tier is individually resolvable at n = 5 (cell bands ±22-35 pp), and billed tokens are +89 % aggregate. It stays opt-in. Do not default it on.

## Per-cell accuracy (runs; E = cell hit the 300 s cap)

| Tier | Task | base | wc |
|---|---|---|---|
| cogito:8b | rw-7 | 67 67 67 33 33 | 67 67 67 67 67 |
| cogito:8b | lh-debug-green | 0 0 0 0 0 | 0 0 0 0 0 |
| qwen3:14b | rw-7 | 100 ×5 | 100 ×5 |
| qwen3:14b | lh-debug-green | 17 17 17 17 E | 83 E 83 E 92 |
| qwen3:4b | rw-7 | 33 67 33 67 33 | 67 100 100 33 67 |
| qwen3:4b | lh-debug-green | 17 17 67 33 17 | 50 50 67 50 0 |

## What it did

- **Mechanism, targets written (all `src/` targets of a task):**
  - qwen3:14b `lh-debug-green`: 1 of 6 in `base` runs, 6 of 6 in the three finished `wc` runs.
  - qwen3:4b `lh-debug-green`: 6 of 6 in 5/5 `wc` runs (`base` 1,1,6,4,1).
  - qwen3:4b `rw-7`: 3 of 3 in 5/5 `wc` runs (`base` 1,3,1,3,1).
- **Needed two parts.** With only the requirement (first cogito run, `wc1-…` file), `loop_resolution` / `dispatcher_early_stop` handed the run off at iteration 7-10 of 24 after one denial, in 9/9 terminating runs. Each of those runs had written 1-2 targets since that denial. Progress-aware re-denial (`59001bcd0`) removed that: cogito `lh-debug-green` went from 2-3 to 4-6 targets written.
- **Cost.** qwen3:14b cells take 200-300 s vs 45-80 s; billed tokens +170-185 % on cogito and qwen3:14b. qwen3:4b only +6 %.

## Failure that remains: cogito writes no-op "fixes"

- 15 of 38 cogito `src/` writes under `wc` rewrote the original file unchanged (modulo whitespace and quotes), against 10 of 22 in `base`. Other writes broke the API: it renamed `parseDuration` to `duration` and `dedupeBy` to `dedupe`.
- qwen3:14b: 0 of 33 no-op writes. qwen3:4b: 1 of 45.
- Coverage makes cogito write; it cannot make it find the bug. Every cogito `lh-debug-green` run scores 0.00 in both arms, so there is no lift there, however many targets get written.
- The requirement is satisfied by a no-op write. Next change, if pursued: a target counts as written only if the content differs from the file as read. Deterministic, and it keeps the requirement honest.

## Not proven

- The gap on qwen3:14b `lh-debug-green` has 2 of 5 `wc` cells censored. A rerun at a 500 s cap was skipped. Counted as 0, the cell mean is still 51 vs 14.
- `rw-7` pipeline bug: no lift expected (behaviourally invisible), and none measured on qwen3:14b (already 100 %).
- Only two tasks have targets (rule gives zero targets on every other LH/H3/real-world task). No claim beyond them.
- `base` is a different SHA than `wc` (flag-gated difference).

## Files

`base-ab-*.json`, `wc-ab-*.json` (traces in `bench-corpora/2026-11-09/wc-ab/`), `wc1-cogito-8b-before-progress-exit.json`, `gate-3tier.txt`, `gate-2tier.txt`, `cov.ts` (targets written per run), `noop.ts` (no-op write count), `run-wc.ts`, `drive.sh`, `loop.sh`, `PREDICTIONS.md`.
