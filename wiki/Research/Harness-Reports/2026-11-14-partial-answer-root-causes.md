---
type: research
status: complete
created: 2026-11-14
tags: [harness, partial-credit, false-success, root-cause, zero-token, answer-quality]
---

# Why accepted-success runs earned only partial credit (zero-token, recorded traces)

Follow-up to [[2026-11-14-terminal-decision-basis-audit]]. That audit found 98 false successes with partial grader credit (0.17-0.91). This study reads each one: which hidden-grader items were missed, and why.

**Verdict.** The dominant blocker is neither exploration depth nor verification. It is that the model has the evidence and gets the final step wrong: **mental arithmetic and single-pass inference, with no check against the data**. 48% of missed items (109 of 239) are "retrieved but computed, selected or concluded wrongly". The second blocker (23%) is small models never reading the inputs, a qwen3:4b-only pattern. Roughly 12% of missed items are not model faults at all (hidden grader requirements the prompt never states, a regex miss). Model capacity matters less than it looks: the 8B-20B models fail in the same way as the 14B ones, and no model ever solved rw-2.

Scripts, per-run classification and the per-item CSV are in `2026-11-14-partial-answer-root-causes/` (`classify.py`, `agg.py`, `lev.py`, `per-run.csv`, `recs.json`). The scripts import `load.py` from a scratch path; fix the `sys.path.insert` line to rerun.

## Method and caveats

- Corpus: the 98 FALSE-SUCCESS cells with 0 < accuracy < 1 in `mismatches.csv` (P2a + P3a, sha `2269ce57e`). My filter on the cell files gives 100; the two extra (`gemma4:e4b|rw-2|2`, `gemma4:e4b|h3-required-tools|1`) are not in the audit and are excluded. The 11 zero-credit false successes are not classified (all llama3.1, cogito, qwen2.5 and one qwen3:4b; tasks h3-exact-value, h3-todo-heavy, rw-7, lh-enumerate-audit).
- Missed items come from the in-trace `eval-graded.checks[].passed` (the hidden grader's own items). 239 missed items across 98 runs.
- Cause per item is my classification from the trace (tool calls and results, file-write contents, final output), checked against the hidden-check source in `packages/benchmarks/src/tasks/real-world.ts`, `h3/tasks.ts`, `h3/long-horizon-tasks.ts`. Rules are in `classify.py`; they are deterministic per task, not an LLM judge. I read 30+ runs by hand to validate the rules.
- Causes: **NR** never retrieved the needed input; **RO** retrieved but omitted or never applied; **RW** retrieved but computed/selected/concluded wrongly; **HAL** fabricated beyond evidence or accepted a false premise; **FMT** instruction/format miss (includes hidden-rubric requirements the prompt does not state); **TM** tool/guard mechanics (placeholder written, wrong file, repetition-guard block, summarised result).
- Credit lost per run is split equally across its missed items to apportion lost credit by cause. Crude.
- Trace limits. (1) `llm-exchange` messages are capped at 2000 chars in the trace, so for plan-execute tasks (rw-3, h3-plan-only) I cannot prove how much of the CSV the model saw. The tool result and the correct low-stock selections in 14 of 18 plan-only runs say it saw the data. (2) `tool-call-end.result` is a "compressed preview"; the react-path messages carry the full file (checked on rw-2). (3) Bernoulli noise: 9 models, 12 tasks, k = 1-3, and the cells cluster by model x task. Task counts are uneven (rw-2 and rw-3 are 44% of runs). Read percentages as descriptions of this corpus.
- Frontier tiers are not in the corpus. No live model call was made.

## 1. Cause distribution (n = 98 runs, 239 missed items)

| Cause | Items | Share | Credit lost (apportioned) | Share of 37.6 lost |
|---|---|---|---|---|
| RW retrieved, wrong | 109 | 46% | 19.3 | 51% |
| NR never retrieved | 54 | 23% | 6.3 | 17% |
| FMT format / unstated rubric | 26 | 11% | 4.3 | 11% |
| RO retrieved, omitted | 24 | 10% | 3.6 | 10% |
| TM tool / guard mechanics | 21 | 9% | 3.5 | 9% |
| HAL fabrication / false premise | 5 | 2% | 0.7 | 2% |

Run-level primary cause (most common item cause in the run): RW 54, RO 18, TM 10, NR 9, HAL 4, FMT 3.

Item type (what the grader asked for):

| Rubric item type | Items | Dominant cause |
|---|---|---|
| diagnosis / cross-column hypothesis (rw-2) | 55 | RW 55 |
| per-file code fix or edit, multi-target | 48 | NR 27, RW 10, HAL 5, RO 4 |
| computation (sum, mean, dollar total) | 39 | RW 36, TM 3 |
| enumeration / per-item batch | 39 | NR 27, TM 7, RW 5 |
| format / structure | 25 | FMT 25 |
| analysis synthesis (aggregate + claim, rw-3) | 22 | RO 19 |
| tool mechanics / other | 11 | TM 10 |

By task (items): rw-2 61 (all RW), rw-3 43 (FMT 21, RO 19), h3-plan-only 33 (RW 17, TM 12), lh-debug-green 30 (NR 20), lh-pipeline-stages 21 (NR 16), h3-required-tools 13 (RW 11), lh-enumerate-audit 11 (NR 11), rw-6 9 (HAL 5), rw-7 7 (NR 6), rw-9 6, todo-heavy 3, rw-4 2.

## 2. What the data shows per cause

**RW is arithmetic and single-pass inference, not retrieval.**
- h3-required-tools (12 runs): the mean of 20 numbers. The model read `readings.csv` in full, then wrote a number from its head. `code-execute` was on the surface in all 12 and called in 1 (cogito run 0, and it returned an error). Written means: 15.50-24.69 against 21.83.
- h3-plan-only (18 runs): `totalUnits` wrong in 17 of 18 (true 461; written 387-614). The same runs got the low-stock filter right in 14 of 18, so the read was fine; the sum was not. The surface was `file-read` + `file-write` only, so there was no compute path at all.
- rw-2 (21 runs; 0 of 27 attempts solved across all models): every run read the full CSV, and attributed the drop to the 15% discount. Only 3 of 21 computed the correct day-1 total ($7,839.85); the rest gave wrong totals or per-unit figures. None grouped the TV SKU by day (8 orders on day 1, 3 on day 2). The failure is one missing analysis step, anchored on the loud signal, not missing data. The dollar-band item was missed in 6 runs (per-unit $127.50 or inconsistent totals); the other 15 landed in the $3,000-7,000 band by quoting the total drop while still blaming the discount.
- lh-pipeline-stages qwen3.5 (2 runs): read all 7 batches, then miscounted regional order totals.

**NR is almost only qwen3:4b.** 52 of 54 NR items. qwen3:4b reads one input and proceeds: lh-debug-green read 1 of 12 files (edited `clamp.ts` only) and then claimed "all six modules fixed"; lh-enumerate-audit read 1 of 12 invoices and still produced `audit.json`; lh-pipeline-stages read no batch file and fabricated `US/EU` rows; rw-7 never opened `processor.ts` or `pipeline.ts` yet stated "`bun test` exits 0" in 2 runs. No model of 8B or larger had an NR item. Prior evidence: `inputCoverage` raised reads from 40% to 93% and did not lift accuracy ([[../Ablations/2026-11-07-input-coverage/README]], OPT-IN-ONLY).

**FMT is largely the instrument.** rw-3 "contains a data table" (21 runs) requires a markdown pipe table; the prompt says only "surface whatever is most actionable... show your reasoning". 21 of 22 rw-3 runs lost it. That item is the single biggest grader-validity issue in the corpus. One more is brittleness: rw-6 gemma4:e4b wrote `$O(N \log N)$` and the regex `n\s*log\s*n` does not match LaTeX. h3-plan-only "## Reorder" heading (4 runs) is a real instruction miss.

**RO** is mostly rw-3: 19 runs wrote Engineering anecdotes (max salary, tenure) and never aggregated the department mean, which is what the "salary claim is grounded" item checks (band 138k-152k or a 35-49% premium). 9 of the 22 rw-3 runs contain no "average/mean" wording at all; most of the rest quote averages for performance or tenure, not salary.

**TM**: h3-plan-only wrote CSV contents or the totals JSON into `low-stock.txt` (5 runs) or never wrote `totals.json` (gpt-oss, run ended by `loop_detected:all_tools_called` labelled success). cogito h3-todo-heavy wrote the literal `<doubled_value>` to six files, then the repetition guard returned "You have already called file-write 11 times" for the corrective `out-6.txt` write (`ok:true` in the trace, file unchanged). granite rw-7: `code-execute` returned an empty error twice, then the guard blocked it. qwen3.5 rw-4: the comments fetch came back as a "key facts" summary plus a 2400-byte preview, so per-post counts were unrecoverable. Guard-blocked calls appear in 9 of 98 runs.

**HAL** is rw-6 (inverted "nothing to optimize" task): 4 of 5 partials accepted the false premise, rewrote working code and reported invented gains, no benchmark run. Another 8 runs claimed tests/fixes passed with no successful execution.

## 3. By model

Items by model family and size (run primary in the second table):

| Model | Runs | Items | NR | RO | RW | HAL | FMT | TM |
|---|---|---|---|---|---|---|---|---|
| qwen3:4b | 15 | 67 | 52 | 1 | 10 | 0 | 3 | 1 |
| gpt-oss | 10 | 30 | 0 | 5 | 10 | 1 | 5 | 9 |
| granite4:tiny-h | 16 | 30 | 2 | 2 | 21 | 0 | 4 | 1 |
| llama3.1 | 14 | 26 | 0 | 2 | 16 | 0 | 3 | 5 |
| qwen2.5:14b | 14 | 24 | 0 | 3 | 14 | 2 | 3 | 2 |
| cogito:8b | 13 | 23 | 0 | 3 | 16 | 0 | 3 | 1 |
| qwen3.5 | 7 | 23 | 0 | 4 | 17 | 1 | 0 | 1 |
| gemma4:e4b | 6 | 10 | 0 | 1 | 5 | 1 | 2 | 1 |
| qwen3:14b | 3 | 6 | 0 | 3 | 0 | 0 | 3 | 0 |

| Size band | Runs | NR | RO | RW | HAL | FMT | TM (run primary) |
|---|---|---|---|---|---|---|---|
| small (qwen3:4b, granite tiny, gemma e4b) | 37 | 9 | 4 | 18 | 1 | 2 | 3 |
| 8B (llama, cogito, qwen3.5) | 34 | 0 | 6 | 24 | 0 | 1 | 3 |
| 14B (qwen2.5, qwen3) | 17 | 0 | 6 | 8 | 2 | 0 | 1 |
| 20B MoE (gpt-oss) | 10 | 0 | 2 | 4 | 1 | 0 | 3 |

Larger models fail by a *different* cause only at one boundary: NR disappears from 8B up. Above that the cause is the same RW, plus more RO/FMT in the 14B rows (rw-3 report-style items). gpt-oss is the TM outlier (9 items): plan-only wrote CSV into the wrong files and ended on the attempt-based `all_tools_called` accept (A2 in the audit).

## 4. Stop behaviour (early stop with budget left)

- 74 of 98 runs (76%) ended on a model-chosen stop (`end_turn` 42, `final_answer` 32). The harness chose the stop in 24 (`harness_deliverable` 10, `loop_detected:all_tools_called` 9, `harness_synthesis` 3, `dispatcher_early_stop` 2).
- 89 of 98 (91%) ended at or below 50% of the iteration budget. Only 2 used 90% or more (granite todo-heavy, 14 of 14). Median 3 iterations, median 10.2k tokens.
- But more iterations is not the lever. The early-stop runs are the ones whose miss is arithmetic or a missing analysis step; a second pass with the same habit repeats it. Within one model the long-task signal is real: gpt-oss used 12-20 iterations on lh-debug/enumerate/pipeline and scored 1.00 (6 of 6); qwen3.5 used 4-10 on the same and scored 0.50-0.80 on two of them; qwen3:4b used 3-5 and scored 0.00-0.21. That is confounded by model strength and k is 2.
- Controls (solved successes on the same 12 tasks, n = 88): solved runs on rw-7 used 12 iterations / 33k tokens vs 7.5 / 17k for the partials. Todo-heavy solved runs used 5 iterations vs 14 for the partials (partials thrash on guards). Plan-only and required-tools solved runs look like the partials in iterations and tokens. They differ in what the model computed, not in effort: the solvers are mostly qwen3.5, gpt-oss, qwen3:14b (6 of 6 plan-only solves are qwen3.5/qwen3:14b/qwen3:4b).
- `run-started.config.mechanisms` for these cells: `verification:false`, `grounding:false`, `inputCoverage:false`, `fabricationGuard:off`, `budgetAnswerTurn:false`. The runs had no verifier in the loop; a "false success" here is the harness doing what that config says.

## 5. Levers

Estimates are share of the 37.6 lost credit points, with the 98-run, k <= 3 caveats above. None is measured. "Recoverable" assumes the mechanism fires and the model uses it.

| # | Lever | Addresses | Lost credit it touches | Estimate recoverable | Exists / cost | Needs live ablation |
|---|---|---|---|---|---|---|
| L1 | **Compute offload.** When the task needs a sum, mean, count or group-by over data the model has read, route it through `code-execute` (or a deterministic aggregate helper). Advisory `PendingGuidance` ("compute with code, do not estimate") plus, for tasks that need computation, putting `code-execute` on the surface. | RW computation: required-tools 11, plan-only 17, rw-2 dollar 6, lh-pipeline 5 | 8.0 (21%) | **4-6 pts (11-16%)** if the tool is available and called and works; 0 where no compute tool is on the surface | `code-execute` exists, was called in 1/12 required-tools runs, and all 6 calls in the corpus errored. Tool surface is a task/builder contract. Cheap | yes: 2 tiers |
| L2 | **Evidence-vs-claim recheck before finalize**, advisory: re-derive each number or selection in the answer from the observations (a model-written checklist of the figures it asserted, then check against tool results). Catches wrong sums, `58` for `63*2`, wrong filters. Not a veto. | RW (computation, selection, copy errors) | overlaps L1; extra on selection and rw-2 totals | 1-2 pts beyond L1, mostly the same items | partial: `verifier.ts` fabricated-measurement check exists but only compares numbers to observations, and `verification:false` in these runs | yes |
| L3 | **Competing-hypothesis pass for diagnosis tasks**: list >= 2 explanations, test each against a grouped view of the data, report the one the data separates. | rw-2 (9.2 pts, 0/27 solved) | 9.2 (24%) | **0-3 pts (0-8%)**; highly uncertain, single task; 8 models share the same anchor | none; would be a prompt/guidance mechanism; high overfit risk to one red-herring task | yes, and not on rw-2 alone |
| L4 | **Input-coverage with read-before-write order** (finish the existing `inputCoverage`/`writeCoverage` rework) | NR 54 items, all but 2 qwen3:4b; 6.3 pts | 6.3 (17%) | 1-2 pts. Prior ablation: reads 40% -> 93%, accuracy -5.3pp, +101% tokens; reads after writes did not help | exists, OPT-IN-ONLY; rework items 1-3 listed in the ablation | yes (already in kernel-warden queue) |
| L5 | **Outstanding-deliverable self-check against the prompt's explicit demands** (advisory checklist from the task text: headings, files, "verify tests pass", every listed item). | RO, G2, claimed-without-running (8 runs), plan-only heading | ~5 (RO 3.6 + G2 + HAL claims) | 1-1.5 pts | partial: delivery conditions exist for artifacts; "ran the tests" is not a receipt | yes |
| L6 | **Guard/tool mechanics.** (a) A repetition-guard block must not swallow a corrective write to a target that differs from the earlier one; (b) `code-execute` empty `ERR` result needs a reason string; (c) guard-synthesized replies are `ok:true` in the trace (audit item 6); (d) large `http-get` bodies compressed to "key facts" lose countable data. | TM 21 items | 3.5 (9%) | **1.7-2.4 pts (5-6%)**; these are defects, not model limits | kernel-warden / tools-warden; deterministic | no for (a)-(c), yes for (d) |
| L7 | **Premise check on "optimize/improve" tasks** (rw-6) | HAL 5 | 0.7 | < 0.7; single task | none | no, skip |
| L8 | Fix the measurement, not the harness: state the table requirement in rw-3 or drop it; widen the rw-6 `n log n` regex. | FMT 26 | 4.3 (11%) | up to 4.3 pts of *false* loss | `packages/benchmarks` (mine) | no |

Ranking by expected return per unit effort: **L1 > L6 > L8 > L5 > L2 > L4 > L3 > L7**. L3 is the largest pool but the least recoverable. Nothing here moves the termination owner; L1, L2 and L5 are advisory guidance and receipts, not new vetoes.

What does not look like a lever: more iterations by itself, a stronger exit gate, or an LLM judge on the final answer. The accepted answers pass every declared gate because the failing items were never declared.

## 6. Honest limits

- Item causes are rule-based. The "RW" bucket is wide: it joins arithmetic slips, anchoring (rw-2), and edit-wrong cases. Splitting it further would not change the ranking, but the L1 vs L3 split inside rw-2's dollar and attribution items is a judgment call (6 dollar items counted as L1).
- 10 runs (rw-4, rw-9, lh-enumerate-audit, rw-6) have one-off causes assigned by hand-written rules for a single run or two; I read each, but they rest on n = 1-2.
- L1 depends on `code-execute` working. In these 98 runs the tool was called 6 times (granite 4, cogito 1, qwen3.5 1), every call returned an empty error, and 3 more granite calls were blocked by the repetition guard. Zero successful calls. L1 needs L6(b) first; whether the tool works for a model that formats the call correctly is not shown by this corpus.
- Task mix is narrow (12 tasks). rw-2 plus rw-3 carry 44% of runs and 43% of lost credit.
- Single-model confounds: qwen3:4b alone is 67 of 239 items and 52 of 54 NR items.

## Erratum (2026-11-14, tools-warden, commit 7bacddc84)

The phrase "code-execute returned an empty error / every call errored with an empty ERR" above is wrong. Reading the traces and running the real handler shows the tool works and every failure carried a populated message. The failures were model-input faults: (1) ENOENT on relative paths because host mode runs with cwd=/tmp, (2) module syntax (`export ...`) inside the async wrapper, (3) non-JavaScript input (Python/bash), (4) the repetition guard blocking the retry. Commit 7bacddc84 hoists module syntax, hints the /tmp working directory on ENOENT and guarantees non-empty failure reasons. The L1 conclusion (the model rarely calls the compute tool; arithmetic is done in its head) is unchanged, and L6(b) is no longer a prerequisite for L1.
