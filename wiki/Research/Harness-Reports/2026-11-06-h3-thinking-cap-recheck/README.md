---
type: harness-report
status: complete
created: 2026-11-06
tags: [h3, thinking, runaway, output-cap, plan-execute, structured-output, bonsai, qwen3]
---

# H3 targeted recheck: thinking/runaway cap, and the plan-execute planner output runaway

Questions (task #25):
1. Since the thinking/output cap landed, did `runaway-exhausted` replace cell timeouts, and did solve rates on the affected cells change?
2. Is the qwen3:4b h3-plan-only planner-call runaway (13,855 output tokens in 99 s, fan-out report) a recurring defect, and does the cap apply to it?

"The cap" means two commits, both in `6a6a7f4d5` and later:
- `77a526dd4`: Ollama `stream()` sends `num_predict = maxTokens`. Before, it added a 6000-token thinking allowance on top.
- `3231565a8`: the one thinking-runaway retry sends `thinking: false`.

`runaway-exhausted` means the `thinking-runaway` signal with `signalKind: "block"`. That is the second runaway, after the retry, which fails the run (`packages/reasoning/src/kernel/capabilities/reason/thinking-runaway.ts:44-58`). In `rax-diagnose attribute` it shows as `signal:block@thinking-runaway`. The first runaway shows as `signal:redirect@thinking-runaway`.

## Answers

1. **runaway-exhausted did not replace timeouts. It never fires.** There are 0 `block` signals in every trace available: 938 runs (914 in 37 earlier scratch trace roots, plus the 24 HEAD runs). Every runaway that was detected recovered on its thinking-off retry. qwen3:4b timeouts on the affected cells fell from 5/20 before the cap to 1/20 at `6a6a` and 0/12 at HEAD. The cap explains this directly: before it, 5 stream calls overshot `maxTokens`, up to 13,200 tokens, and 6 calls ran longer than 60 s. After it there were 0 overshoots and 0 calls over 60 s. The solve rate on those cells did not move outside noise: 9/20, then 9/20, then 8/12.
2. **On bonsai-2:27b the cap is inert, and its timeouts are not runaways.** At HEAD, 6 of 12 bonsai cells timed out, against 12/20 at `b52d3f9f5`. The thinking-runaway mechanism fired in 0 of 12 runs. No stream call reached `max_tokens`; the largest was 4,363 tokens. The calls are slow but below the cap (55-117 s each). The plan-execute `complete()` synthesize call still gets the +6000 allowance.
3. **The planner runaway is real and recurring on qwen3:4b, and no cap covers it.** I found 11 plan-execute planner `completeStructured` calls whose output went over the caller's `maxTokens` of 4096. All 11 are qwen3:4b h3-plan-only, across 5 commits. 3 of them went over 10,096 tokens, which is one widened attempt, so those 3 needed at least 2 attempts. 2 of the 11 calls ended in a cell timeout. cogito:8b and bonsai never did this. The `completeStructured` path keeps the 6000-token thinking allowance, allows 2 native attempts, and has no runaway detection.

## Setup

- Code: dev HEAD `29c749f33`, in the isolated worktree `/home/tylerbuell/.claude/jobs/eaddf328/tmp/wt-h3` (moved from `d864d50a3`). I rebuilt `core` and `reasoning` dist in the worktree. The main checkout was not used.
- Flags: `--k 3 --budget-sec 560 --cell-timeout-sec 150`. The cell cap is the same as all baselines. The run took 2 qwen chunks and 4 bonsai chunks, all `timeout 590` and foreground (the tool host moved calls that ran past 180 s to the background; I waited for each PID to exit before starting the next chunk).
- Cells: the cells where runaways or timeouts appeared in the last full runs.
  - qwen3:4b: rw-7, h3-todo-heavy and rw-9 had runaway signals at `6a6a`. h3-plan-only had the planner runaway and the fan-out timeout.
  - bonsai-2:27b: rw-2, rw-3, rw-6 and rw-7, which had all 12 timeouts in ledger entry 26.
  - cogito:8b: not rerun. It had 0 runaways and 0 timeouts in these cells at `6a6a` (not a thinking model).
- Ollama: no models were loaded at start. I loaded qwen3:4b and then bonsai-2:27b, one tier at a time.
- Results: `results-qwen3-4b.json`, `results-bonsai-2-27b.json` (both `gitSha 29c749f33`).
- Traces (scratch): `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-capcheck/traces-{qwen3-4b,bonsai}/`.
- Scan scripts (scratch): `/home/tylerbuell/.claude/jobs/eaddf328/tmp/runaway-scan/{scan,timesink,cells}.py`. They read trace JSONL and dedupe by `seq`, because aborted traces before `28c28c343` contain every event twice.

## 1. Thinking cap: qwen3:4b (rw-7, h3-todo-heavy, rw-9, h3-plan-only)

| arm | commit | cap | runs | solved | cell timeouts | runs with runaway redirect | runs with runaway block (exhausted) |
|---|---|---|---|---|---|---|---|
| 77b6 | `77b6d6122` | no | 20 | 9/20 | 5 | 1 | 0 |
| 6a6a | `6a6a7f4d5` | yes | 20 | 9/20 | 1 | 4 | 0 |
| HEAD | `29c749f33` | yes | 12 | 8/12 | **0** | 1 | **0** |

Per cell:

| task | 77b6 | 6a6a | HEAD | HEAD causes |
|---|---|---|---|---|
| rw-7 | 0/5 (3 timeouts) | 0/5 (1 timeout) | 0/3 (0) | wrong-answer:3 |
| h3-todo-heavy | 0/5 (1 timeout) | 0/5 | 3/3 | none:3 (the 94f0 fix, not the cap) |
| rw-9 | 5/5 | 5/5 | 2/3 | stall-after-work:1 |
| h3-plan-only | 4/5 (1 timeout) | 4/5 | 3/3 | none:3 |

`rax-diagnose attribute --all` on the same cells:

| reason | 77b6 | 6a6a | HEAD |
|---|---|---|---|
| environment:run-aborted | 5 | 1 | **0** |
| harness:tool-call-dropped | 3 | 2 | 0 |
| harness:stall-after-work | 0 | 0 | 1 |
| model:had-evidence-wrong-output | 1 | 7 | 3 |
| model:fabrication-vetoed | 2 | 1 | 0 |
| signal:block@thinking-runaway (exhausted) | 0 | 0 | **0** |

Direct evidence that the cap acted, from qwen3:4b `stream` calls in all 60 runs per full arm:

| arm | stream calls | tokensOut > maxTokens | max tokensOut | `max_tokens` stops | calls > 60 s |
|---|---|---|---|---|---|
| 77b6 (no cap) | 184 | 5 | 13,200 | 5 | 6 |
| 6a6a (cap) | 192 | 0 | 7,200 | 7 | 0 |
| HEAD (cap, 12 runs) | 32 | 0 | 7,200 | 1 | 0 |

How to read it:
- The cap holds. Runaways now stop at 7,200 tokens and get one retry with thinking off.
- The retry recovered every time: 6a6a had 5 redirects and 0 blocks, 94f0 had 3 and 0, HEAD had 1 and 0.
- The timeouts these long calls caused are gone. HEAD rw-7 run1 shows the path end to end: a 7,200-token thinking-only stop, a redirect, a recovered run of 86 s, and the cell completed.
- The solve rate did not change outside noise. The h3-todo-heavy gain (0/5 to 3/3) comes from `94f0`, not from the cap.

`h3/verdict.ts` with `--reason environment:run-aborted --mechanism thinking-runaway` cannot measure the before side. It reads `environment:run-aborted 0→0` with "absent from the baseline cells", because the 77b6 and 6a6a results files have no `traceFile` for timed-out cells. That is the `no-trace` bug, fixed in `ca45e029f` after those runs. The timeout counts above come from the results `status`/`causeLabel` and from `rax-diagnose --all` on the trace directories. The verdict lines (verbatim, for the record):

```
qwen 77b6→HEAD: NO-CHANGE · environment:run-aborted 0→0 · pass 9/20 → 8/12 (+22pp, within noise) · mechanism thinking-runaway fired 1/20 → 1/12; new harness reasons: harness:stall-after-work 0→1
qwen 6a6a→HEAD: NO-CHANGE · environment:run-aborted 0→0 · pass 9/20 → 8/12 (+22pp, within noise) · mechanism thinking-runaway fired 4/20 → 1/12; new harness reasons: harness:stall-after-work 0→1
```

## 2. Thinking cap: bonsai-2:27b (rw-2, rw-3, rw-6, rw-7)

| task | b52d (entry 26) | HEAD | HEAD causes |
|---|---|---|---|
| rw-2 | 0/5 (2 timeouts) | 0/3 (2) | stall-after-work:1, aborted:2 |
| rw-3 | 3/5 (2) | 0/3 (2) | wrong-answer:1, aborted:2 |
| rw-6 | 1/5 (3) | 0/3 (1) | stall-after-work:2, aborted:1 |
| rw-7 | 0/5 (5) | 0/3 (1) | wrong-tool-arg:2, aborted:1 |
| total | 4/20, 12 timeouts | 0/12, 6 timeouts | |

Verdict (verbatim): `INERT · environment:run-aborted 0→6 · pass 4/20 → 0/12 (-20pp, within noise) · mechanism thinking-runaway fired 0/20 → 0/12 (never ran: no delta is creditable to it); new harness reasons: harness:tool-call-dropped 0→1, harness:stall-after-work 0→1`. The `0→6` has the same cause as above: the b52d results have no trace path for timed-out cells.

`rax-diagnose attribute --all` at HEAD: harness=2, model=4, environment=6. Reasons:
- environment:run-aborted 6
- model:had-evidence-wrong-output 2
- model:fabrication-vetoed 1
- harness:stall-after-work 1
- harness:tool-call-dropped 1
- model:ignored-guidance 1

At b52d on the same cells: environment:run-aborted 12, model 5, harness 0.

Why bonsai cells time out (trace time-sink at HEAD):
- No `max_tokens` stops and no runaway signal in any run. The largest stream output was 4,363 tokens.
- The slowest single call per run was 55-117 s, either a `stream/think` call or a plan-execute `complete/synthesize` call. 4 stream calls ran over 60 s while staying under the cap. That is decode speed, not runaway.
- rw-3: the plan-execute synthesize step is the time sink in every run. At b52d it produced 4,645-6,273 output tokens per call (`maxTokens` 4096, so the `complete()` +6000 allowance applied) in 81-107 s, with 6-8k characters of real content. HEAD rw-3 run0 went silent for 131 s after the s1 `file-read` while step s2 was in progress, then aborted (`01M6QT7F7D901B2WRCPPD4PFVT`).
- The drop from 4/20 to 0/12 is inside noise. Commits between the arms include Phase 4 typed parts and the plan fan-out split. Nothing in it can be credited to or blamed on the cap, which fired 0 times.

The bonsai timeouts are a speed versus cell-cap problem, as entry 26 finding 2 already said. They are not a runaway problem. The cap has nothing to cut on this tier.

## 3. Planner-call output runaway (plan-execute `completeStructured`)

Threshold: `tokensOut > 4096`, the planner's own `maxTokens` (`packages/reasoning/src/strategies/plan-execute.ts:326`). I scanned every `completeStructured` exchange in all available traces: 914 runs in 37 trace roots under `/home/tylerbuell/.claude/jobs/eaddf328/tmp/`, plus the 24 HEAD runs.

**11 occurrences, all qwen3:4b, all h3-plan-only, all the plan-execute planner call.**
- No cogito:8b call went over the threshold.
- No bonsai-2:27b call went over the threshold; the largest was 886 tokens.
- No call on any other task went over the threshold.
- Older qwen roots had 0: h3full, s4full, d9, fix1.

| arm (commit) | run | trace | tokensOut | duration | cell outcome |
|---|---|---|---|---|---|
| a698 | run4 | `h3-baseline-a698/traces-qwen3-4b/qwen3_4b/ra-default/h3-plan-only/run4/01M6PK3SBDMPZ685RPF0W8913V.jsonl` seq 1103 | 6,568 | 47 s | completed |
| 77b6 | run0 | `h3-77b6/traces-qwen3-4b/qwen3_4b/ra-default/h3-plan-only/run0/01M6PX2D6WS9WT15W1VJR9JAXH.jsonl` seq 15 | 6,804 | 49 s | completed |
| 77b6 | run1 | `h3-77b6/.../h3-plan-only/run1/01M6PXNGSC1PRTZGZV5JBZ4ZFE.jsonl` seq 451 | **11,246** | 83 s | **timeout** |
| 77b6 | run2 | `h3-77b6/.../h3-plan-only/run2/01M6PY9JNQX0R2AWRCKHZZQBQ9.jsonl` seq 306 | 9,366 | 70 s | completed |
| 6a6a | run1 | `h3-6a6a/traces-qwen3-4b/qwen3_4b/ra-default/h3-plan-only/run1/01M6Q3B8TZ64VWSNTBRZQJDH34.jsonl` seq 1057 | 4,209 | 31 s | completed |
| 6a6a | run2 | `h3-6a6a/.../h3-plan-only/run2/01M6Q3YXMPE3P09Z8165M0K2PB.jsonl` seq 312 | 5,013 | 37 s | completed |
| 6a6a | run4 | `h3-6a6a/.../h3-plan-only/run4/01M6Q4Z1Z7F6E7YR0Z4TP23G6S.jsonl` seq 697 | 6,919 | 50 s | completed |
| 6a6a | run4 | same trace, seq 742 (second planner call, a replan) | 7,818 | 56 s | completed |
| fanout (`d864d50a3`) | run1 | `h3-fanout/traces-qwen3-4b/qwen3_4b/ra-default/h3-plan-only/run1/01M6QRQ95CJZMNC0K4J9XBFF17.jsonl` seq 148 | **11,216** | 82 s | completed |
| fanout | run2 | `h3-fanout/.../h3-plan-only/run2/01M6QRV6NF4BAS7VXC7P7F23DQ.jsonl` seq 486 | **13,855** | 99 s | **timeout** |
| HEAD (`29c749f33`) | run2 | `h3-capcheck/traces-qwen3-4b/qwen3_4b/ra-default/h3-plan-only/run2/01M6QT070E264BMJYHX2M6TJT0.jsonl` seq 160 | 4,843 | 35 s | completed |

All paths are relative to `/home/tylerbuell/.claude/jobs/eaddf328/tmp/`.

- **Rate:** about 1 in 3 qwen3:4b planner calls on this task go over 4096 output tokens. Across 30 planner calls in the qwen h3-plan-only runs from a698 to HEAD, the median is about 1,500 tokens and the distribution has a heavy tail.
- **Plan size:** the plan JSON itself is small, 815-1,929 characters (about 200-500 tokens). The excess output is not plan content.
- **Cost:** these calls take 31-99 s of a 150 s cell. 2 of the 11 went over 11k tokens and ended the cell by timeout.

### Does the cap apply to `completeStructured`? No.

1. **The runaway detector is think-phase only.** `isThinkingRunaway` and `recoverThinkingRunaway` run from `packages/reasoning/src/kernel/capabilities/reason/normalize-think-response.ts:167`, on the kernel think call. Plan generation goes through `extractStructuredOutput` (`packages/reasoning/src/strategies/plan-execute.ts:317`) and never reaches that code.
2. **The stream cap does not cover it.** `77a526dd4` changed only `stream()`. Ollama `completeStructured` still widens `num_predict` by the 6000 allowance and sends no `think` param, so qwen3 thinks under `format` (`packages/llm-provider/src/providers/local.ts:1203-1214`, `widenNumPredictForThinking` at `local.ts:399`). The per-attempt cap is 4096 + 6000 = 10,096.
3. **It gets 2 native attempts, then more calls.** `tryNativeStructuredOutput` passes `maxParseRetries: 1` (`packages/reasoning/src/structured-output/pipeline.ts:109`). `runStructuredParseWithRetry` sums usage across attempts (`packages/llm-provider/src/structured-parse-retry.ts:83-106`). So one recorded exchange can hold up to 20,192 output tokens. If both attempts fail, the prompt-mode fallback runs more calls (`maxRetries: 2`).
4. **Inference, not verified:** 13,855, 11,246 and 11,216 are each above 10,096, so those 3 exchanges took at least 2 attempts. The likely story is that attempt 1 thought until `num_predict`, returned truncated or invalid JSON, and attempt 2 produced the plan. The trace cannot confirm this (see the instrument gaps).

So this is the same family as the think-phase runaway: unbounded default thinking under a widened `num_predict`. It sits on a path the cap and the runaway recovery do not reach.

## Instrument gaps found

1. **`completeStructured` exchanges record no `stopReason`, no `thinkingChars` and no per-attempt split.** For the call above (seq 486) the trace keeps only `tokensOut 13855, durationMs 99370, content 1424 chars`. Thinking runaway, parse retry and real output look the same. Anchor: `packages/reasoning/src/kernel/observable-llm.ts:371`, with usage from `StructuredUsageRef`.
2. **An LLM call still in flight at cell abort leaves no record.** In HEAD bonsai rw-3 run0, the trace has 131 s of silence before `run-aborted`. Nothing says which call ran or how far it got. There is no request-started event in the trace (`emitLLMRequestStarted` in `observable-llm.ts:374` is not persisted).
3. **verdict.ts cannot count before-arm timeouts for results files written before `ca45e029f`.** Timed-out cells have no `traceFile`. For older baselines, use `rax-diagnose --all` on the trace directory.
4. **The plan-execute run meter estimates planner spend as `raw.length/4 + prompt/4`** (`plan-execute.ts:340-345`). For seq 486 that estimate is a few hundred tokens against 13,855 recorded in the trace. I did not check whether the run total also adds `StructuredUsageRef`.

## Ledger

**Not booked.** I found no valid mechanism comparison:
- The cap is present in both `6a6a` and HEAD.
- `77b6`→`6a6a` was already booked as part of the batch in entry 24.
- On bonsai the mechanism fired 0/12, which is void-no-activation.
- The `77b6`→HEAD qwen delta spans many commits.

The direct activation evidence above (stream overshoot 5→0, timeouts 5→1→0, exhausted 0 everywhere) is the result of this pass. It is not a gated lift claim.

## Next (one per cycle)

1. **SELECT, planner output runaway (llm-provider, possibly kernel).** Cap thinking on the structured path the same way as `77a526dd4`: send `num_predict = maxTokens` with no allowance on `completeStructured` (`local.ts:1208-1214`). Another option is to send `think: false` for schema-constrained plan calls, since the plan JSON is 200-500 tokens. Also record `stopReason`/`thinkingChars` per attempt on structured exchanges (instrument gap 1), so the fix can be measured. The fix should emit a key, so that `verdict.ts --mechanism` can count activations.
   - Verify: `--task h3-plan-only --k 5` on qwen3:4b, with bonsai and cogito as guards.
   - Success: 0 planner calls over 4096 output tokens, no drop in plan validity, and solve rate held.
   - Owner: provider-warden (`packages/llm-provider/src/providers/local.ts`).
2. **Not this cycle:** bonsai rw-* timeouts. They are decode speed plus the `complete()` +6000 allowance on synthesize (`local.ts:589`), not runaways. To measure bonsai on rw-*, rerun those cells with `--cell-timeout-sec 300`. The `complete()` allowance is the same lever as item 1 for a later pass.
