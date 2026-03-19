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
| `withStrictValidation` | `() => this` | Throw at build time if required config is missing (provider, model, etc.) |
| `withTimeout` | `(ms: number) => this` | Execution timeout in milliseconds. Throws `TimeoutError` if exceeded |
| `withRetryPolicy` | `(policy: RetryPolicy) => this` | Retry on transient LLM failures. `{ maxRetries: number, backoffMs: number }` |
| `withCacheTimeout` | `(ms: number) => this` | Semantic cache TTL in milliseconds. Entries older than this are evicted |

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
| `withGuardrails(thresholds?)` | Injection, PII, toxicity detection on input. Pass consolidated `{ injectionThreshold?, piiThreshold?, toxicityThreshold? }` to customize detection sensitivity. Old separate-param form is deprecated |
| `withKillSwitch()` | Per-agent and global emergency halt capability via `KillSwitchService` |
| `withBehavioralContracts(contract)` | Enforce typed behavioral boundaries: `deniedTools`, `allowedTools`, `maxIterations`. Throws `BehavioralContractError` on violation |
| `withVerification()` | Semantic entropy, fact decomposition, and multi-source (LLM + Tavily) on output |
| `withCostTracking()` | Budget enforcement (persisted to SQLite), complexity routing (27 signals), semantic caching |
| `withModelPricing(registry)` | Set programmatic pricing overrides for specific models manually. Example: `{ "gpt-4o": { input: 5.0, output: 15.0 } }` |
| `withDynamicPricing(provider)` | Fetch remote pricing at instantiation. Supports `openRouterPricingProvider` or custom JSON endpoints |
| `withReasoning(options?)` | Structured reasoning (ReAct, Reflexion, Plan-Execute, ToT, Adaptive). See [ReasoningOptions](#reasoningoptions) below |
| `withTools(options?)` | Tool registry with sandboxed execution (subprocess isolation via `Bun.spawn`, Docker sandbox). Options: `{ tools?: [{ definition, handler }], resultCompression?: ResultCompressionConfig }`. See [Tool Result Compression](/guides/tools/#tool-result-compression) |
| `withRequiredTools(config)` | Ensure agent calls critical tools before producing a final answer. Config: `{ tools?: string[], adaptive?: boolean, maxRetries?: number }` |
| `withIdentity()` | Agent certificates (real Ed25519 keys) and RBAC |
| `withObservability(options?)` | Distributed tracing, metrics, OTLP export, structured logging. Options: `{ verbosity?: "minimal" \| "normal" \| "verbose" \| "debug", live?: boolean, file?: string }` |
| `withInteraction()` | 5 interaction modes with adaptive transitions |
| `withPrompts(options?)` | Version-controlled prompt template engine. Options: `{ templates?: PromptTemplate[] }` |
| `withOrchestration()` | Multi-agent workflow coordination |
| `withExperienceLearning()` | Enable cross-agent experience learning via `ExperienceStore`. Records tool patterns and error recoveries per task type; injects relevant tips at bootstrap. |
| `withMemoryConsolidation(config?)` | Enable background memory consolidation via `MemoryConsolidatorService`. Decays unused episodic entries, replays recent history. Config: `{ threshold?: number, decayFactor?: number, pruneThreshold?: number }` |
| `withSelfImprovement()` | Cross-task self-improvement: logs `StrategyOutcome` per task and retrieves relevant past outcomes at bootstrap to guide strategy selection |
| `withAudit()` | Compliance audit trail logging |
| `withEvents()` | Enable typed EventBus subscriptions via `agent.subscribe()` |
| `withGateway(options?)` | Persistent autonomous gateway: adaptive heartbeats, cron scheduling, webhook ingestion, policy engine. Options: `{ heartbeat?: HeartbeatConfig, crons?: CronEntry[], webhooks?: WebhookConfig[], policies?: PolicyConfig }` |
| `withErrorHandler(handler)` | Register a global error callback for logging/monitoring. `(err: AgentError, ctx: ErrorContext) => void`. For observation only — does not swallow or transform errors |
| `withFallbacks(config)` | Provider/model fallback chain via `FallbackChain`. Config: `{ providers?: string[], models?: string[], errorThreshold?: number }`. On consecutive failures ≥ `errorThreshold`, the agent transparently retries with the next provider/model |
| `withLogging(config)` | Structured logging via `makeLoggerService()`. Config: `{ level?: "debug" \| "info" \| "warn" \| "error", format?: "json" \| "text", output?: "console" \| "file", filePath?: string, maxFileSizeMb?: number, maxFiles?: number }` |
| `withHealthCheck()` | Enable `agent.health()` which returns `{ status: "healthy" \| "degraded" \| "unhealthy", checks: HealthCheck[] }`. Each check reports on a specific subsystem (LLM, memory, tools, etc.) |
| `withReactiveIntelligence(config?)` | Entropy sensing, reactive controller, local learning, and telemetry. Config: `{ entropy?: { enabled?, tokenEntropy?, semanticEntropy? }, controller?: { earlyStop?, contextCompression?, strategySwitch? }, telemetry?: boolean }`. See [Reactive Intelligence](/features/reactive-intelligence/) |

#### ReasoningOptions

```typescript
interface ReasoningOptions {
  /**
   * Which strategy to use. Defaults to "react".
   * "adaptive" requires adaptive.enabled: true.
   */
  defaultStrategy?: "react" | "reflexion" | "plan-execute-reflect" | "tree-of-thought" | "adaptive";

  /** Per-strategy overrides (e.g., custom prompts or tuning). Rarely needed. */
  strategies?: Partial<ReasoningConfig["strategies"]>;

  /** Adaptive strategy config. Must set enabled: true when defaultStrategy is "adaptive". */
  adaptive?: {
    enabled?: boolean;   // Required for adaptive strategy
    learning?: boolean;  // Enable cross-run learning (default: false)
  };

  /** Max iterations of the reasoning loop (default: 10). */
  maxIterations?: number;

  /**
   * Automatically switch to a better-suited strategy when the current one appears stuck
   * (repeated tool calls, repeated thoughts, or consecutive think-only steps).
   * Default: false.
   */
  enableStrategySwitching?: boolean;

  /**
   * Maximum number of strategy switches allowed in a single run.
   * Default: 1.
   */
  maxStrategySwitches?: number;

  /**
   * When set, bypasses the LLM evaluator and always switches to this strategy on loop
   * detection. Useful when you want deterministic switching without the extra LLM call.
   * Example: "plan-execute-reflect"
   */
  fallbackStrategy?: string;
}
```

**Examples:**

```typescript
// Default: ReAct with no options
.withReasoning()

// Switch to Plan-Execute-Reflect strategy
.withReasoning({ defaultStrategy: "plan-execute-reflect" })

// Adaptive strategy (must set adaptive.enabled)
.withReasoning({ defaultStrategy: "adaptive", adaptive: { enabled: true } })

// Auto-switch when stuck, up to 2 times, via LLM evaluator
.withReasoning({ enableStrategySwitching: true, maxStrategySwitches: 2 })

// Auto-switch deterministically (no extra LLM call) to plan-execute-reflect
.withReasoning({ enableStrategySwitching: true, fallbackStrategy: "plan-execute-reflect" })
```

When `enableStrategySwitching` is active, two EventBus events are emitted around each switch:
- `StrategySwitchEvaluated` — after the evaluator runs, before the switch (includes `willSwitch`, `rationale`, `recommendedStrategy`)
- `StrategySwitched` — after the new strategy takes over (includes `fromStrategy`, `toStrategy`, `switchNumber`, `stepsCarriedOver`)

See [Automatic Strategy Switching](/guides/choosing-strategies/#automatic-strategy-switching) for full details on loop detection triggers, handoff context, and EventBus subscription examples.

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
| `withTestScenario` | `(steps: TestScenarioStep[]) => this` | Set a deterministic test scenario (auto-sets `"test"` provider). Each step: `{ match?: string, text: string }` |

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

### `chat(message: string, options?: ChatOptions): Promise<ChatReply>`

Conversational Q&A with the agent. Routes automatically:
- **Direct LLM path** — for questions, summaries, and status checks (fast, no tools)
- **ReAct loop path** — for tool-capable requests (search, fetch, write, create, etc.)

Injects context from the last run's debrief so the agent can answer "what did you do last time?" accurately.

```typescript
const reply = await agent.chat("What did you accomplish last run?");
console.log(reply.message);

// Force tool-capable path
const reply2 = await agent.chat("Search for the latest AI news", { useTools: true });
console.log(reply2.toolsUsed); // ["web-search"]
```

```typescript
interface ChatReply {
  message: string;
  toolsUsed?: string[];   // Set when tools were invoked
  fromMemory?: boolean;   // Set when answered from debrief context
}

interface ChatOptions {
  useTools?: boolean;     // Override auto-routing
  maxIterations?: number; // Cap for tool-capable path (default: 5)
}
```

### `session(options?: SessionOptions): AgentSession`

Start a multi-turn conversation session with auto-managed history. Conversation history is forwarded to the LLM on every subsequent turn.

Pass `{ persist: true, id: "my-session" }` to persist conversation history to SQLite via `SessionStoreService`. Persistent sessions survive process restarts and can be resumed by passing the same `id`.

```typescript
// In-memory session (default)
const session = agent.session();

const r1 = await session.chat("What are the key findings from your last run?");
const r2 = await session.chat("Tell me more about the first finding");
// r2 has full context of r1

// Persisted session — survives process restarts
const persistedSession = agent.session({ persist: true, id: "research-session-1" });
await persistedSession.chat("Start researching quantum computing");
// On next run, restore the session:
const restoredSession = agent.session({ persist: true, id: "research-session-1" });
await restoredSession.chat("Continue where we left off");

const history = session.history(); // ChatMessage[]
await session.end();               // Clears history (and DB record if persisted)
```

```typescript
interface SessionOptions {
  persist?: boolean;   // Persist history to SQLite via SessionStoreService
  id?: string;         // Session ID for persistence (auto-generated if omitted)
}

interface AgentSession {
  chat(message: string): Promise<ChatReply>;
  history(): ChatMessage[];
  end(): Promise<void>;
}
```

### `health(): Promise<HealthResult>`

Requires `.withHealthCheck()` to be enabled.

Returns a structured health snapshot of all agent subsystems. Use for readiness probes, liveness checks, and monitoring dashboards.

```typescript
const health = await agent.health();
console.log(health.status);  // "healthy" | "degraded" | "unhealthy"

for (const check of health.checks) {
  console.log(`${check.name}: ${check.status} — ${check.message}`);
}
```

```typescript
interface HealthResult {
  status: "healthy" | "degraded" | "unhealthy";
  checks: Array<{
    name: string;
    status: "pass" | "warn" | "fail";
    message?: string;
    durationMs?: number;
  }>;
}
```

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
| `StrategySwitchEvaluated` | `taskId`, `fromStrategy`, `recommendedStrategy`, `rationale`, `willSwitch` |
| `StrategySwitched` | `taskId`, `fromStrategy`, `toStrategy`, `switchNumber`, `stepsCarriedOver` |

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
    confidence?: "high" | "medium" | "low";  // From final-answer tool
  };

  // Enriched fields (present when reasoning is enabled)
  format?: "text" | "json" | "markdown" | "csv" | "html"; // Output format declared by agent
  terminatedBy?: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn";

  // Debrief (present when .withMemory() + .withReasoning() are enabled)
  debrief?: AgentDebrief;
}
```

### `AgentDebrief`

A structured post-run synthesis produced automatically when memory is enabled:

```typescript
interface AgentDebrief {
  outcome: "success" | "partial" | "failed";
  summary: string;                    // 2-3 sentence narrative
  keyFindings: string[];
  errorsEncountered: string[];
  lessonsLearned: string[];           // Auto-fed to ExperienceStore
  confidence: "high" | "medium" | "low";
  caveats?: string;
  toolsUsed: { name: string; calls: number; successRate: number }[];
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
  markdown: string;                   // Pre-rendered Markdown version
}
```

Access it from any run result:

```typescript
const result = await agent.run("Fetch the latest commits and summarize");
if (result.debrief) {
  console.log(result.debrief.summary);
  console.log(result.debrief.markdown);
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
