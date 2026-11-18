---
title: Limits, cost and resilience
description: >-
  Builder reference for iteration and time limits, retry, context profile, cost tracking, budgets, model routing, pricing, circuit breaker, rate limiting and fallbacks.
sidebar:
  order: 6
topic: config-reference
related:
  - reference/builder-api
  - features/cost-tracking
  - guides/cost-optimization
  - guides/production-checklist
---

Methods that bound a run and its cost: iteration, timeout and retry limits, cost tracking and budgets, model routing and pricing, and provider resilience (circuit breaker, rate limiting, fallbacks, stall policy). Part of the [builder reference](/reference/builder-api/).

## Execution

| Method                 | Signature                                    | Description                                                                                      |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `withMaxIterations`    | `(n: number) => this`                        | Max agent loop iterations (default: 10)                                                          |
| `withMinIterations`    | `(n: number) => this`                        | Minimum iterations before `final-answer` is permitted — prevents fast-path exit on complex tasks |
| `withContextProfile`   | `(profile: Partial<ContextProfile>) => this` | Model-adaptive context overrides: tool result size/preview limits, tool schema verbosity, iterations, temperature, context-window tokens |
| `withStrictValidation` | `() => this`                                 | Throw at build time if required config is missing (provider, model, etc.)                        |
| `withLazyValidation`   | `() => this`                                 | Keep the missing-API-key and unknown-for-provider-model checks as **warnings even under `withStrictValidation`** — `build()` succeeds and the clean typed failure surfaces at `run()` time. Useful when keys are injected after construction, or in tooling that eagerly constructs many configs. Keyless providers (`ollama`, `test`) are exempt from the key gate anyway. Env equivalent: `REACTIVE_AGENTS_LAZY_VALIDATION=1` |
| `withTimeout`          | `(ms: number) => this`                       | Execution timeout in milliseconds for the **whole agent run** (all iterations combined). Throws `TimeoutError` if exceeded |
| `withLlmTimeout`       | `(ms: number) => this`                       | Per-LLM-call timeout in milliseconds — bounds a **single provider request**, distinct from `withTimeout`. Honored by the Ollama/local provider (maps to `LLMConfig.ollamaTimeoutMs`; equivalent to the `OLLAMA_TIMEOUT_MS` env var but scoped to this agent — useful to tolerate cold model loads, e.g. `.withLlmTimeout(600_000)`). Hosted providers (Anthropic/OpenAI/Gemini) ignore it |
| `withRetryPolicy`      | `(policy: RetryPolicy) => this`              | Retry on transient LLM failures. `{ maxRetries: number, backoffMs: number }`                     |

### ContextProfile fields

| Field                     | Type                                          | Description                                                                     |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `tier`                    | `"local" \| "mid" \| "large" \| "frontier"`   | Model tier — controls which defaults are applied                                |
| `toolResultMaxChars`      | `number`                                      | Max characters per compressed tool result before overflow compression           |
| `toolResultPreviewItems`  | `number`                                      | Array items shown in a compressed tool result preview                           |
| `toolSchemaDetail`        | `"names-only" \| "names-and-types" \| "full"` | Tool schema verbosity in the system prompt                                      |
| `maxIterations`           | `number` (optional)                           | Max kernel iterations before failing                                            |
| `temperature`             | `number` (optional)                           | LLM sampling temperature                                                        |
| `maxTokens`               | `number` (optional)                           | Context-window token cap used by pressure gates and message compaction          |
| `recentObservationsLimit` | `number` (optional)                           | Accepted but currently has no effect: nothing reads it, so setting it changes nothing. It is slated for deprecation. |

<!-- docs-skip-typecheck -->
```typescript
// Lean context for local small models
.withContextProfile({ tier: "local" })

// Manual overrides for a specific task
.withContextProfile({
  maxTokens: 4000,
  toolResultMaxChars: 800,
  toolResultPreviewItems: 3,
  toolSchemaDetail: "names-and-types",
})
```

See [Context Engineering](/guides/context-engineering/) for full tier defaults.

## Cost, budgets and resilience

| Method                               | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withCostTracking(options?)`         | Budgets in USD: `{ perRequest?, perSession?, daily?, monthly? }` plus cost estimation / analytics                                                                                                                                                                                                                                                                                                            |
| `withBudget(limits)`                 | Hard in-loop killswitch: `{ tokenLimit?, costLimit? }`. Caps cumulative tokens / USD and stops the loop when hit — distinct from `withCostTracking()` accounting. Also set by `HarnessProfile` budget composition.                                                                                                                                                                                            |
| `withModelRouting(options?)`         | **Opt-in cost-aware model routing (off by default).** Routes each run to the cheapest *capable* model of the configured provider, picked by task complexity, on both the inline and reasoning paths. Stays within the provider's tiers (`haiku`/`sonnet`/`opus` cost ladder → the provider's models); capability-gated (never routes a large-input task below a model whose context window fits); advisory (degrades to the configured model on any error). `{ tierModels?: Partial<Record<"haiku"\|"sonnet"\|"opus", string>>, minTier? }`. |
| `withModelPricing(registry)`         | Per-model $/1M tokens: `{ "model-id": { input, output } }`                                                                                                                                                                                                                                                                                                                                                   |
| `withDynamicPricing(provider)`       | Remote pricing (`openRouterPricingProvider`, etc.) fetched at build time                                                                                                                                                                                                                                                                                                                                     |
| `withCircuitBreaker(config?)`        | LLM call circuit breaker (`@reactive-agents/llm-provider` `CircuitBreakerConfig`)                                                                                                                                                                                                                                                                                                                            |
| `withRateLimiting(config?)`          | Throttle LLM requests (`requestsPerMinute`, `tokensPerMinute`, concurrency, …)                                                                                                                                                                                                                                                                                                                               |
| `withFallbacks(config)`              | `{ providers }` — an ordered provider cascade. The primary provider runs first; on **any** error the next provider in the list is tried, in order (no error threshold, no 429/cost-specific logic).                                                                                                                                                                                                          |
| `withStallPolicy(policy)`            | Tune the stall / no-progress policy — how the harness reacts when the model ignores required-tool nudges. Sensible defaults apply when unset: tolerate **2** consecutive ignored nudges before fast-escalating (deliver accumulated artifacts, else fail) instead of looping to the full nudge cap, and **escalate** nudge wording on repeats. Bounds wasted iterations/tokens on stuck runs; legitimately-progressing runs are untouched (progress resets the ignored streak). `{ ignoredNudgeTolerance?, escalateNudgeContent? }`. |
| `withLongHorizon()`                  | **Opt-in, off by default.** Mode toggle (no arguments). Scales the reasoning kernel's guard thresholds (stall, consecutive-thoughts, redirect/nudge budgets) *proportionally* to `maxIterations` instead of using absolute counts, so a run configured for 40+ iterations of tool work isn't tripped by guards tuned for short runs. Verified to let a long-horizon task run to completion; **not yet lift-gated for default-on**. When not called, `horizonProfile` stays unset and behavior is byte-identical to the default. |
