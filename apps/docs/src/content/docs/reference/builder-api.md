---
title: ReactiveAgentBuilder
description: Complete API reference for the ReactiveAgentBuilder.
---

The `ReactiveAgentBuilder` is the primary entry point for creating agents. It provides a fluent API for composing capabilities.

:::tip[Guided stacks]
For copy-paste **recipe chains** (minimal LLM, ReAct + tools, memory, streaming, serialization), see [Common builder stacks](/cookbook/builder-stacks/). For defaults and env vars in one table, see [Configuration](/reference/configuration/).
:::

## `ReactiveAgents` factory

| API | Description |
| --- | ----------- |
| `ReactiveAgents.create()` | New empty builder (defaults: `name: "agent"`, `provider: "test"`). |
| `ReactiveAgents.fromConfig(config)` | Async — rebuild a builder from an `AgentConfig` object (`agentConfigToBuilder`). |
| `ReactiveAgents.fromJSON(json)` | Async — parse JSON → validate → same as `fromConfig`. |

```typescript
import { ReactiveAgents } from "reactive-agents";
// or: import { ReactiveAgents } from "@reactive-agents/runtime";

const builder = ReactiveAgents.create();
```

### Agent as Data (`toConfig` / serialization)

On a configured builder:

- **`toConfig()`** → `AgentConfig` (plain object, JSON-serializable except documented exceptions).
- Use **`agentConfigToJSON`** / **`agentConfigFromJSON`** from **`reactive-agents`** or **`@reactive-agents/runtime`** for string round-trips.

## Builder methods

All chain methods return `this` unless noted.

### Identity & prompts

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withName` | `(name: string) => this` | Display name / `agentId` basis |
| `withPersona` | `(persona: AgentPersona) => this` | Structured steering: `{ name?, role?, background?, instructions?, tone? }` |
| `withSystemPrompt` | `(prompt: string) => this` | Custom system prompt; if persona is set, persona text is prepended |
| `withEnvironment` | `(context: Record<string, string>) => this` | Extra key/value context merged into the system prompt (framework already injects date/time/tz/platform) |

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
| `withMemory` | `(options?: MemoryOptions \| "1" \| "2") => this` | Enable memory. Prefer `.withMemory()` or `.withMemory({ tier: "enhanced", ... })`. Strings `"1"` / `"2"` still work with a deprecation warning (`"1"` → standard, `"2"` → enhanced) |

#### MemoryOptions

| Field | Type | Default / notes |
| ----- | ---- | ---------------- |
| `tier` | `"standard" \| "enhanced"` | `"standard"` — enhanced = 4-layer memory + embeddings |
| `dbPath` | `string` | SQLite path (default under `.reactive-agents/memory/{agentId}/`) |
| `maxEntries` | `number` | Compaction cap |
| `capacity` | `number` | Working memory slots (default `7`) |
| `evictionPolicy` | `"fifo" \| "lru" \| "importance"` | Working set eviction |
| `retainDays` | `number` | Episodic retention |
| `importanceThreshold` | `number` | Semantic inclusion threshold |

### Execution

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withMaxIterations` | `(n: number) => this` | Max agent loop iterations (default: 10) |
| `withMinIterations` | `(n: number) => this` | Minimum iterations before `final-answer` is permitted — prevents fast-path exit on complex tasks |
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

### Optional features

| Method | Description |
| ------ | ----------- |
| `withGuardrails(options?)` | Toggle detectors: `{ injection?, pii?, toxicity?, customBlocklist? }`. All default **on** when guardrails are enabled. |
| `withKillSwitch()` | Pause / resume / stop / terminate via `KillSwitchService` |
| `withBehavioralContracts(contract)` | Rules such as `deniedTools`, `allowedTools`, `maxIterations`, etc. |
| `withVerification(options?)` | Post-output checks — toggles and thresholds: `semanticEntropy`, `factDecomposition`, `multiSource`, `hallucinationDetection`, `passThreshold`, … |
| `withCostTracking(options?)` | Budgets in USD: `{ perRequest?, perSession?, daily?, monthly? }` plus cost estimation / routing |
| `withModelPricing(registry)` | Per-model $/1M tokens: `{ "model-id": { input, output } }` |
| `withDynamicPricing(provider)` | Remote pricing (`openRouterPricingProvider`, etc.) fetched at build time |
| `withCircuitBreaker(config?)` | LLM call circuit breaker (`@reactive-agents/llm-provider` `CircuitBreakerConfig`) |
| `withRateLimiting(config?)` | Throttle LLM requests (`requestsPerMinute`, `tokensPerMinute`, concurrency, …) |
| `withReasoning(options?)` | Strategies + ICS — see [ReasoningOptions](#reasoningoptions) |
| `withTools(options?)` | Tool layer — see [ToolsOptions](#toolsoptions) below |
| `withDocuments(docs)` | Chunk + index `DocumentSpec[]` for RAG (`rag-search`). Enables tools if needed |
| `withRequiredTools(config)` | Tools that must run before success — `{ tools?, adaptive?, maxRetries? }`. When `adaptive: true`, the framework also auto-sets a per-tool call budget of 3 for search-type tools to prevent infinite research loops. |
| `withIdentity()` | Ed25519 identity + RBAC |
| `withObservability(options?)` | Metrics dashboard, tracing, verbosity. Options: `verbosity` (`"minimal"\|"normal"\|"verbose"\|"debug"`), `live` (stream phase events), `file` (JSONL path), `logPrefix`, `logModelIO` (when `true` or when `verbosity: "debug"`, logs the complete FC conversation thread with role labels `[USER]`/`[ASSISTANT]`/`[TOOL]` and raw LLM response for every iteration — essential for debugging prompt issues) |
| `withStreaming(options?)` | Default density for `agent.runStream()`: `{ density?: "tokens" \| "full" }` |
| `withTelemetry(config?)` | Opt-in run telemetry / privacy modes (`@reactive-agents/observability` `TelemetryConfig`; default mode `isolated` if omitted) |
| `withInteraction()` | Collaboration / approval flows |
| `withPrompts(options?)` | `{ templates?: PromptTemplate[] }` |
| `withOrchestration()` | Multi-agent workflows |
| `withExperienceLearning()` | `ExperienceStore` cross-agent tips |
| `withMemoryConsolidation(config?)` | Background consolidation: `{ threshold?, decayFactor?, pruneThreshold? }` |
| `withSelfImprovement()` | Strategy outcome logging for later bootstrap hints |
| `withAudit()` | Audit trail |
| `withEvents()` | Ensures EventBus wiring for `agent.subscribe()` |
| `withGateway(options?)` | Heartbeats, crons, webhooks, policies, `port`, `channels`, … |
| `withErrorHandler(handler)` | Observe-only callback on `agent.run()` failures — does not swallow errors |
| `withFallbacks(config)` | `{ providers?, models?, errorThreshold? }` fallback chain |
| `withLogging(config)` | `makeLoggerService` — `{ level?, format?, output?: "console" \| "file" \| WritableStream, filePath?, maxFileSizeBytes?, maxFiles? }` |
| `withHealthCheck()` | Enables `agent.health()` |
| `withVerificationStep(config?)` | After the initial answer, run a mandatory LLM self-review pass. `{ mode: "reflect" }` (default) makes one extra LLM call; `"loop"` re-enters the ReAct loop (planned V1.1). Optional `prompt` override |
| `withOutputValidator(fn, options?)` | Validate the final output before accepting it. `fn(output) => { valid, feedback? }`. On failure the feedback is injected and the agent retries up to `options.maxRetries` (default 2) |
| `withCustomTermination(fn)` | Re-run reasoning until `fn({ output }) === true`, up to 3 additional times. Useful for domain-specific completion criteria |
| `withTaskContext(record)` | Inject background key-value data into the reasoning memory context (facts, project state — distinct from `systemPrompt` instructions) |
| `withProgressCheckpoint(every, options?)` | Store resumption config every N iterations. `{ autoResume? }`. PlanStore write integration is V1.1; session resumption already surfaces incomplete plans |
| `withReactiveIntelligence(false)` | Disable the Reactive Intelligence layer (enabled by default). |
| `withReactiveIntelligence(options?)` | Entropy, controller, telemetry, hooks (`onEntropyScored`, `onControllerDecision`, …), `constraints`, `autonomy`. See [Reactive Intelligence](/features/reactive-intelligence/) |
| `withSkills(config?)` | `{ paths?, packages?, evolution?: { mode?, refinementThreshold?, rollbackOnRegression? }, overrides? }` |
| `withMetaTools(config?)` | Conductor meta-tools; pass **`false`** to turn off defaults when using `.withTools()`. See [MetaToolsConfig](#metatoolsconfig) |

#### ToolsOptions

| Field | Description |
| ----- | ----------- |
| `tools` | `{ definition: ToolDefinition, handler: (args) => Effect.Effect<unknown> }[]` — custom tools (handlers return **Effect**) |
| `resultCompression` | `ResultCompressionConfig` — previews, overflow keys, transforms |
| `allowedTools` | If set, only these tool names are exposed to the model (others filtered) |
| `adaptive` | Adaptive tool listing from task text (heuristic), reduces noise for small models |

#### MetaToolsConfig

| Field | Description |
| ----- | ----------- |
| `brief`, `find`, `pulse`, `recall` | Enable each Conductor meta-tool |
| `harnessSkill` | `boolean`, path string, or `{ frontier?, local? }` for harness skill source |
| `findConfig`, `pulseConfig`, `recallConfig` | Fine-tuning (scopes, previews, LLM pulse behavior, …) |

#### ReasoningOptions

```typescript
interface ReasoningOptions {
  /**
   * Which strategy to use. Defaults to "reactive".
   * "adaptive" requires adaptive.enabled: true.
   */
  defaultStrategy?: "reactive" | "reflexion" | "plan-execute-reflect" | "tree-of-thought" | "adaptive";

  /**
   * Per-strategy overrides (iterations, temperatures, plan knobs, etc.).
   * Each bundle may also set ICS fields (`synthesis`, `synthesisModel`, `synthesisProvider`,
   * `synthesisStrategy`, `synthesisTemperature`) — they override the top-level synthesis
   * options for that strategy only (see Intelligent Context Synthesis).
   */
  strategies?: Partial<{
    reactive: ReasoningConfig["strategies"]["reactive"] & StrategySynthesisFields;
    planExecute: ReasoningConfig["strategies"]["planExecute"] & StrategySynthesisFields;
    treeOfThought: ReasoningConfig["strategies"]["treeOfThought"] & StrategySynthesisFields;
    reflexion: ReasoningConfig["strategies"]["reflexion"] & StrategySynthesisFields;
  }>;

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

  /** ICS default mode: auto (heuristic), fast (templates), deep (LLM), custom, or off. */
  synthesis?: "auto" | "fast" | "deep" | "custom" | "off";
  /** Model for deep synthesis when different from the executing model. */
  synthesisModel?: string;
  /** Provider for the synthesis model when different from the executing provider. */
  synthesisProvider?: string;
  /** Custom synthesis pipeline when `synthesis: "custom"`. */
  synthesisStrategy?: SynthesisStrategy;
  /** Temperature for deep synthesis LLM calls. */
  synthesisTemperature?: number;
}

/** ICS-only fields allowed on each `strategies.*` bundle (merged with top-level synthesis). */
interface StrategySynthesisFields {
  synthesis?: "auto" | "fast" | "deep" | "custom" | "off";
  synthesisModel?: string;
  synthesisProvider?: string;
  synthesisStrategy?: SynthesisStrategy;
  synthesisTemperature?: number;
}
```

Per-strategy objects under `strategies` also accept strategy-specific fields from `@reactive-agents/reasoning` (for example `kernelMaxIterations` on the `reflexion` bundle).

At runtime, `ReasoningOptions` may also include a non-JSON `synthesisStrategy` function when using `synthesis: "custom"` (omitted from `toConfig()` / JSON).

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

// ICS: fast templates globally, but deep LLM synthesis when running ReAct
.withReasoning({
  synthesis: "fast",
  strategies: { reactive: { synthesis: "deep", synthesisModel: "claude-3-5-haiku-20241022" } },
})
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

### A2A protocol

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withA2A` | `(options?: A2AOptions) => this` | A2A JSON-RPC server — `port` (default `3000`), `basePath` (default `/`) |
| `withAgentTool` | `(name: string, agent: { name: string; description?: string; provider?: string; model?: string; tools?: string[]; maxIterations?: number; systemPrompt?: string; persona?: AgentPersona }) => this` | Static sub-agent as a tool |
| `withDynamicSubAgents` | `(options?: { maxIterations?: number }) => this` | `spawn-agent` for runtime sub-agents |
| `withRemoteAgent` | `(name: string, remoteUrl: string) => this` | Remote A2A agent as a tool |

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

Use the exported `LifecycleHook` type from `@reactive-agents/runtime`. Handlers return **`Effect.Effect<ExecutionContext, ExecutionError>`** (import `Effect` from `"effect"`).

`LifecyclePhase` values include: `bootstrap`, `guardrail`, `cost-route`, `strategy-select`, `think`, `act`, `observe`, `verify`, `memory-flush`, `cost-track`, `audit`, `complete`.

### Testing

| Method | Signature | Description |
| ------ | --------- | ----------- |
| `withTestScenario` | `(turns: TestTurn[]) => this` | Deterministic **test** provider. Forces `provider: "test"`. Turns are `TestTurn` values from `@reactive-agents/llm-provider`: `{ text? }`, `{ toolCall? }`, `{ toolCalls? }`, `{ json? }`, `{ error? }`, optional `match?` (regex) per turn |

See [Testing agents](/cookbook/testing-agents/) and [Configuration](/reference/configuration/) for examples.

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

### `runStream(input, options?): AsyncGenerator<AgentStreamEvent>`

Token and phase streaming. Options: `{ density?: "tokens" | "full", signal?: AbortSignal }`. Default density comes from `.withStreaming()` or `"tokens"`. Ends with `StreamCompleted`, `StreamError`, or `StreamCancelled`.

### `runEffect(input: string): Effect.Effect<AgentResult, Error>`

Run a task as an Effect for composition (see [Effect-TS primer](/concepts/effect-ts/)).

### Dynamic tools & RAG (runtime)

| Method | Description |
| ------ | ----------- |
| `registerTool(definition, handler)` | Register a tool after build; `handler` returns `Effect` |
| `unregisterTool(name)` | Remove a previously registered custom tool |
| `ingest(content, { source, format?, ... })` | Ingest text into RAG when tools / `withDocuments` enabled |

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
import { Effect } from "effect";
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
  .withMemory()
  .withReasoning({ defaultStrategy: "adaptive", adaptive: { enabled: true } })
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
