---
type: ablation
status: complete
created: 2026-11-05
tags: [ablation, lift-gate, loop-progress-aware, plan-9, h3-lh, long-horizon, 0e-baseline]
---

# Ablation: progress-aware loop resolution (`.withHarness({ loopProgressAware: true })`, Plan 9 item 2f)

**Warden:** ablation-warden
**SHA:** `9025f696959f92a42e7c66c8c7f488a2ceaddd1c` (pinned worktree, detached; recorded in all four results files)
**Suite:** `h3-lh` long-horizon suite v1.0.0 (0e, `e420653c4`): `rw-4`, `rw-7`, `lh-1`, `lh-debug-green`, `lh-enumerate-audit`, `lh-pipeline-stages`
**Arms:** baseline `lh-a0` (2f off, the shipped default) vs candidate `lh-a1` (2f on)
**Tiers:** `qwen3:4b`, `cogito:8b` (Ollama, local). k=3 per cell, cell timeout 240 s.
**Matrix:** 6 tasks x 2 arms x 2 tiers x 3 runs = 72 cells. All 72 ran. 3 timed out (all qwen3:4b) and are recorded as unmeasured (`execution-timeout`). No cell was network-unavailable.

## Verdict

**Coded gate: `reject`.** But the experiment did not test the mechanism. **The 2f redirect fired 0 times in 38 a1 runs**, so the two arms ran the same code. The cogito "regression" is noise from what amounted to an A/A comparison. It is not an effect of 2f.

**Recommendation: keep 2f OPT-IN.** It cannot go default-on. This suite does not exercise the mechanism, so the result says nothing about lift in either direction. Do not delete 2f because of this reject. Re-ablate on a suite where the trigger fires (see "Next").

## Gate output (coded rule, `DEFAULT_LIFT_POLICY`)

`rax eval gate --report <session-report.json> --baseline lh-a0 --candidate lh-a1` (the same result comes from calling `evaluateLiftGate` directly):

| Tier | Base acc | Cand acc | Lift (paired) | SE | Billed tok | Min measured runs | Tier verdict |
|---|---|---|---|---|---|---|---|
| qwen3:4b | 29.5% | 31.3% | +1.9 pp | 16.2 pp | -35.8% | 2 | INCONCLUSIVE + underpowered (timeout cells: 1/3 unmeasured > 20% rule) |
| cogito:8b | 19.3% | 3.7% | -15.6 pp | 14.6 pp | -39.7% | 3 | REGRESS (\|lift\| > 1σ band of 14.6 pp; under the 95% band of 28.6 pp) |

`DECISION: REJECT · 2 tier(s) · -15.6pp lift · -39.7% billed tok — a tier significantly regresses` (PARTIAL: one inconclusive tier). pass^8 is not evaluated because no cell has n >= 8.

Per-task paired diffs, candidate minus baseline, in pp:
- qwen3:4b: rw-4 +53.3, rw-7 0, lh-1 0, lh-debug-green -25.0, lh-enumerate-audit -23.8, lh-pipeline-stages +6.7. Every per-task SE is 33 to 49 pp.
- cogito:8b: rw-4 -26.7, rw-7 -22.2, lh-1 -25.9, lh-debug-green +22.2, lh-enumerate-audit -31.0, lh-pipeline-stages -10.0. Every per-task SE is about 35 pp.

Adapter: H3 `results-*.json` files have a different shape from a bench `SessionReport`. A thin mapping builds the report (scripts under the job tmp dir: `gate-adapter.ts`, `dump-report.ts`). Each H3 cell becomes one `RunScore`. The accuracy dimension is the cell's graded accuracy. A timeout becomes `scoreState: "inconclusive", inconclusiveReason: "execution-timeout"`, never a 0. Tokens use billed tokens. No task carries the `horizon:long` tag, so the gate scores all tasks as `short` and uses the billed-token leg.

## Activation audit (why the verdict is not evidence)

The 2f rule fires only on a pattern-(a) loop verdict (identical repeated tool call) that meets two conditions. A previous loop verdict exists in the same run, and the RunLedger shows progress after it. When the rule fires, it emits `guard-fired{guard: loop_resolution, outcome: block, reason: progress_since_last_loop}`. It also appends a step with `intervention.actor = "loop-progress"`.

All a1 traces were scanned. 18 cogito runs are under `.../ablate-2f/traces/`. 20 qwen runs are there and under the earlier `.../lh-ablate/traces-qwen3_4b-a1/`.

| Tier / arm | Runs | Runs with any `loop_resolution` verdict | Runs where the 2f redirect fired |
|---|---|---|---|
| qwen3:4b a0 | 18 | 3 | 0 |
| qwen3:4b a1 | 20 | 3 | **0** |
| cogito:8b a0 | 18 | 3 | 0 |
| cogito:8b a1 | 18 | 2 | **0** |

The a1 arm had 5 loop verdicts: 2 pattern-(a) (repeated tool call) and 3 pattern-(c) (consecutive thoughts). Each was the run's first loop verdict, and each ended the run straight away: `harness_synthesis` x4 (artifacts present), `loop_graceful` x1. With no second verdict, there was nothing for 2f to change. This suite does not reproduce the motivating shape: a stutter, then a write, then a second verdict that ends the run with work outstanding. That shape came from targeted H3 `h3-todo-heavy` on cogito:8b at `94f0c9ea5`.

### The cogito a1 "never-engaged" cluster is sampling noise

9/18 cogito a1 runs ended at iteration 3 by `tool_call_unresolved`. In a0 the count was 0/18. These runs made 0 real tool calls, and `rax-diagnose cause` labels them `never-engaged` (guard authority `tool_call_unresolved`). They drive most of the -15.6 pp.

They are not caused by 2f:
- The run configs differ only in `config.mechanisms.loopProgressAware` / `config.builder.harness.loopProgressAware`.
- Paired traces (cogito rw-4 run0, a0 vs a1) have byte-identical system prompts and message lists at iteration 2. In both, tools are withheld and the guidance reads "Now call http-get".
- At that iteration, a0 sampled a reply the text parser could recover (`dialect: pseudo-code`, `disposition: mixed`). a1 sampled an unrecoverable one (`dialect: none`), took strike 3, and was terminated. This is sampling at temperature 0.3, not a code-path difference.
- In both arms the unresolved-tool-call guard reached strike 2 with tools withheld (a0: 6 runs, a1: 11 runs). Only a1 drew the third strike.

**Gate-calibration finding (for harness-warden):** this was effectively an A/A run, and it produced a 1σ "significant regression" on one of two tiers. The reject leg uses `significanceK: 1`. On 6 tasks x n=3, a two-tier run will raise a false reject in about 30% of null comparisons (one-sided 1σ is about 16% per tier). Reject is meant to be conservative, but here it records a mechanism as harmful when it never ran. Consider requiring evidence that the mechanism fired before an H3 reject is booked. `h3/verdict.ts` already has `activityFromTraces`.

## Per-arm summary (`long-horizon.ts`)

Over measured cells only. Billed tokens are the mean per measured cell.

| Tier / arm | Measured | Timeouts | Solved | Mean acc | Mean billed tok | Mean iters | Cap hits | Cap-cutoff-with-progress | Runs with stall fire | Stall misfires (runs) |
|---|---|---|---|---|---|---|---|---|---|---|
| qwen3:4b a0 | 17/18 | 1 | 1 | 0.287 | 39,346 | 7.9 | 0 | 0 (0.00) | 9 | 3 (3) |
| qwen3:4b a1 | 16/18 | 2 | 2 | 0.279 | 26,644 | 5.6 | 0 | 0 (0.00) | 8 | 4 (3) |
| cogito:8b a0 | 18/18 | 0 | 0 | 0.193 | 18,260 | 7.1 | 0 | 0 (0.00) | 9 | 4 (3) |
| cogito:8b a1 | 18/18 | 0 | 0 | 0.037 | 11,011 | 5.3 | 0 | 0 (0.00) | 7 | 4 (4) |

(The unpaired mean acc for qwen a1 is 0.279. The gate's paired per-task mean is 0.313. They differ because timeout cells drop out unevenly across tasks.)

Per-task summary lines (`bun run src/h3/long-horizon.ts <results>`):

```
LH|qwen3:4b|rw-4|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=0|billed=14895|iters=3.0
LH|qwen3:4b|rw-7|lh-a0|n=3|facts=3|solved=1|ci=[0.06,0.79]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=0|billed=16712|iters=3.3
LH|qwen3:4b|lh-1|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=3|billed=92172|iters=15.3
LH|qwen3:4b|lh-debug-green|lh-a0|n=3|facts=2|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=2(0.67)|stallFireRuns=2|billed=45090|iters=11.0
LH|qwen3:4b|lh-enumerate-audit|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=1|billed=37681|iters=8.3
LH|qwen3:4b|lh-pipeline-stages|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=3|billed=31443|iters=7.7
LH|qwen3:4b|rw-4|lh-a1|n=3|facts=2|solved=2|ci=[0.21,0.94]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=0|billed=14937|iters=3.0
LH|qwen3:4b|rw-7|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=0|billed=12145|iters=3.0
LH|qwen3:4b|lh-debug-green|lh-a1|n=3|facts=2|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=1|billed=17432|iters=5.0
LH|qwen3:4b|lh-enumerate-audit|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=1|billed=37335|iters=7.3
LH|qwen3:4b|lh-pipeline-stages|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=3|billed=33938|iters=8.0
LH|qwen3:4b|lh-1|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=3|billed=37106|iters=7.0
LH|cogito:8b|rw-4|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=0|billed=7800|iters=5.7
LH|cogito:8b|rw-7|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=3|billed=16303|iters=9.3
LH|cogito:8b|lh-1|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=2|billed=36692|iters=8.0
LH|cogito:8b|lh-debug-green|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=1|billed=12165|iters=5.3
LH|cogito:8b|lh-enumerate-audit|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=1|billed=19119|iters=7.7
LH|cogito:8b|lh-pipeline-stages|lh-a0|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=2|billed=17482|iters=7.3
LH|cogito:8b|rw-4|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=0|billed=2745|iters=3.0
LH|cogito:8b|rw-7|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=1|billed=11181|iters=7.0
LH|cogito:8b|lh-1|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=1|billed=15107|iters=5.7
LH|cogito:8b|lh-debug-green|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=2(0.67)|stallFireRuns=3|billed=20055|iters=9.0
LH|cogito:8b|lh-enumerate-audit|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=1(0.33)|stallFireRuns=1|billed=9678|iters=4.0
LH|cogito:8b|lh-pipeline-stages|lh-a1|n=3|facts=3|solved=0|ci=[0.00,0.56]|pass^3=0.00|capHits=0|capCutWithProgress=0(0.00)|stallMisfire=0(0.00)|stallFireRuns=1|billed=7303|iters=3.3
```

## First 0e baseline (arm a0, 2f off, SHA 9025f6969)

These are the first numbers for the long-horizon suite at the shipped default:
- **Solve rate is near the floor.** qwen3:4b solved 1/17 measured runs (rw-7 once). cogito:8b solved 0/18. Partial-credit accuracy: qwen 0.287, cogito 0.193. The suite has headroom, but at k=3 it cannot resolve effects under about 25 pp per tier (per-task SE about 35 pp).
- **No run hit the iteration cap, in either tier or arm.** Cap-cutoff-with-progress is 0/71 measured runs. Runs end long before the cap, through `end_turn`, `harness_deliverable` or a guard. A cap that never binds is not this suite's failure mode.
- **The stall guards are the active failure surface.** A stall guard fired in 9/17 (qwen) and 9/18 (cogito) a0 runs. A misfire (guard fired while the ledger showed progress inside the window) was recorded in 3 runs per tier. The worst task is `lh-debug-green`, with a misfire rate of 0.67 on qwen a0 and 0.67 on cogito a1.
- **Dominant cause labels in a0:** `wrong-answer` (qwen 9, cogito 8), then `stall-after-work` (5 each).

## Run notes and caveats

- **Resume.** Two earlier attempts left 12 qwen3:4b cells (6 a0, 6 a1). Those traces are under `.../tmp/lh-ablate/traces-qwen3_4b-a*/`. All were complete cells at the same SHA and were kept. Their 240 s timeouts are cell timeouts, not cuts from a stop. All later cells use `--trace-root .../tmp/ablate-2f/traces`.
- **Shared Ollama.** Other models were resident at points during the run: `bonsai-2:27b` at the start, `qwen2.5-coder:7b` later. They were not started by this warden and were not touched. VRAM contention may explain the 3 qwen timeouts. It adds time-varying noise, which a0/a1 chunk alternation only partly controls.
- **Provider error.** One cogito a0 cell (`provider-error`, `terminatedBy: llm_error`) is counted as a measured 0, as `run-h3` recorded it.
- **Chunking.** Every chunk ran as `timeout 590 bun ... run-h3.ts ... --budget-sec 560` and exited 0. The tool harness moved chunks over 180 s into the background on its own. Each chunk was awaited to completion before the next started, and no two ran at once.
- **Ledger.** `--ledger wiki/Research/Harness-Reports/improvement-ledger.json` was **not** written. That path is outside this mission's authority. The SessionReport needed for the booking is at `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-2f/session-report.json`.

## Next

1. Re-ablate 2f on a suite that produces the trigger: targeted H3 `h3-todo-heavy` on cogito:8b, which produced the motivating evidence. Gate on activity. Report the a1 fire count first. If it is 0, the comparison is void.
2. harness-warden: decide whether an H3 reject needs evidence that the mechanism was active, given the A/A false-reject seen here.
3. kernel-warden (optional): every a1 loop verdict here (5 of 5, 2 of them pattern-(a)) was a first verdict that ended the run at once. If the first verdict is "denied once by the exit gate" as the 2f docstring says, check why these ended at verdict 1 (`harness_synthesis` with artifacts present, or `loop_graceful`). It may limit where 2f can ever act.

## Artifacts

- Results: `results-qwen3_4b-a0.json`, `results-qwen3_4b-a1.json`, `results-cogito_8b-a0.json`, `results-cogito_8b-a1.json` (this dir)
- Traces: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-2f/traces/`, `/home/tylerbuell/.claude/jobs/eaddf328/tmp/lh-ablate/`
- Gate input and output: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/ablate-2f/session-report.json`, `gate-verdict.json`, `gate-adapter.ts`, `dump-report.ts`
