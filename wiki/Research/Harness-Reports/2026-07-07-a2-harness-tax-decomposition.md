# Harness per-turn token/latency tax decomposition — 2026-07-07

**Scope:** `packages/benchmarks/benchmark-traces/*.jsonl` (2026-07-07 mtimes, ~55 recent files + the three cross-run buckets `llm-direct.jsonl` / `structured-output.jsonl` / `classify-tool-relevance.jsonl`) + source read of the assembly (`packages/reasoning/src/kernel/capabilities/reason/think.ts`), structured-output pipeline (`packages/reasoning/src/structured-output/*`), planning strategies (`packages/reasoning/src/strategies/*`), and Ollama provider adapter (`packages/llm-provider/src/providers/local.ts`).

**Relationship to prior 2026-07-07 reports:** [[2026-07-07-a1-manual-react-autopsy]] already measured systemPrompt section composition (Environment/Meta-Tools/Available-Tools/Goal, mean 929 chars, `think.ts:401-421,608-611`) and the manual-react-vs-ra-full accuracy/turn comparison — not re-derived here. [[2026-07-07-bench-bottleneck-determination]] already filed B1 (terminal-acceptance gap), B2 (thinking-token starvation thrash in `think.ts`'s main loop), B3 (fabrication under forced grounding), B4 (trace stopReason fidelity bug in the **stream** accumulator), B5 (bench zombie fibers). **This report's three findings are new mechanisms, or the same root cause in code paths B2 does not cover** — none are covered by A1 or B1–B5, and none touch the falsified-levers list (cache-churn, extractObservationFacts-44%, local-step-economy, cogito-17-step-stall, rationale-breaks-weak, escalation-lift).

Method note: all evidence for Finding 2 comes from the `LLMService.complete()` path (`extractStructuredOutput`'s fallback loop), not `.stream()` — B4's stream-accumulator stopReason bug does not apply here; `response.stopReason` on these events is provider-truthful.

---

## Finding 1 (new, highest measured impact) — 9 LLM call sites never thread `traceContext`; real LLM time is misattributed away from the run's own trace

**What's wrong:** `CompletionRequest.traceContext` (`packages/llm-provider/src/types.ts:835`) is how the observable-LLM wrapper keys an `LLMExchangeEmitted` event to the run that issued it (`packages/reasoning/src/kernel/observable-llm.ts`). When it's omitted, the exchange is filed under the global `"llm-direct"` placeholder taskId (`packages/reasoning/src/kernel/observable-llm.ts:49`) instead of the run's own trace file. 5 call sites in the codebase already do this correctly (conditional `...(input.taskId ? { traceContext: { taskId: input.taskId } } : {})` — `plan-execute.ts:227`, `plan-execute.ts:279`, `plan-execute.ts:851`, `blueprint.ts:220`, `plan-mutation.ts:101,174`, `think.ts:663`). **9 sibling call sites in the same files never do:**

| Call site | What it does | maxTokens |
|---|---|---|
| `packages/reasoning/src/strategies/code-action.ts:121` | code-action plan-phase generation | uncapped (provider default) |
| `packages/reasoning/src/strategies/code-action.ts:246` | code-action retry-phase generation | uncapped |
| `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:854` | `extractObservationFacts` — tool-result compression | `THINKING_SAFE_MIN_TOKENS` (2048) |
| `packages/reasoning/src/strategies/blueprint.ts:518` | blueprint final-answer synthesis | 4096 |
| `packages/reasoning/src/strategies/plan-execute.ts:446` | single-analysis-step direct generation | 4096 |
| `packages/reasoning/src/strategies/plan-execute.ts:1063` | plan-execute final-answer synthesis | 4096 |
| `packages/reasoning/src/kernel/loop/finalize.ts:150` | **every** run's end-of-loop re-synthesis (fires when `decideSynthesisInput().needsSynthesis` is true) | `THINKING_SAFE_MIN_TOKENS` (2048) |
| `packages/reasoning/src/structured-output/infer-required-tools.ts:170` | required-tools inference pass | `THINKING_SAFE_MIN_TOKENS` |
| `packages/reasoning/src/structured-output/infer-required-tools.ts:299` | tool-relevance classification pass | `THINKING_SAFE_MIN_TOKENS` |

**Measured impact:** across the 51 non-placeholder recent trace files (excluding `llm-direct.jsonl`/`structured-output.jsonl`/`classify-tool-relevance.jsonl`), **36 of 51 (70.6%) report `totalTokens > 0` in `run-completed` but log ZERO `llm-exchange` events** — every LLM call that run made leaked to the placeholder bucket. Of the 15 runs with at least one captured exchange, the median silent gap between the last logged event and `run-completed` is **36.5s** (mean 54.9s, n=30 measured directly from event timestamps; worst case 344,161ms in `01KWYA2ETPG96FZ8250342HKNQ.jsonl`, a 377,663ms run). In a fully-covered control run (`01KWXKV1TR0R1ZXWDC222J4424.jsonl`, cogito:8b — `run-completed.totalTokens` exactly equals the sum of its logged exchanges' `tokensIn+tokensOut`, 18,178 both sides), the equivalent gap is **1,738ms** — two orders of magnitude smaller. The gap size scales with how much of the run's actual LLM work landed in an untraced call, not with genuine harness compute (see Finding 4).

`finalize.ts:150` alone explains why this shows up in *every* run, not just code-action/blueprint/plan-execute ones: it is the universal end-of-loop re-synthesis step and it never threads `traceContext` at all (zero occurrences of the string in the file).

**Why this matters beyond bookkeeping:** this is the exact instrument this task (and any future harness-tax analysis) depends on. A trace file with `nllm=0` and a 5-minute `durationMs` looks like "silent harness overhead" until you check `run-completed.totalTokens` — it is real, costed LLM traffic, just filed under the wrong bucket. Any latency/cost attribution done against `benchmark-traces/*.jsonl` per-run files today undercounts LLM time and overcounts "unexplained gap" for roughly 70% of runs.

**Remedy:** thread `traceContext: input.taskId ? { taskId: input.taskId } : undefined` (or the local equivalent — `plan.taskId`, `config.traceContext`, etc.) into all 9 sites, mirroring the pattern already correct in the same files. This is a pure-observability change — zero behavioral risk, no lift-rule ablation needed, and it's a few-line diff per site (the field is explicitly documented as a no-op for every provider adapter, `types.ts:829-834`).

---

## Finding 2 (new — extends filed B2 to 8 unpatched sibling call sites) — flat, non-thinking-aware `maxTokens` in the structured-output/planning pipeline burns full budget on invisible `<think>` tokens, then retries identically

B2 (filed) already diagnosed thinking-token starvation thrash in the **main react loop** (`think.ts:617`, `tierMaxTokens`) and shipped `thinkingAllowance = profile.thinkingModel ? 6000 : 0` (`think.ts:626`) plus a Stage-1 escalation-to-64k recovery path (`think.ts:847`) for when the capped attempt comes back empty. **That fix was never propagated to the structured-output/planning pipeline**, which is a separate code path with 8 call sites, all using a flat literal (`plan-execute.ts:226,278,446,1063`, `blueprint.ts:219,518`, `plan-mutation.ts:100,173` — all `maxTokens: 4096`) or the project-wide "safe" floor (`THINKING_SAFE_MIN_TOKENS = 2048`, `packages/reasoning/src/kernel/utils/stream-parser.ts:80`, used at 13+ sites including `tool-execution.ts:866`, `finalize.ts:150`, `infer-required-tools.ts:170,299`). Neither budget is thinking-aware, and — worse than the main loop — **the retry loop in `extractStructuredOutput` (`packages/reasoning/src/structured-output/pipeline.ts:181-206`) reuses the exact same `maxTokens` on every retry** (no escalation, no `stopReason` check, no backoff). There is also no way to ask for `think:false` on a specific call today: `CompletionRequest` (`packages/llm-provider/src/types.ts:781-839`) has no per-request thinking field — thinking is only controlled globally via `LLMConfig.thinking`/`.withThinking()`.

Root cause confirmed at the provider layer: `packages/llm-provider/src/providers/local.ts:412-436` only sends Ollama's `think` parameter when `configThinking === true`; otherwise it is omitted entirely (`...(think !== undefined ? { think } : {})`). Omitting `think` is **not** the same as `think:false` for Ollama's own default on thinking-capable models (qwen3 family) — the model still reasons inline, and `response.message.content` (`local.ts:551`) is populated only from the post-thinking text, while `response.message.thinking` is captured separately (`local.ts:469-472`) but **never merged into `content` or read by any structured-output consumer**. When the model's chain-of-thought alone exceeds the budget, `content` comes back `""` with `stopReason:"max_tokens"` (`done_reason==='length'` → `local.ts:544`) — the entire allotment spent on invisible reasoning, zero usable output.

**Measured impact (2026-07-07 corpus, all buckets):** 54 `llm-exchange` events show `stopReason:"max_tokens"` **and** `content.length === 0` — 100% wasted calls:

| Model | n dead calls | tokensOut wasted | wall-clock wasted |
|---|---|---|---|
| qwen3:14b | 37 | 83,968 | 2,032,097 ms (33.9 min) |
| qwen3:4b | 16 | 28,160 | 178,157 ms (3.0 min) |
| gemma4:12b | 1 | 1,024 | 17,283 ms |
| **total** | **54** | **113,152** | **2,227,537 ms (37.1 min)** |

`THINKING_SAFE_MIN_TOKENS=2048` is measurably insufficient for this model family on non-trivial prompts: 16 of the 54 dead calls hit exactly 2048 output tokens with empty content — the constant's name overpromises relative to observed behavior.

Single worst-case example, `01KWXMV5ATPGG8BMKMGSDBKR2Q.jsonl` (qwen3:14b, plan-execute's `plan-execute.ts:218` plan-generation call, task: research+synthesize embedded vector DBs): 3 attempts (`attempt=0,1,2`, `maxRetries:2`), each `maxTokens:4096`, each returns `stopReason:"max_tokens"`, `tokensOut:4096`, `content:""` — 115,078ms / 113,631ms / 115,378ms = **344,087ms (91.2% of the run's 377,070ms total wall-clock)** spent on three deterministically-identical failures before the run gives up with `status:"failure"`. Nothing about attempt 2 or 3 could have succeeded where attempt 1 failed — same prompt, same budget, same model behavior.

**Remedy, ranked by cost/risk:**
1. **Zero-risk immediate win:** in `pipeline.ts`'s retry loop, after a `stopReason==="max_tokens" && content-after-strip===""` response, stop retrying with the identical budget — either fail fast (saves 2 of 3 wasted calls, ~67% of this waste bucket for free) or bump `maxTokens` on the next attempt only.
2. **Matches the shipped B2 pattern:** propagate `thinkingAllowance`-style budgeting (or reuse `resolveProfile(modelId).thinkingModel`, already computed at `plan-execute.ts:207`/`blueprint.ts:~200` for prompt-tier selection but never applied to `maxTokens`) to all 8 sites.
3. **Root fix (larger, cross-package):** add a per-request `thinking?: boolean` field to `CompletionRequest` so JSON-extraction call sites — which structurally never want chain-of-thought — can request `think:false` outright, eliminating the tax rather than budgeting around it. Requires `llm-provider` API surface change + plumbing through `local.ts`'s `resolveThinking`.

---

## Finding 3 (new — cost of escalation, distinct from the falsified quality claim) — strategy-switch escalation discards completed tool work and re-executes it from scratch, ~doubling the run's cost

Not to be confused with the already-**falsified** "escalation-lift" finding (that measured whether strategy-switching improves *pass rate* — it doesn't, reliably). This finding is about what escalation *costs* when it fires, which is a different axis entirely.

`applyStrategySwitch` (`packages/reasoning/src/kernel/loop/runner-helpers/strategy-switch.ts:103-140`) builds a 9-line textual "handoff summary" (tools called, steps completed, key observations) and folds it into `priorContext` for the new strategy — but it does not preserve or let the new strategy reuse the actual tool-call *results* (file contents read, API responses fetched, etc.), only a text description that they happened. The new strategy's own plan can, and in the observed case does, re-issue the identical tool calls.

**Measured in `01KWXZ8F30839FQAAV2B3ET4EA.jsonl`** (qwen3:14b, rw-9/resilience task — same file A1 used for its systemPrompt sample):
- **Pass 1** (`reactive` strategy, iter 0–4, 5 exchanges): `file-read` → `file-write` → 3 no-op thinking turns with **identical** `tokensIn=2922` each — a genuine stall, correctly caught by the loop detector (`strategy-switched` event: *"Loop detected: the model repeated the same thought 3 times without making progress"*). Wall-clock: 41,875+21,555+18,259+15,202+9,299 = **106,190ms**.
- **`strategy-switched`**: `reactive` → `plan-execute-reflect`.
- **Pass 2** (`plan-execute-reflect`, iter 0–4, 5 exchanges): re-issues `file-read` (tokensIn=1996, matching pass 1's first call exactly) then `file-write` (tokensIn=2289, matching pass 1's second call exactly) — the same file gets read and written again — followed by 3 more turns to reach `final-answer`. Wall-clock: 33,875+23,774+23,948+17,807+18,218 = **117,622ms**.
- Combined: **223,812ms of the run's 269,415ms total (83%)** is two nearly-parallel executions of the same task; only the second one produces the accepted answer.

n=1 in this trace — worth confirming the redo-from-scratch pattern (vs. context reuse) holds across more `strategy-switched` cells before treating the ~2x multiplier as a general constant, but the mechanism (`applyStrategySwitch` carries text, not tool-result state) is verified directly from source and is guaranteed to reproduce whenever the new strategy's plan re-touches the same resources.

**Remedy:** thread completed tool-call results (not just a summary line) into the new strategy's `priorContext`/scratchpad so a plan step that would re-fetch already-fetched data can short-circuit against it — analogous to what `recall()`'s overflow-gate already does for oversized tool results within a single strategy (`think.ts:520-544`), just extended across the switch boundary.

---

## Finding 4 (negative / confirming) — harness-side per-event bookkeeping is not a meaningful tax; ruling out entropy scoring and inter-exchange checkpointing

Task brief explicitly asked whether the harness itself is slow between exchanges (entropy scoring, checkpoint serialization, phase overhead). Measured directly from event timestamps in a **fully-covered** control run (`01KWXKV1TR0R1ZXWDC222J4424.jsonl`, no Finding-1 leakage — `run-completed.totalTokens` exactly matches the summed exchanges): every `kernel-state-snapshot`, `entropy-scored`, `harness-signal-injected`, and `guard-fired` event lands 0–5ms after the preceding event. The only non-trivial non-LLM gaps in that run are a genuine tool call (`find`, 1,760ms — real work, not overhead) and the pre-first-call setup + tail (216ms + 1,738ms). Total non-LLM-non-tool overhead for the whole 17,212ms run: **≈2.0s (11.6%)**, none of it attributable to entropy scoring or checkpoint code. No durable-execution/checkpoint trace events (`checkpoint-*`) appear anywhere in this corpus — the bench session under analysis doesn't exercise that code path, so no verdict on durable-checkpoint cost specifically; see [[2026-07-07-a1-manual-react-autopsy]] for the (larger, real) per-call decode-time story that actually drives ra-full's wall-clock on thinking models.

**Local-tier-gets-frontier-prompts check:** not observed as a live issue on this corpus. A1's numbers (mean 929 systemPrompt chars, gated Meta-Tools block, `toolSchemaDetail` compaction) show the assembly already tier-conditions prompt verbosity; this report's own sample systemPrompts (145–1,504 chars) confirm the same range. The tax in this corpus is concentrated in token *budget* mismanagement (Finding 2) and *trace attribution* (Finding 1), not raw prompt bloat reaching local models.

---

## Ranked summary

| # | Inefficiency | Measured cost | Code site | Remedy |
|---|---|---|---|---|
| 1 | 9 call sites never thread `traceContext` → LLM time misattributed to `llm-direct` placeholder | 70.6% of runs (36/51) show 0 logged exchanges despite nonzero tokens; median 36.5s / mean 54.9s unattributed gap per run, up to 344.2s | `code-action.ts:121,246`; `tool-execution.ts:854`; `blueprint.ts:518`; `plan-execute.ts:446,1063`; `finalize.ts:150`; `infer-required-tools.ts:170,299` | Thread `traceContext` — mirror the 5 sites that already do it correctly in the same files. Zero behavioral risk. |
| 2 | Flat non-thinking-aware `maxTokens` (4096 / `THINKING_SAFE_MIN_TOKENS`=2048) in structured-output/planning, retried at identical budget | 54 dead exchanges, 113,152 output tokens, 2,227,537ms (37.1 min) wasted corpus-wide; worst single run: 344,087ms (91.2% of wall-clock) across 3 identical failed retries | `pipeline.ts:181-206` (retry loop); 8 call sites in `plan-execute.ts`, `blueprint.ts`, `plan-mutation.ts` | Fail-fast after first empty-`max_tokens` attempt (zero-risk); propagate `thinkingAllowance` pattern from `think.ts:626`; longer-term: per-request `think:false` in `CompletionRequest`. |
| 3 | Strategy-switch escalation re-executes completed tool work from scratch instead of reusing it | Observed: escalation pass costs 117,622ms on top of the 106,190ms first pass (223,812ms / 269,415ms = 83% of one run); n=1, mechanism source-verified | `runner-helpers/strategy-switch.ts:103-140` (handoff carries text summary, not tool-result state) | Thread completed tool-call results into the new strategy's `priorContext`, not just a text summary. |
| 4 (negative) | Per-event harness bookkeeping (entropy, snapshots, guards) | ≈2.0s / 17.2s (11.6%) in a clean control run, 0–5ms per event — not a real tax | n/a | No action needed; don't resurface as a suspect. |

## Files read

- `packages/benchmarks/benchmark-traces/{01KWXZ8F30839FQAAV2B3ET4EA,01KWXKV1TR0R1ZXWDC222J4424,01KWXMV5ATPGG8BMKMGSDBKR2Q,01KWXN7837EXFP8J7JZY6SD0AT,01KWXTV1DNF32ZXD4CSSNW02KZ,01KWXXD0HFWSF3ZE2PPX5E50JD,01KWY0M7WAEG03W7H85SD9QZFR}.jsonl`, `llm-direct.jsonl` (aggregate scan of all 1,391 exchanges), plus a full-corpus scan of all `*.jsonl` mtimed 2026-07-06+
- `packages/llm-provider/src/types.ts:781-975` (`CompletionRequest`/`CompletionResponse`)
- `packages/llm-provider/src/providers/local.ts:220-575` (thinking resolution, Ollama chat payload, response mapping)
- `packages/reasoning/src/kernel/observable-llm.ts`, `packages/reasoning/src/kernel/capabilities/reason/think.ts:500-670`
- `packages/reasoning/src/structured-output/pipeline.ts` (full), `packages/reasoning/src/structured-output/infer-required-tools.ts`
- `packages/reasoning/src/strategies/{plan-execute,blueprint,code-action}.ts`, `packages/reasoning/src/strategies/planning/plan-mutation.ts`
- `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:840-870`, `packages/reasoning/src/kernel/loop/finalize.ts:110-160`
- `packages/reasoning/src/kernel/loop/runner-helpers/strategy-switch.ts` (full)
- `packages/reasoning/src/kernel/utils/stream-parser.ts:80` (`THINKING_SAFE_MIN_TOKENS`)
- `packages/trace/src/normalize.ts:195-215` (`LLMExchangeEmitted` → `llm-exchange` mapping)
- Cross-referenced: `wiki/Research/Harness-Reports/2026-07-07-a1-manual-react-autopsy.md`, `wiki/Research/Harness-Reports/2026-07-07-bench-bottleneck-determination.md`
