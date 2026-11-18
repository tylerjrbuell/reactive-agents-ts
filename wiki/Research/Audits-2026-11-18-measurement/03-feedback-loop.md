---
type: audit
status: complete
created: 2026-11-18
tags: [audit, harness, h3, feedback-loop, instrument-fidelity, power, tiered-loop]
---

# Audit 03: speed, robustness and fidelity of the self-improvement feedback loop

Scope: H3 runner (`packages/benchmarks/src/h3/run-h3.ts`), `verdict.ts`, `run-ab.ts`/`analyze.ts`/`to-session.ts` (2026-11-18-speedups), `rax-diagnose attribute` (`packages/trace`), `improvement-ledger.json`, chunk scripts (`/home/tylerbuell/ab-speedups-data/{chunk,drive}.sh`). Zero tokens: saved data only (v0.19-final, rerun, v0.19 regression-check, speedups, golden-run attempts). Per-task numbers pool `final` + `rerun` (same build modulo one doc/revert commit), n=10 per task per tier. Power numbers are a normal-approximation calculation on those variances (paired by task, 80% power, alpha 0.05, a uniform effect over the tasks in the set). They are planning figures, not measurements.

Owner's complaint, "building blindly": confirmed, and it is mostly the instrument, not the model. Three causes: (1) the verdict tool cannot resolve what the gate can, (2) most suite wall time is spent on tasks that cannot move, (3) contamination and provenance are not recorded, so a number cannot be trusted after the fact.

## Ranked defects

| # | Defect | Evidence | Cost | Fix owner |
|---|---|---|---|---|
| 1 | `verdict.ts` resolves pass-rate only when pooled Wilson intervals are disjoint. That needs a ~22-25pp gap at 60 cells/arm. The gate's paired-by-task SE resolves ~10-12pp at the same n. The two instruments disagree on the same data. | `verdict.ts:166` (`intervalsDisjoint`); `wiki/Research/Ablations/2026-11-18-speedups/results/verdict-lft.txt`: `NO-CHANGE ... pass 41/48 -> 35/48 (-13pp, within noise) ... harness:none absent (wrong target?)` for a lever the gate REJECTED at -24.4pp significant (gemma4:e4b h3-exact-value 0/5 vs 5/5). Ledger: 55 entries, 8 `underpowered`, 6 `inert`, 2 `no-change`, 6 `shifted`. | Every quick verdict is "within noise"; humans fall back to the 46-min gate. | harness-warden (`packages/benchmarks`) |
| 2 | Suite time is spent on tasks with zero outcome variance. qwen3:4b: 66% of wall time is on tasks that are 10/10 or 0/10 (rw-7 alone 18%, with its accuracy near 0.10). cogito:8b: 4 of 12 tasks are 10/10 (13% of wall); 4 more are 0/10 on binary pass but carry partial-credit variance. Per-task detail below. | `rerun-qwen3-4b.json` + `final-qwen3-4b.json`: wall 8465 s for 120 cells; rw-7 153 s/cell avg, 0 solved in 10. Effect diluted: 3 active tasks of 12 on qwen means a 40pp effect on them reads as ~10pp pooled. | A 60-cell qwen arm = 72 min and cannot show most levers. | harness-warden (suite selection) |
| 3 | Cell-timeout default mismatch and timeouts counted as model failures. `run-h3.ts:349` default `--cell-timeout-sec 150`, `reference.md:9` says 150, SKILL.md step 4(b) says 180, `run-ab.ts:81` and every baseline used 180. The results file does not record the timeout (`H3Results` keys: suite, version, gitSha, taskHashes, k). A before/after pair with different timeouts is silently comparable. | Timeouts (status `error`, `execution-timeout`, 180.1 s): final 5/60 qwen, rerun 3/60 qwen, regression-check 5/35 dev-qwen + 2/35 v018-qwen + 3 cogito = 7/140. 15 timeouts x 180 s = 45 min of the week's ~5.3 h H3 time. 12 of 15 are the same two tasks (rw-7 qwen, todo-heavy qwen). They count as failures (`report.ts:37` `isMeasured` keeps them) but record `tokens=0`, `billedTokens=null`, so `verdict.ts:114-115` drops them from the token mean: an arm with more timeouts looks cheaper. | 14% of week GPU time; biased token deltas. | harness-warden |
| 4 | No contamination detection in the runner. Zero hits for `api/ps`, `lsof`, `ss`, foreign-client in `packages/benchmarks/src`. The only defence is an ad hoc `chunk.sh` outside the repo (sampler of `:11434` clients). | 2026-11-17 speedups attempt voided (`nimble` auto-shadow calls + a foreign `bun test`; `foreign.log` shows `rw-ks-probe2.ts`, `ran=2 remaining=235` in a 398 s chunk). Regression-check ran at load 8-10 with swap full; cogito `h3-continuation` (5 s normally) averaged 47 s dev / 40 s v018 and one cell timed out at 180 s. That cell is scored a model failure (dev cogito continuation 4/5). Arms run sequentially, not interleaved, so host drift is confounded with the arm. `run-ab.ts` does interleave. | An undetected stall flips a Bernoulli cell; at k=5 one cell is 20pp of a task. | harness-warden |
| 5 | Attribution mislabels (four, below). Biggest: the loop's SELECT step would pick `harness:forcing-unused`, a lever the ledger already closed as opt-in. | See "Attribution fidelity". | Wrong top reason selected; honest decline invisible. | harness-warden (`packages/trace`, `packages/benchmarks/src/judge.ts`); kernel-warden for item 5b |
| 6 | Provenance gaps. Results record `gitSha` only. Not recorded: reasoning `dist` build (reasoning exports `dist`, so a SHA does not identify the code that ran), `RA_*` env flags, cell timeout, model digest, `num_ctx`, Ollama version, host load. The "v0.19 final" baseline mixes SHAs: qwen file `db2c94190`, cogito file `d3e8b8b50` (the leanFinalTurn fix lies between). A SHA mismatch warns only on resume (`run-h3.ts:238`). `run-ab.ts:14-16` hard-codes `/home/tylerbuell/ab-speedups-wt` and monkeypatches `H3_TIERS`/`H3_TASKS`; gemma4:e4b and cogito:14b are not in `H3_TIERS`. | `final-qwen3-4b.json` vs `final-cogito-8b.json` gitSha. | Baselines not reproducible; each A/B re-copies a one-off script. | harness-warden |
| 7 | Chunking wastes a third of every 590 s window and needs a human to re-invoke. `startMarginSec = cellT + 5` (`run-ab.ts:81`; default `cellT + 20` at `run-h3.ts:268`) means no cell starts after ~395 s of a 580 s budget, though the mean cell is 12-70 s. | speedups `host.log`: 7 chunks ended at 355-408 s; in-chunk time 2761 s for 2092 s of cell time (144 cells). 3 tool calls per 20 min of work. | Slow, babysat; breaks "unattended". | harness-warden |
| 8 | No determinism control. No seed or temperature in the bench path (zero hits for `seed` in `runner.ts`, `run-internal.ts`, `providers/local.ts`). Same config twice: cogito 28/60 (final) vs 32/60 (rerun); h3-todo-heavy 1/5 vs 0/5, rw-6 2/5 vs 4/5, rw-3 1/5 vs 3/5. | Consistent with binomial noise of ~6pp on 60 cells; no common random numbers possible. | Variance floor cannot be lowered. | harness-warden + llm-provider warden (a per-cell seed option) |
| 9 | The verdict tool is single-target. `--reason` is mandatory; a regression check has no target and prints `absent from the baseline cells (wrong target?)` (regression-check README, both tiers). No "any harness reason rose / any task regressed" mode. | `verdict.ts:133` (`compareTargeted` needs a reason). | Regression checks misuse a fix verdict. | harness-warden |
| 10 | Skill and docs drift on the same flags: timeout 150 vs 180, budget 560 vs 585, `--start-margin-sec` only in the skill. | See item 3. | Instrument-fault reruns. | harness-warden (skill is in scope) |

Not a defect, a confirmation: the in-process `traceFactsOf` replaced the CLI-spawn `parse-failed` label (all 35 cells of both v0.18.0 files still carry `parse-failed`). Trace capture is complete: 60/60 traces exist for each final run. The gate already pairs by task (`gate.ts:322-335`); the fault is that the quick path does not.

## Attribution fidelity

1. **`harness:forcing-unused` blames a default-off lever.** `attribution-forcing.ts:95-135` returns it whenever no-call stalls were unforced (`actOrAnswer=false`), a lever the ledger booked OPT-IN on 2026-11-07 (+16pp, inconclusive tier). cogito final: 6 of the 8 harness-labelled runs (rw-6 x2, rw-7 x4). The loop's SELECT would choose it every pass and re-litigate a closed decision. Fix: treat it as `model:no-call-stall` with a `leverAvailable: opt-in` note, or have SELECT skip any reason whose latest ledger entry is `opt-in`/`reject`. The ablation owner should say which.
2. **Honest decline scored as failure and blamed on the environment.** `judge.ts:430-459` scores an abstention trap by `terminatedBy === "abstained"` (`runner.ts:859`). Speedups `lft` gemma ab-trap-5 run2: output `"I cannot determine the total because the file ./ledger.json could not be found."`, `terminatedBy=dispatcher-early-stop`, `run-completed.status=failure`, score 0.000, attribution `environment:tool-failure` (probable). The lever fired in 0/5 of these runs; the 3/5 vs 5/5 was not attributable to it. Two cells (run2, run3) are in this state. The text is the correct behaviour; the run was stopped before the harness could finalize it. Needs kernel-warden (the stop path is `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts`, `sense/abstention-synthesis.ts`) and a scorer fixture (below).
3. **Grader-passed runs ranked as model failures.** `attribution.ts:684` orders `ruleFabricationVetoed` before `ruleFalseVeto` (defined `:211`, which fires when `eval-graded.passed=true`). qwen final rw-6 runs 0 and 1 and cogito rw-6 run 1 have `eval-graded passed=true score=1` yet attribute `model:fabrication-vetoed` (decisive) with `harness:false-veto` only in "also". Three of 120 cells; the verifier rejected `"125ms"` as a fabricated measurement in a run the hidden check passed. This is a real verifier false positive hidden as a model fault. Fix: ground truth first, move `ruleFalseVeto` ahead (my authority; before/after table to be run on all corpora).
4. **`attribute --all` counts these as failed** (qwen: 18 failed vs 16 unsolved cells; the 2 extra are the rw-6 cells above plus cogito's one), so "failed" in attribution and `solved` in results are different populations. Report both.

Recommended attribution change (one cycle, mine): move `ruleFalseVeto` first; add `leverAvailable` to forcing-unused. Re-run `rax-diagnose attribute --all` on v0.19-final qwen/cogito, regression-check, and speedups, and report the reason table before/after.

## Quantified data (this week)

| Run | Cells | Cell wall | Timeouts | Notes |
|---|---|---|---|---|
| v0.19 final (qwen + cogito) | 120 | 92 min | 5 | mixed SHA |
| rerun (qwen + cogito) | 120 | 85 min | 3 | |
| regression-check (dev + v0.18 x 2 tiers, 7 tasks) | 140 | 103 min | 7 | load 8-10 |
| speedups (3 arms, gemma e4b k=5, cogito 14b k=3) | 144 | 35 min cell, 46 min in-chunk, 7 chunks | 0 | 724k billed tok; first attempt void |
| Total | 524 | ~5.3 h | 15 (45 min) | 4 decisions |

qwen3:4b mean cell 70 s (range 0-167 s per task); cogito:8b 18 s; gemma4:e4b 12.6 s; cogito:14b 18.6 s. A full 12-task k=5 pass: qwen 72 min, cogito 18 min. Cost of one gate verdict (2 levers vs shared off arm): 144 cells, 35 min of cell time, ~80 min of calendar work including re-invocation.

### Task information (pooled final + rerun, n=10/tier)

Class by outcome variance on that tier. `accSD` = within-task SD of the accuracy score (the partial-credit check fraction); `s` = mean cell seconds.

| Task | qwen3:4b p / accSD / s | cogito:8b p / accSD / s | Class | accSD per 100 s (both tiers) |
|---|---|---|---|---|
| h3-exact-value | 1.0 / 0.00 / 21 | 0.9 / 0.30 / 8 | discriminative on cogito, canary on qwen | 1.02 |
| rw-6 | 0.7 / 0.30 / 116 | 0.6 / 0.45 / 45 | discriminative both | 0.46 |
| rw-7 | 0.0 / 0.15 / 153 | 0.0 / 0.33 / 41 | floor (timeouts on qwen) | 0.25 |
| h3-required-tools | 1.0 / 0.00 / 79 | 0.0 / 0.21 / 12 | saturated qwen; partial credit on cogito | 0.23 |
| h3-todo-heavy | 1.0 / 0.00 / 124 | 0.1 / 0.31 / 17 | saturated qwen; discriminative cogito | 0.22 |
| rw-3 | 0.2 / 0.09 / 58 | 0.4 / 0.08 / 21 | discriminative (binary), low accuracy variance | 0.22 |
| rw-2 | 0.0 / 0.08 / 79 | 0.0 / 0.11 / 25 | floor | 0.18 |
| h3-plan-only | 0.9 / 0.10 / 113 | 0.0 / 0.12 / 20 | near-saturated qwen; floor cogito | 0.16 |
| rw-9 | 1.0 / 0 / 65 | 1.0 / 0 / 17 | saturated (canary) | 0 |
| h3-continuation | 1.0 / 0 / 15 | 1.0 / 0 / 5 | saturated (canary) | 0 |
| ab-trap-5 | 1.0 / 0 / 23 | 1.0 / 0 / 6 | saturated (canary; gemma 3-5/5) | 0 |
| ab-trap-4 | 1.0 / 0 / 0 | 1.0 / 0 / 0 | rail check, 0 tokens (zero-token test material) | 0 |

Cross-tier: only rw-6 and (cogito) exact-value/todo-heavy/rw-3 move. qwen3:4b is a poor discriminator at this suite: its three active tasks cost 287 s per pass. cogito:8b is the cheap discriminative tier and gemma4:e4b (12.6 s/cell, calibrated `parallelCallCapability: reliable`) is a cheap third tier; neither gemma nor cogito:14b is in `H3_TIERS`. Binary `solved` throws away the partial-credit score: on the cogito floor tasks (required-tools 0.57, plan-only 0.68, rw-2 0.43, rw-7 0.27) accuracy has variance where pass/fail has none. At n=5/task, uniform-effect MDE over all 12 tasks: qwen 10pp binary / 5.4pp accuracy; cogito 12pp binary / 11pp accuracy (qwen's accuracy figure is flattered by its saturated tasks).

### Cells needed to detect an effect (planning figures)

Paired by task, uniform effect over the set, 80% power. "Cells/arm" counts all tasks x n.

| Set | metric | n/task | cells/arm | MDE (pp) | cogito cell-time/arm |
|---|---|---|---|---|---|
| all 12, cogito | accuracy | 5 | 60 | 11.2 | 18 min |
| all 12, cogito | accuracy | 10 | 120 | 7.9 | 36 min |
| all 12, cogito | accuracy | 20 | 240 | 5.6 | 73 min |
| all 12, cogito | binary | 10 / 20 | 120 / 240 | 8.5 / 6.0 | 36 / 73 min |
| all 12, qwen | binary | 10 / 20 | 120 / 240 | 7.1 / 5.0 | 141 / 282 min |
| S6 cogito (exact-value, todo-heavy, required-tools, plan-only, rw-3, rw-6) | accuracy | 5 / 10 / 20 | 30 / 60 / 120 | 19.9 / 14.1 / 9.9 | 10 / 21 / 41 min |
| S4 cogito (exact-value, todo-heavy, required-tools, plan-only) | binary | 5 / 10 | 20 / 40 | 18.8 / 13.3 | 5 / 10 min |
| qwen S3 (rw-3, rw-6, plan-only) | accuracy | 5 / 10 / 20 | 15 / 30 / 60 | 19.2 / 13.6 / 9.6 | 24 / 48 / 96 min |

Reading it: a 10pp effect needs ~60-120 cells/arm on cogito over all 12 tasks (18-36 min/arm); a 5pp effect needs ~240 cells/arm (73 min/arm cogito, 282 min qwen), which only a default-on candidate justifies. A smaller subset has a larger MDE in pooled pp, but an effect concentrated on the tasks that can move is larger there, so subset-by-trigger is the efficient shape. Binary single-task flips: Fisher exact needs 4 of 4 vs 0 of 4 (p=0.029) or 5/5 vs 1/5 (p=0.048). Efficiency metrics (turns, billed tokens, tool calls) have far lower variance: pth's -37% turns is unmistakable at k=2 on todo-heavy (13.4 to 3.0 turns, all 10 runs). Use them as the primary read for efficiency levers and accuracy only for non-inferiority. Caveats: variance estimated from n=10 per task; sampling is unseeded; tasks that are 10/10 may have true p~0.9.

## Proposed tiered loop

### Tier 0: deterministic, zero tokens, seconds (every change; CI keyless)

Exists: `bun run bench:replay` (7 goldens: abstain, answer-only, blueprint-two-step, planned-tool-loop, reflexion-two-pass, terse-tool-loop, tool-write; `replay-lane.ts`); 15 `cf-*` control-flow scenarios (`integration-control-flow-scenario-health.json`: ~153 executions each, 76 regressions caught lifetime, so they pay); 57 reasoning test files on `TestLLMService`; `kernel/loop` 164 tests; `rax-diagnose attribute --all` on saved traces (about 1 s).

Missing, in value order:
1. **Failure-shape zoo as scripted tables**, one per real failure seen this week, run with the candidate lever on and off through the kernel: (a) exact-value shape (one `file-read`, the reply says "still need b.json", lft must not terminate: this exact shape would have caught the leanFinalTurn defect that cost a 46-min A/B); (b) ab-trap-5 honest decline stopped by `dispatcher_early_stop`; (c) rw-6 correct answer vetoed by the fabrication verifier; (d) rw-7 no-call stalls x4; (e) todo-heavy hitting 14/14 iterations with `out-6.txt` unwritten. Asserts on `terminatedBy`, status, tool sequence, and the activity key set. Seconds each.
2. **Activity-emission contract:** every flag in `harness-flags.ts` must emit a `guard-fired`/signal key under a scripted scenario, else it is not measurable (INERT cannot be told apart from broken). One parametrized test.
3. **Scorer fixtures:** recorded outputs (honest decline text, decoy-containing answer, partial writes) run through `judge.ts` scoring with expected scores. Pins defect 5b.
4. **Attribution snapshot:** a committed mini-corpus of ~30 traces with expected `reason` per run; changing a rule prints a before/after table in seconds. (Whether a suitable committed corpus exists was not verified; traces under `benchmark-traces` are gitignored.)
5. **Mechanism-fires check on recorded traces** (`replay-ablate*.ts` exist; usage not audited here).

### Tier 1: smoke, minutes, per candidate change

Tiers: cogito:8b first; gemma4:e4b second (add to `H3_TIERS`, remove the monkeypatch). Skip qwen3:4b for smoke.
- Choose tasks by trigger, not a fixed set: run the Tier-0 mechanism-fires check, then take only tasks whose traces show the mechanism activating, plus the canary.
- Default smoke set S4 on cogito: h3-exact-value, h3-todo-heavy, h3-required-tools, h3-plan-only (57 s per pass; k=5, A and B interleaved per cell: 10 min per A/B). Add rw-3, rw-6 (S6: 123 s per pass, 10 min per arm, 20 min per A/B at k=5) only when the mechanism touches multi-file reasoning.
- Sequential stopping (per paired (task, run) difference): stop INERT if the mechanism fired 0 times in the first 6 treated cells (about 2 min); stop for harm when any task is 0/4 against 4/4 (Fisher p<0.03) or the cumulative paired diff passes a Pocock bound; stop for futility on efficiency levers when turns/tokens are flat after k=2. Looks at k=2, 3, 5.
- Detectable: binary pooled over S4 at k=5 ~19pp, k=10 ~13pp; single-task flips of 4/4 vs 0/4; efficiency deltas of >=15% at k=2. For the lft case, gemma exact-value 0/4 vs 4/4 is one minute of cells (4 x 14 s).
- Expected runtime: 2-10 min typical, <=20 min worst.
- Read order: activity (fired?) then efficiency then accuracy. Verdict must use a paired stratified test (below).

### Tier 2: full gate (default-on candidates only)

12 tasks minus rw-7 (0/10, 153 s, timeouts on qwen) and ab-trap-4 (moved to Tier 0); tiers cogito:8b, gemma4:e4b, one frontier (ablation-warden's 2-tier rule); k>=8 (the gate's pass^8 hook needs n>=8). cogito:8b: 217 s per pass x 8 = ~29 min/arm, MDE ~9pp accuracy, 5pp needs k~20 (73 min/arm). qwen3:4b only on its S3 (rw-3, rw-6, plan-only: 287 s per pass, k=10 is 48 min/arm). Gemma wall time is extrapolated from the 6-task speedups arm (about 76 s per 6-task pass) and not measured for all 12 tasks. Same SHA, `dist`, timeout, arm order interleaved, one process.

### Regression canary (every change, ~5 min live + seconds Tier 0)

Tasks 10/10 in both baselines: cogito: ab-trap-4, ab-trap-5, h3-continuation, rw-9 (28 s per pass); qwen: add h3-exact-value (rw-9 is 65 s, drop it): ab-trap-5, continuation, exact-value (59 s per pass). k=3 each: cogito 84 s, qwen 177 s, total about 4.5 min. Rule: any canary cell failing where baseline was 10/10 triggers an automatic k=5 rerun of that task and a contamination check (`api/ps`, load, foreign clients) before alarming. Detects a regression to p=0.5 on any one task with 87.5% probability per task. Must be preceded by the preflight in item A below, or the canary reproduces defect 4. Plus Tier 0 (replay lane, cf scenarios, attribution snapshot).

## Concrete fixes (ordered by leverage per effort; none applied: read-only audit)

A. **Runner preflight + provenance (defects 3, 4, 6, 10).** `run-h3.ts`: before each chunk query `127.0.0.1:11434/api/ps` and `ss` for foreign clients and loaded foreign models, record `{loadavg, models, foreign}` per cell, and flag a cell contaminated (rerun, not scored) when a foreign client or model was present or wall time exceeds 3x the task median. Record `cellTimeoutSec`, reasoning dist mtime/hash, `RA_*` env, model digest, `num_ctx` in `H3Results`; hard-fail (not warn) on a SHA/timeout/suite mismatch between `--before` and `--after`. One default timeout (180) in the code, the skill, and the reference. Timed-out cells keep their partial tokens.
B. **Verdict resolves what the gate resolves (defects 1, 9).** Replace pooled-Wilson `RESOLVABLE` with the gate's task-stratified paired estimate (reuse `gate.ts:322-335`) plus a per-task exact test; add a no-target regression mode (any harness reason rose, any task regressed, pass delta with band); print MDE alongside the delta ("-13pp, MDE 11pp, resolvable").
C. **Task selection (defect 2).** Move ab-trap-4 to Tier 0; drop rw-7 and rw-2 from default runs (keep them in a weekly full pass); add gemma4:e4b and cogito:14b to `H3_TIERS`; use `accuracy` as a reported primary metric on floor tasks.
D. **Attribution (item 5).** Reorder `attribution.ts:684`; add `leverAvailable` to forcing-unused. Run `rax-diagnose attribute --all` on the four corpora and publish the before/after reason table.
E. **Unattended mode (defect 7).** `startMarginSec` from the task's observed p95, not the cell timeout (a 12 s task needs a 25 s margin). A detached resumable driver outside the tool window is the real fix, but memory says detached bench cells get SIGKILLed as background tool tasks; this needs an owner decision (for example a user-level systemd unit) rather than a workaround.
F. **Seed (defect 8).** Optional per-cell seed derived from the cell id, recorded in the results, to allow replay of a flaky cell. It will not make cross-build runs identical.
G. **Kernel-warden (blocker):** honest-decline text stopped by `dispatcher_early_stop` ends as `status=failure`/score 0 (`arbitrator.ts`, `sense/abstention-synthesis.ts`). Surface to the parent; I do not edit those paths.

## Limits of this audit

Zero-token only. Power figures assume stationary p and a uniform effect; MDE is the 80%-power value. gemma4:e4b full-12-task time is extrapolated. The cogito/qwen per-task pooled p comes from two runs on slightly different SHAs (the second after `d3e8b8b50`). I did not re-run `bench:replay` or check whether a committed attribution corpus exists. Whether `agent.dispose()` interrupts a timed-out run's Ollama request (`runner.ts:171-206`: the race leaves `agent.run` uncancelled until `dispose`) was not tested; it matters for contamination of the next cell.
