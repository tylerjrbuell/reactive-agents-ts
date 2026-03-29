---
title: Error Handling & Resilience
description: Handle failures gracefully with typed errors, provider fallbacks, retry policies, and execution timeouts.
sidebar:
  order: 8
---

Reactive Agents uses typed errors throughout so you can distinguish transient failures from configuration problems and handle each appropriately.

## Typed Error Hierarchy

Every error from `agent.run()` is one of these tagged types:

```typescript
import type { RuntimeErrors } from "@reactive-agents/runtime";
// RuntimeErrors is a union of:
// | ExecutionError          — unexpected error in a lifecycle phase
// | HookError               — a registered hook threw
// | MaxIterationsError      — agent hit iteration limit without answering
// | GuardrailViolationError — input/output blocked by guardrails
// | BudgetExceededError     — token/cost budget exceeded
// | KillSwitchTriggeredError — agent was stopped externally
// | BehavioralContractViolationError — agent violated a contract rule
```

## Handling Errors from agent.run()

`agent.run()` is `async` and **rejects on failure** (typed errors from the runtime). On success it resolves to an `AgentResult` with `success: true`.

Use **`try/catch`** (or `runEffect()` + `Effect` operators) for failures:

```typescript
import {
  MaxIterationsError,
  GuardrailViolationError,
  ExecutionError,
  unwrapErrorWithSuggestion,
} from "@reactive-agents/runtime";

try {
  const result = await agent.run(prompt);
  console.log(result.output);
} catch (err) {
  if (err instanceof MaxIterationsError) {
    console.log(`Gave up after ${err.iterations} iterations.`);
    console.log("Partial output:", err.partialOutput);
  } else if (err instanceof GuardrailViolationError) {
    console.log(`Blocked: ${err.violationType} — ${err.reason}`);
  } else if (err instanceof ExecutionError) {
    console.log(`Error in phase [${err.phase}]: ${err.message}`);
    // unwrapErrorWithSuggestion adds actionable fix hints
    console.log(unwrapErrorWithSuggestion(err));
  }
}
```

## Provider Fallbacks

When your primary provider is down or rate-limited, automatically cascade to alternatives:

```typescript
const agent = await ReactiveAgents.create()
  .withName("resilient-agent")
  .withProvider("anthropic")          // primary provider
  .withFallbacks({
    providers: ["anthropic", "openai", "gemini"],  // tried in order
    errorThreshold: 2,                             // errors before switching
  })
  .build();
```

After `errorThreshold` consecutive failures on a provider, the runtime automatically switches to the next one. The switch is transparent to the caller.

## Retry Policy

Retry transient LLM failures (rate limits, network blips) with exponential-like back-off:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withRetryPolicy({
    maxRetries: 3,
    backoffMs: 1_000,   // wait 1s between each retry attempt
  })
  .build();
```

Retries apply to every `llm.complete()` call across all reasoning strategies. Use `withFallbacks` + `withRetryPolicy` together for maximum resilience:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withRetryPolicy({ maxRetries: 2, backoffMs: 500 })
  .withFallbacks({ providers: ["anthropic", "openai"], errorThreshold: 3 })
  .build();
```

## Execution Timeout

Prevent runaway agents with a hard wall-clock timeout:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTimeout(30_000)    // abort after 30 seconds
  .build();

try {
  const result = await agent.run("Summarize the internet");
} catch (err) {
  if (err instanceof ExecutionError && err.message.includes("timed out")) {
    console.log("Agent took too long — try a more focused prompt.");
  }
}
```

## Global Error Handler

Wire a callback to observe every error without try/catch at every call site:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withErrorHandler((err, ctx) => {
    console.error(`[${ctx.phase}] Agent error on step ${ctx.iteration}:`, err.message);
    // ctx.taskId, ctx.phase, ctx.iteration, ctx.lastStep are available
    // Log to your error tracking service here (Sentry, Datadog, etc.)
  })
  .build();
```

The error handler is called for every thrown error regardless of where it occurred.

## Build-Time Validation

Catch misconfigured agents before they run in production:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withStrictValidation()   // throws at .build() if required config is missing
  .build();
```

Without `withStrictValidation()`, misconfiguration typically surfaces at runtime. Strict validation makes the failure fast and obvious during startup.

## Circuit Breaker

Use the circuit breaker to automatically open (stop sending requests) after repeated failures and close again after a recovery window:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCircuitBreaker({
    failureThreshold: 5,      // open after 5 failures in window
    recoveryTimeMs: 60_000,   // try again after 1 minute
    windowMs: 30_000,         // failure counting window
  })
  .build();
```

## Putting It Together

A production-grade resilient agent:

```typescript
const agent = await ReactiveAgents.create()
  .withName("prod-agent")
  .withProvider("anthropic")
  .withStrictValidation()
  .withTimeout(60_000)
  .withRetryPolicy({ maxRetries: 3, backoffMs: 1_000 })
  .withFallbacks({
    providers: ["anthropic", "openai"],
    errorThreshold: 3,
  })
  .withErrorHandler((err, ctx) => {
    reportToSentry(err, { extra: ctx });
  })
  .withGuardrails({
    injectionThreshold: 0.8,
    toxicityThreshold: 0.7,
  })
  .withLogging({ level: "warn", format: "json", filePath: "./logs/agent.log" })
  .build();
```
