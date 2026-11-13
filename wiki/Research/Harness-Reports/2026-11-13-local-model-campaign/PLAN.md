---
type: research
status: active
created: 2026-11-13
tags: [harness, bench, local-models, campaign, ollama]
---

# Local-model campaign (2026-11-13): Phase 1 roster + smoke, and the plan for P2-P5

Machine: RTX 4070 Ti SUPER 16 GB, Ollama at localhost:11434, HEAD `3018dcac1` (dev, clean).
All smoke cells: H3 `h3-exact-value` (needs `file-read`, native FC), k=1, `ra-default` arm.
Outputs live OUTSIDE the repo: `/home/tylerbuell/campaign-traces/` (660 KB after P1). `/tmp` 2.3 GB before and after (growth 0).
Results manifest (append-only): `wiki/Research/Harness-Reports/2026-11-13-local-model-campaign/manifest.jsonl`.

## 1. Key finding: capability table gate, and the override that works

Only 8 Ollama tags are in `STATIC_CAPABILITIES` (`packages/llm-provider/src/capability.ts:519-655`):
`cogito:14b`, `qwen3:14b`, `qwen3:4b`, `cogito:8b`, `qwen3.5:latest`, `bonsai-2:27b`, `qwen3.8:27b`, `gemma4:26b`.
Every other model resolves `source="fallback"` (2048 ctx) at the bench preflight (`packages/benchmarks/src/preflight.ts`) and its cell is INCONCLUSIVE (`no-run`). Reproduced: `llama3.1:latest` without the flag gives `no-run cause=no-trace`.

Documented per-run override: `RA_BENCH_ALLOW_FALLBACK=1` (`packages/benchmarks/src/runner.ts:680`). Verified it is honest, not a silent 2048 run: with the flag, the live `/api/show` probe in `providers/local.ts` writes through, and every `llm-request` in the trace carries `numCtx":32768`, `numCtxSource":"profile"` (checked on granite4:tiny-h, gemma4:e4b, deepseek-r1:14b, mimo-v2.6, llama3.1). Tool dialect comes from the `tools` capability in `/api/show` (native-fc). So non-table models are NOT blocked; they run under the override. Static-table rows are still the cleaner fix (see section 6).

`H3_TIERS` (`packages/benchmarks/src/h3/run-h3.ts:83`) only knows 3 tiers. This campaign uses an out-of-repo driver, `/home/tylerbuell/campaign-traces/driver.ts`, which imports `runH3` + `H3_TIERS` by absolute path and registers any tag at runtime (no source edit). It supports `--suite long-horizon`.

## 2. Roster

Selection: 10 primary models, 9 families, one resident at a time (Ollama swaps; no restart needed). "Cap" = capability status. `ovr` = needs `RA_BENCH_ALLOW_FALLBACK=1`. Disk size from `/api/tags`; weights fit 16 GB unless noted.

| # | Model | Family | Params / quant | Size | VRAM fit | Cap | Smoke endStatus | Smoke cause | Tok | Dur | traceId |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | qwen3:4b | qwen3 | 4.0B Q4_K_M | 2.6 GB | yes | static | success (solved) | none | 2216 | 14 s | 01M7B42VB09KSGFT1FGJ2HD0MF |
| 2 | qwen3:14b | qwen3 | 14.8B Q4_K_M | 9.3 GB | yes | static | success (solved) | none | 2167 | 34 s | 01M7B45FF13WPNM6XFVHF4JJBJ |
| 3 | qwen3.5:latest | qwen3.5 (qwen35) | 9.7B Q4_K_M | 6.6 GB | yes | static | success (solved) | none | 1990 | 14 s | 01M7B46N5QCM9Z3TCMC2160W3E |
| 4 | cogito:8b | cogito (llama base) | 8.0B Q4_K_M | 4.9 GB | yes | static | success (solved) | none | 2083 | 11 s | 01M7B44ZF017YX1V062XS6064Z |
| 5 | llama3.1:latest | llama | 8.0B Q4_K_M | 4.9 GB | yes | ovr | success (solved) | none | 3911 | 10 s | 01M7B4767C0WVH1E74WKRDFQ98 |
| 6 | gemma4:e4b | gemma4 | 8.0B Q4_K_M | 9.6 GB | yes | ovr | success (solved) | none | 2630 | 12 s | 01M7B47SJHJRVFBVGPWJTC01X8 |
| 7 | gemma4:12b | gemma4 | 11.9B Q4_K_M | 7.6 GB | yes | ovr | success (solved) | none | 2301 | 16 s | 01M7B4DJG9YN21C0HSXNR2PHJA |
| 8 | granite4:tiny-h | granite (hybrid MoE) | 6.9B Q4_K_M | 4.2 GB | yes | ovr | success (solved) | none | 2122 | 7 s | 01M7B48A7TE33BEF0PYFC4K22W |
| 9 | qwen2.5:14b | qwen2.5 | 14.8B Q4_K_M | 9.0 GB | yes | ovr | success (solved) | none | 1501 | 15 s | 01M7B4FDF340KK73A3A2RNTP3S |
| 10 | deepseek-r1:14b | deepseek-r1 (qwen2 distill) | 14.8B Q4_K_M | 9.0 GB | yes | ovr | failure (not solved) | never-engaged (abstained: no file-read call) | 4232 | 104 s | 01M7B48P31C28SD5Z5XJB3WFV5 |

Note on rows 6-7: gemma4 ships as two sizes of one family. Family count = qwen3, qwen3.5, cogito, llama, gemma4, granite, qwen2.5, deepseek-r1 = 8 for 10 models (9 with reserve phi). Drop #7 first if time is short.

Reserve (smoke done, run only if time remains, or swap in):

| Model | Family | Size | Cap | Smoke | Tok | Dur | traceId |
|---|---|---|---|---|---|---|---|
| mimo-v2.6:latest | qwen35 (custom) | 6.6 GB | ovr | success (solved) | 1569 | 9 s | 01M7B4E718ZPDR3A77M09WDVY2 |
| ornith:latest | qwen35 (custom) | 5.6 GB | ovr | success (solved) | 1937 | 10 s | 01M7B4EXQTQWWXSVVVKPTMNP4M |
| granite3.3:latest | granite | 4.9 GB | ovr | success (solved) | 2940 | 18 s | 01M7B4G1SBBZAAB27PRFTKTBF3 |
| llama3.2:3b | llama | 2.0 GB | ovr | success (solved) | 3172 | 8 s | 01M7B4GPBX9VRFFPBAYAWR5BHK |
| bonsai-2:27b | qwen35 Q2_0 | 8.3 GB | static | success (solved) | 1917 | 13 s | 01M7B4H3SDX7794X4J7MKDYTYH (already measured 2026-11-06) |
| phi4-mini-reasoning | phi3 | 3.2 GB | ovr | failure (not solved) | 3391 | 24 s | 01M7B4CHMV3TNHGSAJVGBEQCW5 (cause budget-cap, 1 iteration; weak tool use. Keep as the "small reasoning model" probe if wanted) |

Blocked / excluded:

| Model | Reason | Evidence |
|---|---|---|
| gpt-oss:latest (20.9B MXFP4, 13.8 GB) | blocked-on-ollama: `/api/show` and chat both fail with `read GGUF metadata ... unsupported tensor "blk.0.ffn_down_exps.weight" size overflows` (installed Ollama build cannot load this blob). Not a framework fault; needs an Ollama upgrade or re-pull (owner action, not done). | smoke trace 01M7B4BWN8E8X4X0EMHM06R34X, `provider-error`, 0 tok |
| nimble:latest (9B Q8_0) | blocked-on-capability/model: `/api/show` capabilities = `["decision"]` (no `completion`, no `tools`), Modelfile `TEMPLATE {{ .Prompt }}`; chat request fails at iteration 0. Not a tool-calling chat model. | trace 01M7B4EGKKPRW9A5C4XHNA21FV, `provider-error`, 0 tok |
| gemma4:26b (18.7 GB), qwen3.8:27b (17.7 GB), Huihui-Qwen3.8-27B (18.3 GB) | exceed 16 GB VRAM (CPU offload, very slow). In static table, so runnable later as an owner opt-in, not in the roster. | `/api/tags` sizes |
| gemma4:latest (9.6 GB) | duplicate of gemma4:e4b (same size/digest family) | `/api/tags` |
| cogito:latest, qwen3:latest, llama3.2:latest, qwen2.5-coder 7b/14b, cogito:3b/14b, granite4:latest, Nemotron-Bolt-E4B | duplicates or same-family; not smoked. qwen2.5-coder:7b and Nemotron-Bolt (`tools` yes, 64K ctx) are cheap additions for a coding slice. | `/api/tags` |

Smoke honesty notes:
- Smoke is k=1 of one easy task. It proves plumbing (trace, endStatus, tools, ctx), not model quality. Bench cells are Bernoulli: llama3.1 failed the same task once (`wrong-tool-arg`, 7 iterations, trace 01M7B43K3AB3M0GPGVKYS149P8) and passed on the next run.
- deepseek-r1:14b abstained without calling `file-read` and took 104 s: expect a low H3 score and long cells. This is a model behavior result; do not "fix" the cell.
- The H3 result field `status: "pass"` means "ran to completion"; use `endStatus` (from the trace `run-completed.status`) and `solved` for outcome.

## 3. Capability patch (ready to apply; I did not edit packages/)

Owner: `provider-warden` (`packages/llm-provider/src/capability.ts`). Needed for the cleaner, override-free path and for the `model-support-consistency` / `calibration-static-consistency` guards. Facts from `ollama show` (/api/show) 2026-11-13. `recommendedNumCtx` = min(ctx, 32768) (VRAM-safe, as the probe does). `maxOutputTokens: 4096`. `toolCallDialect: "native-fc"` for all (all list `tools`). Mirror the existing `ollama/qwen3:14b` row shape (line 539).

| Key | maxContextTokens | recommendedNumCtx | thinking | vision | tokenizerFamily | Caveat |
|---|---|---|---|---|---|---|
| ollama/llama3.1:latest | 131072 | 32768 | false | false | llama | template scannable (1481 chars, has tool markers) |
| ollama/llama3.2:3b | 131072 | 32768 | false | false | llama | calibration file `llama3.2-3b.json` exists; check consistency test |
| ollama/gemma4:e4b | 131072 | 32768 | true | true (also audio) | unknown | template is a 13-char stub, so tool emission UNMEASURED; calibration `gemma4-e4b.json` exists (GH #243) |
| ollama/gemma4:12b | 262144 | 32768 | true | true (also audio) | unknown | same stub-template caveat |
| ollama/granite4:tiny-h | 1048576 | 32768 | false | false | unknown | hybrid mamba/MoE; template 6842 chars OK |
| ollama/granite3.3:latest | 131072 | 32768 | false | false | unknown | |
| ollama/qwen2.5:14b | 32768 | 32768 | false | false | llama | |
| ollama/deepseek-r1:14b | 131072 | 32768 | true | false | llama | `tools`+`thinking` advertised, but smoke showed no tool call: dialect claim is advertised, not behaviorally proven (run the calibration probe before trusting native-fc) |
| ollama/mimo-v2.6:latest | 262144 | 32768 | true | true | llama | 13-char stub template |
| ollama/ornith:latest | 262144 | 32768 | true | false | llama | 13-char stub template |
| ollama/phi4-mini-reasoning:latest | 131072 | 32768 | false (no thinking cap listed) | false | unknown | advertises `tools`; smoke failed (budget-cap) |

Also add a `H3_TIERS` entry per roster model in `packages/benchmarks/src/h3/run-h3.ts:83` (owner: harness-warden, packages/benchmarks) so `run-h3.ts` runs them natively and the driver can be retired: `{ id: "<tag>", provider: "ollama", model: "<tag>", contextTier: "local" }`. The comment above that table is stale (it says gemma4:e4b/llama3.2:3b are INCONCLUSIVE; true only without the override).

## 4. Phases, cheapest signal first

Conventions for every command below. `D=/home/tylerbuell/campaign-traces`. Run from repo root. Foreground only, `timeout 590`, one live cell at a time (never two bench processes). Re-run the identical command to resume: cells already in `--out` are skipped (cell id = `tier|task|variant|run`). `RA_BENCH_ALLOW_FALLBACK=1` for every non-static model (harmless for static ones, so just always set it). Before each model: `df -h /tmp | tail -1` (expect ~2.3G; abort if over 2.8G).

Per-model time estimates come from smoke timings and the prior H3 baseline (qwen3:4b 33 s/cell, cogito:8b 18 s/cell, 36 cells = 12 tasks x k=3). Smoke ratios vs those two baselines: scale up for qwen3:14b (2.4x slower than qwen3:4b smoke), deepseek-r1 (7x).

### P2: full H3, k=3, 36 cells per model (primary signal, deterministic graders, zero judge)

```
RA_BENCH_ALLOW_FALLBACK=1 timeout 590 bun $D/driver.ts --model <tag> --k 3 \
  --budget-sec 560 --cell-timeout-sec 150 \
  --out $D/p2/<tag with / and : replaced by _>.json --trace-root $D/traces/p2/<same>
```

Repeat the command until the last line prints `{"ran":N,"remaining":0}` (each call advances ~560 s of cells). Run-major order, so a cut leaves balanced coverage. Estimates (36 cells): qwen3:4b 20 min; cogito:8b 11 min (existing baselines exist at `wiki/Research/Harness-Reports/2026-11-13-recent-default-harness-ablation/`; reuse as P2 for these two only if the SHA matters less than time: HEAD there was `d1eb475e9`); qwen3.5 ~25 min; llama3.1 ~15 min; gemma4:e4b ~20 min; gemma4:12b ~30 min; granite4:tiny-h ~12 min; qwen2.5:14b ~30 min; qwen3:14b ~50 min; deepseek-r1:14b ~90 min (cell timeouts at 150 s will dominate). Total about 5.5-6.5 h wall. Order: granite4:tiny-h, llama3.1, qwen3:4b, cogito:8b, qwen3.5, gemma4:e4b, gemma4:12b, qwen2.5:14b, qwen3:14b, deepseek-r1:14b (fast/likely-clean first; r1 last, droppable).
Early stop rule: if a model has 0/6 solved after the first two runs of every task AND the causes are provider-error, stop it and log it as blocked.

### P3: broader tasks

P3a, long-horizon suite (deterministic, 3 tasks, k=2): `RA_BENCH_ALLOW_FALLBACK=1 timeout 590 bun $D/driver.ts --model <tag> --suite long-horizon --k 2 --budget-sec 560 --cell-timeout-sec 400 --out $D/p3a/<tag>.json --trace-root $D/traces/p3a/<tag>`. Cells are long (cell timeout needs raising from 150 s; I could not measure LH cell times in P1, so the estimate is a bound: 6 cells x up to 400 s = 40 min/model worst case, ~15 min typical). Run it for the 6 best P2 models only.

P3b, rw suite with the bench runner (judge-scored tasks need the judge-server; deterministic dimensions do not). Probe verified in P1 (qwen3:4b, rw-2, `ra-full`, 135 s, 29k tokens):
```
RA_BENCH_ALLOW_FALLBACK=1 timeout 590 bun run packages/benchmarks/src/run.ts --session local-models \
  --provider ollama --model <tag> --variant ra-full --task rw-2,rw-3,rw-6,rw-8,rw-9 --runs 2 \
  --output $D/p3b/<tag>.json
```
CAVEAT: `run.ts` ignores `REACTIVE_AGENTS_TRACE_DIR` and writes traces to `<repo>/benchmark-traces/` (gitignored). After EACH invocation move them: `mv benchmark-traces/*.jsonl $D/traces/p3b/<tag>/`. Also `--output` rewrites with a shallow merge per invocation: use one `--output` per model and do not split a model's tasks across invocations (it clobbers `taskReports`). Estimate: 5 tasks x 2 runs x ~130 s = ~22 min/model for 4B-class, 2x for 14B. Check judge-server reachability first (the runner prints a judge warning if the default judge URL is dead); judge model must differ from the SUT model.

### P4: eval/judge graded suite

Same command shape as P3b with `--session real-world-full` (adds judge-scored dimensions) once a judge-server is up and its model is not any roster model (Rule-4 guard in `runner.ts` aborts otherwise). Needs the owner to start the judge-server (not done here). Use `--variant ra-full,bare-llm` only on 3 models to get a lift number; otherwise ra-full only. Estimate 30-45 min/model.

### P5: efficiency attribution (zero-token reads, then one live arm)

1. Every trace: `bun run packages/diagnose/src/cli.ts attribute --all $D/traces/p2` then `cause --all $D/traces/p2` (and p3a, p3b). Output the harness-vs-model reason table per model. About 1 minute total, no tokens.
2. Spend decomposition by purpose on 3 models (small, mid, 14B): `bun run packages/benchmarks/src/harness-cost-attribution.ts ollama <tag> 2`. About 10 min/model.
3. Compare `billedTokens` per solved cell across models from the manifest; flag models where the harness spends >2x tokens of the best model on the same task.

## 5. What every result row must contain

One JSON object per cell appended to `manifest.jsonl` (the H3 results files already carry all but a few fields; the aggregator step is a python/bun one-liner over `$D/p*/*.json`):

`phase, suite, task, model, k, run, endStatus` (trace `run-completed.status`), `solved, accuracy, tokens, billedTokens, durationMs, iterations, causeLabel, traceId, tracePath, gitSha`. Smoke rows (20) already follow this schema.
Phase-level summary per model in the final report: n cells, solved/n, wilson-ish note (n<=36: gaps under ~26pp are noise), median duration, billed tokens per solved cell, cause-label histogram. Never publish a per-task win/loss at k=3.

## 6. Resume and housekeeping

- Everything is resumable by re-issuing the same command (H3 skips recorded cells; `run.ts` has no resume: restart that model's P3b/P4 file).
- Do not commit, do not restart Ollama or Cortex, do not pull models. Ollama keeps a model resident ~5 min after use; switching to the next model evicts it, which is acceptable at 16 GB (largest roster model 9.6 GB).
- Side effect to know: the live probe writes capability rows to `~/.reactive-agents/capabilities/` (324 KB, one JSON per tag+endpoint). Harmless and cross-run stable; it is outside the repo.
- Git tree stays clean: P1 produced no repo changes except these wiki files and the pilot log block.
- The two stale facts found for the owner: the `H3_TIERS` comment (run-h3.ts:83) and that `run.ts --output` shallow-merge clobbers across splits.

## 7. Next dispatches

1. provider-warden: apply section 3 capability rows (optional; the override works without it, but table rows make bench cells non-INCONCLUSIVE by default and avoid reliance on a `RA_BENCH_ALLOW_FALLBACK` flag in an unattended run).
2. harness-warden (next spawn): execute P2 chunks per section 4.
3. Owner: decide on Ollama upgrade for gpt-oss (GGUF load error), judge-server model for P4.
