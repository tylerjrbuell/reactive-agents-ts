---
title: Resilience & Caching
description: Circuit breaker, embedding cache, budget persistence, tool result caching, and Docker sandbox for production-grade reliability.
sidebar:
  order: 11
---

Reactive Agents includes multiple resilience layers that protect your agent workflows from provider outages, redundant API calls, and unsafe code execution.

## Circuit Breaker

The LLM provider layer includes a circuit breaker that protects against cascading failures when a provider is experiencing issues.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .build();
// Circuit breaker is automatically enabled for all LLM calls
```

### How It Works

The circuit breaker has three states:

| State | Behavior |
|-------|----------|
| **CLOSED** (normal) | Requests pass through. Failures increment the counter |
| **OPEN** (tripped) | Requests fail immediately without calling the provider. Resets after timeout |
| **HALF_OPEN** (probing) | A limited number of requests pass through. Success resets to CLOSED; failure returns to OPEN |

When consecutive LLM call failures exceed the failure threshold, the circuit opens and subsequent calls fail fast — preventing wasted tokens and API quota during outages. After a configurable reset timeout, the circuit moves to half-open and probes with limited requests.

## Embedding Cache

An LRU + TTL cache sits in front of all embedding API calls, avoiding redundant requests for previously-embedded text.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory("2") // Tier 2 enables semantic memory with embeddings
  .build();
// Embedding cache is automatically active when memory tier 2 is enabled
```

Repeated embedding calls for identical text return cached vectors instantly — useful for agents that re-embed the same context across reasoning iterations.

### Cache Properties

| Property | Value |
|----------|-------|
| Eviction | LRU (least recently used) |
| TTL | Configurable per instance |
| Scope | Per-agent session |

## Budget Persistence

Budget state is persisted to SQLite, so cost tracking survives agent restarts:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking() // Budget state persisted to SQLite
  .build();
```

When the agent starts, the budget enforcer loads the most recent spend from the database and continues tracking from where it left off. Daily and monthly budgets are enforced across restarts without resetting.

## Tool Result Cache

Tool execution results are cached to avoid redundant calls for identical inputs within a session:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools() // Tool result caching is built-in
  .build();
```

When the same tool is called with the same arguments, the cached result is returned immediately. This is especially valuable in reasoning loops where the agent may re-invoke a tool with identical parameters across iterations.

### Cache Behavior

- **Keyed by** tool name + JSON-serialized arguments
- **Scope** is per-session (not persisted across `agent.run()` calls)
- **TTL** configurable via `ToolResultCacheConfig`

## Docker Sandbox

For code execution tools, the Docker sandbox provides container-level isolation:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools() // Code execution uses Docker sandbox when available
  .build();
```

Code snippets execute in isolated Docker containers with resource limits:

| Limit | Default |
|-------|---------|
| Memory | Configurable per container |
| CPU | Configurable CPU shares |
| Timeout | Per-execution timeout |
| Network | Isolated by default |

The Docker sandbox prevents:
- File system escapes
- Environment variable leakage (API keys are not inherited)
- Resource exhaustion (CPU/memory caps)
- Network access to internal services

When Docker is not available, code execution falls back to `Bun.spawn()` subprocess isolation with a minimal environment (`PATH` only).

## Required Tools Guard

Ensure your agent calls critical tools before producing a final answer:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withRequiredTools({
    tools: ["web-search"],   // Must call web-search before answering
    maxRetries: 2,           // Retry up to 2 times if tool is missed
  })
  .build();
```

### Adaptive Inference

Instead of a static tool list, let the LLM determine which tools are required per-task:

```typescript
.withRequiredTools({ adaptive: true })
```

The framework calls the LLM with the task description and available tool schemas. A hallucination guard filters the inferred list against actual tool names, ensuring only real tools are required.

### Combined Mode

Use both a static baseline and adaptive inference:

```typescript
.withRequiredTools({
  tools: ["web-search"],  // Always required
  adaptive: true,         // Plus LLM-inferred requirements
  maxRetries: 3,
})
```

### How It Works

1. Before execution, the required tools list is determined (static, adaptive, or both)
2. The kernel runner tracks which tools are called during reasoning
3. After the kernel produces a final answer, the runner checks if all required tools were called
4. If any are missing, a nudge message is injected and the kernel re-enters the loop
5. This repeats up to `maxRetries` times before accepting the answer as-is
