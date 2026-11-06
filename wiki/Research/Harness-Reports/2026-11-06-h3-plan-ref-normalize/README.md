---
type: harness-report
status: complete
created: 2026-11-06
tags: [h3, plan-execute, from-step, ref-grammar, bonsai, qwen3, cogito]
---

# H3 targeted rerun: keyed from_step refs normalized at plan validation (8ebf0929b) on h3-plan-only

Mechanism under test: `8ebf0929b`. After a plan is generated or replanned, `normalizePlanRefs` (`packages/reasoning/src/strategies/planning/plan-refs.ts`) rewrites keyed refs such as `{{from_step:s2:lowstock}}` to the bare `{{from_step:s2}}`. It emits `guard-fired{guard:"plan-ref-normalized"}` when it rewrites anything. The executor strip at `step-executor.ts:225-235` now also removes any leftover from_step token. The change targets the regression in `2026-11-06-h3-planner-thinking-off` section 3, where bonsai wrote literal keyed tokens into output files with `ok: true`.

## Activation (read first)

| Tier | Runs | plan-ref-normalized fired | Keyed refs in planner output | Literal `{{from_step` in any tool-call arg |
|---|---|---|---|---|
| bonsai-2:27b | 5 | **1/5** (run3: 2 refs rewritten) | 2 (run3 only) | **0** |
| qwen3:4b | 3 | 0/3 | 0 | 0 |
| cogito:8b | 3 | 0/3 | 0 | 0 |

- **bonsai run3** (trace `01M6R748ZK2EQTP9GM6S0N0TJN`): the planner emitted `{{from_step:s2:lowstock}}` (s3) and `{{from_step:s2:totals}}` (s4). The guard rewrote both to the bare ref. `plan-fanout-split` then fired and split s2 into one producer per file. The run solved (acc 1.00). This is the exact path that failed in before-arm run0 and run2.
- **Literal-token count is 0 across all 11 after runs.** The before arm had 5 literal-token file-writes in 2 of 3 bonsai runs (3 with `ok: true`).
- The guard tiers never emitted a keyed ref, so the mechanism is void on them. It cannot have caused their deltas.

## Setup

- Code: dev HEAD `f3d38c4a1` (contains `8ebf0929b`) in the isolated worktree `/home/tylerbuell/.claude/jobs/eaddf328/tmp/wt-h3` (moved from `c76f508f8`). Rebuilt `core`, `llm-provider`, `trace`, `reasoning`, `runtime` dists there (turbo, 24 tasks OK). The main checkout was not used.
- Flags: `--task h3-plan-only --budget-sec 560 --cell-timeout-sec 150`. bonsai-2:27b k=5 (measured tier), qwen3:4b and cogito:8b k=3 (guards). Each tier ran as one chunk with no concurrent cells. Resident at start: qwen3:4b (not loaded by this probe, about 2 minutes left on its keep-alive). It was resident during the bonsai chunk. bonsai stayed resident into the qwen chunk.
- Note: the harness moved the bonsai and qwen chunks to the background after 180 s. Both ran to completion (`ran=N remaining=0`) before the next step started. No cell overlapped another.
- Before arms (no toggle exists, so the before arm is prior results on the same cells):
  - `2026-11-06-h3-planner-thinking-off/results-*.json` (`d8974d306`, thinking off, no normalization). This is the primary reference.
  - `2026-11-06-h3-plan-fanout-split/after-bonsai-2-27b.json` (`d864d50a3`, thinking on). Secondary reference for bonsai.
- Confound: the arms differ by every commit `d8974d306..f3d38c4a1`, not only `8ebf0929b`.
- Results: `results-bonsai-2-27b.json`, `results-qwen3-4b.json`, `results-cogito-8b.json` (all `gitSha f3d38c4a1`).
- Traces (scratch): `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-refnorm/traces-{bonsai,qwen3-4b,cogito-8b}/`.
- Scan script (scratch): `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-refnorm/scan_refnorm.py`. It reports per run: guard counts, rewritten refs, literal tokens in `tool-call-end` args, keyed refs in planner output, and planner tokensOut/attempts. Validated against the before-arm traces: it finds the 5 literal writes in run0/run2 and 0 normalize events.

## Solve rates

| tier | fanout arm (`d864`, thinking on) | thinking-off arm (`d897`) | this arm (`f3d3`) | median billed | median cell |
|---|---|---|---|---|---|
| bonsai-2:27b | 3/3 | 0/3 | **4/5** | 9,041 (was 10,543) | 72 s (was 73 s) |
| qwen3:4b | 1/3 | 4/5 | 2/3 (1 cell abort at 150 s) | n/a | n/a |
| cogito:8b | 0/3 | 0/3 | 0/3 | n/a | n/a |

**How much of bonsai 0/3 to 4/5 the mechanism earns:** at most 1 solve (run3). In the other 3 solved runs, the planner emitted bare refs (run0, run1, run4). Keyed refs fell from 2/3 plans to 1/5 plans between arms. That is planner variance, not the fix. The fix closes the failure path whenever it occurs, and the one occurrence solved. The arm-level lift is not creditable to it.

Planner calls (completeStructured, `attempts` now present: 1 attempt each, `stopReason: end_turn`):
- bonsai: 845-934 tokensOut, 18-20 s.
- qwen: 441-709 tokensOut, plus one 157-token replan.
- cogito: 620-665 tokensOut, plus one 218-token replan.

None of these is a runaway. The `attempts[].tokensOut` and `thinkingChars` fields are absent. The per-attempt token field is `outputTokens`.

## New finding: `:summary` refs into whole-content args flatten whitespace (separate harness defect)

The one bonsai failure (run2, trace `01M6R728BXFAF801MGDHA5N2H3`, acc 0.67) is not model compute. The planner addressed all three writes with `{{from_step:s2:summary}}`. That form is in the grammar, so no rewrite happened. fanout-split fired. The split producers returned correct multi-line text, for example `'SKU-003\nSKU-008\nSKU-012\nSKU-013\nSKU-018'`. But `file-write` received `'SKU-003 SKU-008 SKU-012 SKU-013 SKU-018'`. In `summary.md`, `## Reorder` was no longer at the start of a line. Hidden checks failed: `low-stock.txt is exactly the sorted SKUs below 10` and `summary.md has the Reorder heading`.

Cause: `resolveStepReferences` sends `:summary` through `distillStepResult` (`packages/reasoning/src/types/plan.ts:196-197`, helper at `:167-171`). That helper collapses `\s+` to one space and caps the text at 500 chars. This is correct for search-query args (the FM#3 rationale). It is wrong for whole-content args like `file-write.content`.

- **Before-arm reinterpretation:** thinking-off bonsai run1 (`01M6QX295JG8EZTV5FD5S73Q21`) failed the same way, with the same two checks and the same flattened content. That report called it "model compute". That reading is wrong. So the thinking-off bonsai 0/3 was two keyed-ref literal writes plus one `:summary` flattening, and all three are harness defects.
- **Run3 was also flattened.** Its `summary.md` came from a `:summary` ref and was flattened. It passed only because `## Reorder` happened to be the first text in the file.
- **Prevalence across all scratch h3-plan-only traces:** 16 of 119 planner runs send `:summary` into file-write content. Those runs pass 2/16, against 32/103 for runs that do not. Tier mix is a confound, but the direction matches the mechanism. `rax-diagnose attribute` labels these failures `unattributed` / `wrong-answer`, so the defect is invisible to attribution.

## Verdicts (verbatim `h3/verdict.ts --reason unattributed --mechanism plan-ref-normalized`)

bonsai-2:27b vs thinking-off arm (ledger entry 32):
```
IMPROVED · unattributed 3→1 · pass 0/3 → 4/5 (+80pp, within noise) · mechanism plan-ref-normalized fired 0/3 → 1/5
  activity changed: guard:plan-fanout-split:redirect 1/3→5/5; guard:plan-ref-normalized:redirect 0/3→1/5; ...
```

bonsai-2:27b vs fanout arm (not ledgered, reference only):
```
REGRESSED · unattributed 0→1 · pass 3/3 → 4/5 (-20pp, within noise) · mechanism plan-ref-normalized fired 0/3 → 1/5; unattributed absent from the baseline cells (wrong target?)
```
The `REGRESSED` label is the `:summary` failure (run2), which the mechanism does not touch.

qwen3:4b + cogito:8b vs thinking-off arm (ledger entry 33, marked VOID: 0 activations):
```
INERT · unattributed 1→0 · pass 4/8 → 2/6 (-17pp, within noise) · mechanism plan-ref-normalized fired 0/8 → 0/6 (never ran: no delta is creditable to it)
```

rax-diagnose `attribute --all`:
- bonsai: 4 not-failed, 1 unattributed.
- qwen: 2 not-failed, 1 `environment:run-aborted`.
- cogito: 2 `model:had-evidence-wrong-output`, 1 `model:ignored-guidance`.

## Decision input: should thinking-off stay on for all tiers?

- **Keyed-ref path: closed.** 0 literal tokens reached a tool. The one activated run solved. The before-arm failure mode is gone.
- **bonsai is not yet clean.** The remaining failure path is `:summary` flattening. It predates thinking-off (it appears in the d9b, a698, 6a6a, fix1 and s4full roots). It does not argue for reverting `af8653981`. It does cap bonsai below 5/5 whenever the planner picks `:summary`.
- Recommendation: keep thinking-off on all tiers. Fix `:summary` resolution for whole-content args next, then re-probe bonsai k=5 for a clean before/after.

## Open items

1. `:summary` flattening (`packages/reasoning/src/types/plan.ts:196-197`). Candidate fixes, in the reasoning warden's domain:
   - Treat `:summary` like `:full` when the consuming arg is a whole-content field.
   - Or normalize `:summary` to the bare ref at plan validation for file-write content. The bare ref passes analysis output through whole (`plan.ts:202`).
   - The second fits the 8ebf boundary.
2. Minor: `normalizePlanRefs` rewrites only top-level string tool args (`plan-refs.ts:51`). A keyed ref nested in an object or array arg would pass through to the executor strip and become an empty string, not a resolved value. Not observed in any trace.
3. Attribution gap carried over: wrong-content writes with `ok: true` read `unattributed`.
