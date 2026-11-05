---
type: experiment
status: complete
created: 2026-11-05
tags: [harness, h3, baseline, plan-9, token-accounting, diagnosis]
---

# H3 baseline at a698ff4cb (2026-11-05)

Full H3 (12 tasks, k=5, qwen3:4b + cogito:8b, cell timeout 150 s) on `dev` at `a698ff4cb`. Defaults at this commit: strategy switching opt-in (`1f8754a27`), plan-execute patch and dependency fixes, per-run stores, and token accounting that counts every LLM call (`32a56ea91`, `f53b6eceb`, `a698ff4cb`). **This run is the new H3 baseline.** Before = the Plan 9 Phase 1 confirmation run (`2026-11-05-plan9-phase1-full-h3`, at `a04336931`). Results: `results-qwen3-4b.json`, `results-cogito-8b.json`. Traces stay in scratch (`/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-baseline-a698/traces-*`). Ledger entry 22.

**Commit note.** HEAD moved to `cab323133` during the run. That commit changes one wiki plan file and nothing under `packages/` (`git diff a698ff4cb cab323133 -- packages` is empty). The last 4 qwen cells and all 60 cogito cells ran at `cab323133`, so the cogito results JSON records that sha. The code under test is identical.

Verdict line: `REGRESSED · harness:false-veto 4→6 · pass 62/120 → 64/120 (+2pp, within noise)`. The ledger marks the entry `rejected` because that is how verdict.ts records a rise in the targeted reason. For a baseline refresh this label means nothing. Also, 3 of the 6 false-vetoes are correct vetoes that the attribution mislabels (instrument finding 1).

## Results

| | Before (a04336931) | After (a698ff4cb) |
|---|---|---|
| pass, both tiers | 62/120 | 64/120 (+2pp, within noise) |
| qwen3:4b | 36/60 | 38/60 |
| cogito:8b | 26/60 | 26/60 |
| harness-attributed failures (verdict.ts) | false-veto 4 | false-veto 6, tool-call-dropped 1, premature-stop 1 |
| tokens, qwen (sum of trace llm-exchange) | 563,628 | 527,924 (-6.3%) |
| tokens, cogito (sum of trace llm-exchange) | 381,762 | 329,606 (-13.7%) |
| LLM calls per traced run, qwen | 4.30 (241/56) | 4.22 (232/55) |
| LLM calls per traced run, cogito | 5.69 (336/59) | 4.85 (286/59) |

Per task (solved/5, before → after):

| task | qwen3:4b | cogito:8b |
|---|---|---|
| ab-trap-4 | 5 → 5 | 5 → 5 |
| ab-trap-5 | 4 → 5 | 5 → 5 |
| h3-continuation | 5 → 5 | 5 → 5 |
| h3-exact-value | 5 → 5 | 5 → 5 |
| h3-plan-only | 1 → 0 | 0 → 0 |
| h3-required-tools | 4 → 4 | 0 → 0 |
| h3-todo-heavy | 4 → 5 | 0 → 0 |
| rw-2 | 0 → 0 | 0 → 0 |
| rw-3 | 0 → 0 | 0 → 0 |
| rw-6 | 3 → 5 | 3 → 2 |
| rw-7 | 0 → 0 (5 cell timeouts, were 3) | 0 → 0 (1 timeout) |
| rw-9 | 5 → 4 | 3 → 4 |

No per-task change is outside noise (k=5).

## Token accounting: raw and billed agree

On all 114 traced runs, these four numbers are exactly equal: the cell's `tokens` (raw), its `billedTokens`, `run-completed.totalTokens`, and the sum of `tokensIn + tokensOut` over the trace's `llm-exchange` events. No run differs by more than 5%; none differs at all. The only mismatch is the 5 cogito and 5 qwen `ab-trap-4` runs: they make 0 LLM calls, so `billedTokens` is `null` and the other numbers are 0.

In the confirmation run, raw undercounted: qwen raw was 473,847 against billed 563,628. Billed equalled the trace sum there too, so the token rows above compare trace sums on both sides. Caveat: cells that time out record 0 tokens. That affects 5 qwen rw-7 cells now and 3 before, so the qwen "after" total omits about 5 x 150 s of rw-7 spend.

## Harness defects (ranked by leverage, one decisive trace each)

1. **The evidence-staleness loop check reads an assessment taken before the act, so it vetoes the turn that wrote the deliverables.** In 3 qwen runs that the grader passed (rw-9 run1 and run3, h3-todo-heavy run2), the model calls `file-write` and produces every deliverable. On the next pass, `loop_resolution` fires `evidence-staleness 3/3` before the model can answer. The counter comes from the assessment computed at the top of the previous pass, which still shows the deliverable missing. The exit gate then hands off to harness synthesis, `deliverable_decision` blocks it, and the run ends `failure` even though the model's final text (seq 969) was correct. The same signature appears on cogito rw-7 run1, which failed anyway. Anchors: `packages/reasoning/src/kernel/loop/iterate-pass.ts:431` (assessment, set at `:434`) is read by detection at `packages/reasoning/src/kernel/loop/iterate-pass.ts:1109`. The staleness value is set in `packages/reasoning/src/kernel/loop/iterate-assessment-seam.ts:100`. Fix direction: compute staleness from a post-act assessment, or treat a pass whose act produced a contract deliverable as not stale. Trace `01M6PHCBGQT7VJH5AAS2PG9W8G` (qwen rw-9 run1).
2. **A composite plan step is scoped to one tool but inherits the parent's `requiredTools`, so it force-abstains before the loop and is still recorded `completed`.** `routeUnderspecifiedToolSteps` (`c85c9d4e7`) turns a `file-read` step with `toolArgs: {}` into a composite step with `toolHints: ["file-read"]`. The step executor filters the tool surface to the hints (`packages/reasoning/src/strategies/plan-execute/step-executor.ts:412`), but it passes the parent's `requiredTools: [file-read, file-write]` through (`step-executor.ts:448`). In the sub-kernel, `file-write` is "unavailable", so forced abstention fires at iteration 0 with 0 LLM calls ("required tool unavailable", `packages/reasoning/src/kernel/control/abstention-proposal.ts:42`). The step result is hardcoded `success: true` (`step-executor.ts:477`), the same defect class `c85c9d4e7` fixed in `step-run.ts`. Because s1 counts as completed, s2 runs on nothing and invents SKUs (`A123`, `C789`). This happened in 3 of 5 qwen h3-plan-only runs; the other 2 plans carried the path and read the file. Cogito plans carried the path in all 5 runs, so this is single-tier evidence. rax-diagnose does not attribute it: it reports `unattributed` and `wrong-tool-arg`. Trace `01M6PGYNBB9V6Y6CWFB7DJXG0V` (qwen h3-plan-only run0).
3. **`max_tokens` recovery escalates the output budget on a thinking runaway.** In 8 qwen runs, one think call stops at `max_tokens` with empty content after about 99 s of thinking (64k thinking chars, 13,200 tokens out against a 7,200 cap). Stage 1 recovery re-runs the same request at `maxOutputTokensOverride: 64_000`, clamped to 31,070 (`packages/reasoning/src/kernel/capabilities/reason/normalize-think-response.ts:150`). That re-run thinks for another 44 s, and its `llm-exchange` records null usage. All 5 qwen rw-7 cells hit the 150 s cell timeout this way; before, 3 timed out. The other runs affected are h3-required-tools run3, h3-todo-heavy run4 and rw-9 run1. Empty content with a large thinking body is a runaway, not a truncated answer, and should not get a bigger budget. Trace `01M6PGRP1VPDDD0ENTKMEKCT1T` (qwen rw-7 run0).

Single-run defect, not ranked: on cogito h3-todo-heavy run0, the model emits `file-write(out-6.txt)` at iteration 13 of 14. `max_iterations` terminates while the kernel is `acting`, so the call never executes, and the harness spends a synthesis LLM call instead. Trace `01M6PKHSES1WK5J85CS8TE8MKD`.

## Instrument findings

1. **rax-diagnose labels correct fabrication vetoes `harness:false-veto`.** On qwen rw-6 run1, run3 and run4, the report invents a before/after benchmark table ("12.4 ms ... 8.9 ms", "20-30% faster") when the only tools available were `file-read` and `file-write`. `detectFabricatedMeasurement` blocks it, which is correct. The H3 hidden check grades only the file half of rw-6, so it passes, and attribution calls the veto false. Either the attribution should not count a fabrication-check veto as false, or the rw-6 grader needs its behavioral half. Until one of these is fixed, the `false-veto` count is inflated by 3 on qwen.
2. **Timed-out cells write every trace event twice** (all 5 qwen rw-7 traces). Any reader that sums events must dedupe by `seq`.
3. **verdict.ts `--ledger` records a baseline refresh as `rejected`.** No baseline decision exists.

## Model-attributed (not chased)

The rest of the failures are attributed to the model: 11 of 28 failed qwen runs and 25 of 34 failed cogito runs, mostly `had-evidence-wrong-output`. These are rw-2 and rw-3 (0/5 on both tiers, as before), cogito h3-required-tools (miscomputed mean), and cogito h3-plan-only (wrong low-stock content).
