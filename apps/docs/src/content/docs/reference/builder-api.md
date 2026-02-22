---
title: ReactiveAgentBuilder
description: Complete API reference for the ReactiveAgentBuilder.
---

The `ReactiveAgentBuilder` is the primary entry point for creating agents. It provides a fluent API for composing capabilities.

## `ReactiveAgents.create()`

Creates a new builder instance.

```typescript
import { ReactiveAgents } from "reactive-agents";
// or: import { ReactiveAgents } from "@reactive-agents/runtime";

const builder = ReactiveAgents.create();
```

## Builder Methods

All methods return `this` for chaining.

### Identity

| Method | Signature | Description |
|--------|-----------|-------------|
| `withName` | `(name: string) => this` | Set the agent's name (used as `agentId`) |
| `withSystemPrompt` | `(prompt: string) => this` | Set a custom system prompt (default: `"You are a helpful AI assistant."`) |

### Model & Provider

| Method | Signature | Description |
|--------|-----------|-------------|
| `withModel` | `(model: string) => this` | Set the LLM model (e.g., `"claude-sonnet-4-20250514"`) |
| `withProvider` | `(provider: "anthropic" \| "openai" \| "ollama" \| "gemini" \| "test") => this` | Set the LLM provider |

### Memory

| Method | Signature | Description |
|--------|-----------|-------------|
| `withMemory` | `(tier: "1" \| "2") => this` | Enable memory. Tier 1: FTS5. Tier 2: FTS5 + KNN vectors |

### Execution

| Method | Signature | Description |
|--------|-----------|-------------|
| `withMaxIterations` | `(n: number) => this` | Max agent loop iterations (default: 10) |

### Optional Features

| Method | Description |
|--------|-------------|
| `withGuardrails()` | Injection, PII, toxicity detection on input |
| `withVerification()` | Semantic entropy, fact decomposition on output |
| `withCostTracking()` | Budget enforcement, complexity routing, semantic caching |
| `withReasoning(options?)` | Structured reasoning (ReAct, Reflexion, Plan-Execute, ToT, Adaptive). Options: `{ defaultStrategy?, strategies?, adaptive? }` |
| `withTools(options?)` | Tool registry with sandboxed execution. Options: `{ tools?: [{ definition, handler }] }` |
| `withIdentity()` | Agent certificates and RBAC |
| `withObservability()` | Distributed tracing, metrics, structured logging |
| `withInteraction()` | 5 interaction modes with adaptive transitions |
| `withPrompts(options?)` | Version-controlled prompt template engine. Options: `{ templates?: PromptTemplate[] }` |
| `withOrchestration()` | Multi-agent workflow coordination |
| `withAudit()` | Compliance audit trail logging |

### Lifecycle

| Method | Signature | Description |
|--------|-----------|-------------|
| `withHook` | `(hook: LifecycleHook) => this` | Register a lifecycle hook |

#### LifecycleHook

```typescript
interface LifecycleHook {
  phase: ExecutionPhase;
  timing: "before" | "after" | "on-error";
  handler: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext>;
}

type ExecutionPhase =
  | "bootstrap" | "guardrail" | "cost-route" | "strategy-select"
  | "think" | "act" | "observe"
  | "verify" | "memory-flush" | "cost-track" | "audit" | "complete";
```

### Testing

| Method | Signature | Description |
|--------|-----------|-------------|
| `withTestResponses` | `(responses: Record<string, string>) => this` | Set canned test responses (uses `"test"` provider) |

### Advanced

| Method | Signature | Description |
|--------|-----------|-------------|
| `withLayers` | `(layers: Layer<any, any>) => this` | Add custom Effect Layers to the runtime |

## Build Methods

### `build()`

```typescript
async build(): Promise<ReactiveAgent>
```

Creates the agent, resolving the full Layer stack. Returns a `ReactiveAgent` instance.

### `buildEffect()`

```typescript
buildEffect(): Effect.Effect<ReactiveAgent, Error>
```

Creates the agent as an Effect for composition in Effect programs.

## ReactiveAgent

The facade returned by `build()`.

### `run(input: string): Promise<AgentResult>`

Run a task with the given input. Returns the result with output and metadata.

### `runEffect(input: string): Effect.Effect<AgentResult, Error>`

Run a task as an Effect for composition.

### `cancel(taskId: string): Promise<void>`

Cancel a running task by its ID.

### `getContext(taskId: string): Promise<unknown>`

Get the execution context of a running or completed task.

## AgentResult

```typescript
interface AgentResult {
  output: string;           // The agent's response
  success: boolean;         // Whether the task completed successfully
  taskId: string;           // Unique task identifier
  agentId: string;          // Agent that ran the task
  metadata: {
    duration: number;       // Execution time in milliseconds
    cost: number;           // Estimated cost in USD
    tokensUsed: number;     // Total tokens consumed across all LLM calls
    strategyUsed?: string;  // Reasoning strategy used (if reasoning enabled)
    stepsCount: number;     // Number of reasoning steps / iterations
  };
}
```

## Full Example

```typescript
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

// Build agent with all features
const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withSystemPrompt("You are a CRISPR research specialist.")
  .withMemory("1")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools()              // Built-in tools (web search, file I/O, etc.)
  .withGuardrails()
  .withVerification()
  .withCostTracking()
  .withObservability()
  .withAudit()
  .withInteraction()
  .withMaxIterations(15)
  .withHook({
    phase: "think",
    timing: "after",
    handler: (ctx) => {
      console.log(`Iteration ${ctx.iteration}, tokens: ${ctx.tokensUsed}`);
      return Effect.succeed(ctx);
    },
  })
  .build();

// Run a task
const result = await agent.run("Research the latest advances in CRISPR gene editing");
console.log(result.output);
console.log(`Cost: $${result.metadata.cost.toFixed(4)}`);
console.log(`Tokens: ${result.metadata.tokensUsed}`);
console.log(`Strategy: ${result.metadata.strategyUsed}`);
```
