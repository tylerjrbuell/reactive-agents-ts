---
type: harness-report
status: complete
created: 2026-11-19
tags: [arithmetic, code-execute, compute-lever, repeat-failure-guard, census, zero-token, spike]
---

# Arithmetic lever census: how often does a head-computed figure get written, how often is it wrong, and what stops a calculator from fixing it

Zero model tokens, no live cells, no code edits. Spike-level: nothing here is a measured lift. Every "predicted" number is a stated scenario, not a result. Trigger: [zoo-live addendum 7](../2026-11-18-zoo-live/README.md) (suite-v2 lever pilot: `code-execute` offered, engaged in 1 of 30 runs; one engaged run looped 30 failing calls, 82k tokens). Prior art this extends: [2026-11-15 compute-offload spike](../2026-11-15-compute-offload-spike.md) (accepted-run census) and Class 1 of [2026-11-19 top failures](../2026-11-19-top-failures/README.md).

## Verdict

1. **The trigger is common and clean.** In 84% of graded runs on the arithmetic tasks the run wrote a figure that no tool result and no task text contained (815 of 976). The same short-data-write predicate fired in 0 of 798 runs on 10 non-arithmetic tasks, so it can be a precise trigger.
2. **The figure is wrong exactly where the model is weak.** Offered-calculator `h3-required-tools` (mean of 20): cogito:8b 50 of 52 wrong, llama3.1 13/13, qwen2.5:14b 13/13, granite4:tiny-h 6/6; qwen3:4b 2/29, gemma4:12b, qwen3.5, gpt-oss, qwen3:14b 0/13. Nothing to recover on the strong side.
3. **Engagement is not the bottleneck; call success is.** Of 188 runs where `code-execute` was visible, 67 (36%) called it, and **3 (1.6%) ever got a computed value back**. Of the 84 runs from the four weak models, 31 called it and 0 got a value. 73% of failed calls (213 of 290) never executed: wrong language or shell input (140), or JS syntax errors from pasting data or Python-isms (73); 114 of 141 calculator-using runs had at least one such call. The tool already says "JavaScript/TypeScript only" after `e5b2e9068` (2026-11-15), and models still re-send Python (at least 56 such rejections in the corpus).
4. **So a nudge to use the calculator has a ceiling near zero on the models that need it** until call success is fixed. A nudge alone: predicted +0 to 2pp on cogito `h3-required-tools`. Fixed contract plus nudge: scenario range 3 to 32pp (grid below), unmeasured.
5. **The repeat-failure guard is a cost and safety item, not an accuracy item.** It fires in 8% of calculator-using runs at its tightest useful setting, on runs that are already failing (0 of 5 graded passed), and the 30-call loop is 1 run in 141. Real hole found: the converging-retry carve-out in `repetitionGuard` lets any call with different arguments pass after a failure, so a never-converging loop is bounded only by the iteration cap or the wall clock.

Recommended order: (1) calculator call-success repair (tools-warden), (2) repeat-failure guard via the carve-out (kernel-warden), (3) the write-time nudge only after (1) shows call success of at least 25% on cogito. Ablation-warden bar applies to (2) and (3); see section 6.

## 1. Corpus and method

- Sources, deduplicated by `runId`: `packages/benchmarks/benchmark-traces/**` (568 files), `wiki/Research/Harness-Reports/**` (zoo-live, wire-corpus, gate-traces, v0.19 H3), and `/home/tylerbuell/campaign-traces/**` (2003 files, outside the repo; the 2026-11-15 spike corpus plus an `offload` arm). Scanner and helpers lived in the session scratchpad, not committed.
- 976 graded runs on the 11 arithmetic-bearing task ids (`h3-required-tools`, `h3-plan-only`, `h3-todo-heavy`, `h3-exact-value`, `rw-2`, `rw-3`, their `-calc` v2 twins, `lh-pipeline-stages`, `lh-enumerate-audit`). 488 are dated before 2026-11-15, 488 after. A further 141 runs call `code-execute` on any task (used for the failure census, section 4).
- **Calculator offered** = any `tool-surface-resolved` event lists `code-execute` in `visible` or `callable` (188 runs). **Not offered, surface known** = events exist, none list it (573). **Unknown** = no surface events, older trace format (215: `h3-plan-only`, `rw-3` and their `-calc` twins; I cannot show the calculator was offered on the plan-execute path, same caveat as addendum 7).
- **Ungrounded figure written**: a `file-write` whose content has a number that appears in neither the task text nor any earlier non-writer, non-meta tool result (`h3-exact-value`: the final answer). Same family as `fabrication-count.ts` (percent only) widened to any number. Numbers inside identifiers and dates are skipped. Counts figures the model computed correctly too: "ungrounded" is not "wrong".
- **Wrong** = the task's own graded arithmetic check failed (`mean within 0.01`, `totalUnits`/`skuCount correct`, `out-N.txt is X`, the sum regex, `dollar impact` band, pipeline group sums). **Would solve if right** = every failed check was an arithmetic check. It is an upper bound on recovery, not a prediction.
- **Ran / produced a value** (calculator): result text has `"executed":true` and none of the failure markers; value means non-null `result` or non-empty `output`. Re-derived from result text because traces before 2026-11-05 (`ae7f80b69`) mark failed `code-execute` calls `ok:true`. After that fix the trace is reliable (47 post-11-15 calls, 2 ok, 0 mislabeled).
- Caveats: mixed SHAs; k is 1 to 10 per model-task cell and cells cluster; the corpus is selected for arithmetic tasks, so frequencies describe this corpus, not the population of real tasks. No frontier models.

## 2. Census: calculator offered

Per task (all dates; wrote = ungrounded figure written; "valued" = calculator returned a value):

| Task | n | Wrote figure | Called calc | Valued | Arith check failed | Solved | Would solve if figure right |
|---|---|---|---|---|---|---|---|
| h3-required-tools | 137 | 123 | 46 | 2 | 88 | 45 | 80 |
| h3-todo-heavy | 16 | 11 | 6 | 1 | 15 | 1 | 15 |
| lh-enumerate-audit | 13 | 0 (booleans, not numbers) | 8 | 0 | 12 | 1 | 10 |
| lh-pipeline-stages | 12 | 11 | 7 | 0 | 12 | 0 | 0 (other checks also fail) |
| rw-2-calc | 10 | 10 | 0 | 0 | 4 | 0 | 0 (SKU diagnosis also missing) |
| Total | 188 | 155 (82%) | 67 (36%) | 3 (1.6%) | 131 | 47 | 105 |

Post-2026-11-15 slice (after the JS/TS-only contract fix): 115 runs, 88 wrote, 45 called, 1 valued; `h3-required-tools` alone 64 runs, 24 called, 0 valued, 10 solved (all qwen3:4b).

`h3-required-tools` by model (calculator offered, all dates):

| Model | n | Wrote | Called | Valued | Wrong | Solved | Would solve if right |
|---|---|---|---|---|---|---|---|
| cogito:8b | 52 | 46 | 22 | 0 | 50 | 0 | 46 |
| llama3.1 | 13 | 11 | 6 | 0 | 13 | 0 | 12 |
| qwen2.5:14b | 13 | 12 | 3 | 0 | 13 | 0 | 12 |
| granite4:tiny-h | 6 | 6 | 0 | 0 | 6 | 0 | 6 |
| deepseek-r1:14b | 4 | 0 | 0 | 0 | 2 | 0 | 0 (no write at all) |
| qwen3:4b | 29 | 29 | 12 | 0 | 2 | 27 | 2 |
| gemma4:e4b | 3 | 2 | 2 | 1 | 2 | 1 | 2 |
| gpt-oss | 6 | 6 | 1 | 1 | 0 | 6 | 0 |
| qwen3.5 / qwen3:14b / gemma4:12b | 11 | 11 | 0 | 0 | 0 | 11 | 0 |
| Total | 137 | 123 | 46 | 2 | 88 | 45 | 80 |

Reading: the four weak models carry 80 of 88 wrong runs; 0 of their 84 runs ever got a computed value even though 31 called the tool. qwen3:4b called it in 12 runs, never got a value in any, and was right in 10 of those 12 anyway (head arithmetic is within its reach). In `h3-required-tools` the weak models often write the guess first (iteration 1 to 3) and only then try the tool; 8 of the 46 calling runs wrote the figure before their first call. Calculator engagement costs tokens when it fails: cogito 3.6k tokens/run without a call, 4.5k with failed calls (+27%).

Recoverable loss, upper bound: on offered `h3-required-tools` 80 of 137 runs (58%) would solve with a right figure; 46 of them are cogito, whose offered-arm baseline is 0 of 52 solved. Not a prediction: it assumes the calculator works every time.

## 3. Census: calculator not offered, and where the figure is wrong without the lever

Not offered, surface known (573 runs, 454 wrote a figure, 230 with a failed arithmetic check):

| Task | n | Wrote | Arith check failed | Solved | Would solve if right |
|---|---|---|---|---|---|
| h3-todo-heavy | 199 | 178 | 110 | 85 | 110 |
| h3-exact-value | 186 | 169 | 20 | 159 | 20 |
| lh-enumerate-audit | 39 | 0 | 23 | 16 | 13 |
| lh-pipeline-stages | 26 | 24 | 20 | 6 | 4 |
| rw-2 | 106 | 71 | 41 | 1 | 0 |
| h3-plan-only | 12 | 8 | 11 | 0 | 2 |
| rw-3 | 5 | 4 | 5 | 0 | 0 |

Surface unknown (215: `h3-plan-only` 111, `rw-3` 85, v2 twins 19): 206 wrote a figure, 142 failed an arithmetic check, 57 would solve if right. Most `h3-plan-only` losses also carry the plan-execute fan-out defect, so its recovery is small.

`h3-todo-heavy` decomposed by the actual written value (215 runs; final successful write per `out-N.txt` against the true doubles 34, 84, 16, 126, 58, 108). "slip" = a wrong integer that is not another note's double; "copy" = another note's double (lag or copy, a harness-wiring cause, not arithmetic):

| Model | n | Runs with a slip | Slip items | Runs with a copy | All six right | Would solve if slips fixed |
|---|---|---|---|---|---|---|
| cogito:8b | 93 | 17 | 41 | 27 | 8 | 8 |
| llama3.1 | 13 | 8 | 46 | 2 | 0 | 7 |
| qwen2.5:14b | 13 | 4 | 13 | 2 | 6 | 3 |
| qwen3:4b | 40 | 4 | 18 | 3 | 26 | 2 |
| gemma4:e4b | 32 | 0 | 0 | 0 | 31 | 0 |
| granite4:tiny-h | 6 | 0 | 0 | 5 | 0 | 0 |
| Others (gpt-oss, qwen3.5, gemma4:12b, qwen3:14b, deepseek) | 18 | 0 | 0 | 0 | 16 | 0 |
| Total | 215 | 33 | 118 | 39 | 87 | 20 |

Slips grow with magnitude (by output index 1 to 6: 10, 16, 14, 22, 28, 28), the signature of in-head arithmetic. Pure arithmetic accounts for 20 of 215 runs (9%); a copy or lag cause is 39 runs. The todo-heavy "cause F" (out-6 wrong, addendum 7) is the same class. A calculator is the wrong lever for doubling an integer; the general failure mode is "figure derived in the head and written without any check", which is what the trigger in section 5 detects.

## 4. Failure census of `code-execute` calls (any task, 141 runs, 326 calls, 36 executed)

Failed calls: 290 (89%). Classified from result text:

| Class | Calls | Share of failures | Example |
|---|---|---|---|
| A. wrong language, shell input, bad param | 140 | 48% | `language "python" is not supported`; `Parameter "language" must be one of`; `"ls -R ..." is a shell command` |
| B. JS syntax: raw data or Python-isms pasted as code | 73 | 25% | `The constant "qty" must be initialized`; `Unexpected pandas`; `JSON Parse error: Unexpected identifier "sku"` |
| C. module, reference, path | 36 | 12% | `parsed is not defined` (state not kept between calls), `Cannot find module`, `ENOENT /tmp/readings.csv` |
| D. existing repetition guard fired | 22 | 8% | `You have already called code-execute 2 times. Stop repeating this tool.` |
| E. other | 19 | 7% | |

(Class A and B are pre-execution: the code never ran. Class C includes some runtime failures after parsing.)

Two tool-contract facts the traces expose: each call is stateless (a later call cannot see `parsed` from the earlier one, so the model must re-embed the data every time), and the working directory is `/tmp` while task prompts name relative paths, so the only route to the data is pasting it into the code (the 30-call loop pasted a CSV into `JSON.parse`).

Consecutive-failure streaks (a streak resets on a run that executed; "same error" = identical error text after masking paths and digits):

| Rule | Calc-using runs that fire | Graded passed / failed | Excess calls past the trigger | Tasks |
|---|---|---|---|---|
| any failure, N=3 | 38 (27%) | 10 / 22 | 58 | rw-7, h3-required-tools, lh-* |
| any failure, N=4 | 15 (11%) | 4 / 6 | 37 | same |
| same error, N=3 | 11 (8%) | 0 / 5 | 39 | h3-required-tools, rw-7 |
| same error, N=4 | 6 (4%) | 0 / 1 | 31 | h3-required-tools, a7 loop |
| same error, N=5 | 1 (1%) | n/a | 25 | the a7 loop (27-call streak, cogito) |

The any-failure rules fire on passing runs: gemma4:12b and qwen3.5 on `rw-7` and `lh-debug-green` use `code-execute` as a test runner, fail 3 to 7 times while editing, and pass. A rule that counts every failure would break them. A rule keyed to identical error text or to "never executed" does not. The a7 loop's 30 calls were not byte-identical (the model changed the code each time, which the converging-retry carve-out allows), but it had a 27-call failure streak and a 17-call same-error streak, so both the same-error and the never-executed forms fire early on it. Honest limit: one loop run in 141 means the rule's value cannot be shown from existing traces beyond this single shape.

## 5. Lever designs, ranked

Predicted effects are scenarios from the census; none is a measurement. Cogito `h3-required-tools` offered arm is the reference (0 of 52 solved, 22 engaged, 0 valued).

### L1. Calculator call-success repair (tools-warden), first

Failure mode: model reaches for the calculator and fails on the contract (A + B = 73% of failed calls). Candidates, cheapest first: (a) when a call is rejected or never executed, the failure carries a minimal runnable example that already embeds the task's data location, so the retry is a copy edit; (b) failure of class B (syntax) names "the code is parsed as JavaScript; data must be a quoted string or array literal"; (c) owner decision, not recommended without review: accept Python via `python3` when present (same trust class as the existing host JS execution, but a new execution surface).
Trigger frequency: any run that calls the tool and does not execute: 114 of 141 calculator-using runs (81%) had at least one never-executed call. Predicted effect: unknown from traces; the only success rate observed is 2 of 44 engaged offered runs, so the baseline is about 5%.
False-positive risk: none to unrelated runs (only changes a failure observation). Token cost: neutral to positive (a failure message of about 60 more tokens, fewer retries).
Zoo shape: see S2. Ablation bar: it changes a tool's failure text on the default path; a tool-contract fix with a zero-token shape and a cogito `h3-required-tools` k=5 check is proportionate, ablation-warden judges whether it needs the full lift bar.

### L2. Repeat-failure guard (kernel-warden), cost and safety

Failure mode: model re-issues a failing tool with small variations until the cap. Boundary to fix: the converging-retry carve-out in `packages/reasoning/src/kernel/capabilities/act/guard.ts:532` passes any call whose arguments differ after a failure, so only byte-identical retries reach the "Stop repeating this tool" nudge. Minimal rule: the carve-out stops applying once the tool's last N calls were all non-executions (or the same error text) with no successful result in between; the nudge then says to use a different approach (compute from the data already in context, or answer from what was observed). Count only calls that did not execute, so a failing test run (`executed:true`, exit code non-zero) never counts, which keeps `rw-7`-style debug loops out.
Trigger frequency: same-error N=3, 11 of 141 calculator-using runs; N=4, 6. As a fraction of all 1,725 graded runs scanned, under 1%.
Predicted accuracy effect: about 0 (the runs it fires on are already failing, 0 of 5 graded passed). Predicted cost effect: removes about 39 excess calls at N=3 across the corpus; the single pathological run was 82k tokens against a 3k to 15k norm for these tasks. False-positive risk: low for the never-executed rule (no passing run in the corpus fires); high for an any-failure rule (4 of 10 graded firing runs passed). Token cost: one guidance line, only when it fires.
Zoo shape: see S3 (fires) and S4 (must not fire). Ablation bar: yes (default path, tool-call guard). The usual lift bar (at least 3pp) cannot be met by a cost guard; ask ablation-warden to accept "no regression on `rw-7`, `lh-debug-green`, `h3-required-tools` at 2 tiers plus token reduction on S3" as the bar, or decline to default it.

### L3. Write-time ungrounded-figure guidance (kernel-warden), last, gated on L1

Failure mode: model writes a figure no tool produced while a calculator is visible. One-shot `pendingGuidance` (per `AGENTS.md` pitfall 9) after the first short data-file write that carries an ungrounded number, only when `code-execute` is visible and unused this run. It is guidance, not a refusal: a refusal burns an iteration in budget-bound tasks (cause E in addendum 6) and the superseded-write carve-out already lets the model correct the file afterward. Trigger predicate (deterministic, zero tokens): file-write content of at most 200 characters, a non-code extension, containing a number absent from the task text and earlier tool results.
Trigger frequency: 123 of 137 offered `h3-required-tools` runs (90%), 189 of 215 `h3-todo-heavy`, 110 of 123 `h3-plan-only`; 0 of 798 runs on 10 non-arithmetic tasks (`rw-6`, `rw-7`, `rw-9`, `rw-4`, `ab-trap-4`, `ab-trap-5`, `h3-continuation`, `lh-1`, `lh-debug-green`, `lh-enumerate-audit`; `rw-2` and `rw-3` write markdown reports and do not trip the short-write limit, so they are out of scope, not clean). Precision (fired run failed): 75% plan-only, 64% required-tools, 54% todo-heavy, 79% pipeline; a fired run that was already right takes one useless line.
Predicted effect (scenario grid, cogito `h3-required-tools`; lift = engagement x call success x P(it then writes the computed value, about 0.8 from the two runs that got a value)): engagement 42% (today) or 80% (with nudge) against call success 5% (today) or 25% or 50% (after L1):

| Call success | Engagement 42% | Engagement 80% |
|---|---|---|
| 5% | 1.7pp | 3.2pp |
| 25% | 8.4pp | 16pp |
| 50% | 17pp | 32pp |

Without L1 the realistic cell is the top-left (about 2pp, inside the k=10 noise of about 13pp). Token cost: about 40 tokens per fired run plus 1 to 3 calculator calls when it engages (cogito +1k tokens/run). False-positive risk: the todo-heavy case where a correct doubling gets a "verify with the calculator" line (46% of fires there). Mitigation: fire only when the run has no earlier ungrounded-write and the figure is not a pure copy; keep it one-shot. Not to build before L1.
Ablation bar: yes, full (new default-on mechanism): at least 2 tiers, 3pp lift, at most 15% token overhead. Cross-tier: qwen3:4b, gemma4:e4b and gpt-oss are right without it (0 to 7% wrong), so any lift can only show on cogito, llama3.1, qwen2.5:14b, granite4:tiny-h; that is one family of weak local models, so the two-tier bar may need a second weak family (llama3.1) rather than a strong one.

### Not recommended

- Refusing the first ungrounded write (gate form of L3): burns an iteration on todo-heavy's 14-cap and fires on correct doubling.
- A keyword detector on the task text ("mean", "sum", "total", ...): fires on 11 of 20 task ids, 3 of them wrong (`ab-trap-5`, `lh-1`, `lh-debug-green`), 17% of firing runs, and misses `rw-3` entirely. The write-time predicate is more precise and needs no language matching.

## 6. Zero-token zoo shape specs (not built)

Each is a `Shape` for `packages/benchmarks/src/sim/shape.ts` (fields: `id`, `sourceTraceId`, `task`, `tools[]`, `policy`, `ideal`, `run`), in the style of `shapes/pending-write.ts`. The policy reads the request messages for the imperative of the latest guidance or refusal, as that shape does.

- **S1 `arith-ungrounded-write`** (for L3). Task: the `h3-required-tools` text. Fixture: 20 readings, true mean 21.83. Tools: `file-read` (returns the CSV), `file-write`, `code-execute` (scripted: runs the JS and returns `{"executed":true,"result":21.83,"output":"21.83","exitCode":0}` when the code body contains the data literal, else the class-B failure). Policy: turn 0 read, turn 1 write `mean.txt` = `20.45` (head figure), then it obeys the first imperative of any guidance naming `code-execute` (calls it with the correct JS, then rewrites `mean.txt`), otherwise ends. `run`: `maxIterations` 10, `requiredTools` `["file-read","file-write"]`, tier `local`. Assertions: the guidance appears exactly once in the system prompt of turn 2 (activity: `pendingGuidance` render or a named guard event); `toolSeq` equals read, write, code-execute, write; final `mean.txt` is `21.83`. Ignoring arm: same policy with guidance ignored; the run ends within the cap, one fire only, no refusal, `maxTurns` bounded. Control arm: a run whose figure is quoted from a tool result (no ungrounded number) must not fire.
- **S2 `ce-contract-recovery`** (for L1). Same task. Policy: sends Python (`import pandas`) with `language:"python"`, then reads the failure, and succeeds on the next call only if the failure observation contains a runnable JS example (`/require\('fs'\)/` or an inline-data template). Assertions: the observation text carries the example; call 2 executes. Control: the current text leaves the policy in the failure loop (documents the baseline).
- **S3 `ce-never-executed-loop`** (for L2, must fire). Policy: five calls with rotating never-executed failures (python language, `const x = a,b` syntax, `parsed is not defined`, shell input, python again), each with different code (so the byte-identical duplicate guard does not fire; this is the carve-out being closed). Assertions: after the Nth non-executed call the guard fires (activity key `guard-fired` with the repetition guard's name and outcome non-pass), the observation names "different approach" not "retry", the run ends within cap with at most N+1 calls to the tool.
- **S4 `ce-debug-loop-no-fire`** (false-positive pin, must not fire). Policy: `code-execute` runs a test command that executes and exits non-zero (`executed:true`, `exitCode:1`) five times with different code between each, then a passing run, mirroring gemma4:12b `rw-7` (passed). Assertion: the guard never fires; the run completes.

Live follow-up only if a shape proves the mechanism: cogito `h3-required-tools` k=5 (the only cell with the calculator offered by default), with `h3-todo-heavy` gemma4:e4b and `rw-7` as no-regression cells. Power: k=5 has SE about 20pp; gaps under 26pp are noise.

## 7. Decisions needed and anchors

- Dispatch tools-warden for L1: `packages/tools/src/skills/code-execution.ts:340-360` (language and shell rejections), the failure text for class B, the description's `/tmp` working-directory sentence (about line 230). Owner decision for the Python option (c).
- Dispatch kernel-warden for L2 after S3 and S4 exist: `packages/reasoning/src/kernel/capabilities/act/guard.ts:532` (converging-retry carve-out). Hand the bar question to ablation-warden first (a cost guard cannot meet a lift bar).
- L3 waits for L1's live success rate (cogito, k=5).
- Harness-warden follow-ups (own packages): none required; if wanted later, `packages/benchmarks/src/fabrication-count.ts` could carry the general ungrounded-figure predicate (currently percent-only, `rw-6` only), but changing bench scoring mid-run is out of bounds.

Instrument notes: `tool-call-end.ok` on `code-execute` is unreliable in traces before 2026-11-05 (`ae7f80b69`); the post-fix slice is reliable. 12 aborted or ungraded runs (no `eval-graded`), including the a7 30-call loop, appear only in the section 4 failure census, not in the graded tables. "Wrong" relies on each task's own check; `rw-2` and `rw-3` mix a missing diagnosis with the arithmetic, so their "would solve" is 0 or low by construction.
