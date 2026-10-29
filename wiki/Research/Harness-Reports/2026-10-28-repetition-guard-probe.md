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

## Tight-loop follow-up

Corrects TL;DR item 3 / caveat 2 above ("tight loops NOT measured live"). Task P never elicited repeats; these two tasks do. Prototype: `wiki/Research/Prototypes/rg-probe-tightloop-2026-10-28.ts` + `rg-probe-tightloop-matrix-2026-10-28.sh`.

### Setup

| Item | Value |
|---|---|
| BEFORE | worktree `118f45255` |
| AFTER | worktree of `HEAD` (`739af69d4`, descendant of `fd00b49b5`, so includes the distinct-results carve-out) |
| Models | qwen3:14b, gemma4:12b (local Ollama), **n=3** per cell, `reactive`, `maxIterations: 14`, 180 s cell timeout |
| Tool surface | `get_status` (+ `recall` on qwen3), identical across arms; printed per cell |
| T1 | `get_status` takes no args, always returns `{"status":"pending"}`. Prompt: call one at a time, must make >= 8 calls, "pending" is expected. |
| T2 | Same tool, takes `attempt` (number); model told to pass 1,2,3,... Result always identical. This is the varied-no-op-arg case fd00b49b5 targets. |

Prompt iteration: the first prompt ("keep calling until done, at least 8 calls") made qwen3 stop after 1 call; the forcing prompt above was needed. Smoke cells excluded.

### Results

Calls = `tool-call-end` events; Exec = real handler executions; Trips = results containing "Stop repeating this tool"; Dedup = results carrying "[Already done - do NOT repeat]" (same-batch duplicate suppression, a different mechanism).

| Model | Task | Arm | Runs | Calls (per run) | Exec (per run) | Runs with a trip | Dedup (per run) | Other stop signal | Mean iters | Mean tokens |
|---|---|---|---|---|---|---|---|---|---|---|
| qwen3:14b | T1 | before | 3 | 3,3,3 | 1,1,1 | 0/3 | 4,4,4 | none | 7 | 2897 |
| qwen3:14b | T1 | after | 3 | 4,3,3 | 1,1,1 | 0/3 | 6,4,4 | loop_resolution x1 | 7.7 | 2611 |
| gemma4:12b | T1 | before | 3 | 4,4,4 | 1,1,1 | 0/3 | 6,6,6 | loop_resolution x3 | 9 | 1293 |
| gemma4:12b | T1 | after | 3 | 4,4,4 | 1,1,1 | 0/3 | 6,6,6 | loop_resolution x3 | 9 | 1220 |
| qwen3:14b | T2 | before | 3 | 6,6,5 | 4,4,4 | **3/3** (2,2,1 trips) | 0 | stall_deliverable x2 | 17.3 | 7388 |
| qwen3:14b | T2 | after | 3 | 6,6,3 | 4,4,3 | **2/3** (2,2,0 trips) | 0 | stall_deliverable x2 | 15.3 | 7456 |
| gemma4:12b | T2 | before | 2 (+1 timeout) | 5,6 | 4,4 | 2/2 (1,2 trips) | 0 | stall_deliverable x1 | 17 | 4405 |
| gemma4:12b | T2 | after | 2 (+1 timeout) | 5,5 | 4,4 | 2/2 (1,1 trips) | 0 | none | 16 | 4755 |

(T2 row means exclude timeout cells; the gemma4 T2 rep 1 cell timed out at 180 s in BOTH arms.)

### Findings

1. **T2 (varied no-op arg, identical result), the fd00b49b5 case: guard still trips AFTER.** 4/5 completed AFTER runs hit "Stop repeating this tool" (qwen3 2/3, gemma4 2/2), vs 5/5 BEFORE. Handler executed 4 times, then blocked, then the run terminated, in every tripping run, both arms. The one non-tripping AFTER run (qwen3 rep 2) made only 3 calls and stopped on its own; no looping happened, so it neither supports nor contradicts the guard. No BEFORE-trips/AFTER-doesn't pattern: **no regression observed**. Caveat: BEFORE also trips on T2 because the carve-out did not exist there, so T2 cannot discriminate AFTER from BEFORE; it only shows AFTER did not lose tripping. n=3, so a difference of ~1 run is noise.
2. **T1 (identical canonical args): contained by a different mechanism, not the "Stop repeating" nudge.** Models emit the repeated calls in one batch; the first executes (Exec=1) and the rest are answered by same-batch duplicate suppression (`guard.ts:350`, "Already done - do NOT repeat"), then `loop_resolution` terminates in 4/6 runs. Identical in BEFORE and AFTER (0 trips both). So the literal "Stop repeating this tool" string was not exercised by T1. Identical-arg repetition was nonetheless stopped at 1 real execution in 12/12 runs, both arms.
3. **Not tested live:** a sequential (multi-iteration) identical-arg loop, which is what the cross-iteration nudge path is for. The models would not poll sequentially on T1 (they batched or stopped). That path is covered only by unit tests.

### Caveats

- n=3 per cell; two local models only; toy tool; BEFORE..AFTER range spans other reasoning commits (as in the main report), so attribution to fd00b49b5 alone is not isolated (T2 is the only task where its logic is on-path, and BEFORE behaves the same).
- Models do not follow the "one at a time" instruction on T1; the result characterises how they actually behave, not the idealised sequential case.
- `trips` counts string match on trace `tool-call-end`; `dedup`/`guards` are counted from trace too. Token = agent-reported `tokensUsed`.
- 2 of 24 cells (gemma4 T2 rep 1, both arms) timed out and are excluded from the means.

### Verdict

Tight-loop guard behaviour confirmed live for the varied-no-op-arg case on both tiers (AFTER trips in 4/5 completed runs, no regression vs BEFORE) and identical-arg repetition is contained (1 execution) via the same-batch dedup + loop_resolution path. The sequential identical-arg nudge path remains unit-test-only. Nothing for kernel-warden.
