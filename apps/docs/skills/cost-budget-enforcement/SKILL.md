---
name: cost-budget-enforcement
description: Set per-request, per-session, daily, and monthly spend limits, configure rate limiting and circuit breakers, and isolate costs per user or tenant.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Cost and Budget Enforcement

## Agent objective

Produce a builder with cost tracking, budget limits, and rate limiting configured so the agent never exceeds defined spending thresholds.

## When to load this skill

- Deploying agents in production with real API costs
- Building multi-tenant SaaS where per-user cost isolation matters
- Protecting against runaway agent loops consuming excessive tokens
- Adding circuit breakers for provider reliability

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 15 })
  .withTools({ allowedTools: ["web-search", "http-get", "checkpoint"] })
  .withCostTracking({
    perRequest: 0.25,   // max $0.25 per LLM call
    perSession: 2.0,    // max $2.00 per agent.run() call
    daily: 10.0,        // max $10.00/day across all sessions
    monthly: 100.0,     // max $100.00/month
  })
  .withRateLimiting({
    requestsPerMinute: 30,
    tokensPerMinute: 50_000,
    maxConcurrent: 3,
  })
  .withCircuitBreaker()   // auto-opens on provider errors; prevents cascading failures
  .build();
```

## Key patterns

### withCostTracking() — budget limits

```ts
.withCostTracking()
// Enables cost tracking with defaults:
// perRequest: $1.00, perSession: $5.00, daily: $25.00, monthly: $200.00

.withCostTracking({
  perRequest: 0.50,    // hard stop mid-request if cost would exceed this
  perSession: 5.0,
  daily: 25.0,         // daily limit (default $25.00)
  monthly: 200.0,
})
```

When a budget is exceeded, the agent throws a `BudgetExceededError` and stops. Daily/monthly budgets reset based on the timezone configured in `.withGateway()` (if used) or UTC by default.

### withRateLimiting() — throughput caps

```ts
.withRateLimiting()
// Defaults: 60 RPM, 100,000 TPM, 10 concurrent requests

.withRateLimiting({
  requestsPerMinute: 60,     // max LLM requests per minute
  tokensPerMinute: 100_000,  // max tokens per minute (input + output)
  maxConcurrent: 10,         // max simultaneous in-flight LLM requests
})
```

Requests that exceed limits are queued (not dropped) — the agent waits for capacity before proceeding.

### withCircuitBreaker() — provider reliability

```ts
.withCircuitBreaker()
// Default thresholds (open after 5 failures in 60s window, retry after 30s)

.withCircuitBreaker({
  failureThreshold: 5,       // open circuit after N consecutive failures
  windowMs: 60_000,          // failure counting window
  retryAfterMs: 30_000,      // wait before trying half-open probe
})
```

Circuit breaker states: `closed` (normal) → `open` (failing fast) → `half-open` (probing recovery).

### Per-user cost isolation (multi-tenant)

```ts
// Create one agent per user/tenant with separate tracking contexts
const userAgent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking({ perSession: 1.0, daily: 5.0 })
  .withName(`user-${userId}`)
  .withSystemPrompt(`You are assisting user ${userId}.`)
  .build();

// Or use per-request context injection:
const result = await agent.run(task, {
  context: { userId, tenantId },   // included in cost tracking metadata
});
```

### How calls are priced

Every call is priced from the PriceBook: your `withModelPricing` rows first (they always win), then `withDynamicPricing` rows, Ollama at $0, a LiteLLM proxy's stated rates, then a bundled LiteLLM price snapshot (per-model input, output, cache read, cache write 5m/1h, long-context tiers, web search). There is no keyword guess and no fixed cache discount. A model in none of these has an **unknown** price: its calls carry no `estimatedCost` and `priceSource: "unknown"`, and the run reports `result.metadata.costComplete === false` with `cost` as a lower bound.

```ts
import { openRouterPricingProvider, urlPricingProvider } from "@reactive-agents/llm-provider";

// Your own rates ($/1M). Cache rates optional; omitted ones bill at `input`.
.withModelPricing({ "my-fine-tuned-model": { input: 0.5, output: 1.5, cacheRead: 0.05 } })

// Live rows fetched at build (never override withModelPricing)
.withDynamicPricing(openRouterPricingProvider)
// or: .withDynamicPricing(urlPricingProvider("https://internal.corp/pricing.json"))
```

### Reading the cost of a run

```ts
const result = await agent.run(task);
const { cost, costComplete } = result.metadata; // pre-debrief spend; lower bound when costComplete === false
const total = await result.totalCost?.();       // { usd, complete }: billed total incl. the background debrief call
```

The same total is on the `RunCostFinalized` event (`totalCostUsd`, `costComplete`), published once per run. Sum per-call costs (`LLMRequestCompleted.estimatedCost`, stream `TokenUsage.costUsd`, both optional) with `sumCosts` / `addCost` from `@reactive-agents/core`, never with `+`.

## CostTrackingOptions reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `perRequest` | `number` | `1.00` | Max USD per single LLM request |
| `perSession` | `number` | `5.00` | Max USD per `agent.run()` call |
| `daily` | `number` | `20.00` | Max USD per calendar day |
| `monthly` | `number` | `200.00` | Max USD per calendar month |

## RateLimiterConfig reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `requestsPerMinute` | `number` | `60` | Max LLM requests/minute |
| `tokensPerMinute` | `number` | `100_000` | Max tokens/minute (input + output) |
| `maxConcurrent` | `number` | `10` | Max simultaneous in-flight requests |

## Pitfalls

- Budget limits are enforced per-process — multiple processes running the same agent each get their own daily/monthly counters; use an external store for true cross-process budget tracking
- `withCostTracking()` with no args is still useful — it enables cost telemetry without enforcing limits (all defaults are generous)
- `withCircuitBreaker()` opens on LLM provider errors, not on budget exceeded errors — they are independent systems
- Rate limiting queues requests rather than dropping them — set `maxConcurrent` based on your provider's actual concurrency limits to avoid provider-side 429s
- `withDynamicPricing()` makes an external HTTP call during build. A failed fetch does not fail `build()`: it logs `LoadBearingFailure:dynamic-pricing` and falls back to your `withModelPricing` rows plus the bundled snapshot. With `withStrictValidation()` the build fails instead
- `result.metadata.cost` excludes the background debrief call (with `.withMemory()` / `.withDebrief()`); use `await result.totalCost()` for the billed total
- An unpriced model is not free: check `costComplete` before showing `cost` as a total, or set its rates with `withModelPricing`
- Daily budget resets at midnight UTC by default — to use a different timezone, configure it via `.withGateway({ timezone: "America/New_York" })`
