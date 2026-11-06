---
type: experiment
status: complete
created: 2026-11-06
tags: [harness, h3, bonsai-2, tier, baseline, plan-execute, instrument]
---

# H3 full run on bonsai-2:27b at b52d3f9f5 (2026-11-06)

First full H3 run on the new large local tier: 12 tasks, k=5, 60 cells. Runner flags match the other tiers: `--k 5 --budget-sec 560 --cell-timeout-sec 150`. The run used the isolated worktree `wt-h3`, and HEAD was `b52d3f9f5` at start and end. `results-bonsai-2-27b.json` records `gitSha b52d3f9f5`. `@reactive-agents/reasoning` resolved inside the worktree. The run took 11 chunks. Traces stay in scratch: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-bonsai-full/traces/`. Ledger entry 26 (baseline for the new tier).

Smoke test: `2026-11-06-bonsai-27b-smoke` (3/3). Model: Q2_0, 26.9B, thinking on at the Ollama default (`medium`).

## Result

**bonsai-2:27b: 38/60 (63%, Wilson 95% 51%-74%), mean 5178 tokens.**

A diagnostic probe of rw-2 at a 560 s cap is not in the results file (see Finding 2).

## Per-task table, three tiers

qwen3:4b and cogito:8b come from the 6a6a full run (`2026-11-06-6a6a-batch-full-h3`, commit `6a6a7f4d5`). The two cells marked † were rerun in the 94f0 targeted run (`2026-11-06-94f0-targeted-h3`, commit `94f0c9ea5`). bonsai ran at `b52d3f9f5`, which includes 94f0. **Cross-tier gaps are confounded by commit** for h3-todo-heavy, because 94f0 fixed it. Other cells are comparable in commit up to the maxCallsPerTool commits, which set no cap by default.

| task | qwen3:4b | cogito:8b | bonsai-2:27b | bonsai cause labels |
|---|---|---|---|---|
| rw-2 | 0/5 | 0/5 | 0/5 | no-trace:2 (timeout), stall-after-work:2, wrong-answer:1 |
| rw-3 | 0/5 | 0/5 | **3/5** | none:3, no-trace:2 (timeout) |
| rw-6 | 3/5 | 3/5 | 1/5 | no-trace:3 (timeout), stall-after-work:1, verifier-reject:1 |
| rw-7 | 0/5 → 0/5 † | 0/5 → 0/5 † | 0/5 | no-trace:5 (timeout, every run) |
| rw-9 | 5/5 | 3/5 | 5/5 | none:3, success-with-warning:2 |
| ab-trap-4 | 5/5 | 5/5 | 5/5 | unexplained:5 (0-call trap) |
| ab-trap-5 | 5/5 | 5/5 | 4/5 | tool-failure:5 (the trap is a missing file) |
| h3-plan-only | 4/5 | 0/5 | **0/5** | wrong-answer:5, every run scored 0.833 |
| h3-todo-heavy | 0/5 → 5/5 † | 0/5 → 0/5 † | 5/5 | none:4, success-with-warning:1 |
| h3-required-tools | 5/5 | 0/5 | 5/5 | none:5 |
| h3-continuation | 5/5 | 5/5 | 5/5 | none:5 |
| h3-exact-value | 5/5 | 5/5 | 5/5 | none:5 |
| **total** | 37/60 (42/60 with †) | 26/60 | **38/60** | |

The Wilson intervals overlap: bonsai is 51%-74%, and qwen with † is 57%-81% at n=60. No tier ranking is claimable from this run. bonsai is only clearly better on rw-3 (3/5 vs 0/5 on both other tiers). That gap is still inside noise at n=5 (23%-88% vs 0%-43%).

Timeouts: 12 of 60 bonsai cells hit the 150 s cap (rw-7 5, rw-6 3, rw-2 2, rw-3 2). At 6a6a qwen had 1. These 12 cells are unmeasured, not failed on merit. bonsai's real pass rate on the long rw-* tasks is unknown.

Smoke runtimes held on short tasks: rw-9 29 s, todo-heavy 30 s, required-tools 29 s. The long tasks took 110-135 s even when they finished.

## rax-diagnose

- `attribute --all`: 60 runs, 23 failed. harness=0, model=10, environment=13. Reasons: `environment:run-aborted` 12, `model:had-evidence-wrong-output` 9, `environment:tool-failure` 1, `model:fabrication-vetoed` 1.
- `cause --all`: none 25, aborted 12, wrong-answer 6, unexplained 5, tool-failure 5, success-with-warning 3, stall-after-work 3, verifier-reject 1.

For comparison, 6a6a harness reasons were: qwen `stall-after-work` 3, `tool-call-dropped` 2; cogito `tool-call-dropped` 4, `stall-after-work` 1, `evidence-truncated` 1. bonsai has no `tool-call-dropped`, which fits 94f0 being in this commit. It also has no `loop-after-work` (cogito's 94f0 reason): bonsai writes all files in one turn.

**`harness=0` undercounts.** Finding 1 is a harness defect that the attributor labels `model:had-evidence-wrong-output` on all 5 runs. This is the same instrument-gap class as 6a6a finding 2.

## Top harness reasons (ranked, with trace anchors)

### 1. Plan-execute: one step's output fans out whole into several files (bonsai 5/5, qwen 1/5 at 6a6a)

In every bonsai h3-plan-only run, the planner wrote the same plan:
1. `file-read inventory.csv`.
2. One `analysis` step that composes all three outputs.
3. Three `file-write` steps whose `content` is all `{{from_step:s2}}` (run 0) or `{{from_step:s2:full}}` (runs 1-4).

The analysis step returned all three files joined under `=== low-stock.txt ===` headers. The verbatim splice put that whole text into each file.

Trace `01M6Q9TECD4FQ22RYFAQ6NRDJM` (run 0):
- seq 740: the plan.
- seq 759: the synthesize step returns the 3-section text.
- seq 773: `totals.json` is refused as invalid JSON, which triggers a replan of totals and summary.
- seq 776: `low-stock.txt` is written with all 3 sections. Nothing guards `.txt` content.
- seq 812: the reflect step says `SATISFIED`, without having read the file back.
- seq 845: graded 0.833 (`low-stock.txt is exactly the sorted SKUs below 10` failed).

The repo already tried to fix this exact symptom. `packages/reasoning/src/strategies/planning/step-consumers.ts:1-13` cites H3 2026-11-05 with this very task. The fix tells the analysis step where its output goes, but `consumerDirective` (`step-consumers.ts:78-91`) emits one line per consumer. With 3 whole-argument consumers that name different files, the step gets 3 contradictory orders: "Your entire reply becomes the content of low-stock.txt … no … other files", then the same for totals.json and summary.md. No reply can satisfy all three. The model writes all three sections, which matches the trace.

Cross-tier:
- qwen 6a6a: its single h3-plan-only failure (0.833) had the same plan shape (s2 → all 3 writes). Its 4 passes used one producing step per file.
- cogito 6a6a: planned separate steps and failed on values, so not this defect.

This is a harness defect: a well-formed, arguably efficient plan cannot be executed correctly. The more capable model picks this plan shape every time.

The fix belongs at plan time. When one step has ≥2 whole-argument consumers with distinct targets, the plan is unsatisfiable as written. Either split the producer into one step per target, or reject the plan with a replan request. Plan validation points: `packages/reasoning/src/types/plan.ts:221-235` (`extractDependencies`, the reference scan) and `step-consumers.ts:48-69`. Secondary: the plan-execute reflect step (`packages/reasoning/src/strategies/plan-execute/reflect.ts`) accepted wrong file content without reading the file back.

### 2. 150 s cell cap vs. bonsai speed: 12/60 cells unmeasured (environment, with one harness lever)

There is no hang. A probe of rw-2 at a 560 s cap finished in 203 s (`01M6Q9C6P9Q31Y1PDYH7ACYBX0`, scratch `h3-bonsai-full/probe/`). One call (seq 56) used the whole 7200-token cap, all of it thinking (20301 thinking chars): 128 s at about 56 tok/s. It stopped with `max_tokens`. The thinking-runaway retry then recovered in 8 s (seq 70). The 7200 cap is the 1200 caller cap plus the 6000 thinking allowance (`widenNumPredictForThinking`, `packages/llm-provider/src/providers/local.ts:476`, per the smoke report). In timed-out rw-6 run 0 there are 2 `max_tokens` stops and 47852 thinking chars.

rw-7 times out on all 5 runs for a different reason. bonsai does real TDD: it reads 3 sources, writes 3 test files and runs `bun test` through `code-execute` until the tests pass, which takes 14-34 LLM calls (qwen at 6a6a averaged 3.8). The trace for rw-7 run 1 (`01M6QAFW314802M8QF62EJNS6W`) shows real progress until the cap: tests written at seq 266, fixes at seq 444.

Is this a harness defect? Mostly no: the cap was chosen for comparability, and the work is genuine. The harness lever is the 6000-token thinking allowance on the local tier. One runaway call costs about 85% of a cell. Not one-fix material on this evidence. To measure bonsai on rw-*, rerun those 12 cells with `--cell-timeout-sec 300`.

### 3. Stall-after-work after a degraded re-read (bonsai 3 runs: rw-2 ×2, rw-6 ×1; on all three tiers)

In rw-2 runs 2 and 3, the model writes `analysis.md` at iter 1. It then re-reads `sales-data.csv` to "verify my numbers against the full data". `stall_deliverable` ends the run (`guard-fired#325`, `#353`; consecutiveStalled 4/4).

What the model saw (run 2, `01M6QAX0Z3C9VT23HJ84PRHNXG`):
- The answer turn (seq 253) got the 2533-char CSV cut to 2000 chars.
- From seq 279 the same result is shown as 1202 chars plus a `recall("_tool_result_1")` hint.
- The re-read itself returned a 7-line preview plus `[Already done — do NOT repeat …]`.

So asking for the data again returns less than the first read. The model never called `recall`.

Attribution as model is still defensible: the day-2 stock-out rows were inside the 2000-char window at the answer turn, and the failed check is "stock-out identified". The degraded re-read is friction, not the decisive cause. 6a6a attributed `harness:stall-after-work` 3 on qwen and 1 on cogito. Anchor for the compression: `packages/reasoning/src/kernel/capabilities/attend/tool-formatting.ts:compressToolResult`.

## Instrument findings (benchmarks / diagnose, not the harness)

1. **Timed-out cells are labelled `no-trace`, but a partial trace exists.** `packages/benchmarks/src/h3/run-h3.ts:240` builds the trace path from `run0.traceId`, and a timed-out cell has no run0. `rax-diagnose --all` still finds these traces and scores them `environment:run-aborted`.
2. **All 12 aborted-cell traces contain the run twice** (`run-started` ×2, `run-aborted` ×1, every event duplicated). The 48 completed traces are clean. Per-run LLM-time sums over these traces double-count: most show about 300 s of LLM time in a 150 s cell. The cause was not located. It is probably the abort flush path in the bench runner.
3. **`code-execute` failures are reported `ok:true`.** `executed:false` becomes a `[Code execution failed: …]` observation (`packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:373-383`), but `tool-call-end.ok` stays true (rw-7 run 1, seq 175, 201, 228). Failure-streak counting and `cause` see a success.
4. **Finding 1 is attributed `model`.** The attributor has no rule for "the written content is a verbatim splice of a step output that several consumers shared".

## Other observations

- rw-6 run 4 is `solved=true` by the hidden check but `failure` in the run. The verifier vetoed a fabricated "82 ms" timing: no tool result contains it (`guard-fired#647`). The veto is correct, and the hidden check is lenient on fabricated measurements.
- ab-trap-5 run 4 is the only trap miss. It made 4/5 calls that returned ENOENT (the trap is the missing file), and `runtime-success-veto:outstanding-criteria` fired. It is labelled `environment:tool-failure`, which is probably a mislabel for an abstention-trap miss. Not investigated further.

## Next (one per cycle)

1. kernel-warden (reasoning planning): make a plan with ≥2 whole-argument consumers of one step, naming distinct targets, unrepresentable. Either split it at plan time or reject it for replan, at `step-consumers.ts:48-91` / `types/plan.ts:221`. Verify: `--task h3-plan-only` on bonsai-2:27b and qwen3:4b (cogito as guard). The reason is attributed model today, so record it with `verdict.ts --reason model:had-evidence-wrong-output --mechanism <new guard key>`. The fix must emit a guard-fired key so it is measurable.
2. Separately (bench owner): fix the run-h3 `no-trace` label and the duplicated abort traces before the next timeout-heavy tier run.
3. Optional measurement, no code change: rerun the 12 timed-out bonsai cells at `--cell-timeout-sec 300` into a separate results file.
