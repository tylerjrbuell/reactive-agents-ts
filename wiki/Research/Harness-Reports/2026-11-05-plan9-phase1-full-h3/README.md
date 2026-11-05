---
type: experiment
status: complete
created: 2026-11-05
tags: [harness, h3, plan-9, substrate, regression-check, diagnosis]
---

# Plan 9 Phase 1 close: full H3 confirmation and failure diagnosis (2026-11-05)

Full H3 (12 tasks, k=5, qwen3:4b + cogito:8b, cell timeout 150 s) on `dev` at `a04336931`: every strategy on the strategy run substrate (S1-S4a), Phase 2a (meta churn never stalls), Phase 3 (one tool-call parser) and its follow-ups. Before = the D9 full rerun (`2026-11-04-d9-full-h3`). Results: `results-qwen3-4b.json`, `results-cogito-8b.json`. Ledger entry 18, `--reason harness:false-veto`.

| | Before | After |
|---|---|---|
| pass, both tiers | 56/120 | 62/120 (+5pp, within noise) |
| qwen3:4b | 35/60 | 36/60 |
| cogito:8b | 21/60 | 26/60 |
| harness:false-veto | 6 | 4 |
| billed tokens, qwen | 414,958 | 563,628 (+35.8%) |
| billed tokens, cogito | 370,862 | 381,762 (+2.9%) |

Verdict: the migrated harness is not worse on either tier and removes harness-attributed failures, so the cleanup and call-cut work (S4b) may proceed. The qwen token rise is almost entirely rw-2: its runs used to die without a trace (logged 0 tokens) and now run to the iteration cap in a text loop (finding 2), so it is a defect to fix, not migration overhead.

Remaining failures are mostly attributed to the model (qwen 15 of 27, cogito 20 of 35, `had-evidence-wrong-output`); the rest split into unattributed and the harness defects below. Failures repeat almost identically across all 5 runs of a task, so they are deterministic paths, not sampling noise.

## Harness defects found (root causes, ranked by leverage)

1. **The kernel accepts "done" with named deliverables missing** (cogito h3-todo-heavy 0/5, 4 runs `terminal-mislabel`). The model writes `out-1.txt`, reads two files and declares done. The kernel's terminal records `verified=true, terminal_decision=done` with `out-2..6` unproduced; only the runtime's post-hoc veto (`runtime-success-veto:unproduced-deliverable`) marks it failed. The completion proposal should be disposed against contract x ledger in the kernel (redirect while deliverables are missing), exactly Plan 9 Phase 2b. Trace `01M6MX71YZJ8X5B5EXGPBCQC85`.
2. **A deliverable written as prose is never turned into the file write** (qwen rw-2, 3 of 5 runs, ~48k tokens each, `overlap-storm`). The model drafts the full `analysis.md` (with the required sections) as chat text 8 times and never calls `file-write`. The harness shows "Outstanding requirements: produce ./analysis.md, call file-write", then the local-tier `qualityCheck` (`llm-provider/src/adapter.ts:190`) adds "Review your answer ... fix it now", which invites another rewrite. That hook only knows user-declared `requiredTools`, not the run contract's outstanding artifact. Its task quote is `task.slice(0, 120)`, which here is the harness's "Working directory for this task" preamble. The loop detector then switches strategy, which does not change the behavior. Fix: when an artifact requirement is outstanding and the model just produced deliverable-shaped text, the redirect names the action (call `file-write` with that path, your draft is the content), computed in the kernel from the contract (`guardQualityCheck`, `think-guards.ts:318`), not adapter English. Trace `01M6MT1WV5P2VBC8F06PAG2NPD`.
3. **A plan-execute analysis step that feeds a tool argument answers the whole task** (h3-plan-only: qwen 4/5, cogito 5/5 fail the low-stock check). The plan is sound (`file-write low-stock.txt` with `content: "{{from_step:s2}}"`), but the analysis step sees the overall goal and outputs all three files' contents, which land verbatim in `low-stock.txt`. The harness knows from the plan that s2's whole output becomes a file's content and never says so. Fix: an analysis step whose output is consumed by a downstream tool argument is told its exact consumer ("your entire reply becomes the content of low-stock.txt; output only that"). Trace `01M6MTCEJJ5SHGWKDY5XP5T3PH`.

## Model-attributed (not chased)

- rw-3 (0/5 both tiers): the hidden grader wants a data table the task never asks for. Steering toward it would be metric gaming.
- h3-required-tools (cogito 0/5): the model miscomputes the mean (21.83 expected). A code-execution path would help, but that is a capability choice, not a defect.
- rw-7: partial fixes of a three-bug code task; 3 qwen runs hit the 150 s cell timeout (no trace).
