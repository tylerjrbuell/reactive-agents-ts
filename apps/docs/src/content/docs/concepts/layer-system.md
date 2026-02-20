---
title: Layer System
description: How the composable layer system works.
---

The layer system is the core architectural pattern of Reactive Agents. Every capability is an independent Effect Layer that can be enabled or disabled.

## What is a Layer?

In Effect-TS, a `Layer` is a recipe for constructing services. Think of it as a factory:

```typescript
// Layer<AgentService, never, EventBus>
// "I provide AgentService, never fail, and need EventBus"
```

Layers compose through two operations:

- **`Layer.merge(a, b)`** — Provides services from both layers
- **`Layer.provide(dep)`** — Satisfies a layer's requirements

## The Runtime Composition

When you call `createRuntime()`, it composes layers based on your configuration:

```typescript
const runtime = createRuntime({
  agentId: "my-agent",
  provider: "anthropic",
  enableGuardrails: true,
  enableReasoning: true,
});
```

Internally, this produces:

```
CoreServicesLive          → provides EventBus, AgentService, TaskService
  + EventBusLive          → provides EventBus (for optional layers)
  + LLMProviderLayer      → provides LLMService
  + MemoryLayer           → provides MemoryService
  + HookRegistryLive      → provides LifecycleHookRegistry
  + ExecutionEngineLive   → provides ExecutionEngine
  + GuardrailsLayer       → provides GuardrailService
  + ReasoningLayer        → provides ReasoningService, StrategyRegistry
```

## Layer Dependencies

Each layer declares what it provides and what it requires:

| Layer | Provides | Requires |
|-------|----------|----------|
| Core | EventBus, AgentService, TaskService | Nothing |
| LLM Provider | LLMService | Nothing |
| Memory | MemoryService, MemoryDatabase | Nothing |
| Reasoning | ReasoningService, StrategyRegistry | LLMService |
| Tools | ToolService | EventBus |
| Interaction | InteractionManager, ModeSwitcher, ... | EventBus |
| Guardrails | GuardrailService | Nothing |
| Verification | VerificationService | Nothing |
| Cost | CostService | Nothing |
| Identity | IdentityService | Nothing |
| Observability | ObservabilityService | Nothing |
| Prompts | PromptService | Nothing |
| Orchestration | OrchestrationService | Nothing |

The runtime automatically satisfies dependencies when composing layers.

## Custom Layers

Add your own layers using `.withLayers()`:

```typescript
import { Layer, Context, Effect } from "effect";

class MyAnalytics extends Context.Tag("MyAnalytics")<
  MyAnalytics,
  { readonly track: (event: string) => Effect.Effect<void> }
>() {}

const MyAnalyticsLive = Layer.succeed(MyAnalytics, {
  track: (event) => Effect.sync(() => console.log(`[analytics] ${event}`)),
});

const agent = await ReactiveAgents.create()
  .withLayers(MyAnalyticsLive)
  .build();
```

## Testing with Layers

Replace any layer with a test implementation:

```typescript
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

// The test provider is a Layer that returns canned responses
const testLLM = TestLLMServiceLayer({
  "capital of France": "Paris",
});
```

This is the power of the layer system — any service can be swapped at the composition boundary without changing application code.
