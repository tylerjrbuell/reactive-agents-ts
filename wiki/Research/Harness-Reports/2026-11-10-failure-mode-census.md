---
type: harness-report
status: complete
created: 2026-11-10
tags: [harness-report, failure-modes, attribution, tracing, spike, code-execute, h3-plan-only, lh-debug-green]
---

# Failure-mode census: what caps small models and what the harness can fix (2026-11-10)

Zero-token over the 2026-11-07 and 2026-11-09 corpora (387 non-llama3.2 runs, 301 failed), plus one 10-cell local A/B. Follows [[2026-11-07-feedback-loop-spike]] and [[../Ablations/2026-11-09-write-coverage/README]].

## 1. Where the failures are

| rax-diagnose reason | runs | Note |
|---|---|---|
| model:had-evidence-wrong-output | 104 | by elimination, not a diagnosis |
| model:evidence-not-gathered | 98 | by elimination, not a diagnosis |
| model:fabrication-vetoed | 31 | |
| harness:* (all) | 48 | mostly older cohorts (aoa, verdict-h); about 12 on current code (abl-auto, wc-ab) |
| environment:* | 17 | aborts and provider errors |

- The one-off harness defects are mostly worked off. Hunting more of them has low return.
- The two big `model:*` labels (67 % of failures) say only that the harness did nothing visibly wrong. They do not say why the run failed.
- Failure mass by task (the two big buckets): lh-debug-green 70, rw-7 60, lh-enumerate-audit 18, h3-plan-only 19, lh-1 16. Mostly cogito:8b and qwen3:4b.

## 2. Root causes found, with fixability

| # | Root cause | Evidence | Harness-fixable? |
|---|---|---|---|
| 1 | Edit targets never written (lh-debug-green). Run ends after one write. | 58 % of module slots unwritten | Yes. `writeCoverage` opt-in, +13pp aggregate, +89 % tokens. Done. |
| 2 | cogito:8b cannot localise the bug. It rewrites the file unchanged after reading all of it. | 15 of 15 no-op writes followed a full read. 0 truncated reads. | Not by input or visibility. It needs feedback (see 5). |
| 3 | Mental arithmetic over data (h3-plan-only). | 20 of 22 failures fail only `totalUnits`. Sums 300-488 vs true 461. `skuCount` correct. 16 of 22 are cogito. | Not by offering a tool (see 4). |
| 4 | Offering a tool is not a lift for small models. | `code-execute` offered on cogito h3-plan-only: uptake 0 of 5, accuracy 0.78 to 0.80. Earlier `shell-execute`: 3 of 18. | Dead lever (two independent spikes). |
| 5 | No harness-run check of the deliverable. | Visible tests red in 67 of 67 lh-debug-green failures. | Untested live. Candidate. |
| 6 | rw-7 pipeline bug is behaviourally invisible. | 26 of 33 wrong writes still use `Promise.all`. | No. Task ceiling. |

Plan-execute detail for #3/#4: the planner emits file-read then file-write steps and the model generates the content, including the sum, in one shot. `code-execute` appears in the planning prompt but no compute step is planned. This is a strategy structure issue, not a model-choice one.

## 3. Is tracing good enough to form these hypotheses?

Partly. Every finding above needed a bespoke zero-token script (workspace replay, target coverage, no-op writes). Gaps:

1. The two big buckets are residuals. No sub-reason says: target unwritten, no-op write, derived value wrong, wrong file.
2. The grader outcome per check is not in the trace. I rebuilt it by replaying recorded writes (matched the recorded grade in 166 of 166 runs).
3. Target coverage and "content changed vs original" are not recorded.
4. `tool-surface-resolved` lists index-promoted tools (shell-execute) as hidden although they ship.
5. Stale `duplicateGuard` replays are unattributed (fixed in code, 44 hits in 14 runs).
6. The cell JSON `toolSurface` is empty when tools were offered.

Instrument work (harness-warden, `packages/trace`, `packages/diagnose`; not a new harness mechanism): add per-run deliverable state at terminal (target written, changed vs original, per-check result) and split the residual labels. Without this each hypothesis costs a one-off script.

## 4. Spike: code-execute offered on h3-plan-only

- Arms: cogito:8b, k = 5, `RA_ACT_OR_ANSWER=auto`, local (token-free). Arm 2 adds `code-execute` as an available tool, in memory only (no manifest change).
- Prediction (written before the run): uptake at least 50 % and +20pp, otherwise the lever is dead.
- Result: base 0.78 mean, calc 0.80, 0 of 5 solved in both arms, uptake 0 of 5. The prediction's kill condition holds.
- Caveat: the working tree held other sessions' uncommitted token-accounting and provider edits in both arms.
- Scratch: `prediction`, `run-calc.ts`, results in the session scratchpad. Not archived.

## 5. Ranked next steps

1. Instrument first (gap list above). Cheap and removes the one-off scripts.
2. Spike a harness-run acceptance check for code tasks with visible tests, live: lh-debug-green on cogito, qwen3:4b, qwen3:14b, k = 5. It targets root cause 2, the largest unlifted mass. It is a mechanism, so it needs a pre-registered gate and a flag.
3. Do not build more "offer the model a tool" or targeted-nudge mechanisms. Two spikes say small models do not take them.
