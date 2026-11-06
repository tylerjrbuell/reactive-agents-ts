---
type: harness-report
status: complete
created: 2026-11-06
tags: [h3, plan-execute, structured-output, thinking, ollama, qwen3, bonsai, cogito, from-step]
---

# H3 targeted rerun: Ollama structured calls with thinking off (af8653981) on h3-plan-only

Mechanism under test: `af8653981`. Ollama `completeStructured` resolves an unset thinking preference to `think: false` on thinking-capable models and drops the +6000 `num_predict` allowance (`packages/llm-provider/src/providers/ollama-thinking.ts`, `resolveStructuredThinking`; wired at `local.ts:1061-1089`). It targets the planner output runaway found in the thinking-cap recheck (`2026-11-06-h3-thinking-cap-recheck`, section 3).

## Activation (read first)

The only activation signal the change emits is the Effect debug log `structured-thinking-suppressed`. That log is not persisted to the trace, so `verdict.ts --mechanism` cannot see it and reports `fired 0` on every tier (instrument gap 1 below). `d8974d306` adds per-attempt `thinkingChars`/`stopReason` to structured exchanges, but no provider fills `attempts` at that SHA (instrument gap 2). Activation is therefore established from two indirect sources:

1. **Capability** (`/api/show`): qwen3:4b and bonsai-2:27b list `thinking`, so an unset preference sends `think: false`. cogito:8b has no `thinking` capability, so the change is a no-op there by construction.
2. **Output tokens per content character** on each planner exchange. A JSON-only response runs about 0.35 tokens/char; thinking adds hidden tokens on top.

| Tier | Planner calls after | tokensOut/contentChars after | Before (same task) | Activated |
|---|---|---|---|---|
| qwen3:4b | 6 | 0.34-0.39 | 0.55-9.73 (30 calls, median 1.63) | **6/6** |
| bonsai-2:27b | 5 | 0.36-0.37 | 0.73-0.98 (3 calls) | **5/5** |
| cogito:8b | 3 | 0.35-0.36 | 0.34-0.36 (4 calls) | n/a (not thinking-capable) |

Every qwen and bonsai planner call after the change sits at the JSON-only ratio, the same ratio cogito (no thinking) shows in both arms. Before, no qwen or bonsai call did. The mechanism ran on both thinking tiers.

## Setup

- Code: dev HEAD `d8974d306` (contains `af8653981`), in the isolated worktree `/home/tylerbuell/.claude/jobs/eaddf328/tmp/wt-h3` (moved from `9ae6a59ff`). Rebuilt `core`, `llm-provider`, `trace`, `reasoning` dist there. The main checkout was not used.
- Flags: `--task h3-plan-only --budget-sec 560 --cell-timeout-sec 150`. The cell cap matches every baseline. qwen3:4b k=5 (measured tier); bonsai-2:27b and cogito:8b k=3 (guards). One foreground chunk per tier. Ollama had no models resident at start; tiers ran one at a time.
- Before arms (no toggle exists, so the before arm is prior results on the same cells):
  - qwen3:4b: `2026-11-06-h3-plan-fanout-split/after-qwen3-4b.json` (`d864d50a3`) and `2026-11-06-h3-thinking-cap-recheck/results-qwen3-4b.json` (`29c749f33`), 6 runs. The planner-token distribution also uses the a698, 77b6 and 6a6a qwen traces (30 planner calls total).
  - bonsai-2:27b, cogito:8b: `2026-11-06-h3-plan-fanout-split/after-*.json` (`d864d50a3`).
- Confound: the arms differ by every commit between `d864d50a3`/`29c749f33` and `d8974d306`, not only `af8653981`. The planner-call change is directly attributable (activation evidence above). The bonsai plan-shape change is attributable only through the mechanism story below, at n=3.
- Results: `results-qwen3-4b.json`, `results-bonsai-2-27b.json`, `results-cogito-8b.json` (all `gitSha d8974d306`).
- Traces (scratch): `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-thinkoff/traces-{qwen3-4b,bonsai,cogito-8b}/`.
- Scan scripts (scratch): `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-thinkoff/{scan_planner,plan_shape}.py`.

## 1. Planner-call output (qwen3:4b, measured tier)

| arm | planner calls | median tokensOut | max tokensOut | > 4096 | > 10,096 | median duration | max duration |
|---|---|---|---|---|---|---|---|
| before (a698..29c749f33) | 30 | 2,422 | 13,855 | 11 | 3 | 17.3 s | 99.4 s |
| after (`d8974d306`) | 6 | 683 | **716** | **0** | 0 | 6.9 s | 7.1 s |

After-arm calls (trace `.../traces-qwen3-4b/qwen3_4b/ra-default/h3-plan-only/<run>/<id>.jsonl`):

| run | trace | seq | tokensOut | duration | steps |
|---|---|---|---|---|---|
| run0 | `01M6QWSJDA881HMR2Z0MQS5NKB` | 15 | 700 | 7.0 s | 7 |
| run1 | `01M6QWTEMSXHRKQNEV91M3KYNP` | 126 | 714 | 6.8 s | 7 |
| run2 | `01M6QWVF8Z99QYQHX3PK1V7XBE` | 237 | 539 | 5.8 s | 7 |
| run3 | `01M6QWWFW39QTEJGSMSMVB6A6A` | 405 | 716 | 7.1 s | 7 |
| run4 | `01M6QWX7JJNV1NJ10FKN6SMDD1` | 516 | 666 | 7.0 s | 7 |
| run4 | same | 577 (replan) | 262 | 1.9 s | 2 |

The before median (2,422) is computed by `scan_planner.py` over the same 30 calls the recheck used. The recheck README said "about 1,500"; this scan's number is the reproducible one.

## 2. Cells, solve rate, plan quality

| tier | arm | runs | solved | cell timeouts | median cell | median billed tokens |
|---|---|---|---|---|---|---|
| qwen3:4b | before (d864, 29c7) | 3 + 3 | 1/3 + 3/3 | 1 + 0 | 124 s / 51 s | 15,052 / 13,410 |
| qwen3:4b | after | 5 | **4/5** | **0** | **29 s** | 8,803 |
| bonsai-2:27b | before (d864) | 3 | 3/3 | 0 | 104 s | 10,672 |
| bonsai-2:27b | after | 3 | **0/3** | 0 | 73 s | 10,543 |
| cogito:8b | before (d864) | 3 | 0/3 | 0 | 17 s | 8,165 |
| cogito:8b | after | 3 | 0/3 | 0 | 14 s | 5,046 |

Earlier qwen h3-plan-only arms for context: 77b6 4/5 (1 timeout), 6a6a 4/5.

Plan quality:
- **qwen3:4b: unchanged.** All 5 first plans are the 7-step one-producer-per-file shape (read, then analysis then write for each file), the same shape as the before arms. The one failure (run3, acc 0.83) is model compute. One plan (run4) emitted a truncated write path `/home/tyler`; the traversal guard refused it and the replan wrote `totals.json`. The run solved. Before arms also had malformed write paths (fanout run1/run2 plans had no `path`).
- **cogito:8b: unchanged.** Same 6-7 step shape; same model compute errors on low-stock/totalUnits (acc 0.67-0.83 both arms).
- **bonsai-2:27b: regressed, plan shape changed.** See section 3.

## 3. Regression: bonsai-2:27b 3/3 to 0/3, via out-of-grammar `from_step` refs

Before, all 3 bonsai plans were the fan-out shape (one analysis step, three writes of `{{from_step:s2}}`), and `plan-fanout-split` repaired all 3. After, with thinking off, the bonsai planner kept the fan-out shape but addressed the analysis output with keyed refs:

| run | first-plan file-write contents | fanout-split fired | outcome |
|---|---|---|---|
| run0 | `{{from_step:s2:lowstock}}`, `{{from_step:s2:totals}}`, `{{from_step:s2:summary}}` | no | acc 0.83, low-stock wrong |
| run1 | `{{from_step:s2:summary}}` x3 | yes | acc 0.67 |
| run2 | `{{from_step:s2:low_stock_txt}}`, `{{from_step:s2:totals_json}}`, `{{from_step:s2:summary_md}}` | no | acc 0.83, low-stock wrong |

`{{from_step:s2:lowstock}}` is outside the from_step grammar, which allows only `:summary` and `:full` (`packages/reasoning/src/assembly/ref-grammar.ts:89`). Every consumer of the grammar therefore misses it:
- `splitFanOutProducers` (`packages/reasoning/src/strategies/planning/fanout-split.ts:47`) does not see a producer reference, so it does not split.
- `extractDependencies` (`packages/reasoning/src/types/plan.ts:218-235`) does not see the dependency.
- The executor's unresolved-ref strip (`packages/reasoning/src/strategies/plan-execute/step-executor.ts:229-233`) tests only the bare form `/\{\{from_step:s\d+\}\}/`, so the token survives.

Result (run0 trace `01M6QWZVMVD36K77TEPH6PSNNP`, run2 trace `01M6QX514KK1PVCD7VD7SKXHNT`): `file-write` wrote the literal string `{{from_step:s2:lowstock}}` to `low-stock.txt` and returned `ok: true`. `totals.json` was refused (not valid JSON), so the replan rewrote `totals.json` and `summary.md` with inline content. Nothing revisited `low-stock.txt`, because its write had succeeded. The hidden check `low-stock.txt is exactly the sorted SKUs below 10` failed. `rax-diagnose attribute --all`: 3/3 `unattributed`, so the harness defect is invisible to attribution too.

How often this token appears: keyed refs occurred in 3 of 180 planner runs across all prior scratch trace roots (one each in cogito d9, qwen d9b, cogito s4full), 0/3 in the bonsai fanout arm, and 2/3 in the bonsai thinking-off arm. The grammar hole is old; thinking off made bonsai hit it often. At n=3 the solve-rate drop is "within noise" by the Wilson test, but the mechanism is traced end to end in 2 of 3 runs.

This is a harness defect (silent pass-through of an unresolvable reference), exposed by the provider change. It is not by itself a reason to revert `af8653981`: run1, where the split did fire, still failed on model compute (acc 0.67).

## Verdicts (verbatim `h3/verdict.ts`, `--reason environment:run-aborted --mechanism structured-thinking`)

qwen3:4b (ledger entry 30):
```
INERT · environment:run-aborted 1→0 · pass 4/6 → 4/5 (+13pp, within noise) · mechanism structured-thinking fired 0/6 → 0/5 (never ran: no delta is creditable to it)
```

bonsai-2:27b + cogito:8b (ledger entry 31):
```
INERT · environment:run-aborted 0→0 · pass 3/6 → 0/6 (-50pp, within noise) · mechanism structured-thinking fired 0/6 → 0/6 (never ran: no delta is creditable to it); environment:run-aborted absent from the baseline cells (wrong target?)
  activity changed: guard:plan-fanout-split:redirect 3/6→1/6; ...
```

Per tier: bonsai `INERT · 0→0 · pass 3/3 → 0/3 (-100pp, within noise)`; cogito `INERT · 0→0 · pass 0/3 → 0/3`.

The `INERT`/`fired 0` reading is an instrument artifact. The Activation section shows the change ran on 11/11 thinking-tier planner calls. Both ledger entries say so in their `weakness` text. The ledger schema has no validity field to mark this.

## Instrument gaps

1. **The mechanism has no trace-visible activation key.** `structured-thinking-suppressed` is `Effect.logDebug` only (`packages/llm-provider/src/providers/ollama-thinking.ts:178-195`). `verdict.ts --mechanism` and `rax-diagnose attribute` cannot count it. Fix: record the resolved `think` value (or a mechanism event) on the structured exchange.
2. **`attempts` on structured exchanges has no producer at `d8974d306`.** The reasoning wrapper and trace schema accept `attempts` (`packages/reasoning/src/kernel/utils/structured-call-report.ts:50`), but nothing in `packages/llm-provider/src` builds `StructuredAttemptReport` (`structured-parse-retry.ts:79-115` sums usage only). Every after-arm structured exchange lacks `attempts`, `stopReason` and `thinkingChars`. The main checkout has uncommitted work adding this (`ollama-structured-attempt.ts`, untracked); this report did not test it.
3. **An unresolved literal `{{from_step:...}}` written to disk is not attributed.** All 3 bonsai failures read `unattributed` / `wrong-answer`.

## Next (one per cycle)

1. **SELECT: out-of-grammar from_step refs (kernel-warden).** At plan repair (`repairGeneratedPlan`, `packages/reasoning/src/strategies/plan-execute/plan-enforcement.ts:30`), normalize `{{from_step:sN:<key>}}` where `<key>` is not `summary|full` to `{{from_step:sN}}`, or reject the plan for replanning. Normalizing lets `plan-fanout-split` then split it. Also make the executor strip (`step-executor.ts:230`) match any `{{from_step:` token, so an unresolvable ref can never reach a tool as a literal. Emit a guard key so the verdict can count it. Verify: bonsai-2:27b h3-plan-only k=5 (expect the split to fire in about every run and the solve rate to return toward 3/3), qwen3:4b and cogito:8b as guards.
2. **Instrument (provider-warden):** persist structured-call thinking resolution on the exchange (gap 1) and land the per-attempt producer (gap 2, in progress in the main checkout).
3. **Keep `af8653981`.** On the measured tier it removed the planner runaway outright (max 13,855 to 716 tokens, 0/6 over 4096, timeouts 1/6 to 0/5, median cell 29 s) with unchanged plan shape. The bonsai regression comes from a pre-existing grammar hole, which fix 1 closes. Re-check bonsai after fix 1 before calling the change cross-tier KEEP.
