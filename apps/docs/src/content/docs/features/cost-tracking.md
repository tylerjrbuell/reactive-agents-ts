---
title: Cost Tracking
stability: unstable
description: 'Model routing, budget enforcement, semantic caching, and cost analytics.'
sidebar:
  order: 6
topic: cost
related:
  - guides/cost-optimization
  - features/resilience
  - features/eval
  - guides/production-checklist
---

The cost layer keeps your AI spending under control. It routes tasks to the cheapest model that can handle them, enforces budget limits, caches responses, and provides detailed cost analytics.

## Quick Start

```typescript
import { openRouterPricingProvider } from "@reactive-agents/llm-provider";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking()   // Enable cost controls
  .withDynamicPricing(openRouterPricingProvider) // Optional: fetch live prices at build (bundled prices apply without it)
  .build();
```

## Cost-Aware Model Routing

Opt in with `.withModelRouting()` to route each run to the **cheapest _capable_ model** of your configured provider, picked by task complexity. **Off by default** — a bare agent always uses the model you set with `.withModel()`.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")   // your ceiling
  .withModelRouting()               // opt in — simple tasks drop to a cheaper tier
  .build();

// "What's 2+2?"  → routed down to the haiku-tier model
// "Architect a microservices system with code" → stays on a capable tier
```

The router classifies each task onto a three-step **cost ladder** — cheap → mid → expensive — and maps it to your provider's models (so it is **provider-agnostic**, not Anthropic-only):

| Cost tier | When used | Anthropic | OpenAI |
|-----------|-----------|-----------|--------|
| **cheap** (`haiku`) | Simple tasks — short, no code, no analysis | `claude-haiku` | `gpt-4o-mini` |
| **mid** (`sonnet`)  | Medium — code OR analysis | `claude-sonnet` | `gpt-4o` |
| **expensive** (`opus`) | High — code + multi-step + analysis | `claude-opus` | provider's top tier |

Routing stays **within your provider's tiers** (only the model name varies per request; cross-provider routing is a separate concern). Two guarantees make cheap-first safe:

- **Capability-gated.** The router never drops to a model whose context window can't fit the run's prompt — it escalates the tier until a capable model is found. This matters most for local/Ollama models, where windows vary widely.
- **Advisory, never fails.** Any routing/complexity error degrades gracefully to the model you configured — routing can only make a run cheaper, never break it.

Applies on **both** the inline and reasoning (`.withReasoning()`) paths — the routed model reaches the actual LLM call, not just telemetry.

### Options

<!-- docs-skip-typecheck -->
```typescript
.withModelRouting({
  minTier: "sonnet",                        // never route below this tier
  tierModels: { opus: "claude-opus-4-8" },  // override the model for a tier
})
```

- `minTier` — floor tier; a task will never be routed cheaper than this.
- `tierModels` — override the specific model used for a cost tier (still capability-gated).

`.withModelRouting()` has no declarative `AgentConfig` key; it is builder-only. Use it for mixed workloads where most requests are simple (Q&A, classification, summarization) and a few need frontier reasoning.

To choose the model before you build the agent, `@reactive-agents/cost` exposes the routing primitives: `analyzeComplexity(task)` scores a task and `routeToModel(task)` returns a `ModelCostConfig` for the recommended tier. Its `costPer1MInput` / `costPer1MOutput` come from the PriceBook (below) and are absent when the tier model has no known price. Both are Effect-based and also surface on `CostService.routeToModel(task, context)`. Pass the result to `.withModel(...)`. For an ordered provider cascade on errors (no budget logic), use [`.withFallbacks({ providers })`](/reference/builder-api/).

## Budget Enforcement

Set spending limits at multiple levels:

```typescript
import { createCostLayer } from "@reactive-agents/cost";

const costLayer = createCostLayer({
  perRequest: 1.00,    // Max $1 per individual request
  perSession: 5.00,    // Max $5 per session
  daily: 25.00,        // Max $25 per day
  monthly: 200.00,     // Max $200 per month
});
```

When a budget limit is exceeded, the agent fails with a `BudgetExceededError` rather than silently overspending.

On the builder, the same limits are set with `.withCostTracking()` (declarative key: `costTracking`). The agent performs a pre-flight budget check before each run and a per-iteration check during the loop:

```typescript
import { BudgetExceededError } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking({
    perRequest: 0.10,  // Max $0.10 per single run
    daily: 5.0,        // Max $5.00 per day
    monthly: 100.0,    // Max $100.00 per month
  })
  .build();

try {
  const result = await agent.run("Complex task");
  console.log(result.metadata.cost); // USD, a lower bound when result.metadata.costComplete === false
} catch (e) {
  if (e instanceof BudgetExceededError) {
    console.error("Budget exceeded:", e.message); // escalate, alert, or degrade gracefully
  }
}
```

`.withBudget({ tokenLimit, costLimit })` is enforced against cumulative run spend, not a fresh allowance for each kernel invocation. Multi-step strategies, direct LLM calls between kernels, structured-output retries, and continuation passes all draw from the same run-scoped meter. Compose's `budgetLimit()` kill switch reads that same spend, so builder budgets and composed budgets agree. See [Compose API](/reference/compose-api/).

### Budget Persistence

Budget state is persisted to SQLite via `BudgetDB`, so cost tracking survives agent restarts. When an agent starts, the budget enforcer loads the most recent spend from the database and continues from where it left off — daily and monthly budgets are enforced across restarts without resetting.

## How Calls Are Priced

Every LLM call is priced from the **PriceBook** in `@reactive-agents/llm-provider`. A model's price is resolved in this order:

1. **Your pricing.** Rows from `.withModelPricing()` always win. Rows fetched by `.withDynamicPricing()` come next; they never override yours.
2. **Local models.** Ollama calls cost $0.
3. **A LiteLLM proxy's own rates**, when the proxy states them in `/model/info`.
4. **The bundled price snapshot**: a copy of LiteLLM's `model_prices_and_context_window.json`, filtered to Anthropic, OpenAI, Gemini, Groq, xAI and Mistral and cross-checked against the providers' price pages, with a few corrections from those pages. `priceSnapshotInfo()` returns its date (`asOf`) and source URL. The snapshot is refreshed in the repository and ships with each release.

Rates are dollars per 1M tokens and are set **per model**: input, output, cache read, cache write (5-minute and 1-hour), audio, long-context tiers (a higher rate above a prompt size, for example Gemini 2.5 Pro above 200k prompt tokens) and per-request web search. Each provider adapter reports the full usage of a call (cache reads and writes, Gemini thinking and tool-use prompt tokens, audio tokens, Anthropic web searches), and one function, `priceUsage`, applies the model's rates. There is no fixed per-provider cache discount: the cache rate is whatever that model bills.

Model ids are matched exactly after stripping a provider prefix (`openai/gpt-4o` prices as `gpt-4o`). A dated id can have its own price, so date suffixes are not stripped.

To look up a price yourself (for a model picker, say):

```typescript
import { Option } from "effect";
import { priceFor } from "@reactive-agents/llm-provider";

const price = priceFor("anthropic", "claude-sonnet-4-6");
if (Option.isSome(price)) {
  console.log(price.value.input, price.value.output, price.value.source); // $/1M and where it came from
} else {
  console.log("price unknown");
}
```

### Unknown prices are reported as unknown

A model that is in none of the sources above has **no price**. The framework does not guess one. Its calls carry no `usage.estimatedCost` and `usage.priceSource: "unknown"`, and the `LLMRequestCompleted` event omits `estimatedCost`. Each call says where its cost came from in `priceSource`: `"provider-reported"`, `"price-book"`, `"user"` or `"unknown"`.

When any call in a run (delegated sub-agents included) had an unknown price, `result.metadata.costComplete` is `false` and `result.metadata.cost` is a **lower bound**: the sum of the calls that were priced. A fully priced run has no `costComplete` field. Check it before you show `cost` as a total:

```typescript
const result = await agent.run("Summarize the report");
const { cost, costComplete } = result.metadata;
console.log(costComplete === false ? `at least $${cost} (some calls unpriced)` : `$${cost}`);
```

The same flag appears on `runBudgetSpend`, on `chat()` replies (`ChatReply.costComplete`) and on `AgentCompleted`. On the stream, `TokenUsage.costUsd` is absent for an unpriced call. To add up per-call costs yourself, use `sumCosts` / `addCost` from `@reactive-agents/core`: they return `{ usd, complete }` and never count an unknown price as $0.

### Your own prices

`.withModelPricing()` sets $/1M rates for any model. `input` and `output` are required; `cacheRead`, `cacheWrite5m` and `cacheWrite1h` are optional, and an omitted cache rate bills those tokens at your `input` rate.

```typescript
builder.withModelPricing({
  "my-fine-tuned-model": { input: 0.5, output: 1.5, cacheRead: 0.05 },
});
```

Calls priced this way report `priceSource: "user"`.

### Dynamic pricing

`.withDynamicPricing(provider)` fetches price rows when the agent is built:

```typescript
import { openRouterPricingProvider, urlPricingProvider } from "@reactive-agents/llm-provider";

// Live prices from OpenRouter's model list (keeps OpenRouter's cache rates)
builder.withDynamicPricing(openRouterPricingProvider);

// Or a JSON price list you host
builder.withDynamicPricing(urlPricingProvider("https://internal.corp/pricing.json"));
```

- Fetched rows are labelled `source: "remote"` by `priceFor`, with `origin` naming the price list; calls priced from them report `priceSource: "price-book"`. A custom `PricingProvider` should set `origin` on its rows, or pass them through `markRemotePricing(rows, origin)`.
- Your `.withModelPricing()` rows win over fetched rows.
- **A failed fetch does not fail `build()`.** The build continues with your `.withModelPricing()` rows plus the bundled snapshot and logs a warning (`LoadBearingFailure:dynamic-pricing`). With `.withStrictValidation()`, the fetch failure fails the build instead.

### LiteLLM proxy

With the `litellm` provider, the cost the proxy reports in its `x-litellm-response-cost` header is used as the call's cost (`priceSource: "provider-reported"`). Otherwise the call is priced from the proxy's `/model/info` rates or the snapshot, with cached tokens billed at the cache rate.

## Semantic Caching

Cache responses to avoid paying for identical queries:

<!-- docs-skip-typecheck -->
```typescript
// Automatically checked during execution
// If a semantically similar query was recently answered, the cached response is used

// Cache entries have configurable TTL
await costService.cacheResponse(query, response, model, 3600_000); // 1 hour TTL
```

### `makeSemanticCache()`

The cost layer uses `makeSemanticCache()` internally to provide cosine similarity-based prompt deduplication:

<!-- docs-skip-typecheck -->
```typescript
import { makeSemanticCache } from "@reactive-agents/cost";

// Without embedFn — falls back to exact hash matching only
const cache = makeSemanticCache();

// With embedFn — enables semantic similarity matching (>0.92 threshold)
const cache = makeSemanticCache(myEmbedFn);
```

| Behavior | Without `embedFn` | With `embedFn` |
|----------|-------------------|----------------|
| Exact match | Yes (hash) | Yes (hash, fast path) |
| Semantic match | No | Yes (cosine similarity > 0.92) |

When an `embedFn` is provided, queries that are semantically equivalent (e.g., "What is the capital of France?" and "Which city is France's capital?") hit the cache without requiring an exact string match.

## Cost Analytics

Get detailed reports on spending:

```typescript
import { CostService } from "@reactive-agents/cost";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const cost = yield* CostService;

  // Current budget status
  const status = yield* cost.getBudgetStatus("my-agent");
  console.log(`Daily spend: $${status.currentDaily} (${status.percentUsedDaily}%)`);
  console.log(`Monthly spend: $${status.currentMonthly} (${status.percentUsedMonthly}%)`);

  // Detailed report
  const report = yield* cost.getReport("daily", "my-agent");
  console.log(`Total cost: $${report.totalCost}`);
  console.log(`Cache hit rate: ${(report.cacheHitRate * 100).toFixed(1)}%`);
  console.log(`Savings from cache: $${report.savings}`);
  console.log(`Avg cost/request: $${report.avgCostPerRequest}`);
  console.log(`Cost by tier:`, report.costByTier);
});
```

### Report Fields

| Field | Description |
|-------|-------------|
| `totalCost` | Total spend for the period |
| `totalRequests` | Number of LLM calls |
| `cacheHits` / `cacheMisses` | Semantic cache performance |
| `cacheHitRate` | Hit rate (0-1) |
| `savings` | Estimated savings from caching |
| `costByTier` | Breakdown by model tier (haiku/sonnet/opus) |
| `costByAgent` | Breakdown by agent ID |
| `avgCostPerRequest` | Average cost per LLM call |
| `avgLatencyMs` | Average response latency |

## Integration with Execution Engine

Cost tracking integrates with three phases of the execution lifecycle:

1. **Phase 3 (Cost Route)** — Selects optimal model tier based on task complexity
2. **Phase 8 (Cost Track)** — Records actual cost after LLM calls complete
3. **Phase 9 (Audit)** — Includes cost data in the audit log

## Prompt Compression

Reduce token usage by compressing prompts before sending to the LLM:

<!-- docs-skip-typecheck -->
```typescript
const { compressed, savedTokens } = yield* cost.compressPrompt(longPrompt, 2000);
console.log(`Saved ${savedTokens} tokens`);
```

### `makePromptCompressor()`

`makePromptCompressor()` uses a two-pass approach to reduce token count:

<!-- docs-skip-typecheck -->
```typescript
import { makePromptCompressor } from "@reactive-agents/cost";

// Heuristic-only compression (always runs — no LLM required)
const compressor = makePromptCompressor();

// Heuristic + optional LLM second pass
const compressor = makePromptCompressor(myLlmService);
```

**Two-pass strategy:**

1. **Heuristic pass** (always runs): Removes redundant whitespace, collapses repeated content, strips boilerplate. Fast and free.
2. **LLM second pass** (optional): If the heuristic result still exceeds `maxTokens`, an LLM call intelligently summarizes or abbreviates the prompt further.

Without an `llm` parameter, only the heuristic pass runs. The LLM second pass is recommended for very long prompts (>4,000 tokens) where heuristic compression alone may not be sufficient.

## Token Tracking

The execution engine accumulates token usage across every LLM call the run makes up to its result, including planner, synthesis and classifier calls and every delegated sub-agent (crashed ones too). The final `AgentResult` reports `tokensUsed`, `cost`, `inputTokens`, `outputTokens` and `llmCalls` from that one run meter:

```typescript
const result = await agent.run("Complex multi-step task");
console.log(`Tokens used: ${result.metadata.tokensUsed}`);
console.log(`LLM calls: ${result.metadata.llmCalls}`);
console.log(`Cost up to the result: $${result.metadata.cost}`);
```

**Debrief synthesis runs after the result.** With `.withMemory()` or `.withDebrief()`, a non-trivial run forks one more LLM call after the answer to write its rich [debrief](/features/debrief-chat/). That call runs after the result is built, so it is not in `cost`, `tokensUsed` or `llmCalls`. Neither is the extraction call `.withOutputSchema()` makes when the answer is not already schema-shaped JSON. `result.metadata.cost` is the spend up to the result.

For the **billed total of the run**, debrief and extraction included, await `result.totalCost()`. It resolves to `{ usd, complete }`: at once when no debrief runs, otherwise when the debrief call settles. It never rejects. `complete` is `false` when any call, the debrief included, had no known price or the debrief call failed; `usd` is then a lower bound.

```typescript
const result = await agent.run("Complex multi-step task");
console.log(`Cost up to the answer: $${result.metadata.cost}`);

const total = await result.totalCost?.();
if (total) console.log(`Billed total: $${total.usd}${total.complete ? "" : " (lower bound)"}`);
```

The same value is on the `RunCostFinalized` event (`taskId`, `agentId`, optional `runId`, `totalCostUsd`, `costComplete`), published exactly once per run: after the debrief call on debrief runs, right after `AgentCompleted` otherwise, and after `AgentAborted` when a run fails or is aborted. Read a run's total from this event, not from `AgentCompleted.totalCostUsd`, which is the pre-debrief spend.

The debrief's own spend is on the rich debrief (`metrics.synthesisTokens`: `{ input, output, total, cost, calls }`, plus `costComplete: false` when the debrief model is unpriced) and on the `DebriefCompleted` event:

```typescript
const rich = await result.debriefRich?.();
const debriefSpend = rich?.metrics.synthesisTokens;
const billedTokens = result.metadata.tokensUsed + (debriefSpend?.total ?? 0);
```

`.withCostTracking()` budget entries record the run meter's input/output token split (0/0 when the provider reported only totals).

## What's Next

- [Cost Optimization](/guides/cost-optimization/) — a practical guide to keeping spend down beyond this feature reference
- [Evaluation Framework](/features/eval/) — measure whether a cheaper model still meets quality bar
- [Resilience & Caching](/features/resilience/) — budget persistence and other production-reliability mechanisms
