---
title: Your First Agent
description: A step-by-step guide to building a complete agent.
---

This guide walks through building a research assistant agent with memory, reasoning, and guardrails.

## The Builder Pattern

Every agent starts with `ReactiveAgents.create()`:

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .build();
```

This creates a minimal agent with:
- LLM provider (Anthropic)
- In-memory SQLite for memory (Tier 1)
- Direct LLM loop (no reasoning strategy)

## Adding Memory

Memory persists context across conversations:

```typescript
const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1")  // Tier 1: FTS5 full-text search
  .build();
```

**Tier 1** gives you working memory, semantic storage, episodic logging, and full-text search — all backed by bun:sqlite.

**Tier 2** adds vector embeddings for semantic similarity search (requires an embedding provider).

## Adding Reasoning

The reasoning layer gives your agent structured thinking:

```typescript
const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1")
  .withReasoning()  // ReAct loop: Think -> Act -> Observe
  .build();
```

With reasoning enabled, the agent uses a ReAct loop instead of a simple LLM call. It can:
- Break tasks into steps
- Request tool calls
- Observe results and adjust

## Adding Safety

Guardrails protect against prompt injection, PII leakage, and toxic content:

```typescript
const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1")
  .withReasoning()
  .withGuardrails()       // Input/output safety
  .withCostTracking()     // Budget controls
  .build();
```

## Running the Agent

```typescript
const result = await agent.run("Explain the difference between TCP and UDP");

console.log(result.output);       // The agent's response
console.log(result.success);      // true
console.log(result.metadata);     // { duration, cost, tokensUsed, stepsCount }
```

## Using the Effect API

For advanced use cases, use the Effect-based API:

```typescript
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const agent = yield* ReactiveAgents.create()
    .withName("research-assistant")
    .withProvider("anthropic")
    .withReasoning()
    .buildEffect();

  const result = yield* agent.runEffect("Explain quantum entanglement");
  return result;
});

const result = await Effect.runPromise(program);
```

## Lifecycle Hooks

Observe and modify agent behavior at any phase:

```typescript
const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withHook({
    phase: "think",
    timing: "after",
    handler: (ctx) => {
      console.log(`[think] Response: ${ctx.metadata.lastResponse}`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

Available phases: `bootstrap`, `guardrail`, `cost-route`, `strategy-select`, `think`, `act`, `observe`, `verify`, `memory-flush`, `cost-track`, `audit`, `complete`.

Each phase supports `before`, `after`, and `on-error` timing.

## Testing

Use the test provider for deterministic tests:

```typescript
const agent = await ReactiveAgents.create()
  .withName("test-agent")
  .withProvider("test")
  .withTestResponses({
    "capital of France": "Paris is the capital of France.",
    "quantum": "Quantum mechanics describes nature at the atomic scale.",
  })
  .build();

const result = await agent.run("What is the capital of France?");
expect(result.output).toContain("Paris");
```
