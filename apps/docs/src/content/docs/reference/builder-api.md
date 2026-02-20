---
title: ReactiveAgentBuilder
description: API reference for the ReactiveAgentBuilder.
---

The `ReactiveAgentBuilder` is the primary entry point for creating agents.

## `ReactiveAgents.create()`

Creates a new builder instance.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const builder = ReactiveAgents.create();
```

## Builder Methods

All methods return `this` for chaining.

### Identity

| Method | Signature | Description |
|--------|-----------|-------------|
| `withName` | `(name: string) => this` | Set the agent's name |

### Model & Provider

| Method | Signature | Description |
|--------|-----------|-------------|
| `withModel` | `(model: string) => this` | Set the LLM model |
| `withProvider` | `(provider: "anthropic" \| "openai" \| "ollama" \| "test") => this` | Set the LLM provider |

### Memory

| Method | Signature | Description |
|--------|-----------|-------------|
| `withMemory` | `(tier: "1" \| "2") => this` | Enable memory with tier |

### Execution

| Method | Signature | Description |
|--------|-----------|-------------|
| `withMaxIterations` | `(n: number) => this` | Max agent loop iterations |

### Optional Features

| Method | Description |
|--------|-------------|
| `withGuardrails()` | Enable input/output safety checks |
| `withVerification()` | Enable fact-checking |
| `withCostTracking()` | Enable budget enforcement |
| `withReasoning()` | Enable structured reasoning (ReAct) |
| `withTools()` | Enable tool registry and sandbox |
| `withIdentity()` | Enable agent certificates and RBAC |
| `withObservability()` | Enable tracing and metrics |
| `withInteraction()` | Enable 5 interaction modes |
| `withPrompts()` | Enable prompt template engine |
| `withOrchestration()` | Enable multi-agent workflows |
| `withAudit()` | Enable audit logging |

### Lifecycle

| Method | Signature | Description |
|--------|-----------|-------------|
| `withHook` | `(hook: LifecycleHook) => this` | Register a lifecycle hook |

### Testing

| Method | Signature | Description |
|--------|-----------|-------------|
| `withTestResponses` | `(responses: Record<string, string>) => this` | Set canned test responses |

### Advanced

| Method | Signature | Description |
|--------|-----------|-------------|
| `withLayers` | `(layers: Layer<any, any>) => this` | Add custom Effect Layers |

## Build Methods

### `build()`

```typescript
async build(): Promise<ReactiveAgent>
```

Creates the agent. Resolves with a `ReactiveAgent` instance.

### `buildEffect()`

```typescript
buildEffect(): Effect.Effect<ReactiveAgent, Error>
```

Creates the agent as an Effect for composition in Effect programs.

## ReactiveAgent

The facade returned by `build()`.

### `run(input: string): Promise<AgentResult>`

Run a task with the given input. Returns the result.

### `runEffect(input: string): Effect.Effect<AgentResult, Error>`

Run a task as an Effect.

### `cancel(taskId: string): Promise<void>`

Cancel a running task.

### `getContext(taskId: string): Promise<unknown>`

Get the execution context of a running task.

## AgentResult

```typescript
interface AgentResult {
  output: string;
  success: boolean;
  taskId: string;
  agentId: string;
  metadata: {
    duration: number;    // ms
    cost: number;        // USD
    tokensUsed: number;
    strategyUsed?: string;
    stepsCount: number;
  };
}
```
