---
type: audit
status: active
created: 2026-11-19
tags: [cost, providers, cortex]
---

# Token cost accuracy audit (2026-11-19)

Read-only audit. Question: does the cost Reactive Agents computes per run equal what the provider bills, per provider and per model, and does it reach Cortex correctly?

External prices were read on 2026-11-19 from the official pages (Anthropic `platform.claude.com/docs/en/about-claude/pricing`, OpenAI `developers.openai.com/api/docs/pricing`, Google `aistudio.google.com/docs/pricing`, xAI `docs.x.ai/docs/models`, Groq `console.groq.com/docs/models`). Live LiteLLM `model_prices_and_context_window.json` (main) and OpenRouter `/api/v1/models` were downloaded on the same day and agree with the official pages on every row cross-checked. Anything not confirmed this way is marked **unverified**.

Code probes: `calculateCost` was run against current model ids with bun (1M in / 1M out). `fetchAndMergePricing` was run with a failing provider. No full test suite or build was run.

## Summary verdict

| Provider | Verdict | Why |
|---|---|---|
| Anthropic | **Exact** for `claude-sonnet-4-6`, `claude-sonnet-4-5*`, `claude-haiku-4-5*`, `claude-opus-4-8` (5m cache). **Wrong** for every other current model. | Opus 4.5/4.6/4.7 and Opus 5.5 fall to the `opus` heuristic ($15/$75): 3.0x to 3.75x over. Sonnet 5/5.5 are 1.5x over. Fable 5.x is 0.38x (under). The 0.1x cache-read rate is wrong for Opus/Sonnet 5.5 (0.05x) and Fable 5.1/5.2 (0.025x). The Haiku 5.5 >100k tier is not modeled. |
| OpenAI | **Approximate to wrong.** | `gpt-4o`, `gpt-4o-mini`, `gpt-5.4`, `gpt-5.5` list prices are right. The cached-input rate is hard-coded at 0.5x, but OpenAI bills 0.1x on the gpt-5.x/6.x line and 0.25x on gpt-4.1/o3. So it overcounts whenever the cache hits. `o3` is 5x over. All of `gpt-6*`, `gpt-5`, `gpt-5-mini`, `gpt-4.1*` are heuristic-priced (0.13x to 30x). `gpt-4.1` gets $15/$75. The >272k tier is not modeled. |
| Gemini | **Wrong.** | `gemini-2.5-flash` is under-priced (0.5x input, 0.24x output). Every unlisted Gemini id hits the `mini` heuristic, because "ge**mini**" contains "mini". So Gemini 3.x/4 are priced at $0.15/$0.60, as low as 0.04x. The cache rate is 0.25x but Google bills 0.1x. The >200k tier is not modeled. Thinking tokens are counted correctly. |
| Groq | **Wrong.** | The default model `openai/gpt-oss-120b` is not in the table and hits the $3/$15 default. Groq bills $0.15/$0.60, so this is 20x / 25x over. |
| xAI | **Wrong.** | The default model `grok-4` is not in the table and not on xAI's current price list. It hits the $3/$15 default. `grok-4.7` is billed $2/$6 (1.5x / 2.5x over). The ≥200k tier and xAI's cache rate are not modeled. Reasoning-token semantics are unverified. |
| Ollama (local) | **Exact ($0).** | `estimatedCost: 0` is hard-coded (`local.ts:532`, `:897`, `ollama-structured-attempt.ts:41`). |
| LiteLLM | **Wrong by default.** | Prefixed ids (`openai/gpt-4o`, `anthropic/...`, `gemini/...`) never match the exact-key table. `openai/gpt-4o` hits the `gpt-4` heuristic, so 6x / 7.5x over. Cached tokens are not passed to `calculateCost` (billed at full rate). The proxy-cost path reads non-standard `usage.input_cost/output_cost` fields (unverified that any proxy sends them) and is ignored on stream. |

Propagation to Cortex is **faithful**: Cortex keeps no price table and sums the framework's `estimatedCost`. So every error above reaches the user unchanged. Cortex's "cost known" honesty flag can never fire, because the event always carries a number (see F5).

## Findings, ranked by severity

### F1 (critical): the fallback heuristic invents prices for most current models, and every Gemini model falls into "cheap"
- Evidence: `packages/llm-provider/src/token-counter.ts:161-190`. An exact-match miss goes to keyword tiers: `mini|flash|haiku|small|8b|7b|lite` gives $0.15/$0.60; `opus|large|405b|gpt-4*` gives $15/$75; anything else gives $3/$15. `m.includes("mini")` is true for every `gemini-*` id (`:170`). `gpt-4.1` matches the `gpt-4` premium clause (`:184`).
- Measured (probe, RA vs LiteLLM/official, input/output ratio): `gemini-4-neon` 0.05/0.04; `gemini-3.1-pro-preview` 0.07/0.05; `gemini/gemini-2.5-pro` 0.12/0.06; `gpt-6-luna` 30/30; `openai/gpt-oss-120b` 20/25; `gpt-4.1` 7.5/9.4; `claude-opus-4-5/4-6/4-7` 3.0/3.0; `claude-opus-5-5` 3.75/3.75; `claude-fable-5-2` 0.38/0.38; `gpt-5.4-mini` 0.20/0.13.
- Impact: run cost is wrong by up to 30x either way. The value is published as if measured (F5). The provider defaults are affected too: `groq: openai/gpt-oss-120b` and `xai: grok-4` (`provider-defaults.ts:13-14`).
- Owner: `packages/llm-provider` → **provider-warden**.

### F2 (critical): cache multipliers are fixed per provider, but providers bill per model
- Evidence: `token-counter.ts:258-270`. Anthropic read 0.1x and write 1.25x. OpenAI cached 0.5x. Gemini cached 0.25x.
- Official rates: Anthropic cache hits are 0.1x for 4.x / Opus 4.8 / Opus 5 / Sonnet 4.6, 0.05x for Opus 5.5 / Sonnet 5.5, 0.025x for Fable/Mythos 5.1–5.2, and Sonnet 5 is $0.20 = 0.1x. OpenAI cached is 0.1x for gpt-5.x/gpt-6.x (e.g. gpt-5.4 $0.25 on $2.50), 0.25x for gpt-4.1/o3, and 0.5x only for gpt-4o/4o-mini. Gemini cached is 0.1x on every listed model (2.5-pro $0.125 on $1.25, 3-flash $0.05 on $0.50).
- Impact: OpenAI gpt-5.4 with 50k of 60k prompt tokens cached is +60.6% (worked example below). Gemini cached tokens are 2.5x over on the cached portion. Anthropic Opus 5.5 cache reads are 2x over even with a correct base price.
- Owner: provider-warden.

### F3 (high): stale or wrong rows in the static table, plus a second drifting table in `packages/cost`
- Evidence, `token-counter.ts` vs LiteLLM/official:
  - `o3` 10/40 (`:133`) vs 2/8 (5x over).
  - `gemini-2.5-flash` 0.15/0.6 (`:140`) vs 0.30/2.50.
  - `gemini-embedding-001` 0/0 (`:147`) vs 0.15 input.
  - `mistral-large-latest` 2/6 vs 0.7/2.1.
  - `mistral-small-latest` 0.2/0.6 vs 0.15/0.6.
  - 13 rows are for models LiteLLM no longer lists (Claude 3.x, o1-mini, o1-preview, Gemini 1.5, preview ids). These are harmless but dead.
  - Missing ids (they fall to F1): `claude-opus-4-5/4-6/4-7`, every Claude 5.x, every `gpt-6*`, `gpt-5`, `gpt-5-mini`, `gpt-5.4-mini`, `gpt-4.1*`, every Gemini 3.x/4, every Groq and xAI id.
- Second table: `packages/cost/src/routing/complexity-router.ts:8-170` (`PROVIDER_CONFIGS`, `costPer1MInput/Output`). It prices `claude-opus-4-7` at $15/$75 (`:36-38`, `:164-166`), but the real price is $5/$25. It uses `gemini-2.0-flash`. It is consumed by `estimateCost` (`:186-187`) for routing and estimates, not for billing. It has already drifted from table 1, which has `claude-opus-4-8` at $5/$25.
- Owner: provider-warden (table 1); runtime-warden (`packages/cost`, table 2).

### F4 (high): long-context price tiers are not modeled anywhere
- Evidence: `getPricing` returns one `{input, output}` pair (`token-counter.ts:86-191`). `ModelPricing` has only two fields (`pricing.ts:6-9`).
- Official tiers: Gemini 2.5-pro / 3.1-pro >200k prompt gives 2x input and 1.5x output, and doubles the cache rate. OpenAI gpt-5.4/5.5/6.x >272k has separate rates. xAI ≥200k gives 2x on all token classes. Anthropic Haiku 5.5 >100k gives 5x input/output, counting cache reads and writes in the prompt length. Anthropic 4.6+ (except Haiku 5.5) has no long-context surcharge.
- Impact: a 250k-token Gemini 2.5-pro call is under-priced by 43% (worked example). Agent runs with large memory or document context hit this.
- Owner: provider-warden.

### F5 (high): an unknown or guessed cost is published as a measured number, so Cortex's honesty flag is dead
- Evidence:
  - `calculateCost` always returns a number. A heuristic price is indistinguishable from a real one.
  - `packages/reasoning/src/kernel/utils/diagnostics.ts:748` sets `estimatedCost: args.response.costUsd ?? 0`.
  - `packages/core/src/types/events/core-events.ts:224` declares `estimatedCost: number` as required.
  - Cortex `apps/cortex/server/services/model-cost.ts:96-98` sets `costKnown = false` only when the field is non-numeric, so it can never fire.
  - `run-store.ts:253` and `runs-table.ts:227` sum it as-is.
- Impact: users see a confident dollar figure for a model RA has never priced. This conflicts with the framework's honest-claims law in Spec 08.
- Owner: kernel-warden (`diagnostics.ts`), core-warden (event type), provider-warden (a `priceSource` from `calculateCost`), cortex-warden (display).

### F6 (high): LiteLLM pricing path is wrong three ways
- Evidence (`packages/llm-provider/src/providers/litellm.ts`):
  - (a) Model ids are provider-prefixed (`openai/gpt-4o`), and the table lookup is exact-key (`token-counter.ts:97,161`). So the heuristic runs, and `openai/gpt-4o` gets $15/$75.
  - (b) Cached tokens are not passed: `calculateCost(..., undefined, registry, ...)` at `:208-213` and `:522-527`, even though `prompt_tokens_details.cached_tokens` is parsed (`:222`, `:528`).
  - (c) Proxy-reported cost is read from `usage.input_cost/output_cost` (`:132-134`, `:214-219`). These fields are not in LiteLLM's documented response (**unverified**). LiteLLM documents the `x-litellm-response-cost` response header, which is not read. The stream path never uses proxy cost.
- The LiteLLM discoverer already calls `/model/info` (`litellm-discovery.ts:82`), which (per LiteLLM docs, **unverified against a live proxy**) carries `model_info.input_cost_per_token`, `output_cost_per_token` and `cache_read_input_token_cost`. That data is discarded for pricing.
- Impact: worked example, 9.4x over.
- Owner: provider-warden.

### F7 (medium): `withDynamicPricing` is broken
- Evidence: `packages/runtime/src/builder/build-effect/pricing-fetch.ts:37-50` wraps `yield*` in `try/catch`. In `Effect.gen` that does not catch Effect failures. Probe: a failing provider with `strict:false` returned `Exit.Failure("boom")`. So the documented non-strict fallback is dead code, and a pricing-endpoint outage fails `build()`. The code also violates the no-try/catch golden rule.
- Also:
  - The remote registry overrides the user's explicit `withModelPricing` (`:40`, spread order).
  - `openRouterPricingProvider` (`pricing.ts:28-67`) keys by OpenRouter ids (`anthropic/claude-sonnet-4.6`, dot) plus the short name `claude-sonnet-4.6`. Neither matches Anthropic API ids (`claude-sonnet-4-6`, dash), so Claude prices never apply.
  - OpenRouter returns `input_cache_read`, `input_cache_write`, `input_cache_write_1h`, `internal_reasoning`, `web_search` and `overrides[min_prompt_tokens]` (verified on the live feed). All of them are dropped.
- Owner: runtime-warden (`pricing-fetch.ts`), provider-warden (`pricing.ts`).

### F8 (medium): the Anthropic structured-output path ignores the user and dynamic registry
- Evidence: `packages/llm-provider/src/providers/anthropic.ts:614` calls `mapAnthropicResponse(raw, structuredModel)` with no `config.pricingRegistry`. The OpenAI (`openai.ts:702`), Gemini (`gemini.ts:796`) and LiteLLM (`litellm.ts:675`) structured paths pass it.
- Impact: `.withModelPricing()` is silently not applied to Anthropic structured calls.
- Owner: provider-warden.

### F9 (medium): Cortex and the framework can report different run totals
- Evidence: the framework run total is the run meter. It is settled before the forked debrief synthesis, and spend after settle is ignored (`packages/runtime/src/engine/run-budget-arm.ts:77-104`). It is emitted as `totalCostUsd` (`engine/finalize/run-finalize.ts:195`). Cortex's run view instead sums every `LLMRequestCompleted.estimatedCost` (`apps/cortex/ui/src/lib/stores/run-store.ts:253`, `runs-table.ts:227`). That sum includes post-settle calls such as debrief synthesis, which still emit through the observable wrapper.
- Impact: the two totals diverge whenever a post-settle LLM call runs. The size was not measured. Whether sub-agent child events double-count in Cortex was not verified.
- Owner: runtime-warden / cortex-warden.

### F10 (low): usage fields that are dropped or simplified
- Anthropic (`anthropic.ts:68-77`, `:463-491`, `:824-848`): input, output, cache read and cache creation are all read. `totalInputTokens` re-adds the cache pools, and `calculateCost` subtracts them back out, which is correct.
  - Cache creation is always priced at the 5m rate (1.25x). That is correct today: requests send `cache_control: {type:"ephemeral"}` with no `ttl` (`:207`, `:324`). A future `ttl:"1h"` (2x) would be under-priced, because `usage.cache_creation.ephemeral_1h_input_tokens` is not read.
  - `server_tool_use.web_search_requests` ($10 / 1,000 searches) is not read. RA does not send Anthropic server tools today, so the effective impact is $0.
  - The `inference_geo` 1.1x multiplier and the Batch 0.5x discount are not modeled. RA uses neither.
- OpenAI / Groq / xAI (`openai.ts:488`, `:504-607`, `:932-966`):
  - `stream_options.include_usage` is set.
  - `cached_tokens` and `reasoning_tokens` are read. Reasoning is correctly treated as a subset of `completion_tokens` for OpenAI.
  - Audio tokens are not read.
  - For xAI, whether `completion_tokens` includes `reasoning_tokens` is **unverified**: the xAI docs read did not state it. If xAI reports reasoning separately, RA under-prices xAI reasoning output.
  - Groq streaming usage via `include_usage` is **unverified**.
- Gemini (`gemini.ts:166-205`, `:601-622`, `:700-720`):
  - `thoughtsTokenCount` is added to output, which is correct: Google bills thinking as output.
  - `cachedContentTokenCount` is treated as a subset of the prompt, which is correct.
  - `toolUsePromptTokenCount` is dropped. Built-in Google tools are not used, so the impact is about $0 today.
  - Explicit-cache storage ($/1M tokens/hour) is not modeled.
  - A stderr debug line exists at `:537` (gated, not cost-relevant).
- Ollama: `prompt_eval_count` and `eval_count` are read, and cost is 0. Correct.
- Embeddings: `embed()` returns no usage, so embedding spend (e.g. `gemini-embedding-001` $0.15/M, OpenAI embeddings) is never counted in any run total.
- Retries: `applyRetryToLlmService` sits under the observable wrapper (`packages/runtime/src/runtime.ts:440-466`). Only the successful attempt's usage is metered. Failed attempts are usually not billed, so the impact is about $0. A timeout after the provider finished generating would be billed but unrecorded (rare, unquantified).
- Owner: provider-warden.

### F11 (low): `packages/cost` cost-tracking records the wrong fields
- Evidence: `packages/runtime/src/engine/phases/cost-track.ts:46-57`.
  - `outputTokens: ctx.tokensUsed` records the run's total tokens as output.
  - `inputTokens` reads `ctx.metadata.inputTokens`. `settleRunSpend` writes the split under `settledRunSplit` instead (`run-budget-arm.ts:100-104`), so `inputTokens` is usually 0.
  - `cost: ctx.cost` is the settled meter value and is correct.
- `CostService.getReport` analytics token splits are therefore wrong. Dollar totals are fine.
- Owner: runtime-warden.

## Where prices live today (all tables)

1. `packages/llm-provider/src/token-counter.ts:100-159`: the billing table, 47 rows, exact-key, plus heuristics `:163-190`. This is the only table that drives `estimatedCost`.
2. `packages/cost/src/routing/complexity-router.ts:8-170`: router tiers, 15 rows, `costPer1M*`. Used for routing and estimates only.
3. User and dynamic registry: `.withModelPricing()` / `.withDynamicPricing()` lead to `state._pricingRegistry` (`builder/withers/_state.ts:227-231`), then `config.pricingRegistry` (`llm-config.ts:354`). Lookup is exact key (`token-counter.ts:97`).
4. Injected per-call pricing (LiteLLM only, `litellm.ts:214-219`).
5. Cortex: **no price table**. The header of `apps/cortex/server/services/model-cost.ts:4-5` states this. Model lists (`apps/cortex/server/api/models.ts`, `ui/src/lib/framework-models.ts:14`) carry `name`, `label` and `supportsThinking` only. There is no price.
6. `packages/compose/src/killswitches/budget-limit.ts:38` falls back to `tokens * costPerToken` (a user parameter) when the meter has no cost.

Resolution order (`getPricing`, `token-counter.ts:86-191`): injected per-call → user registry exact key → static exact key → keyword heuristic → `$3/$15` default. Nothing ever returns "unknown". Local adapters bypass `calculateCost` with a literal 0.

## Dynamic price sources evaluated

| Source | Returns prices? | Notes |
|---|---|---|
| Anthropic `GET /v1/models` | No price field (per `anthropic-discovery.ts` parsing; RA reads limits only). Official API reference not re-read this session, so **unverified beyond the parser**. | Not usable for price. |
| OpenAI `GET /v1/models` | No price field (`id/created/owned_by`; **unverified this session**). | Not usable. |
| Gemini `models.list` | Token limits, no price (**unverified this session**). | Not usable. |
| LiteLLM `model_prices_and_context_window.json` (GitHub raw, ~5 MB) | **Yes** (verified live). Per-token input/output, `cache_read_input_token_cost`, `cache_creation_input_token_cost`, `..._above_1hr`, `input_cost_per_token_above_200k_tokens`, `search_context_cost_per_query`. Keys match native API ids (Anthropic dash ids, bare OpenAI ids, `gemini/`, `groq/`, `xai/` prefixes). | Every row cross-checked this session matched the official pages. It is the broadest single source, community-maintained, MIT. It needs a provider-prefix-aware key map and a bundled snapshot for offline use. |
| OpenRouter `/api/v1/models` | **Yes** (verified live). Per-token `prompt/completion/input_cache_read/input_cache_write/input_cache_write_1h/internal_reasoning/web_search`, `overrides[min_prompt_tokens]` tiers. | Keyed by OpenRouter ids (Anthropic versions dotted). These are OpenRouter's resale prices: identical to direct for the rows checked, but not guaranteed. |
| LiteLLM proxy `/model/info` | Yes, per LiteLLM docs (`input_cost_per_token` etc.); **unverified against a live proxy**. | Authoritative for a LiteLLM deployment, because it reflects the operator's custom prices. RA already calls it. |
| LiteLLM `x-litellm-response-cost` header | Per-call cost, per LiteLLM docs (**unverified**). | The best number for LiteLLM: it is the proxy's own bill. |

Recommended source per provider:
- Anthropic / OpenAI / Gemini / Groq / xAI: a bundled snapshot of LiteLLM's JSON (normalized and versioned in-repo), with optional `refresh()` from the live URL. Official pricing pages have no machine API.
- LiteLLM proxy: the `x-litellm-response-cost` header first, then `/model/info`, then the snapshot.
- Ollama: always 0.
- OpenRouter: only when the user routes through OpenRouter.

## Worked examples

Prices are $/1M tokens. "Billed" applies the provider's published rule as read on 2026-11-19.

**Anthropic, `claude-sonnet-4-6` (exact case).** Usage: input_tokens 2,000; cache_read 50,000; cache_creation 5,000 (5m); output 1,000.
- RA computes total input 57,000 and subtracts the cache pools, leaving base 2,000. Cost: 2,000×3 + 1,000×15 + 5,000×3×1.25 + 50,000×3×0.1 = $0.006 + $0.015 + $0.01875 + $0.015 = **$0.05475**.
- Billed: 2,000×$3 + 5,000×$3.75 + 50,000×$0.30 + 1,000×$15 = **$0.05475**. Exact.

**Anthropic, `claude-opus-5-5`, same usage.**
- RA (heuristic 15/75, read 0.1x): 2,000×15 + 1,000×75 + 5,000×18.75 + 50,000×1.5 = $0.03 + $0.075 + $0.09375 + $0.075 = **$0.27375**.
- Billed: 2,000×$4 + 1,000×$20 + 5,000×$5 + 50,000×$0.20 = $0.008 + $0.02 + $0.025 + $0.01 = **$0.063**.
- RA is **4.35x over**.

**OpenAI, `gpt-5.4`.** Usage: prompt 60,000 (cached 50,000); completion 3,000 (reasoning 2,000, a subset).
- RA: 10,000×2.5 + 50,000×2.5×0.5 + 3,000×15 = $0.025 + $0.0625 + $0.045 = **$0.1325**.
- Billed: 10,000×$2.50 + 50,000×$0.25 + 3,000×$15 = $0.025 + $0.0125 + $0.045 = **$0.0825**.
- RA is **+60.6%**.
- Same usage on `gpt-6-sol`: RA (heuristic 3/15) **$0.15** vs billed 10,000×2 + 50,000×0.20 + 3,000×10 = **$0.06**, so **2.5x over**.

**Gemini, `gemini-2.5-pro`, long prompt.** Usage: prompt 250,000 (cached 100,000); candidates 2,000; thoughts 3,000.
- RA: base 150,000×1.25 + cached 100,000×1.25×0.25 + output 5,000×10 = $0.1875 + $0.03125 + $0.05 = **$0.26875**.
- Billed (>200k tier): 150,000×$2.50 + 100,000×$0.25 + 5,000×$15 = $0.375 + $0.025 + $0.075 = **$0.475**, plus storage if an explicit cache was used.
- RA is **−43%**.

**Gemini, `gemini-2.5-flash`.** Usage: prompt 20,000; candidates 1,000; thoughts 4,000.
- RA: 20,000×0.15 + 5,000×0.6 = **$0.006**.
- Billed: 20,000×$0.30 + 5,000×$2.50 = **$0.0185**.
- RA is **−67.6%**.

**Groq, `openai/gpt-oss-120b` (provider default).** Usage: prompt 10,000; completion 1,000.
- RA (default 3/15): **$0.045**.
- Billed: 10,000×$0.15 + 1,000×$0.60 = **$0.0021**.
- RA is **21.4x over**.

**xAI, `grok-4.7`.** Usage: prompt 30,000 (cached 20,000); completion 1,000.
- RA: 10,000×3 + 20,000×1.5 + 1,000×15 = **$0.075**.
- Billed (<200k): 10,000×$2 + 20,000×$0.50 + 1,000×$6 = **$0.036**.
- RA is **2.08x over**. If xAI reports reasoning outside `completion_tokens` (**unverified**), billed is higher and the gap narrows.

**LiteLLM, `openai/gpt-4o`.** Usage: prompt 10,000 (cached 8,000); completion 500.
- RA (heuristic 15/75, cache ignored): 10,000×15 + 500×75 = **$0.1875**.
- Billed (OpenAI gpt-4o): 2,000×$2.50 + 8,000×$1.25 + 500×$10 = **$0.02**.
- RA is **9.4x over**.

**Ollama, any local model.** RA $0, billed $0. Exact.

## Recommended design

1. **One price source of truth in `@reactive-agents/llm-provider`: a `PriceBook` service.**
   - Schema per model: `input`, `output`, `cacheRead`, `cacheWrite5m`, `cacheWrite1h`, `tiers: [{minPromptTokens, input, output, cacheRead}]`, `perRequest: {webSearch}`, `source`, `asOf`. Store dollar values directly, never as multipliers, so per-model cache rates are data, not code.
   - Seeded from a committed, generated snapshot of LiteLLM's JSON, normalized to RA's provider ids (`provider` + bare model id, with an alias map for prefixed and dotted ids). A script regenerates it (`scripts/update-prices.ts`), and a CI drift check flags stale rows.
   - Delete the hand-typed `costMap` and the keyword heuristic.
   - Make `packages/cost/complexity-router.ts` read prices from `PriceBook` instead of `PROVIDER_CONFIGS` prices.
2. **Dynamic refresh.**
   - `PriceBook.refresh()` takes an Effect-typed source: LiteLLM JSON URL, OpenRouter (with id normalization), LiteLLM proxy `/model/info`, or a custom URL.
   - Use a TTL cache, and fail open to the snapshot with a typed warning event. Never fail `build()` (fixes F7).
   - User `withModelPricing` always wins over remote.
3. **Price the full usage object.**
   - Adapters return a normalized `BillableUsage`: `inputUncached`, `cacheRead`, `cacheWrite5m`, `cacheWrite1h`, `output` (includes reasoning or thinking), `promptTokensForTier`, `webSearchRequests`.
   - One pure `priceUsage(BillableUsage, PriceEntry) => {usd, priceSource}` function, shared by all adapters.
   - LiteLLM uses the `x-litellm-response-cost` header when present (`priceSource: "provider-reported"`).
4. **Honest unknowns.**
   - Unpriced model: `estimatedCost` absent and `priceSource: "unknown"`, never a guess.
   - Additive `LLMRequestCompleted.priceSource?: "provider-reported" | "price-book" | "user" | "unknown"`. Make `estimatedCost` optional or keep it with the flag; this is a core-warden decision.
   - Cortex's existing `costKnown` then works as designed.
5. **Cortex per-model price display.**
   - Add `price?: {input, output, cacheRead, tiers, source, asOf}` to the `GET /api/models/:provider` model rows, read from `PriceBook`.
   - Render $/1M in/out in the model dropdown (Chat quick controls, Lab Inference section) and on the model page next to `ModelSpend`, with a sort-by-cost option.
   - Show "price unknown" where it is missing.
   - Use the run meter `totalCostUsd` for run totals (one number, F9).

## Fix plan: warden missions

1. **provider-warden (llm-provider).**
   - Add `PriceBook` with a generated LiteLLM snapshot, plus `scripts/update-prices.ts`. The script lives under `scripts/`, so ask tooling-warden for the script and gate.
   - Add a `BillableUsage` normalizer per adapter: Anthropic 1h-TTL read, `server_tool_use`; Gemini `toolUsePromptTokenCount` and tier prompt size; OpenAI audio.
   - Add a pure `priceUsage` that replaces `calculateCost` multipliers and the heuristic.
   - LiteLLM: alias-aware lookup, pass cached tokens, read the `x-litellm-response-cost` header, reuse `/model/info` costs.
   - Fix the Anthropic structured registry (F8).
   - Make `openRouterPricingProvider` id-normalizing and complete.
   - Change provider defaults: Groq and xAI default model sanity (`grok-4` absent from xAI's price list).
   - Tests: the worked examples above as golden pins.
2. **core-warden.** Add `priceSource` to `LLMRequestCompleted`, additive (`core-events.ts:151-225`). Decide whether `estimatedCost` becomes optional, which is the honest-unknown path.
3. **kernel-warden.** `diagnostics.ts:748`: stop coercing missing cost to 0, and forward `priceSource`. Run-meter `cost` should carry "known/unknown" (`kernel/run-budget.ts`).
4. **runtime-warden (runtime + cost).**
   - Fix `pricing-fetch.ts` (Effect-native fallback; user registry wins).
   - `withDynamicPricing` accepts PriceBook sources.
   - `complexity-router.ts` reads PriceBook.
   - `cost-track.ts` records the real split (F11).
   - Decide whether post-settle calls count in `totalCostUsd` (F9).
   - Changeset: cost numbers change for users.
5. **cortex-warden.**
   - Price fields on `/api/models/:provider` and in the dropdowns.
   - Model-page price card.
   - Run totals from `totalCostUsd`.
   - `costKnown` driven by `priceSource`.
   - "Price unknown" UI.
6. **docs-warden (follow-up).** Document pricing sources, refresh, and the honesty rule.

Sequencing: 1 and 2 first (2 is additive and small), then 3 and 4, then 5. Each mission ships its own pinning tests. No harness default changes are involved, so ablation-warden is not needed.

## Unverified items

- Whether xAI includes reasoning tokens in `completion_tokens`, and xAI cached-token field names.
- Groq streaming usage with `include_usage`.
- The LiteLLM proxy `usage.input_cost/output_cost` fields (likely nonexistent), the `x-litellm-response-cost` header, and `/model/info` cost fields, against a live proxy.
- That Anthropic, OpenAI and Gemini model-list endpoints carry no price: inferred from RA's discovery parsers and general API shape, not re-read this session.
- `gemini-3.5-flash` ($1.50/$9): present in LiteLLM and RA's table, but not found on the official Google page as read. That page was truncated at 100k chars.
- The size of the F9 divergence, and whether sub-agent child events double-count in Cortex.
