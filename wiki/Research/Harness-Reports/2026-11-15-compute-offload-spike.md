---
type: research
status: complete
created: 2026-11-15
tags: [harness, compute-offload, code-execute, arithmetic, spike, zero-token, tool-surface]
---

# Compute-offload spike: how often do accepted runs do arithmetic in their head? (zero-token, recorded traces)

Follow-up to [[2026-11-14-partial-answer-root-causes]] (lever L1). Owner rule: count trigger frequency in existing traces before building. No model was run. Source: 623 trace files under `/home/tylerbuell/campaign-traces/traces/` (p2, p3a, p3b, verify, enum; 570 graded, 53 ungraded rw-6 runs with no `eval-graded` are excluded). Scripts are in the session scratchpad (`load.py`, `a2.py`-`a7.py`); not kept in the repo.

## Verdict

1. **The trigger is real and large.** Of 267 accepted (`status=success`) graded runs on the 8 tasks whose hidden grader checks a computed figure, **94 (35%) got an arithmetic or aggregation item wrong** after the run was accepted. All 94 were done in the model's head.
2. **The compute tool was not on the tool surface in 86% of those runs.** `code-execute` is declared `available` on only 3 bench tasks (`h3-required-tools`, `lh-debug-green`, `rw-7`; `packages/benchmarks/src/h3/tasks.ts:155`, `h3/long-horizon-tasks.ts:283`, `tasks/real-world.ts:1168`). On `h3-plan-only`, `rw-2`, `rw-3`, `lh-pipeline-stages`, `lh-enumerate-audit`, `h3-todo-heavy`, `h3-exact-value`, `tool-surface-resolved.visible` never lists it. So on 229 of 267 runs offload was impossible by construction. This is a task/bench contract and a surface-pruning fact, not evidence the model refuses to compute.
3. **Where the tool IS visible (38 accepted `h3-required-tools` runs), the model almost never uses it: 5 of 38 (13%).** Weak models do the mean of 20 numbers in their head and get it wrong **0 of 14**; strong models get it right 21 of 21 in their head. Runs where a `code-execute` call succeeded were right 3 of 3; runs where only failed calls happened were right 0 of 2.
4. **`code-execute` reliability is poor but is not the main blocker.** 31 of 120 calls ok (26%) across the corpus. 94 of the 120 calls are `rw-7` test-running, not arithmetic. On compute-intent runs the failures are model-input faults (JavaScript-only tool, models send shell, Python, relative imports).
5. **Recommendation: (c) then (a), not (b), staged.** First a cheap tool-description fix (tools-warden), then one coordinated surface+guidance mechanism behind an ablation. Do not build the ledger recheck. Details in section 5.

## 1. Method and caveats

- A run is "accepted" when `run-completed.status == success`. "Wrong" is the in-trace `eval-graded.checks[].passed == false` on the check that tests a computed figure:
  - `h3-required-tools`: mean check (any failure).
  - `h3-plan-only`: `totalUnits correct` or `skuCount correct`.
  - `h3-todo-heavy`: any `out-N is X` check (doubling).
  - `h3-exact-value`: sum of two counts.
  - `lh-pipeline-stages`: `by-region.json ...` and `report.md states the total revenue`.
  - `lh-enumerate-audit`: `INV-xxxx marked valid=...` (validity = does `amount` equal sum of `qty*unit`).
  - `rw-2`: `dollar impact quantified in the causally plausible band`.
  - `rw-3`: `salary claim is grounded in the data` (an omission, not a mis-sum; counted because it needs a department mean).
  - Not counted: `ab-trap-5` (abstention check), `rw-4`, `rw-9`, `rw-6`.
- Ground truth is the hidden grader, not my recomputation. I did not re-derive figures; where a written value is shown (required-tools, below) it is from the `file-write` args.
- "Done in head" = no successful `code-execute` result in the run. On the 229 no-tool runs this is trivially true; I did not prove each wrong figure came from the model rather than a guard or copy error. The 2026-11-14 study classified 109 such items as retrieved-but-wrong, consistent.
- Corpus mixes shas (p2 at one SHA, verify at the head with the `7bacddc84` code-execute fix). Pooled counts; k is 1-3 per cell-model-task and the cells cluster. Treat as description of this corpus.
- Trace gap: 28 of 37 `h3-plan-only` and 31 of 36 `rw-3` runs have no `tool-surface-resolved` events (older format). Their `visible` set is unknown from events; the erratum and the 9 and 5 that do have events show file-read/file-write only. I counted them as "tool absent"; if wrong, the 86% is an upper bound.
- No frontier-tier runs in the corpus.

## 2. How often accepted runs got a computed figure wrong

| Task | Accepted graded | Computed item wrong | `code-execute` visible | Called |
|---|---|---|---|---|
| h3-required-tools (mean of 20) | 38 | 14 | 38 | 5 |
| h3-plan-only (sum, count) | 35 | 18 | 0 | 0 |
| h3-todo-heavy (6 doublings) | 33 | 9 | 0 | 0 |
| h3-exact-value (add two counts) | 54 | 2 | 0 | 0 |
| lh-pipeline-stages (group sums) | 14 | 8 | 0 | 0 |
| lh-enumerate-audit (qty*unit sums) | 26 | 10 | 0 | 0 |
| rw-2 (dollar impact) | 31 | 6 (30 miss some check; the diagnosis is a separate cause) | 0 | 0 |
| rw-3 (department mean) | 36 | 27 (omission, not a bad sum) | 0 | 0 |
| **Total** | **267** | **94 (35%)** | **38** | **5** |

If rw-3 (omission) is excluded: 67 of 231 (29%). If rw-2 and rw-3 are excluded (pure arithmetic tasks): 61 of 164 (37%).

Per model, share of accepted aggregation runs with a wrong computed item (runs in brackets):

| Model | Wrong / accepted | Rate |
|---|---|---|
| llama3.1 | 15 / 18 | 83% |
| cogito:8b | 12 / 18 | 67% |
| granite4:tiny-h | 12 / 18 | 67% |
| qwen2.5:14b | 10 / 19 | 53% |
| qwen3:14b | 6 / 16 | 38% |
| gemma4:e4b | 5 / 16 | 31% |
| gpt-oss | 16 / 54 | 30% |
| qwen3:4b | 10 / 39 | 26% |
| gemma4:12b | 5 / 21 | 24% |
| qwen3.5 | 3 / 41 | 7% |

(Rates are dominated by which tasks each model was run on; qwen3.5 and gpt-oss ran the long-horizon tasks, llama and cogito ran H3 and rw. Single-run models omitted: all 0 of 1 or 2.) The gap is steep by model, same direction as the 2026-11-14 study: weak models fail the arithmetic, strong ones largely do not.

Written values for the wrong `h3-required-tools` means (truth 21.83): llama3.1 23.45, 24.69, 23.27; cogito 19.55, 20.91, 20.56; granite 20.00, 20.41, 21.32; qwen2.5 22.35, `TODO`, 15.50; gemma4:e4b 22.85, 22.65. All accepted and graded wrong.

## 3. Did runs that used `code-execute` get it right more often?

Only `h3-required-tools` offers a clean split (tool visible, pure arithmetic, single figure). n is tiny.

| Group (40 graded runs, 38 accepted) | Runs | Right |
|---|---|---|
| no `code-execute` call | 35 | 21 (60%) |
| called, at least one ok | 3 | 3 |
| called, all failed | 2 | 0 |

Confounded by model strength, so split by tier:

- Strong models with no call (gemma4:12b, gpt-oss, qwen3.5, qwen3:14b, qwen3:4b): **21 of 21 right**. A mean of 20 numbers in the head is within reach.
- Weak models with no call (llama3.1, cogito, granite4:tiny-h, qwen2.5:14b, gemma4:e4b, deepseek-r1:14b): **0 of 14 right**.
- Weak model whose call succeeded (gemma4:e4b, 1 run): right. Weak model whose only call failed (cogito, gemma e4b): wrong.

So the within-corpus evidence says: offload helps exactly where the model is weak, and when the call succeeds it is right. The success-conditional is n = 3 runs, not a measured lift.

`verify/h3` (head SHA) shows the same from the other side: required-tools mean was 3/3 correct on every model before and after the fix, and no model called `code-execute` (RESULTS-VERIFY row 59). Those were strong models (qwen3.5, gpt-oss, qwen3:4b) that do not need it.

## 4. `code-execute` reliability

Whole corpus: **120 calls, 31 ok (26%), in 39 of 623 runs.**

| Task | Calls | Ok |
|---|---|---|
| rw-7 (running `bun test`) | 94 | 25 |
| lh-debug-green (running tests) | 11 | 3 |
| h3-required-tools (arithmetic) | 8 | 3 |
| ungraded rw-6 (benchmarking) | 7 | 0 |

By model: qwen3.5 1 of 37, gemma4:12b 15 of 35, gpt-oss 8 of 24, granite 3 of 7, gemma4:e4b 2 of 6, llama3.1 1 of 7, qwen3:4b 1 of 1, cogito/qwen2.5/qwen3:14b 0 of 3 combined. By corpus: p2 20 of 70, verify (post-fix) 3 of 27, p3b 7 of 15, p3a 1 of 8.

Top failure causes (89 failing calls; post-fix `verify` is 24 calls, 3 ok):

- shell command or non-JS in a JavaScript-only tool: 29 (plus 7 `Parameter "language" must be one of: javascript, typescript` rejections, 4 Python calls)
- module or relative path not found (`Cannot find module './src/...'`, ENOENT): 10, 6 of 24 post-fix
- `import` inside the `async` wrapper (`const __fn = async () => { import ...`): 9 in the p2 corpus (hoisted by `7bacddc84`, absent after)
- `Unexpected output format (missing sentinel)` (`packages/tools/src/skills/code-execution.ts:89`): 5
- repetition guard on the retry: 3
- `bun test` runner misuse (filters with no matches, test outside runner): about 6

The error messages are legible post-fix. The tool works for correct input: 31 ok calls. For compute-only intent (`h3-required-tools`), the calls were 3 ok of 8, and the 4 Python-style calls all failed. The reliability is a tool-description problem (the model does not learn that it is JavaScript-only with inline data), not an engine defect. It is a lesser blocker than the surface problem in section 2.

## 5. Recommendation

Of the four options in the brief:

- **(d) do not build:** rejected. The trigger is 35% of accepted aggregation runs and 61 of the 94 are plain arithmetic.
- **(b) deterministic ledger check of claimed totals vs tool-returned numbers:** rejected as a standalone. A derived figure (a sum, a mean) is by definition not in any observation, so "is this number found in tool results?" cannot separate right from wrong. Catching it requires recomputing the formula, which is exactly what offload does. It also adds a veto-shaped mechanism for a failure that did not come from a gate.
- **(c) fix `code-execute` reliability first:** a cheap, deterministic precondition, but small. Ask the tools-warden for: tool description states "JavaScript/TypeScript only; embed data inline or read by absolute path"; reject `language` mismatches with the same text; the `missing sentinel` mode gets a reason. This is a defect fix, not a mechanism, so no ablation is needed. Expected effect on compute calls: from 3/8 to a higher fraction, unmeasured.
- **(a) surface + guidance nudge for aggregation:** the real lever, because it addresses the 86% where the tool was absent. Minimal form, one coordinated mechanism:
  1. When the task text asks for a numeric aggregate (sum, mean, count, total, group-by, "double") over data the run will read, keep `code-execute` on the tool surface (`builtins-floor`) even when the task declares a restricted tool list.
  2. A single `PendingGuidance` line: "compute with code-execute, do not estimate", fired once the data has been read and a write/answer follows without a successful `code-execute` result. Advisory only, no veto, no new terminal logic.
  Detection is the prompt text plus the read receipts; this is deterministic, not LLM-judged. On this corpus a keyword trigger (`sum|mean|average|total|count|double|percent`) fires on every aggregation task listed above and also on `rw-4`/`rw-9`/`ab-trap-5`; precision on the 8 tasks is 100%, but false triggers on `rw-4`, `rw-9` and `ab-trap-5` mean a tighter rule is needed, e.g. require a read-then-compute pair and a single-figure deliverable. Define the trigger before the ablation, from these traces.

Limits on "build (a)": it only helps weak models. Strong models already get 21 of 21 right in the head; for them the mechanism is overhead. Weak models (8B-14B) are probes here, not targets: the failure (a model summing 20 numbers or 12 line items in its head) is general, so it is a harness gap worth closing, but the measured lift will appear on the weak tier only. This does not clear the lift bar unless two tiers move; the ablation must name what counts as the second tier.

### Ablation design (for ablation-warden)

- **Arms** (one variable change per arm):
  - A0: current head (tool absent where task declares no tool).
  - A1: `code-execute` kept visible on aggregation tasks, no guidance.
  - A2: A1 plus the one-line advisory guidance.
- **Tasks** (arithmetic-bearing, real gaps): `h3-required-tools`, `h3-plan-only`, `h3-todo-heavy`, `lh-pipeline-stages`, `lh-enumerate-audit`. Control tasks that must not move: `h3-continuation`, `rw-9` (no arithmetic, trigger must stay quiet).
- **Models:** weak tier `llama3.1`, `cogito:8b`, `qwen2.5:14b`, `granite4:tiny-h` (baseline wrong 53-83%); strong tier `qwen3.5`, `gpt-oss` (baseline wrong 7-30%, overhead and no-regression check). Add one frontier model if keys allow; the corpus has none.
- **k:** 5 per cell. 5 tasks x 6 models x 3 arms x 5 = 450 runs. Weak-tier baseline is Bernoulli with about 60% failure, so n = 20 per arm per tier (4 models x 5) gives a binomial SE near 11pp: only a lift above about 20pp on a tier is detectable. Report per-tier, not just pooled.
- **Accept rule** (house bar): lift >= 3pp on the arithmetic item in at least 2 tiers, token overhead <= 15% on the strong tier (it has no gain, so the tool and guidance must not tax it), no new false-success class (accepted-and-wrong rate on control tasks unchanged, no more `harness:ignored-guidance`). Secondary diagnostic, not part of the rule: fraction of aggregation runs with a successful `code-execute` call (A1 vs A2); if A1 shows calls at less than 15%, guidance is needed; if A2 calls succeed less than half the time, do (c) deeper first.
- **Instrument checks before reading a result** (per the tool-surface confound memory): print `tool-surface-resolved.visible` per arm to confirm A0 truly lacks the tool and A1/A2 have it; confirm token counts compare equal surfaces.
- **Route:** (c) to tools-warden now; the surface rule and guidance to kernel-warden (tool-surface resolver and `PendingGuidance` in `packages/reasoning/src/kernel/`). Both sit behind opt-in until the ablation passes.

## 6. Honest limits

- The 94 wrong runs come from rule-based checks of the hidden grader; the cause is "computed in head" by construction on tool-absent tasks, not proven per run. The 2026-11-14 hand-read of 30+ runs supports it.
- The "tool visible" analysis rests on one task (38 runs, 5 calls). The within-task picture (weak 0/14, strong 21/21) is clean but is one task and one formula.
- Task mix is the bench's, 8 tasks, 3 corpus SHAs. Per-model rates are task-confounded.
- No test of whether weak models, given the tool and a nudge, would call it correctly. That is the ablation's job; the evidence here (weak model with a failed call stays wrong, one weak success is right) supports trying it but does not predict the size.
- Not covered: rw-2 diagnosis (24% of lost credit, anchoring not arithmetic) and `rw-3` omission, which offload does not touch.
