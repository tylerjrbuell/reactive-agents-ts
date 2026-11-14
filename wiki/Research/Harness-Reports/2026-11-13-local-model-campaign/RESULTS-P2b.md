---
type: research
status: complete
created: 2026-11-14
tags: [harness, bench, local-models, campaign, ollama, h3, long-horizon]
---

# Local-model campaign P2b: full H3 (5 models), long-horizon (2 models), combined 11-model ranking

Same pin as P2a: SHA `2269ce57e`, worktree `/home/tylerbuell/campaign-worktree`, arm `ra-default` (H3) / `lh-a0` (LH), out-of-repo driver, `RA_BENCH_ALLOW_FALLBACK=1` (live probe wrote numCtx 32768). 201 new rows in `manifest.jsonl` (phase `P2b`, `P3b`; each with SHA and 12-char digest). Digests: qwen3:14b `bdbd181c33f2`, qwen2.5:14b `7cdf5a0187d5`, gemma4:e4b `dc35e8d9c606`, gemma4:12b `6114515d63c1`, deepseek-r1:14b `c333b7232bdb`. /tmp 2.3G before, 2.4G after (about +100 MB, under the 500 MB limit); / 216G free. cogito:8b already had 36/36 cells (`remaining:0`), nothing to finish. Skipped by brief: lh-1; LH for models outside the best two.

Noise rule: 36 cells, Bernoulli, k=3. Gaps under ~26pp are noise (true SE ~8pp per model). No per-task win/loss is read at k=3.

## 1. H3 (12 tasks x k=3 = 36 cells per model, all complete)

| Model | Solved | Rate | Median dur | Billed tok / solved | Total tok | endStatus (succ/fail/none) | Cause labels |
|---|---|---|---|---|---|---|---|
| gemma4:12b | 25/36 | 69% | 24 s | 17,160 | 429k | 30/3/3 | none 18, wrong-answer 8, success-w-warning 4, aborted 3, unexplained 3 |
| qwen3:14b | 21/36 | 58% | 119 s | 4,854* | 102k* | 18/6/12 | none 14, aborted 12, unexplained 6, wrong-answer 3, s-w-w 1 |
| gemma4:e4b | 21/36 | 58% | 25 s | 12,220 | 257k | 25/7/4 | none 12, wrong-answer 10, unexplained 4, aborted 4, s-w-w 3, tool-failure 2, verifier-reject 1 |
| qwen2.5:14b | 18/36 | 50% | 46 s | 8,072 | 145k | 28/6/2 | wrong-answer 16, none 11, unexplained 6, aborted 2, s-w-w 1 |
| deepseek-r1:14b | 9/36 | 25% | 150 s | 5,166* | 46k* | 5/10/21 | aborted 21, never-engaged 6, none 5, unexplained 4 |

*Timed-out cells (endStatus none) record 0 tokens (the in-flight call is never logged), so tok/solved and totals are understated for qwen3:14b (12 aborted) and deepseek-r1 (21 aborted). Do not compare these two columns across models. Three cells per model are `ab-trap-4`, which passes with 0 tokens/0 s on every model, so each rate includes a free 3/36.

qwen3:14b: 21 of its 24 non-timeout cells solved (88%), but 12 of 36 cells (33%) hit the 150 s cell timeout (rw-2, rw-6, h3-plan-only, h3-todo-heavy mostly). `/api/ps` during the run showed 13.7 GB of 14.9 GB resident in VRAM (partial CPU offload at numCtx 32768) and about 36 s per `think` call. Cell timeout is part of this score; it is a latency result, not a capability result.

### Tool-calling honesty (gemma4 / deepseek-r1, stub templates)
Cells with at least one native `tool-call-start` (ab-trap-4 never needs one): qwen2.5 33/36 (116 calls), gemma4:e4b 33/36 (117), gemma4:12b 33/36 (163), qwen3:14b 31/36 (91), **deepseek-r1:14b 14/36 (19 calls)**. gemma4 (13-char template stub) tool-calls natively and correctly: the advertised capability held. deepseek-r1 does not trip the "never calls a tool" rule (it called file-read/file-write on simple tasks: h3-exact-value, h3-continuation, h3-plan-only, rw-3), but it is `weak-native-tool-use`: on rw-2/6/7/9 and todo-heavy it narrates "I will use the file-read tool" in prose, never emits the call, and answers from imagination (6 cells `never-engaged`, 6 harness `forcing-unused`). Its 25% is a capability floor under this harness, not noise.

## 2. deepseek-r1 first attempt voided: infra (Ollama 503), not model

The first 24 r1 cells ran at 7 s each with 0 tokens: `LLMRateLimitError: ollama call failed: server busy, please try again. maximum pending requests exceeded` (trace `01M7C1JYKENMK1SZ2DD3NBJTF0`, terminatedBy `llm_error`). I stopped it at the early-stop rule and confirmed with direct `curl /api/chat` that every model (gemma4:12b, qwen3:4b, deepseek-r1) returned the same 503 within 1 ms; it cleared by itself about 5 minutes later. The last gemma4:12b H3 cell had finished about 5 minutes before the first 503. The 24 cells were moved to `/home/tylerbuell/campaign-traces/superseded/r1-ollama-busy/`, logged `superseded` in the manifest, and r1 was re-run clean (36/36).

Cause, honestly: the Ollama pending-request queue was saturated, so something other than my single-cell driver was issuing requests. Ollama's journal showed a stream of requests carrying a `logprobs` option every 2-4 s from about 22:26 to 22:29 (my driver does not set it; not verified). A Cortex dev-stack (`bun run start`, `dev-stack.ts`, `server/index.ts`) was running and was restarted by a main-thread command during my run (pids 877xxx earlier, 4145xxx later). Cortex or another agent calling Ollama is the likely source; I cannot prove which process it was. No 503s occurred in the other models' cells, but concurrent Ollama use may have inflated latency for any model (qwen3:14b most exposed).

## 3. Failure attribution (`rax-diagnose attribute --all`, zero tokens)

P2b: 180 runs, 86 failed. As the tool reports: harness 11 (13%), model 33 (38%), environment 42 (49%).

| Model | failed | harness | model | env | Reasons |
|---|---|---|---|---|---|
| qwen3:14b | 15 | 0 | 3 | 12 | run-aborted 12, had-evidence-wrong-output 3 |
| qwen2.5:14b | 18 | 1 | 15 | 2 | had-evidence-wrong-output 6, fabrication-vetoed 5, evidence-not-gathered 4, run-aborted 2, harness:evidence-truncated 1 |
| gemma4:e4b | 15 | 0 | 11 | 4 | had-evidence-wrong-output 6, fabrication-vetoed 5, run-aborted 4 |
| gemma4:12b | 11 | 4 | 4 | 3 | harness:tool-call-dropped 4 (false, see below), run-aborted 3, had-evidence-wrong-output 3, fabrication-vetoed 1 |
| deepseek-r1:14b | 27 | 6 | 0 | 21 | run-aborted 21, harness:forcing-unused 6 |

LH (10 cells each): gemma4:12b harness 1 (stall-after-work), model 4 (fabrication-vetoed 2, evidence-not-gathered 2); qwen3:14b harness 0, model 6, env 1 (run-aborted).

### Instrument fault: all 4 gemma4:12b `harness:tool-call-dropped` are false (my attribution instrument over-blames the harness)
- ab-trap-5 run0/1/2 (`01M7C0BQBJC3QN7K8RDDRMXNZQ`, `01M7C0VVK1S1GATZ6EXFMM7SKA`, `01M7C1A6BJ6QB9B42EQWPTKM4M`): the model emitted `file-read(".")`. The trace shows `tool-call-start/end file-read` with the resolved absolute workdir path ("path is a directory; its listing is shown") 28 ms later, same iteration. The call ran. `nativeCalls()` (`packages/trace/src/attribution-facts.ts:237-242`) matches by `baseName(path)`: `baseName(".")` is `.`, never equal to `.bench-run-...`, so the call is classed `dropped`.
- rw-6 run1 (`01M7C0Q3R2PQVS1HVRBTXCGJQP`): the model emitted `file_write` (underscore); the tool layer normalized it and executed `file-write` (seq 140-143). The same function compares `t.toolName === c.name` (lines 240, 246, 266-267), also `packages/trace/src/attribution.ts:331`, so the alias reads as a drop.
The real cause of those 4 fails is model (`had-evidence-wrong-output` is listed as the "also" reason). Proposed fix (NOT applied, section 8): canonicalize tool names (`_` to `-`) in all comparisons, and let a workdir-relative model path (`.`, `./`) match any recorded path of the same tool. Before/after on the reference corpora (`/home/tylerbuell/campaign-traces/traces/{p2,p3a,p3b}`): before = `harness:tool-call-dropped` 5 in p2 (4 are these), 0 in p3a/p3b; after (expected, unverified until applied) = 1 in p2. The fifth is from P2a gpt-oss and is unexamined.

### Real harness-attributable reasons (file:line hypotheses, not verified by edit)
1. **harness:forcing-unused, deepseek-r1 x6** (cogito x5 in P2a): required `file-read` never called and not forced. The r1 trace shows "Required tools not yet used: file-read ... (Redirect 2/2)" then accept. Hypothesis: two text redirects then terminal accept for a prose-only model; `packages/reasoning/src/kernel/capabilities/reason/think.ts` (forcing decision), `packages/reasoning/src/kernel/loop/runner.ts:875`. Kernel-warden.
2. **harness:evidence-truncated x1** (qwen2.5), same as P2a (granite 2, llama 1, qwen3.5 1).
3. **harness:stall-after-work x1** (gemma4:12b lh-debug-green run0, acc 0.33, `stall_deliverable` terminate). `packages/reasoning/src/kernel/loop/runner-helpers/stall-deliverable.ts:270`.
No false-veto (grader 1.0 with run failure) in the 180 H3 cells or the 20 P2b LH cells.

## 4. Token decomposition (zero-token read of `llm-exchange` by purpose)

| Model (H3) | LLM calls | in | out | `think` share of calls | tokens on unsolved cells |
|---|---|---|---|---|---|
| gemma4:12b | 204 | 338k | 196k | 88% (179) | 38% |
| gemma4:e4b | 150 | 180k | 92k | 85% (128) | 43% |
| qwen3:14b | 97 | 90k | 71k | 76% (74) | 51% (aborted cells log 0) |
| qwen2.5:14b | 104 | 120k | 33k | 77% (80) | 74% |
| deepseek-r1:14b | 138 | 58k | 85k | 94% (130) | 86% |

`think` is 76-94% of calls everywhere; `synthesize` 14-19 calls per model; `verify` and `extract` negligible (as in P2a). Shape: qwen3:14b and r1 are output/thinking heavy (summed `think` latency 2,691 s and 5,479 s, vs 1,143 s for gemma4:12b over more calls); qwen2.5 is input heavy (78%) with no thinking, and spends 74% of tokens on cells it did not solve (wrong-answer 16). LH (10 cells): gemma4:12b 533k tokens (391k in, 143k out, 123 `think` calls, 1,051 s), 46% on unsolved cells; qwen3:14b 119k tokens (43 `think` calls, 2,028 s), 69% on unsolved cells.

## 5. Long-horizon, 5 offline tasks x k=2 (lh-1 skipped)

Chosen: gemma4:12b (25/36) and qwen3:14b. qwen3:14b won the 21/36 tie with gemma4:e4b on solve rate among completed cells (21/24 vs 21/32) and for a second family.

| Model | Solved | Median dur | Billed tok / solved | Total tok | Per-task (run0,run1) |
|---|---|---|---|---|---|
| gemma4:12b | 5/10 | 97 s | 106,690 | 533k | rw-4 01, rw-7 11, debug-green 00, enumerate 11, pipeline 00 |
| qwen3:14b | 3/10 | 195 s | 39,524 | 119k | rw-4 00, rw-7 11, debug-green 00, enumerate 01, pipeline 00 |

Same 5 offline tasks in P2a: gpt-oss 10/10, qwen3.5 5/10, qwen3:4b 3/10. gemma4:12b ties qwen3.5, qwen3:14b ties qwen3:4b; only gpt-oss's lead is outside noise.
endStatus: gemma4:12b 9 success, 1 failure (debug-green run0, `stall_deliverable`); qwen3:14b 9 success, 1 aborted at the 400 s cell timeout (debug-green run0). `success` is the runtime label; the hidden grader decides solve (several `success` cells scored 0.17-0.8).
Loop guidance (commit 2269ce57e): fired in 1 of 20 cells, as a graduated `redirect` (gemma4:12b lh-pipeline-stages run1, pattern a `repeated-tool-call`, ended `success`, acc 0.8, unsolved); never a terminate. `thinking-runaway` redirects: gemma4:12b 4 cells, qwen3:14b 1. Offline tasks do not exercise loop guidance (it needs a persistently failing tool, see P2a).

## 6. Combined ranking, 11 models, H3 36 cells each (SHA `2269ce57e`)

| # | Model | Solved | Rate | Tier | Median dur | LH offline (of 10) |
|---|---|---|---|---|---|---|
| 1 | qwen3.5:latest | 29/36 | 81% | A | 22 s | 5 |
| 2 | gpt-oss:latest | 25/36 | 69% | A/B | 32 s | 10 |
| 2 | gemma4:12b | 25/36 | 69% | A/B | 24 s | 5 |
| 4 | qwen3:4b | 23/36 | 64% | B | 55 s | 3 |
| 5 | qwen3:14b | 21/36 | 58% | B (latency-capped) | 119 s | 3 |
| 5 | gemma4:e4b | 21/36 | 58% | B | 25 s | not run |
| 7 | qwen2.5:14b | 18/36 | 50% | C | 46 s | not run |
| 8 | granite4:tiny-h | 17/36 | 47% | C | 9 s | not run |
| 9 | cogito:8b | 14/36 | 39% | D | 15 s | not run |
| 10 | llama3.1:latest | 11/36 | 31% | D | 15 s | not run |
| 11 | deepseek-r1:14b | 9/36 | 25% | D (weak-native-tool-use) | 150 s | not run |

Noise rule: adjacent gaps under ~26pp are not orderings. Defensible: qwen3.5 beats the bottom group (cogito, llama3.1, r1) by 42-56pp. Ranks 2-9 (47-69%) are not separable pairwise.

Per-capability view:
- **Tool-use correctness** (native call emitted and executed on multi-step tasks): good for qwen2.5, both gemma4, the qwen3 family, gpt-oss. Weak: deepseek-r1 (prose-only in 22 of 36 cells), cogito (5 forcing-unused). H3 score alone does not separate this, because ab-trap-4 and exact-value pass for everyone.
- **Long-horizon (5 offline x2)**: gpt-oss 10, gemma4:12b 5, qwen3.5 5, qwen3:14b 3, qwen3:4b 3. Only gpt-oss is clearly ahead.
- **Token efficiency (billed tok per solved H3 cell; valid only where few timeouts)**: qwen2.5 8.1k, gemma4:e4b 12.2k, qwen3.5 13.9k, cogito 14.3k, qwen3:4b 15.1k, granite 16.9k, gemma4:12b 17.2k, gpt-oss 17.2k, llama3.1 31.8k. qwen2.5 is cheap per solve but is wrong most often. qwen3:14b and r1 not comparable (timeouts log 0 tokens). Latency: granite 9 s, qwen3.5 22 s, gemma4 24-25 s fast; qwen3:14b 119 s and r1 150 s slow.

## 7. Levers (P2b deltas)
1. Thinking-model latency under the 150 s cap: qwen3:14b (12/36) and r1 (21/36) lose a third to two thirds of cells to timeouts; both `think`-dominated. Same lever as P2a #2 (pre-emptive thinking budget for `thinking:true`).
2. Prose-only "I will call file-read" turns (r1, cogito): required-tool forcing, same as P2a #4; evidence now spans two families.
3. Fix the attribution instrument (section 3) before reading the next harness reason table: removes 4 over-blamed runs.

## 8. Authority note and dispatch
I attempted the attribution fix in `packages/trace/src/attribution-facts.ts` (my instrument), but the brief's out-of-scope bars editing `packages/**` and the edit was denied by the permission layer; nothing under `packages/**` changed. Parent decision needed: re-dispatch harness-warden with `packages/trace/src/attribution-facts.ts`, `packages/trace/src/attribution.ts` and a pin in `packages/trace/tests/attribution-instrument-faults.test.ts` in scope, then re-run `rax-diagnose attribute --all` on the reference corpora.
- kernel-warden: forcing-unused for prose-only models (r1, cogito); pre-emptive thinking budget.
- provider-warden: static rows exist since b97b6c165; the preflight can drop `RA_BENCH_ALLOW_FALLBACK` once the pin moves. gemma4 native tool emission is behaviorally confirmed; deepseek-r1 `native-fc` is advertised but exercised in only 14/36 cells.
- Owner: lh-1 needs a real search backend. Quiesce Cortex and other Ollama clients during campaign runs (section 2).

## 9. Artifacts
Results `/home/tylerbuell/campaign-traces/p2/{qwen3_14b,qwen2.5_14b,gemma4_e4b,gemma4_12b,deepseek-r1_14b}.json`, LH `/home/tylerbuell/campaign-traces/p3b/{gemma4_12b,qwen3_14b}.json`; traces `/home/tylerbuell/campaign-traces/traces/{p2,p3b}/`; logs `p2-*.log`, `p3b-*.log`; scripts `loop.sh loop-lh.sh wait2.sh wait3.sh agg2.ts cost2.ts lh2.ts`; voided r1 attempt `/home/tylerbuell/campaign-traces/superseded/r1-ollama-busy/`.

## 10. Erratum (2026-11-14): attribution fix applied, numbers changed

The instrument fix proposed in section 8 landed in `packages/trace` (one `canonTool`/`sameTool` normalizer for tool names; a directory-root path `.`/`./` is no target). Re-attributed with `rax-diagnose attribute --all` on `/home/tylerbuell/campaign-traces/traces/{p2,p3a,p3b}`:

| corpus | reason | before | after |
| --- | --- | --- | --- |
| p2 | harness:tool-call-dropped | 5 | 1 |
| p2 | model:had-evidence-wrong-output | 67 | 71 |
| p2 | harness verdict total | 25 | 21 |
| p2 | model verdict total | 110 | 114 |
| p3a, p3b | all rows | unchanged | unchanged |

All other p2 rows, the confidence split and the mechanism counts are identical. The 4 flipped runs are the gemma4:12b runs named in section 8 (all now `model:had-evidence-wrong-output`, decisive). The remaining `tool-call-dropped` is gpt-oss rw-7 run2 (`01M7BJYRHFJHRC1VAZ1M39D2XB`, P2a): the seq 854 `file-write(pipeline.ts)` has no tool-call event before the run ended, so it is a genuine drop. Wherever this report or RESULTS-P2a counts gemma4:12b harness verdicts, read the 4 as model-attributed; the P2a line 47 gpt-oss `tool-call-dropped` stands.
