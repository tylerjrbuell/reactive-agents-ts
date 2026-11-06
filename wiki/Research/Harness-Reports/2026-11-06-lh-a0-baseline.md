---
type: harness-report
status: complete
created: 2026-11-06
tags: [h3, long-horizon, plan-9, 0e, baseline, lh-a0]
---

# Long-horizon suite: first A0 baseline (lh-a0), 2026-11-06

**Arm:** `lh-a0` (HEAD default path: tools + reasoning + run workspace). **SHA:** `afbac9af7` (on top of `030654b62`).
**Tiers:** cogito:8b, qwen3:4b (Ollama, local). **k = 3.** **Cells:** 36 of 36 attempted. One cell was cut by the cell timeout (see Coverage).
**Raw data:** `/home/tylerbuell/.claude/jobs/eaddf328/tmp/lh-a0/results.json` (cells), `.../traces/<tier>/lh-a0/<task>/run<N>/*.jsonl`, `.../attribute.json` (`rax-diagnose attribute --all --json`).
**Runner:** `run-h3.ts --suite long-horizon --k 3 --budget-sec 560 --cell-timeout-sec 240`, chunks of `timeout 590` each, resumed on the same `--out`.

## Headline

1. **The suite does not reach the iteration cap.** 0 of 36 runs hit the cap (caps are 22 to 24). The longest run was 14 iterations. So the cap-cutoff-with-progress metric is 0/36 by construction. This baseline cannot measure a 2c cap handoff.
2. **The suite does pass 9 iterations in 10 of 36 runs** (5 per tier). That is the first such data in the corpus. These runs are enough to study Phase 4 post-act assessment and stall-guard behavior past iteration 9.
3. **Solve rates are near the floor.** cogito:8b solved 0/18. qwen3:4b solved 3/18, all on the inherited tasks (rw-4, rw-7). The 4 new long-horizon tasks (lh-1, lh-debug-green, lh-enumerate-audit, lh-pipeline-stages) solved 0/24 across both tiers. pass^3 is 0.00 for every tier and task.
4. **Runs end early, not at the cap.** Runs end by the model's own `end_turn` with a wrong answer (20/36), or by a stall guard handoff (`harness_deliverable` / `harness_synthesis`, 15/36).

## Per-tier metrics (pre-registered, from `long-horizon.ts`)

| Metric | cogito:8b | qwen3:4b |
|---|---|---|
| Measured runs | 18 | 18 (1 cut by timeout, counted as a measured fail) |
| Solved | 0/18 (0%) | 3/18 (17%) |
| Mean accuracy (partial credit) | 0.143 | 0.401 |
| pass^3 (every task) | 0.00 | 0.00 |
| Cap hits | 0 | 0 |
| Cap-cutoff-with-progress | 0/18 | 0/18 |
| Runs with a stall-guard fire | 10/18 | 5/18 |
| Stall misfire runs (fire while evidence grew) | 3/18 (17%) | 1/18 (6%) |
| Mean billed tokens | 19,613 (n=18) | 28,750 (n=17, no billing on the cut cell) |
| Iterations, sorted | 4,5,5,5,5,5,5,6,7,8,8,9,9,10,10,10,10,13 | 3,3,3,3,3,4,4,5,6,7,7,8,8,10,11,12,14,14 |
| Median iterations | 7.5 | 6.5 |
| Runs with more than 9 iterations | 5/18 | 5/18 |
| Max iterations | 13 | 14 |
| Wall time, total | 14 min | 32 min |

Iterations = distinct kernel iterations in the trace (`tool-surface-resolved` events), as recorded in `H3Cell.iterations`.

### Per task (both tiers, `longHorizonLine`)

| Tier / task | solved | billed (mean) | iters (mean) | stall-fire runs | misfire runs |
|---|---|---|---|---|---|
| cogito rw-4 | 0/3 | 13,759 | 5.7 | 0 | 0 |
| cogito rw-7 | 0/3 | 14,840 | 9.3 | 1 | 0 |
| cogito lh-1 | 0/3 | 43,520 | 8.3 | 3 | 0 |
| cogito lh-debug-green | 0/3 | 13,540 | 6.3 | 1 | 0 |
| cogito lh-enumerate-audit | 0/3 | 16,804 | 7.7 | 2 | 1 |
| cogito lh-pipeline-stages | 0/3 | 15,218 | 7.3 | 3 | 2 |
| qwen rw-4 | 1/3 | 22,042 | 3.3 | 0 | 0 |
| qwen rw-7 | 2/3 | 13,933 | 4.3 | 0 | 0 |
| qwen lh-1 | 0/3 | 57,772 | 10.7 | 3 | 0 |
| qwen lh-debug-green | 0/3 | 17,067 | 5.7 | 1 | 1 |
| qwen lh-enumerate-audit | 0/3 | 33,347 | 9.3 | 0 | 0 |
| qwen lh-pipeline-stages | 0/3 | 29,869 | 8.3 | 1 | 0 |

Misfires, by `guard@iter`: cogito lh-pipeline-stages r0 `dispatcher_early_stop@3`, r1 `loop_resolution@10`; cogito lh-enumerate-audit r2 `dispatcher_early_stop@7`; qwen lh-debug-green r0 `loop_resolution@5`.

## Cause and attribution

`rax diagnose cause` labels (per cell):

| Label | cogito:8b | qwen3:4b |
|---|---|---|
| wrong-answer | 8 | 9 |
| stall-after-work | 5 | 4 |
| verifier-reject | 2 | 0 |
| loop-after-work | 2 | 1 |
| tool-failure | 1 | 0 |
| aborted (cell timeout) | 0 | 1 |
| none / success-with-warning | 0 | 3 |

`rax-diagnose attribute --all` (36 runs, 33 failed): **model 28 (85%), harness 2 (6%), environment 2 (6%), unattributed 1.** Reasons: `model:had-evidence-wrong-output` 19, `model:ignored-guidance` 5, `model:fabrication-vetoed` 4, `harness:tool-call-dropped` 2, `environment:tool-failure` 1, `environment:run-aborted` 1. 29 of 36 verdicts are decisive.

The top harness reason is `harness:tool-call-dropped` (2 runs, both cogito:8b). The root cause is below.

## Decisive failures (2 per tier)

**cogito:8b**

- `01M6REXPKJXWABQ9WB081BTBCR` (lh-pipeline-stages r0), harness:tool-call-dropped, decisive. At iter 2 the model read the inputs and also read `clean.csv` and `by-region.json`. Those are outputs that do not exist yet, so both reads failed with ENOENT. At iter 3 it emitted the correct batch: 4 `file-write` calls plus 1 `recall`. `tool-failure-redirect` then escalated to `early-stop` ("file-read failed 2 times; redirect nudge was ignored"). `dispatcher_early_stop` ended the run before the batch ran, so no file was written. The model had switched tools, and the escalation did not check that. Also logged as a stall misfire (`dispatcher_early_stop@3`).
- `01M6RFRCKH4284VV2GYBDV0WAA` (lh-1 r1), harness:tool-call-dropped, decisive. `file-write(findings.json)` was refused twice because the content was not valid JSON. The model retried `file-write`. The early stop blocked once (`deny-once`), then ended the run on the next retry. That retry was never executed, so the run cannot show whether the JSON was fixed.

**qwen3:4b**

- `01M6RF30NP775P458322P4Y1TY` (lh-1 r0, 14 iterations, 69,652 tokens), model:ignored-guidance, decisive. The harness injected "required file-write still missing". The model made no `file-write` call on the next turn. `stall_deliverable` (5/5 stalled) then handed off at iter 13. Score 0.111. This is a real long run that a stall guard ended. No evidence grew in its last window, so it is not a misfire.
- `01M6RG90Y13N3EDJSVNSJ1P04J` (lh-enumerate-audit r1, 11 iterations), model:fabrication-vetoed, decisive. `audit.json` failed the hidden check (score 0.214: wrong row count, INV-1061 and INV-1068 marked valid). The runtime verifier flagged `output-not-fabricated-listed-entities`. The deliverable gate still accepted the output as `advisory-softfail`.

## Harness defects found (for dispatch, not fixed here)

1. **Dispatcher early-stop drops the model's pending, corrective tool batch.** This is the top harness reason in this run (2/2 harness verdicts).
   - Location: `packages/reactive-intelligence/src/controller/handlers/tool-failure-redirect.ts:16-27`.
   - The second fire of `tool-failure-redirect` always escalates to `early-stop` and claims "redirect nudge was ignored".
   - It never checks whether the model's current turn still calls the failing tool. In r0 above, the streak tool was `file-read` and the pending calls were `file-write`.
   - The streak comes from the trailing `tool_result`s (`packages/reasoning/src/kernel/capabilities/reflect/tool-failure-streak.ts:24`, read at `reactive-observer.ts:239`). It is evaluated after think and before act, so the new calls are invisible to it.
   - Two parallel failures in one batch count as a 2-streak, and those are not retries. In r0 the two ENOENT reads came from one parallel batch.
   - The first-fire nudge text tells the model to "call the final-answer tool immediately", which pushes toward quitting.
   - Owner: kernel-warden (per `repo scope`).
2. **Phantom deliverable from an absolute input path.** All 6 lh-pipeline-stages traces carry the requirement "write the file `.//home/.../.bench-run-*/pipeline.json`". `pipeline.json` is the task's INPUT manifest. The run workspace makes the task text carry absolute paths, and `deriveDeliverableItems` admits one of them. Its normalizer then prefixes `./` to the absolute path: `packages/reasoning/src/kernel/capabilities/verify/derive-conditions.ts:546`. In run r0 the model obeyed and wrote `pipeline.json` with paraphrased content, overwriting its own input. The batch was dropped by defect 1, so the overwrite did not land. Which admit branch (write-anchored or list-mode) let the path through is unconfirmed. A zero-token unit check on the frozen task text would pin it. Owner: kernel-warden.

## Coverage and instrument notes

- **Cell timeout:** `qwen3:4b|lh-enumerate-audit|0` was cut at 240 s (14 iterations, status `error`, `execution-timeout`, cause `aborted`, no billed tokens). `isMeasured` counts it as a measured fail. qwen lh-1 also ran close to the limit: 221 s, 91 s and 246 s (r2 finished slightly past 240 s and was still scored). A rerun should use `--cell-timeout-sec 360` for qwen3:4b, or that tier's long tasks will be censored.
- **Evidence source:** every cell's facts came from the run ledger (`evidenceSource=ledger`), not the tool-call fallback.
- **Runner:** each chunk was a separate `timeout 590` process. Chunks 3 and later were driven by a small loop script (`.../tmp/lh-a0/loop.sh`, one log per chunk) because the tool shell moves any call longer than 180 s to the background. Every chunk ran to its own exit, and none was killed. Results are identical in form to manual chunking.

## Does the suite reach long horizons?

Partly. It passes 9 iterations in 28% of runs (10/36), but it never comes near the 22 to 24 cap, so cap behavior is untestable. There are three reasons:

- **Parallel batching compresses iterations.** Both models issue many reads per turn; cogito read all 9 pipeline inputs in one iteration. `LH_MIN_TOOL_CALLS` is a floor on calls, not on iterations.
- **Early wrong `end_turn`.** 20/36 runs ended by the model's own `end_turn`.
- **Stall-guard handoffs at iterations 4 to 13.**

Tasks that are too short, by measured iterations (mean, both tiers):

- **rw-4:** 3.3 to 5.7. Never passed 7.
- **lh-debug-green:** 5.7 to 6.3. Never passed 9; it is designed for 12 calls, but the models batch reads and quit.
- **rw-7:** passed 9 once (cogito r2, 13 iterations).

lh-1 is the task that most often passes 9 iterations on both tiers (4 of 6 runs at 10 or more: cogito 10, 5, 10; qwen 14, 6, 12). lh-enumerate-audit passes 9 in 3 of 6 runs and lh-pipeline-stages in 2 of 6. To make the cap measurable, a task needs serial dependencies that defeat batching (each step's input is the previous step's output), or a lower cap for this arm. That is a suite-design question for the Plan 9 0e owner. Do not tune it on these outcomes.

## Next

- Before/after probe for defect 1: rerun lh-pipeline-stages and lh-1 on both tiers at k=3 against this file. Use `verdict.ts`, or compare cells by hand: `dispatcher_early_stop` count, `harness:tool-call-dropped` count, and solve rate.
- Defect 2 needs no live probe. A unit test on the frozen lh-pipeline-stages task text pins it.
