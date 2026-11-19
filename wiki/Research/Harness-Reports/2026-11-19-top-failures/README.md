---
type: harness-report
status: complete
created: 2026-11-19
tags: [failure-ranking, attribution, rax-diagnose, h3, zero-token, compute-lever, duplicate-guard, never-engaged]
---

# Top harness failure classes on small models (zero-token, existing traces)

Zero model tokens. No live cells. Spike-level findings: nothing here is a measured lift. Every "predicted effect" is a hypothesis with a stated zoo shape that would prove or kill it.

## Part 1: quick-mode grading fix (done)

`runBenchmarks` -> `runTask` graded with `matchesExpected(output, task.expected)`, which returns `true` when `expected` is absent. The five hidden-check tasks (`s1-fibonacci`, `s2-palindrome-bug`, `m1-merge-intervals`, `m4-remove-duplicates`, `c3-test-suite`) carry `successCriteria: verifiable` and no `expected`, so they auto-passed in quick mode whatever the agent did.

Fix (`packages/benchmarks/src/runner.ts`, new `src/quick-grade.ts`): each quick task now runs in a per-task temp dir (`mkdtempSync` + `writeFixtures`, `withFileRoot(tmpDir, ...)` around `agent.run`, removed in a `finally`), and the verdict is `gradeQuickRun`, which routes `successCriteria` tasks through the same `scoreTask` as session mode (hidden fixtures written post-run, `bun hidden-check.ts`). Pass needs a measured accuracy of 1.0. A task with no grader at all (no `expected`, no `successCriteria`, no `abstainExpected`) cannot pass. Keyword-only tasks still use `matchesExpected`. The failure log line no longer says "Expected pattern not found" for hidden-check failures.

Tests: `packages/benchmarks/tests/quick-grade.test.ts` (4): each of the five ids fails on empty work; s1 passes only with a working `fibonacci` (and a stub `return n` fails); a no-grader task cannot pass; keyword tasks still grade by `expected`. `bun run repo verify packages/benchmarks` green (tests, typecheck, cross-cutting).

Inflated committed result files: none found. The committed benchmark JSON under `packages/benchmarks/benchmark-baselines/` (`real-world-full.json`, `t0-deterministic.json`) is session mode, and no committed JSON or markdown under `wiki/Research` or `packages/benchmarks` mentions `s1-fibonacci`. Quick mode writes nothing without an explicit output, so any inflated quick-mode run would be an uncommitted local file; I did not search the owner's local disk. Residual: quick mode does not run the scorer-v3 fabrication check (no run-evidence from a trace), same as before.

## Part 2: ranking method and corpus

Corpus: default-harness arms only, 8 result files (cells with `traceFile` on disk, inconclusive cells excluded): v0.19 `final` and `rerun` for qwen3:4b and cogito:8b, the `dev` regression-check pair, and zoo-live `off` arms for gemma4:e4b (f123) and cogito (f45). 320 graded cells: qwen3:4b 142 (mean accuracy 0.932), cogito:8b 163 (0.739), gemma4:e4b 15 (1.000, no loss). Each cell re-attributed with `attributeFailure` from `@reactive-agents/trace` (the library under `rax-diagnose attribute`); the CLI itself run on `benchmark-traces` (567 runs, 303 failed: harness 100, model 167, environment 26, unattributed 10), which mixes all tiers and arms.

Loss = `1 - accuracy` summed over cells (partial credit counted), so a reason that costs 0.17 per run ranks below one that costs 1.0. Scorer caveat: accuracy values are the file's recorded ones (v1, v2 or v3 depending on file); v3 only changes `rw-6` (`FABRICATION_CHECKED_TASKS`), where the zoo regrade already showed 7 of 15 solves carried invented figures, so `rw-6` loss here is understated.

Total loss: qwen3:4b 9.6, cogito:8b 42.5. Loss by `rax-diagnose` reason (all tiers):

| loss | runs | reason | tasks |
|---|---|---|---|
| 18.5 | 55 | model:had-evidence-wrong-output | rw-2, rw-3, rw-7, h3-plan-only, h3-required-tools |
| 13.6 | 15 | model:ignored-guidance | rw-7, rw-6, h3-todo-heavy, h3-required-tools |
| 9.3 | 11 | model:evidence-not-gathered | rw-7, h3-todo-heavy |
| 4.3 | 10 | model:fabrication-vetoed | rw-2, rw-6 |
| 2.5 | 5 | unattributed | h3-required-tools, h3-plan-only |
| 1.3 | 2 | harness:stall-after-work | h3-todo-heavy |
| 1.2 | 2 | harness:evidence-truncated | rw-2 |
| 0.5 | 2 | harness:tool-not-offered / premature-stop | rw-7, h3-todo-heavy |

Reading it: only 3.0 of 52.1 loss (6%) carries a `harness:` label. The `model:` labels hide the leaks, as the 2026-11-06 audit already showed (that audit: the `had-evidence-wrong-output` label is right for under half the runs). Ranking below is by cause read from the traces, not by label. Per task, the loss concentrates: cogito rw-7 11.0 (0/15 solved), h3-todo-heavy 9.2 (3/15), h3-required-tools 7.0 (0/15), rw-2 5.7 (0/10), h3-plan-only 4.0 (0/14); qwen3:4b rw-2 5.5 (0/10), rw-7 2.0, rw-3 1.5.

## Class 1: head arithmetic and aggregation with no calculation lever used or offered

Loss about 22 of 52.1 (43%). For qwen3:4b, `rw-2` alone is 5.5 of 9.6 (57% of its loss).

Decisive traces:
- cogito `h3-required-tools`, `01M7QR019YKDAV1RWFSJ02EEP7` (and 12 more): reads `readings.csv`, writes `mean.txt` = `20.45`; true mean `21.83`. Failed check `mean within 0.01 of 21.8300` in 13 of 15 runs. Tool surface was `file-read, file-write, code-execute`; `code-execute` was never called in any of the 15. Solved 0/15, 3.9k tokens/run. qwen3:4b solves this task.
- cogito `h3-plan-only`, `01M7QQYKFAFR4R7X8T5BSY1HD6`: `totalUnits` wrong in 14 of 14 runs (the sum of 24 quantities), plan-execute, surface has no `code-execute`. Solved 0/14.
- qwen3:4b `rw-2`, `01M7QKAEEFFN40Q8DB6NX6MTH9`: reads the CSV once, writes `analysis.md` in one turn, 3 iterations, blames the 15% discount; fails all three of "names the TV SKU", "stock-out identified", "recommends restocking" in all 10 runs (0/10). Tool surface `file-read, file-write` only: `tool-surface-resolved` reason is `visible: builtins-floor` for `file-write`, and the task declares no `code-execute`. The comparison needed (per-SKU day 1 vs day 2) is a group-by that a 4B model does not do by eye.

Instrument trap found on the way (cost me a detour, hence recorded): the `tool-call-end.result` field of the `file-read` shows `[file-read result - compressed preview] ... 38 more lines`, which reads like the model never saw day 2. It did: `llm-exchange.messages` at seq 46 and 71 contain the full CSV (`2025-03-11,ORD` present; the 4000-char inline cap in `conversation-assembly.ts:117` swaps in the stored full text). The trace records the stored preview, not what the model was shown. The attribution label `had-evidence-wrong-output` is correct here; the trace field is misleading.

Mechanism: the model computes aggregate figures and group comparisons in its head. Where the lever exists (`h3-required-tools`) a small-ish model (8B) ignores it; where it is not offered (`rw-2`, `h3-plan-only`) the bench configuration hides it (explicit `tools:` list, so `builtins-floor` only). Same family as [2026-11-15-compute-offload-spike](../2026-11-15-compute-offload-spike.md) (35% of accepted runs on figure-checking tasks wrong). That spike recommended (c) a cheap tool-description fix, then (a) one surface-plus-guidance mechanism behind an ablation; the ledger and `git log` show neither landed as of today.

Root-fix hypothesis: when the task text asks for a mean, sum, count, or comparison over file contents and `code-execute` is available, the step that writes the figure must be preceded by a `code-execute` call, or the harness puts `code-execute` on the surface and names it in the pre-write guidance. Two parts: (1) cheap, in `packages/tools/src/skills/code-execution.ts`, the description already says "Best for: math, aggregation", so the lever is the guidance path, not the description; (2) the measuring side: `rw-2`, `h3-plan-only`, `rw-3` need `code-execute` in their `tools` (available) to be a fair test of the lever, which is a task-definition change in `packages/benchmarks` (re-hash, comparability break, never mid-run).

Predicted effect (hypothesis): cogito `h3-required-tools` 0/15 -> 8-12/15 (qwen3:4b's solve pattern on the same task is the ceiling evidence, 100%); `rw-2` unknown, 0/10 each tier, a plausible 3-6/10 on qwen3:4b only if the model both calls the tool and spots the stock-out (the second step is not proven by any trace); `h3-plan-only` bounded by the separate `{{from_step}}` fan-out defect already named in the 2026-11-06 audit. Honest range for the class: +9 to +20 solved runs of 39 failing on these four task/tier cells, tokens per solved run roughly flat to -10% (one `code-execute` call replaces a long in-head derivation; `h3-required-tools` costs 3.9k tokens/run and ends unsolved).

Zoo shape that proves it: scripted model that, given a CSV and a "write the mean" task with `code-execute` visible, either calls `code-execute` or writes a hand-computed wrong figure; assert the pre-write gate/guidance fires and the run ends with a `code-execute` call before `file-write` (activity key `guard:...` or `requirement:tool-coverage@...`). Then cogito `h3-required-tools` k=5 as the live proof (the only cell with the lever already offered).

Owner: tools-warden (guidance text / surface), kernel-warden (the pre-write gate and surface resolution, `packages/reasoning/src/kernel/capabilities/act/`), harness-warden for the benchmark task `tools:` change. Structural (new gate), with a cheap first step: `tools:` declaration on three bench tasks (one file, but a scoring-boundary change).

## Class 2: duplicate-call refusal steers the model to write outputs it has not read the inputs for

Loss 5.2 on one task and cheap to fix; cogito `h3-todo-heavy` is otherwise a 3/15 cell.

Decisive traces: cogito `h3-todo-heavy` `01M7QQZ93AWGVYJ0VC7YYSTBWP`, `01M7QRC26HEC3WN92C1CJ8Y3QG`, and 6 more. Timeline of the first: reads notes-1, writes out-1 (34, correct), reads notes-2, writes out-2 (84, correct), reads notes-3 (8), then re-reads notes-3. `file-read` is refused by `duplicateGuard` with the text `8 [Already done - do NOT repeat. Still outstanding: write the file ./out-3.txt; write the file ./out-4.txt; write the file ./out-5.txt; write the file ./out-6.txt. Do the next item now.]`. The model then reads notes-4 (63) and writes out-3, out-4, out-5, out-6 all as `126` (63 x 2). notes-3, 5, 6 never contributed; notes-5 and notes-6 were never read. Exit gate passes, `dispatcher_early_stop`, status success. Graded 0.5.

Census on this corpus: runs containing a `duplicateGuard` refusal (`Already done - do NOT repeat`): cogito `h3-todo-heavy` 8 runs, 0 solved, 5.2 loss, 12.5k tokens/run; the 7 runs without a refusal solved 3 (qwen3:4b and gemma4:e4b, 17 runs without one, solved 17/17). Same refusal also in cogito `h3-exact-value` (6 runs, 5 solved) and `rw-7` (2 runs, 0 solved).

Mechanism: the refusal note is built at `packages/reasoning/src/kernel/capabilities/act/guard.ts:413`; its `nextHint` is `contractOutstanding(...)`, the exit gate's list of unwritten deliverables only. It never names unread enumerated inputs, so the next-step instruction is "write the remaining files now" while three inputs are unread. The label the instrument gives is `model:evidence-not-gathered` (8 runs), which hides that the harness's own message instructed the skip. Confound to state: refusals occur in runs where the model already loops, so the 0/8 vs 3/7 gap is a selection effect in part; the guidance text is the only harness-controlled variable in it.

Root-fix hypothesis: in the same `duplicateGuard` branch, when an enumerated task input is unread (the set `deriveListedInputs` already computes, `verify/derive-inputs.ts`), the hint names the next unread input before any write ("Next: read notes-4.txt"); otherwise unchanged. One function, no new mechanism, no new flag. It is the narrow part of the `inputCoverage` idea (opt-in, +101% billed tokens, 2026-11-07) done as a refusal-message edit instead of a gate.

Predicted effect: 8 runs with the refusal, 0 solved; non-refusal rate for this model is 3/7. Predict 2-4 of 8 recovered (cogito `h3-todo-heavy` 3/15 -> 5-7/15). qwen3:4b and gemma are untouched (zero refusals), so no small-tier movement, and no token cost (the refusal already happens). Per solved run: unmeasurable now (0 solved among refusal runs).

Zoo shape: scripted model on a 6-input task that repeats a read after reading inputs 1-3; assert the refusal text contains the first unread input path and not only a write list, and that the scripted follow-through reads it. Observable activity key: the existing refusal `guard-fired`, with the hint text as metadata. Live: cogito `h3-todo-heavy` k=5 plus cogito `h3-exact-value` as the no-regression cell.

Owner: kernel-warden. Cheap (1 file, 1 branch; plus a pin test).

## Class 3: tool call printed as text, one ignored nudge, then terminal `abstained` with zero tool calls

Loss 13.6 labelled `model:ignored-guidance` (15 runs); 12 of them are this shape (cogito `rw-6` 5, `rw-7` 7), 0 solved among them.

Decisive traces: cogito `rw-7` `01M7QR9G7KHQY1MY2MVHQ43B08`, cogito `rw-6` (first `ignored-guidance` run in `final-cogito-8b.json`). Both: first turn answers "I'll help you ... let's start by reading the source files: ```typescript // src/..." (the call printed as prose), the harness injects `guidance to call required file-read (unsatisfied)` (seq 25, 1425), the next turn again makes no `file-read` call ("it printed one as text instead", `llm-exchange` seq 33, 1433), `signal-effect=ignored`, and the run terminates `abstained` after 4-5 iterations, status failure, 6k tokens. `file-read` never succeeded once, yet the same model solves `rw-6` 9 of 15 when it does engage.

Mechanism: one text-form guidance nudge per run, then an abstention terminal that the harness itself finalizes, for a model whose failure is protocol-level (prints, does not emit, a tool call). The nudge channel is the same channel the model just failed on. This is the harness giving up one step before the lever that exists: `actOrAnswer` (forced retry), which is opt-in.

Honesty gate: this class has the weakest evidence for recoverable solves. The zoo showed `actOrAnswer` cut `never-engaged` 2 -> 0 on `rw-6`, but at scorer v3 the `rw-6` "lift" vanished (2/5 vs 2/5, ledger `d7f3c9b2`): the engaged runs fabricated figures. `rw-7` is a near-floor task (acc 0.27 -> 0.40 on 5 runs, 0 solved either way). So engagement is recoverable; solves are not yet shown. Treat as a token and honesty item first (6k tokens spent to produce a failure that reads as an abstention of a solvable task).

Root-fix hypothesis: abstention must not be a terminal for a run with a pending required tool and zero tool calls attempted natively; escalate to the forced-call retry (the `actOrAnswer` redirect, already built) before the terminal, on the substrate, not per strategy (Pitfall 12: `emitTerminalDecision`, `finalizeStrategyResult`, terminal verify gate). That is a default-on question: needs the ablation-warden bar (>=2 tiers, >=3pp, <=15% token overhead).

Predicted effect: engagement 12/12 failing runs reach a tool call (zoo: 5/5 redirects fired); solves: `rw-6` +0 to +2 of 5 after v3 fabrication check, `rw-7` +0; token cost per run roughly +2-3k for the retry, partly offset by the avoided 6k abstention path. State plainly: predicted solve gain is small and unproven.

Zoo shape: scripted model that prints a fenced tool call twice when a required tool is pending; assert the run does not terminate `abstained`, the forced call is issued, and the run ends via a verified answer. Live: cogito `rw-6` plus `rw-7` k=5, scored at v3.

Owner: kernel-warden (terminal path), ablation-warden (default-on gate). Structural.

## Not top-3, noted

- `h3-plan-only` `{{from_step}}` fan-out (cogito 0/14, qwen3:4b 13/14): the 2026-11-06 audit's H-assembly item, `packages/reasoning/src/types/plan.ts:173-207`. Its failed check here is `totalUnits correct` (14/14) plus the sorted-SKU file (7/14), so the arithmetic class and the fan-out class overlap; I did not separate them.
- `harness:false-veto` on `rw-6`: 10 runs, loss 0 (the grader passed them); the cost is label and token, not score.
- qwen3:4b `rw-3` (1.5): "salary claim is grounded in the data" 8 of 10; a grounding failure, not arithmetic; the v3 fabrication check does not cover `rw-3`.
- gemma4:e4b: 15/15 solved on the corpus, nothing to rank.

## What I could not do

- No scorer-v3 regrade of the whole corpus: `2026-11-18-rescore/rescore.ts` writes its README and JSON beside itself and would overwrite committed v2 artefacts. Only `rw-6` is affected by v3.
- `rax-diagnose attribute --all` was run on `benchmark-traces` and two zoo directories; the per-model, per-cell join used the same library in a scratch script (not committed).
- Predictions are spike-level. None is a lift claim. The cheapest to prove is Class 2 (one scripted zoo cell, one live cell).

## Ledger

Three entries appended to `improvement-ledger.json` (status `baseline`, decision `baseline`, `liftPp 0`: unmeasured hypotheses, not verdicts).
