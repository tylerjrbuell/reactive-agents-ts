---
title: Cost Tracking
description: Model routing, budget enforcement, semantic caching, and cost analytics.
sidebar:
  order: 3
---

The cost layer keeps your AI spending under control. It routes tasks to the cheapest model that can handle them, enforces budget limits, caches responses, and provides detailed cost analytics.

## Quick Start

```typescript
import { openRouterPricingProvider } from "@reactive-agents/llm-provider";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking()   // Enable cost controls
  .withDynamicPricing(openRouterPricingProvider) // Automatically fetch latest model prices
  .build();
```

## Complexity-Based Model Routing

The cost layer analyzes each task and routes it to the optimal model tier:

| Tier | When Used | Examples |
|------|-----------|---------|
| **Haiku** | Simple tasks < 50 words, no code, no analysis | "What's 2+2?", "Hello!", greetings |
| **Sonnet** | Medium complexity — code OR analysis keywords | "Explain recursion", "Review this function" |
| **Opus** | High complexity — code + multi-step + analysis | "Architect a microservices system with code examples" |

The router uses 27 complexity signals: word count, code blocks, multi-step instructions, analysis keywords, math/logic expressions, constraint satisfaction, creative writing patterns, domain-specific indicators, and more.

```typescript
// The execution engine calls routeToModel() during Phase 3 (Cost Route)
// You don't need to call this manually — it happens automatically
```

## Budget Enforcement

Set spending limits at multiple levels:

```typescript
import { createCostLayer } from "@reactive-agents/cost";

const costLayer = createCostLayer({
  budgetLimits: {
    perRequest: 1.00,    // Max $1 per individual request
    perSession: 5.00,    // Max $5 per session
    daily: 25.00,        // Max $25 per day
    monthly: 200.00,     // Max $200 per month
  },
});
```

When a budget limit is exceeded, the agent fails with a `BudgetExceededError` rather than silently overspending.

### Budget Persistence

Budget state is persisted to SQLite via `BudgetDB`, so cost tracking survives agent restarts. When an agent starts, the budget enforcer loads the most recent spend from the database and continues from where it left off — daily and monthly budgets are enforced across restarts without resetting.

## Dynamic Pricing

By default, the framework maintains an internal static map of provider token costs. To ensure absolute accuracy when using platforms with hundreds of models (like OpenRouter or LiteLLM) or when pricing changes, you can configure the agent to dynamically fetch pricing during initialization:

```typescript
import { openRouterPricingProvider, urlPricingProvider } from "@reactive-agents/llm-provider";

// 1. Fetch live prices from OpenRouter's API
builder.withDynamicPricing(openRouterPricingProvider)

// 2. Fetch prices from an internal JSON file hosted anywhere
builder.withDynamicPricing(urlPricingProvider("https://internal.corp/pricing.json"))

// 3. Override specific model costs manually
builder.withModelPricing({
  "my-fine-tuned-model": { input: 0.5, output: 1.5 }
})
```

If the dynamic fetch fails, the builder warns but gracefully falls back to the static map. When cost calculations run (e.g. for `metadata.cost`), the framework automatically correctly calculates cached-token discounts applied by OpenAI (50%), Anthropic, and Gemini (25%).

## Semantic Caching

Cache responses to avoid paying for identical queries:

```typescript
// Automatically checked during execution
// If a semantically similar query was recently answered, the cached response is used

// Cache entries have configurable TTL
await costService.cacheResponse(query, response, model, 3600_000); // 1 hour TTL
```

### `makeSemanticCache()`

The cost layer uses `makeSemanticCache()` internally to provide cosine similarity-based prompt deduplication:

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

```typescript
const { compressed, savedTokens } = yield* cost.compressPrompt(longPrompt, 2000);
console.log(`Saved ${savedTokens} tokens`);
```

### `makePromptCompressor()`

`makePromptCompressor()` uses a two-pass approach to reduce token count:

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

The execution engine automatically accumulates token usage across all LLM calls within a task. The final `AgentResult` includes accurate `tokensUsed` and `cost` metadata:

```typescript
const result = await agent.run("Complex multi-step task");
console.log(`Tokens used: ${result.metadata.tokensUsed}`);
console.log(`Cost: $${result.metadata.cost}`);
```
