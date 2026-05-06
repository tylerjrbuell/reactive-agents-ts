# @reactive-agents/cost

Cost management for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.2**

Routes tasks to the cheapest capable model using a 27-signal complexity router, caches semantically-similar requests, enforces budgets at four levels (per-request / per-session / daily / monthly), and tracks token + USD spend in real time. Pricing can be loaded from a static table or fetched dynamically (OpenRouter and provider APIs supported).

## Installation

```bash
bun add @reactive-agents/cost
```

Or via the umbrella:

```bash
bun add reactive-agents
```

## Features

- **Complexity router** — 27 signals (length, code presence, multi-step phrasing, entity count, etc.) classify each task and select Haiku / Sonnet / Opus or local equivalents
- **Semantic cache** — embedding-similarity lookup of prior responses, with cache-aware token discounts when the provider supports prompt caching
- **Budget enforcer** — blocks a request before it spends if any of the four budget windows would be exceeded; emits `BudgetExceededError`
- **Cost tracker** — accumulates token + USD spend per agent / session / day / month, persisted via `BudgetDb` (SQLite)
- **Dynamic pricing** — `.withDynamicPricing()` on the builder fetches up-to-date model prices including OpenRouter; falls back to static table on failure
- **Prompt compressor** — optional compression layer for context-heavy requests

## Quick Example

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("budget-agent")
  .withProvider("anthropic")
  .withDynamicPricing()
  .withCostTracking({
    perRequest: 0.10,    // USD
    perSession: 1.00,
    daily: 5.00,
    monthly: 50.00,
  })
  .build();

const result = await agent.run("Summarize this 200-word document");
console.log(result.metadata.cost);      // { usd: 0.0003, tokens: 450 }
console.log(result.metadata.modelUsed); // "claude-haiku-4-5-20251001" — auto-routed
console.log(result.metadata.cacheHit);  // true | false
```

## Routing Logic

| Task signals (sample)                  | → Selected tier      |
| -------------------------------------- | -------------------- |
| Short, factual, single-turn            | Haiku (cheapest)     |
| Code analysis, multi-step, structured  | Sonnet               |
| Complex reasoning, research, long-form | Opus                 |

The router uses heuristic classification by default; `analyzeComplexity()` exposes the full signal vector for callers who want LLM-assisted routing.

## Direct API

```typescript
import {
  analyzeComplexity,
  routeToModel,
  estimateCost,
  makeBudgetEnforcer,
  makeSemanticCache,
} from "@reactive-agents/cost";

const analysis = analyzeComplexity({
  input: "Write a binary search tree in Rust",
});
const model = routeToModel(analysis, { provider: "anthropic" });

const cost = estimateCost({
  model,
  inputTokens: 500,
  outputTokens: 1200,
});
```

## Budget Levels

| Level         | Window           | Persisted to |
| ------------- | ---------------- | ------------ |
| `perRequest`  | single LLM call  | in-memory    |
| `perSession`  | one agent run    | in-memory    |
| `daily`       | UTC day rollover | SQLite       |
| `monthly`     | calendar month   | SQLite       |

Each level can be omitted; only configured limits are enforced.

## Key Exports

| Export                            | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `CostService`, `CostServiceLive`  | Composite cost-management entry point              |
| `analyzeComplexity`, `routeToModel` | 27-signal complexity router                      |
| `makeSemanticCache`               | Embedding-similarity response cache                |
| `makeBudgetEnforcer`, `makeBudgetDb` | 4-level budget enforcement + SQLite persistence |
| `makeCostTracker`                 | Token + USD accumulator                            |
| `makePromptCompressor`            | Context compression                                |
| `estimateCost`, `estimateTokens`  | Pricing helpers                                    |
| `createCostLayer`                 | Factory for the runtime layer                      |
| `BudgetExceededError`, `RoutingError` | Tagged errors                                  |

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Cost guide: [docs.reactiveagents.dev/guides/cost-management/](https://docs.reactiveagents.dev/guides/cost-management/)

## License

MIT
