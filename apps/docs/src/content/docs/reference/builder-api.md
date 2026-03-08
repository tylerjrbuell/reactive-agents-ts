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
| `withModel` | `(model: string) => this` | Set the LLM model by name (e.g., `"claude-sonnet-4-20250514"`) |
| `withModel` | `(params: ModelParams) => this` | Set model with advanced parameters: `thinking`, `temperature`, `maxTokens` |
| `withProvider` | `(provider: "anthropic" \| "openai" \| "ollama" \| "gemini" \| "litellm" \| "test") => this` | Set the LLM provider |

#### ModelParams

```typescript
interface ModelParams {
  model: string;         // Model identifier (provider-specific)
  thinking?: boolean;    // Enable thinking/reasoning mode (auto-detected if omitted)
  temperature?: number;  // Sampling temperature 0.0–1.0
  maxTokens?: number;    // Maximum output tokens
}
```

```typescript
// String form — simple model selection
.withModel("claude-opus-4-20250514")

// ModelParams form — local model with thinking mode
.withModel({ model: "qwen3:14b", thinking: true, temperature: 0.7 })

// ModelParams form — cap token budget
.withModel({ model: "gpt-4o", maxTokens: 2048 })
```

### Memory

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withMemory` | `(tier: "1" \| "2") => this` | Enable memory. Tier 1: FTS5. Tier 2: FTS5 + KNN vectors |

### Execution

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withMaxIterations` | `(n: number) => this` | Max agent loop iterations (default: 10) |
| `withContextProfile` | `(profile: Partial<ContextProfile>) => this` | Model-adaptive context overrides: compaction thresholds, tool result size limits, budget |

#### ContextProfile fields

| Field | Type | Description |
|-------|------|-------------|
| `tier` | `"local" \| "mid" \| "large" \| "frontier"` | Model tier — controls which defaults are applied |
| `budgetTokens` | `number` | Max tokens to include in the context window |
| `toolResultMaxChars` | `number` | Truncate tool results beyond this length |
| `compactionLevel` | `"full" \| "summary" \| "grouped" \| "dropped"` | How aggressively to compact older steps |
| `maxStepsBeforeCompaction` | `number` | Steps to keep in full detail before compacting |

```typescript
// Lean context for local small models
.withContextProfile({ tier: "local" })

// Manual overrides for a specific task
.withContextProfile({
  budgetTokens: 4000,
  toolResultMaxChars: 800,
  compactionLevel: "grouped",
})
```

See [Context Engineering](/guides/context-engineering/) for full tier defaults.

### Optional Features

| Method | Description |
| ------ | ----------- |
| `withGuardrails()` | Injection, PII, toxicity detection on input |
| `withKillSwitch()` | Per-agent and global emergency halt capability via `KillSwitchService` |
| `withBehavioralContracts(contract)` | Enforce typed behavioral boundaries: `deniedTools`, `allowedTools`, `maxIterations`. Throws `BehavioralContractError` on violation |
| `withVerification()` | Semantic entropy, fact decomposition, and multi-source (LLM + Tavily) on output |
| `withCostTracking()` | Budget enforcement (persisted to SQLite), complexity routing (27 signals), semantic caching |
| `withReasoning(options?)` | Structured reasoning (ReAct, Reflexion, Plan-Execute, ToT, Adaptive). Options: `{ defaultStrategy?, strategies?, adaptive?: { enabled?: boolean, learning?: boolean } }`. Set `adaptive.enabled: true` to auto-select strategy per task |
| `withTools(options?)` | Tool registry with sandboxed execution (subprocess isolation via `Bun.spawn`, Docker sandbox). Options: `{ tools?: [{ definition, handler }], resultCompression?: ResultCompressionConfig }`. See [Tool Result Compression](/guides/tools/#tool-result-compression) |
| `withRequiredTools(config)` | Ensure agent calls critical tools before producing a final answer. Config: `{ tools?: string[], adaptive?: boolean, maxRetries?: number }` |
| `withIdentity()` | Agent certificates (real Ed25519 keys) and RBAC |
| `withObservability(options?)` | Distributed tracing, metrics, OTLP export, structured logging. Options: `{ verbosity?: "minimal" \| "normal" \| "verbose" \| "debug", live?: boolean, file?: string }` |
| `withInteraction()` | 5 interaction modes with adaptive transitions |
| `withPrompts(options?)` | Version-controlled prompt template engine. Options: `{ templates?: PromptTemplate[] }` |
| `withOrchestration()` | Multi-agent workflow coordination |
| `withSelfImprovement()` | Cross-task self-improvement: logs `StrategyOutcome` per task and retrieves relevant past outcomes at bootstrap to guide strategy selection |
| `withAudit()` | Compliance audit trail logging |
| `withEvents()` | Enable typed EventBus subscriptions via `agent.subscribe()` |
| `withGateway(options?)` | Persistent autonomous gateway: adaptive heartbeats, cron scheduling, webhook ingestion, policy engine. Options: `{ heartbeat?: HeartbeatConfig, crons?: CronEntry[], webhooks?: WebhookConfig[], policies?: PolicyConfig }` |

#### RequiredToolsConfig

```typescript
interface RequiredToolsConfig {
  /** Static list of tool names the agent MUST call before answering. */
  tools?: string[];
  /** Enable adaptive inference — LLM analyzes task + tools to determine required tools. */
  adaptive?: boolean;
  /** Number of retry loops if required tools are missed (default: 2). */
  maxRetries?: number;
}
```

**Examples:**

```typescript
// Static required tools — agent must call web-search before answering
.withRequiredTools({ tools: ["web-search"] })

// Adaptive inference — LLM determines which tools are required per-task
.withRequiredTools({ adaptive: true })

// Both — static list as baseline, adaptive for additional inference
.withRequiredTools({ tools: ["web-search"], adaptive: true, maxRetries: 3 })
```

When `adaptive: true`, the framework calls the LLM with the task description and available tool schemas to infer which tools are required. The inferred list is merged with any static `tools` list. A hallucination guard ensures only actual tool names are included.

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
| `withMCP` | `(config: MCPServerConfig \| MCPServerConfig[]) => this` | Connect to MCP servers. Accepts a single config or array. Automatically enables `.withTools()`. |

#### MCPServerConfig

| Field | Type | Transport | Description |
|-------|------|-----------|-------------|
| `name` | `string` | all | Unique name for this server. Tool names are prefixed `{name}/` |
| `transport` | `"stdio" \| "streamable-http" \| "sse" \| "websocket"` | all | Protocol to use. Use `"streamable-http"` for modern remote servers, `"stdio"` for local subprocesses |
| `command` | `string` | stdio | Executable to launch (`"bunx"`, `"docker"`, `"python"`, absolute path, etc.) |
| `args` | `string[]` | stdio | Arguments passed to `command`. Includes package names, flags, Docker image, etc. |
| `env` | `Record<string, string>` | stdio | Extra env vars merged on top of the parent process environment. Use for per-server secrets |
| `cwd` | `string` | stdio | Working directory for the subprocess. Defaults to parent process `cwd` |
| `endpoint` | `string` | streamable-http, sse, websocket | HTTP/WebSocket URL (`"https://mcp.example.com"`, `"ws://localhost:8000/mcp"`) |
| `headers` | `Record<string, string>` | streamable-http, sse | HTTP headers sent on every request. Use for `Authorization`, `x-api-key`, etc. |

**Examples:**

```typescript
// stdio: npm package via bunx
{ name: "filesystem", transport: "stdio", command: "bunx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "."] }

// stdio: with per-server secret
{ name: "github", transport: "stdio", command: "bunx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GH_TOKEN ?? "" } }

// stdio: Docker container with networking
{ name: "my-server", transport: "stdio", command: "docker",
  args: ["run", "-i", "--rm", "--network", "host", "ghcr.io/org/mcp-server"] }

// streamable-http: modern cloud server with Bearer auth
{ name: "stripe", transport: "streamable-http",
  endpoint: "https://mcp.stripe.com",
  headers: { Authorization: `Bearer ${process.env.STRIPE_KEY}` } }

// sse: legacy remote server with API key
{ name: "legacy", transport: "sse",
  endpoint: "https://api.example.com/mcp",
  headers: { "x-api-key": process.env.API_KEY ?? "" } }
```

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

### `runOnce(input: string): Promise<AgentResult>`

Builds the agent, runs a single task, disposes all resources, and returns the result — in one call. Use this for one-shot scripts where you don't need to hold a reference to the agent.

```typescript
const result = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .runOnce("Summarize the README in one paragraph");

console.log(result.output);
// Resources are already cleaned up
```

## ReactiveAgent

The facade returned by `build()`.

### Resource Management

Agents that use MCP servers (stdio transport) or other subprocess-based resources **must be disposed** after use, otherwise the process will hang on open pipes. Three patterns are available:

#### Pattern 1 — `await using` (recommended)

Uses the [Explicit Resource Management](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html) protocol introduced in TypeScript 5.2. The agent is disposed automatically when the enclosing block exits, whether normally or via an exception.

```typescript
await using agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMCP({ name: "filesystem", transport: "stdio", command: "npx", args: ["@modelcontextprotocol/server-filesystem", "."] })
  .withReasoning()
  .build();

const result = await agent.run("List the project files.");
console.log(result.output);
// agent.dispose() is called automatically here
```

Requires `"lib": ["ES2022", "ESNext"]` or `"target": "ES2022"` in your `tsconfig.json`.

#### Pattern 2 — `runOnce()` (one-shot)

If you only need a single result and don't want to manage the agent handle at all, use the builder's `runOnce()` method. It builds, runs, and disposes in one call.

```typescript
const result = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMCP({ name: "filesystem", transport: "stdio", command: "npx", args: ["@modelcontextprotocol/server-filesystem", "."] })
  .withReasoning()
  .runOnce("List the project files.");

console.log(result.output);
// Resources already cleaned up
```

#### Pattern 3 — `dispose()` (explicit)

Call `dispose()` manually in a `finally` block when you need to reuse the agent across multiple calls before cleaning up.

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .build();

try {
  const r1 = await agent.run("First task");
  const r2 = await agent.run("Second task");
  console.log(r1.output, r2.output);
} finally {
  await agent.dispose();
}
```

| Pattern | When to use |
|---------|-------------|
| `await using` | General purpose — automatic cleanup, works with `try/catch` |
| `runOnce()` | Single-shot scripts and one-liners |
| `dispose()` | Multiple sequential runs before teardown |

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
| `GatewayStarted` | `agentId`, `timestamp` |
| `GatewayStopped` | `agentId`, `reason` |
| `GatewayEventReceived` | `agentId`, `eventId`, `source`, `category` |
| `ProactiveActionInitiated` | `agentId`, `eventId`, `action` |
| `ProactiveActionCompleted` | `agentId`, `eventId`, `success`, `durationMs` |
| `ProactiveActionSuppressed` | `agentId`, `eventId`, `reason` |
| `PolicyDecisionMade` | `agentId`, `eventId`, `action`, `policyTag` |
| `HeartbeatSkipped` | `agentId`, `consecutiveSkips`, `reason` |
| `EventsMerged` | `agentId`, `mergedCount`, `mergeKey` |
| `BudgetExhausted` | `agentId`, `tokensUsed`, `dailyBudget` |

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

// await using — agent is disposed automatically when this block exits
await using agent = await ReactiveAgents.create()
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
// agent.dispose() is called automatically here
```
