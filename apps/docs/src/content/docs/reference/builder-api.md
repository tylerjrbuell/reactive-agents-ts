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
| ------ | --------- | ----------- |
| `withName` | `(name: string) => this` | Set the agent's name (used as `agentId`) |
| `withPersona` | `(persona: AgentPersona) => this` | Set a structured persona for behavior steering. Fields: `{ name?, role?, background?, instructions?, tone? }` |
| `withSystemPrompt` | `(prompt: string) => this` | Set a custom system prompt. When combined with persona, the persona is prepended |

### Model & Provider

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withModel` | `(model: string) => this` | Set the LLM model (e.g., `"claude-sonnet-4-20250514"`) |
| `withProvider` | `(provider: "anthropic" \| "openai" \| "ollama" \| "gemini" \| "litellm" \| "test") => this` | Set the LLM provider |

### Memory

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withMemory` | `(tier: "1" \| "2") => this` | Enable memory. Tier 1: FTS5. Tier 2: FTS5 + KNN vectors |

### Execution

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withMaxIterations` | `(n: number) => this` | Max agent loop iterations (default: 10) |

### Optional Features

| Method | Description |
| ------ | ----------- |
| `withGuardrails()` | Injection, PII, toxicity detection on input |
| `withKillSwitch()` | Per-agent and global emergency halt capability via `KillSwitchService` |
| `withBehavioralContracts(contract)` | Enforce typed behavioral boundaries: `deniedTools`, `allowedTools`, `maxIterations`. Throws `BehavioralContractError` on violation |
| `withVerification()` | Semantic entropy, fact decomposition, and multi-source (LLM + Tavily) on output |
| `withCostTracking()` | Budget enforcement, complexity routing, semantic caching |
| `withReasoning(options?)` | Structured reasoning (ReAct, Reflexion, Plan-Execute, ToT, Adaptive). Options: `{ defaultStrategy?, strategies?, adaptive? }` |
| `withTools(options?)` | Tool registry with sandboxed execution (subprocess isolation via `Bun.spawn`). Options: `{ tools?: [{ definition, handler }] }` |
| `withIdentity()` | Agent certificates (real Ed25519 keys) and RBAC |
| `withObservability(options?)` | Distributed tracing, metrics, structured logging. Options: `{ verbosity?: "minimal" \| "normal" \| "verbose" \| "debug", live?: boolean, file?: string }` |
| `withInteraction()` | 5 interaction modes with adaptive transitions |
| `withPrompts(options?)` | Version-controlled prompt template engine. Options: `{ templates?: PromptTemplate[] }` |
| `withOrchestration()` | Multi-agent workflow coordination |
| `withSelfImprovement()` | Cross-task self-improvement: logs `StrategyOutcome` per task and retrieves relevant past outcomes at bootstrap to guide strategy selection |
| `withAudit()` | Compliance audit trail logging |

### A2A Protocol

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withA2A` | `(config: { port?: number }) => this` | Enable A2A server capability |
| `withAgentTool` | `(name: string, agent: { name: string; description?: string; persona?: AgentPersona; systemPrompt?: string; ... }) => this` | Register a local agent as a callable tool. Subagent personas are supported for specialized behavior |
| `withDynamicSubAgents` | `(options?: { maxIterations?: number }) => this` | Enable `spawn-agent` tool to dynamically create subagents at runtime with optional persona parameters |
| `withRemoteAgent` | `(name: string, remoteUrl: string) => this` | Register a remote A2A agent as a callable tool |

### MCP

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withMCP` | `(config: MCPServerConfig \| MCPServerConfig[]) => this` | Connect to MCP servers (stdio, SSE) |

### Lifecycle

| Method | Signature | Description |
| ------ | --------- | ----------- |
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
| ------ | --------- | ----------- |
| `withTestResponses` | `(responses: Record<string, string>) => this` | Set canned test responses (uses `"test"` provider) |

### Advanced

| Method | Signature | Description |
| ------ | --------- | ----------- |
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

### Lifecycle Control

Requires `.withKillSwitch()` to be enabled.

| Method | Signature | Description |
|--------|-----------|-------------|
| `pause()` | `() => Promise<void>` | Pause execution at the next phase boundary. Blocks until `resume()` is called |
| `resume()` | `() => Promise<void>` | Resume a paused agent |
| `stop(reason)` | `(reason: string) => Promise<void>` | Graceful stop — signals intent; agent completes current phase then exits |
| `terminate(reason)` | `(reason: string) => Promise<void>` | Immediate termination (also triggers kill switch) |

### Event Subscription

Requires an EventBus to be wired (any feature that enables it, e.g., `.withObservability()`).

`subscribe` is overloaded — pass a tag for type-narrowed access, or omit it for a catch-all:

```typescript
// ── Tag-filtered: event is narrowed to the exact payload type ──────────────
const unsub = await agent.subscribe("AgentCompleted", (event) => {
  // TypeScript knows event has: taskId, agentId, success, totalIterations,
  // totalTokens, durationMs — no _tag check, no cast needed
  console.log(`Done in ${event.durationMs}ms, ${event.totalTokens} tokens`);
});
unsub();

// ── Catch-all: receives the full AgentEvent union ──────────────────────────
const unsub2 = await agent.subscribe((event) => {
  // Discriminate via event._tag when handling multiple types in one handler
  if (event._tag === "ToolCallStarted") console.log(`Tool: ${event.toolName}`);
  if (event._tag === "LLMRequestStarted") console.log(`Model: ${event.model}`);
});
unsub2();
```

TypeScript signatures:

```typescript
// Tag-filtered — event type is automatically narrowed
subscribe<T extends AgentEventTag>(
  tag: T,
  handler: (event: Extract<AgentEvent, { _tag: T }>) => void,
): Promise<() => void>;

// Catch-all — full AgentEvent union
subscribe(handler: (event: AgentEvent) => void): Promise<() => void>;
```

The `AgentEventTag` and `TypedEventHandler<T>` helpers are exported from `@reactive-agents/core` for use in your own service code:

```typescript
import type { AgentEventTag, TypedEventHandler } from "@reactive-agents/core";

// Build a typed handler outside of an inline callback
const onStepComplete: TypedEventHandler<"ReasoningStepCompleted"> = (event) => {
  // event.thought, event.action, event.observation — all typed
  return Effect.log(`Step ${event.step}: ${event.thought ?? event.action}`);
};

yield* eventBus.on("ReasoningStepCompleted", onStepComplete);
```

**Subscribable event tags:**

| Tag | Payload fields |
|-----|---------------|
| `AgentStarted` | `taskId`, `agentId`, `provider`, `model`, `timestamp` |
| `AgentCompleted` | `taskId`, `agentId`, `success`, `totalIterations`, `totalTokens`, `durationMs` |
| `LLMRequestStarted` | `taskId`, `requestId`, `model`, `provider`, `contextSize` |
| `LLMRequestCompleted` | `taskId`, `requestId`, `tokensUsed`, `durationMs` |
| `ReasoningStepCompleted` | `taskId`, `strategy`, `step`, `thought\|action\|observation` |
| `ToolCallStarted` | `taskId`, `toolName`, `callId` |
| `ToolCallCompleted` | `taskId`, `toolName`, `callId`, `success`, `durationMs` |
| `FinalAnswerProduced` | `taskId`, `strategy`, `answer`, `iteration`, `totalTokens` |
| `GuardrailViolationDetected` | `taskId`, `violations`, `score`, `blocked` |
| `ExecutionPhaseEntered` | `taskId`, `phase` |
| `ExecutionPhaseCompleted` | `taskId`, `phase`, `durationMs` |
| `ExecutionHookFired` | `taskId`, `phase`, `timing` |
| `ExecutionCancelled` | `taskId` |
| `MemoryBootstrapped` | `agentId`, `tier` |
| `MemoryFlushed` | `agentId` |
| `AgentPaused` | `agentId`, `taskId` |
| `AgentResumed` | `agentId`, `taskId` |
| `AgentStopped` | `agentId`, `taskId`, `reason` |
| `TaskCompleted` | `taskId`, `success` |

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
  .withPersona({
    role: "CRISPR Research Specialist",
    background: "Expert in gene editing and molecular biology",
    instructions: "Provide detailed technical analysis with citations",
    tone: "professional",
  })
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
