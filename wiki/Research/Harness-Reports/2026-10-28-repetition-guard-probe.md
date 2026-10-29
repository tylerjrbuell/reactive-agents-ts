---
type: harness-report
status: complete
created: 2026-10-28
tags: [harness-report, repetition-guard, kernel, local-models, before-after]
probe: repetition-guard-probe
verdict: directional-spike-evidence
related:
  - "[[2026-10-28-cortex-reliability-and-providers]]"
  - "[[2026-10-28-todo-surface-probe]]"
---

# Repetition guard before/after probe (2026-10-28)

> [!warning] Directional evidence, not a lift-rule verdict
> n=5 per cell, 2 local tiers, toy deterministic tasks. Bernoulli SE is about 13pp per cell; gaps under about 26pp are noise. The S-task gap below (0/5 vs 5/5 on both tiers) is far outside that band.

Raw data: `2026-10-28-repetition-guard-probe.jsonl` (60 cells). Probe script: `wiki/Research/Prototypes/rg-probe-2026-10-28.ts`, matrix runner `rg-probe-matrix-2026-10-28.sh`.

## TL;DR

1. **Fix works for distinct-argument lookups.** Task S (4 `inventory_lookup`/`price_lookup` calls with the original `sku` argument): BEFORE 0/5 on both tiers, AFTER 5/5 on both tiers. BEFORE tripped "Stop repeating this tool" in 10/10 runs (62 trips total); AFTER tripped 0 times in 10/10.
2. **No regression on distinct file writes.** Task F (3 different files via `file-write`): 5/5 vs 5/5 on both tiers, 0 trips in either arm.
3. **"True tight loops still trip" is NOT measured.** Task P (a job-status tool that never becomes ready) did not elicit repeated identical calls: both arms made at most 1 `job_status` call per run, 0 guard trips. Neither arm exercised the tight-loop path. Live evidence for that clause is absent; only the unit tests (`guard.test.ts`) cover it.
4. **Token and time cost drops with the fix on S** (BEFORE burns iterations on blocked calls then invents a total): see table.

## Setup

| Item | Value |
|---|---|
| BEFORE | git worktree of `118f45255` (parent of the guard commits) |
| AFTER | git worktree of `eafef13d0` (dev HEAD at run time) |
| Models | qwen3:14b, gemma4:12b (local Ollama), n=5 per task x arm |
| Config | `reactive` strategy, `maxIterations: 12`, one process per cell, 240 s cell timeout (counts as fail) |
| Order | arms interleaved per (rep, model, task) |

Tasks and checks:

| Task | Prompt (abridged) | Pass |
|---|---|---|
| F | Write a.txt/b.txt/c.txt with alpha/bravo/charlie via file-write | all 3 files exist with the word |
| S | Look up units and price for A100,B200,C300,D400 (`sku` argument), compute total value | answer contains 1155 |
| P | Poll `job_status` until ready (never ready); report | honest "pending", no claim of ready (regex) |

## Instrument checks

- **Resolution.** Each arm imports `packages/runtime/src` and `packages/tools/src` from its own worktree by absolute path. `Bun.resolveSync("@reactive-agents/reasoning")` from each worktree's runtime resolved to that worktree's `packages/reasoning/src/index.ts` (recorded per cell in the `reasoning` field), so arms differ in reasoning source only through the commit range. Main tree was not touched.
- **Visible tool surface (per cell, from `llm-exchange.toolSchemaNames`).** F: `file-write, recall`. S: `inventory_lookup, price_lookup, recall`. Identical across arms. (An early F smoke run without `builtins:["file-write"]` showed only `recall`; fixed before counting.)
- **Guard trips** counted from trace `tool-call-end` events containing "Stop repeating this tool".
- Smoke cells (`results-smoke` runs) excluded from the data.

## Results (n=5 per cell)

| Model | Task | Arm | Pass | Guard trips (runs with >=1) | Mean tokens | Mean wall s |
|---|---|---|---|---|---|---|
| qwen3:14b | F | before | 5/5 | 0 | 1563 | 22 |
| qwen3:14b | F | after | 5/5 | 0 | 1463 | 12 |
| qwen3:14b | S | before | 0/5 | 18 (5/5) | 5107 | 90 |
| qwen3:14b | S | after | 5/5 | 0 | 4277 | 63 |
| qwen3:14b | P | before | 2/5 (3 cell timeouts) | 0 | 1915* | 166 |
| qwen3:14b | P | after | 3/5 | 0 | 1460 | 33 |
| gemma4:12b | F | before | 5/5 | 0 | 1967 | 18 |
| gemma4:12b | F | after | 5/5 | 0 | 1970 | 9 |
| gemma4:12b | S | before | 0/5 | 44 (5/5) | 4422 | 119 |
| gemma4:12b | S | after | 5/5 | 0 | 1920 | 11 |
| gemma4:12b | P | before | 5/5 | 0 | 1545 | 18 |
| gemma4:12b | P | after | 5/5 | 0 | 1429 | 17 |

\* tokens exclude timed-out cells (no data). Token values are the agent-reported `tokensUsed`; trace-derived token sums were 0 (field not populated in `llm-exchange`), so they are not reported.

## Caveats

1. **BEFORE-to-AFTER range is wider than the guard change.** `118f45255..eafef13d0` also contains other reasoning-kernel commits (todo checklist facts `380d0b6b8`, answer-satisfied ledger fix `45b55c849`, etc.). The S result matches the guard mechanism (BEFORE trips on every run, AFTER on none) but attribution to a13cdf182+fd00b49b5 alone is not isolated; no intermediate arm at `fd00b49b5` was run.
2. **Task P is invalid as a tight-loop test** (see TL;DR 3). Its pass/fail differences (qwen3:14b 2/5 vs 3/5, mostly cell timeouts and one fabricated "reported ready" answer in AFTER) are model noise, not guard behaviour.
3. **P regex check is crude.** It rejects answers matching "is ready"/"reports ready"; one AFTER qwen3 answer claimed it "checked repeatedly until it reported ready" despite one call. That is a model honesty failure unrelated to the guard.
4. Two local tiers, no frontier tier, toy tools, n=5. Does not satisfy the cross-tier KEEP bar for a new mechanism; this is a bug-fix regression check, and S is a clear bug repro rather than a lift claim.
5. fd00b49b5's added "distinct results" requirement for the carve-out was not specifically probed (S results were distinct per SKU).

## Verdict

Distinct-argument calls no longer blocked (S: 0/10 to 10/10); distinct-target file writes unaffected (F: 10/10 both). Tight-loop-still-trips: **not measured** live; relies on unit tests.
