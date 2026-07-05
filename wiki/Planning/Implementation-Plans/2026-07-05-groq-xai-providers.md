# Groq + xAI Providers

**Date:** 2026-07-05
**Status:** In progress
**Goal:** Add `groq` and `xai` as first-class LLM providers. Both are OpenAI-compatible HTTP APIs, so reuse the OpenAI adapter parameterized by `baseURL` + key source instead of duplicating ~32KB of streaming/thinking/capability logic. Port parity with the Python `reactive-agents` which shipped Groq.

## Provider facts

| | Groq | xAI |
|---|---|---|
| Base URL | `https://api.groq.com/openai/v1` | `https://api.x.ai/v1` |
| Env key | `GROQ_API_KEY` | `XAI_API_KEY` |
| Model prefix | varied (llama-, qwen/, openai/gpt-oss, moonshotai/, deepseek-) | `grok-` |
| Native FC | yes (OpenAI tools schema) | yes |
| Embeddings | **no endpoint** | **no endpoint** |
| Thinking | some (gpt-oss, ds-r1, qwen3) | grok reasoning models |

## Design decisions

1. **Reuse OpenAI adapter.** Refactor `providers/openai.ts` into a factory `makeOpenAICompatProvider({ providerName, resolveApiKey, baseURL })`. Export `OpenAIProviderLive` (unchanged behavior, baseURL undefined), `GroqProviderLive`, `XAIProviderLive`. The 4× hardcoded `resolveCapability("openai", model)` become `resolveCapability(providerName, model)` so Groq/xAI models resolve their own capability rows.
2. **Capability fallback must not strip tools.** `fallbackCapability` returns `toolCallDialect:"none"` (correct for unknown local models). Groq/xAI model lists drift fast; an unlisted model hitting the conservative fallback would silently lose tool-calling. Add a provider-aware branch: `groq`/`xai` fall back to `native-fc` + 128k ctx + `large` tier. Seed headline models in `STATIC_CAPABILITIES` for accurate windows.
3. **Embeddings unsupported.** `embed()` on the Groq/xAI variants throws a descriptive `ProviderError` (no embeddings endpoint). Embedding routing config stays `openai`|`ollama` only.
4. **Single key-read path preserved.** Wire `groq`/`xai` into `PROVIDER_API_KEY_MAP` (build-validation.ts) — the single build-time key read that fixed the 2026-07-01 split-brain. Do NOT read keys anywhere else.

## Edit sites

| File | Change |
|---|---|
| `llm-provider/src/types.ts` | `LLMProviderType` literal += `"groq"`, `"xai"` |
| `llm-provider/src/llm-config.ts` | `groqApiKey`/`xaiApiKey` fields + env wiring; optional `GROQ_BASE_URL`/`XAI_BASE_URL` override |
| `llm-provider/src/providers/openai.ts` | factory refactor; export 3 layers; `resolveCapability(providerName,…)`; embed throws for groq/xai |
| `llm-provider/src/capability.ts` | STATIC entries (Groq: llama-3.3-70b-versatile, llama-3.1-8b-instant, openai/gpt-oss-120b, moonshotai/kimi-k2-instruct, qwen/qwen3-32b, deepseek-r1-distill-llama-70b; xAI: grok-4, grok-3, grok-3-mini); provider-aware `fallbackCapability` branch |
| `llm-provider/src/runtime.ts` | widen union (both fns) + dispatch cases |
| `llm-provider/src/pricing.ts` | groq/xai static rates (nice-to-have) |
| `runtime/src/build-validation.ts` | `ProviderName` union, `PROVIDER_API_KEY_MAP`, `PROVIDER_MODEL_PREFIXES` (xai:["grok"], groq: omit=skip), model-check skip list += groq |
| `runtime/src/runtime-types.ts` | widen `provider?` union + doc |
| `create-reactive-agent/src/{types,lib/provider-config}.ts` | `Provider` union += groq/xai; scaffolder env/model/import/display maps |
| `benchmarks/src/types.ts:311` | widen union |
| `judge-server/src/live-layer.ts` | `JudgeProvider` union + `PROVIDERS` array |

## Tests (TDD)

- `providers/openai-compat.test.ts` — `mock.module("openai")` asserts `baseURL` passed for groq/xai, absent for openai; correct key selected per provider.
- capability: groq/xai headline models resolve `native-fc`; unlisted groq model falls back to `native-fc` not `none`.
- runtime dispatch: `createLLMProviderLayer("groq")` / `("xai")` build without error.
- build-validation: missing `GROQ_API_KEY` warns; `xai`+non-grok model warns; groq skips prefix check.

## Verify

`bunx turbo run build --filter=@reactive-agents/llm-provider --filter=@reactive-agents/runtime` + targeted `bun test`. Real-API smoke deferred (needs keys) — note in debrief.

## Verification results (2026-07-05)

- **Build:** turbo 25/25 success (ESM + DTS). tsc `--noEmit` clean on llm-provider, runtime, judge-server, benchmarks, create-reactive-agent.
- **Tests:** new `groq-xai-provider.test.ts` 13 pass; full llm-provider suite **344 pass / 0 fail**; runtime suite green except 2 **pre-existing** real-Anthropic-API flakes in `model-routing-reasoning-path.test.ts` (confirmed failing 2/2 on clean `main` via `git stash` — not caused by this change).
- **E2E:** public-API smoke (`getProviderDefaultModel`, `resolveCapability`, layer exports) + facade builder (`ReactiveAgents.create().withProvider("groq"|"xai").build()`) both construct end-to-end through the runtime.
- **Doc compliance (live-fetched Groq + xAI docs):** base URLs, key env vars, and OpenAI-compat confirmed. Groq's documented **unsupported** params (`logprobs`, `top_logprobs`, `logit_bias`, `messages[].name`, N>1) are all avoided; `logprobs` now gated by `supportsLogprobs:false` for groq/xai. Core seeded Groq models (llama-3.3-70b-versatile, llama-3.1-8b-instant, gpt-oss-120b/20b) match the current **production** list; kimi/qwen3/deepseek are preview (usable, fallback-covered).
- **Warden review (provider-warden):** verdict **MERGE-READY** on all primary paths. Two opt-in-only risks: (1) `reasoning_effort` param on the thinking path — **fixed** by setting `supportsThinkingMode:false` on qwen3-32b/deepseek-r1-distill (Groq uses `reasoning_format`) and grok-4 (auto-reasons); gpt-oss + grok-3-mini keep thinking. (2) `completeStructured` json_schema strict is model-dependent on Groq — **documented limitation** (opt-in `.withOutputSchema` only, has parse-retry; not gated to avoid regressing the shared OpenAI path).

## Live E2E (2026-07-05, GROQ_API_KEY added by user)

- **Plain completion** (`.withProvider("groq").withModel("llama-3.3-70b-versatile")`, no tools) → `success: true`. Basic wire + auth confirmed live.
- **Native function-calling** with a single clean-schema custom `multiply` tool → `success: true`, tool handler fired, model `llama-3.3-70b-versatile`. Full stack (builder → runtime dispatch → GroqProviderLive → OpenAI-compat tools → execution) verified on the real API.

**Live finding — Groq hard-400s on malformed tool generation.** Running with `.withTools()` (the full default builtin set = many complex schemas) + the mid-tier llama-3.3-70b produced `400 "Failed to call a function. Please adjust your prompt."` — Groq validates function calls server-side and rejects the ENTIRE request when the model emits an invalid call (its `tool_use_failed` behavior), rather than degrading like OpenAI/Anthropic. Mitigations: fewer/simpler tools, a stronger model (gpt-oss-120b), or narrowing via `allowedTools`. Not a wiring defect — single clean tool works. Possible follow-up: catch Groq's `tool_use_failed` 400 in the adapter and route it through the existing healing/malformed-tool-call path instead of failing the run.

## xAI live E2E (2026-07-05, XAI_API_KEY + credits added)

Fully verified on the real API: plain completion → `success: true`; single clean-schema `multiply` tool → `success: true`, handler fired, model `grok-4`. (Earlier 403 was a billing gate — team had no credits; resolved by adding credits, no code change.)

**Both Groq and xAI are now fully live-verified (completion + native tool call).**

## Live model-catalog audit (2026-07-05) — 2 dead IDs fixed

Ran every seeded Groq model at the provider layer (`LLMService.complete`, plain + tool). Results:

| Seeded model | plain | tool | verdict |
|---|---|---|---|
| llama-3.3-70b-versatile | ✅ | ✅ | keep |
| llama-3.1-8b-instant | ✅ | ✅ | keep |
| openai/gpt-oss-120b | ✅* | ✅ | keep (*reasoning model — needs adequate maxTokens; 32-tok budget → `finish_reason=length`) |
| openai/gpt-oss-20b | ✅* | ✅ | keep |
| qwen/qwen3-32b | ✅ (emits `<think>`) | ✅ | keep |
| meta-llama/llama-4-scout-17b-16e-instruct | ✅ | ✅ (3/3 on retry) | **added** (was missing; current preview, vision) |
| ~~moonshotai/kimi-k2-instruct~~ | ❌ 404 does not exist | — | **REMOVED** (not in Groq catalog) |
| ~~deepseek-r1-distill-llama-70b~~ | ❌ 400 decommissioned | — | **REMOVED** (decommissioned) |

Fix: `capability.ts` — dropped the two dead rows, added `meta-llama/llama-4-scout-17b-16e-instruct`. Verified against live `console.groq.com/docs/models`.

**Groq hard-400 on malformed tool generation reconfirmed** — llama-4-scout tool call 400'd once (`tool call validation failed`), then 3/3 clean on retry: intermittent model behavior, Groq rejects the whole request per bad generation. Root cause of the earlier user `.withTools()` 400s.

## Original user failures — diagnosed (not code bugs)

- **413 "Request too large … TPM Limit 12000, Requested 13265"** and the `scratch.ts` llama-3.1-8b-instant failure: Groq **free-tier 12k tokens/minute** rate limit, blown by a large prompt (the `scratch.ts` case loads the github-MCP server = **46 tool schemas** + builtins → >12k-token request). Not an integration defect. Mitigate: `allowedTools` to trim the tool set, fewer MCP tools, or upgrade Groq tier.
- **Diagnosability gap — FIXED.** The raw provider 413/400 was swallowed to `"Reasoning failed"` at `result.error`. Root cause: the kernel set the full message in `state.error` (`explainProviderError`-enriched), but `normalizeReasoningResult` (runtime/src/engine/util.ts) is a whitelist rebuild that dropped `error`, so `execution-engine.ts:1128` fell back to the generic label. Fix (7 sites): added `error` to `ReasoningResultSchema`, `ExecutionReasoningResult`, the `reasoningResult` ctx type, and `buildStrategyResult`'s param; `normalizeReasoningResult` now preserves it; reactive/adaptive pass `state.error`; execution-engine prefers `rr.error`. **Verified live:** `result.error` now reads `"LLM stream failed at iteration 0: groq call failed (…): 404 The model … does not exist"` for both reactive + adaptive. Regression: reasoning 1890/0, runtime unchanged (same 2 pre-existing anthropic flakes). Remaining strategies (plan-execute/blueprint/tot/reflexion/code-action/direct) can pass `error` at their `buildStrategyResult` calls too — minor follow-up; the param now exists.

## Known limitations
- **Structured output on Groq** is model-dependent (`json_schema` strict works on gpt-oss and some models; others accept only `json_object`). The parse-retry loop mitigates; a per-capability `supportsJsonSchema` gate is a possible follow-up.
- **Groq tool-call 400** on malformed generation with weak models + large tool sets (see Live finding above).
