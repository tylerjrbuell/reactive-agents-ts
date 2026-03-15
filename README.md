<div align="center">

<img src="./assets/logo.png" alt="Reactive Agents" width="280" />

# Reactive Agents — TypeScript AI Agent Framework

**The open-source agent framework built for control, not magic.**

Every decision controllable, observable, and auditable. 22 packages. 13 composable layers. 5 reasoning strategies. 6 LLM providers. Model-adaptive context profiles. 10-phase execution engine with lifecycle hooks. 2,091 tests across 274 files. Built on Effect-TS for type safety from prompt to production.

[![CI](https://github.com/tylerjrbuell/reactive-agents-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/tylerjrbuell/reactive-agents-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/badge/npm-%40reactive--agents-CB3837?logo=npm)](https://www.npmjs.com/org/reactive-agents)
[![npm downloads](https://img.shields.io/npm/dm/reactive-agents?logo=npm)](https://www.npmjs.com/package/reactive-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Effect-TS](https://img.shields.io/badge/Effect--TS-3.x-7C3AED)](https://effect.website)
[![Bun](https://img.shields.io/badge/Bun-compatible-FBF0DF?logo=bun&logoColor=000000)](https://bun.sh)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/tylerjrbuell/reactive-agents-ts/pulls)

[Documentation](https://docs.reactiveagents.dev/) · [Discord](https://discord.gg/498xEG5A) · [Quick Start](#quick-start) · [Features](#features) · [Comparison](#comparison) · [Architecture](#architecture) · [Packages](#packages)

</div>

---

## Why Reactive Agents?

Most AI agent frameworks are dynamically typed, monolithic, and opaque. They assume you're using GPT-4, break when you try smaller models, and hide every decision behind abstractions you can't inspect. **Reactive Agents** takes a fundamentally different approach:

| Problem                        | How We Solve It                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| **No type safety**             | Effect-TS schemas validate every service boundary at compile time                   |
| **Monolithic**                 | 13 independent layers -- enable only what you need                                  |
| **Opaque decisions**           | 10-phase execution engine with before/after/error hooks on every phase              |
| **Model lock-in**              | Model-adaptive context profiles (4 tiers: local, mid, large, frontier) help smaller models punch above their weight |
| **Single reasoning mode**      | 5 strategies (ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive)            |
| **Unsafe by default**          | Guardrails block injection/PII/toxicity before the LLM sees input                   |
| **No cost control**            | Complexity router picks the cheapest capable model; budget enforcement at 4 levels  |
| **Poor DX**                    | Builder API chains capabilities in one place; great frameworks disappear, ours feels like superpowers |

## Features

- **5 reasoning strategies** + adaptive meta-strategy (ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive)
- **6 LLM providers** -- Anthropic, OpenAI, Google Gemini, Ollama (local), LiteLLM (40+ models), Test (deterministic)
- **Model-adaptive context profiles** -- 4 tiers (local, mid, large, frontier) with tier-aware prompts, compaction, and truncation
- **4-layer memory** -- working, episodic, semantic (vector + FTS5), procedural (bun:sqlite); ExperienceStore for cross-agent learning; background consolidation + decay
- **Real-time token streaming** + SSE via `agent.runStream()` with AbortSignal cancellation, `IterationProgress` + `StreamCancelled` events, and `StreamCompleted.toolSummary`
- **Persistent autonomous gateway** -- adaptive heartbeats, cron scheduling, webhook ingestion (GitHub adapter), composable policy engine
- **Agent debrief + conversational chat** -- `agent.chat()` and `agent.session()` (with optional SQLite persistence via `SessionStoreService`) for adaptive Q&A; post-run `DebriefSynthesizer` produces structured summaries persisted to SQLite
- **A2A multi-agent protocol** -- Agent Cards, JSON-RPC 2.0 server/client, SSE streaming, agent-as-tool composition
- **Multi-agent orchestration** -- sequential, parallel, pipeline, and map-reduce workflows with dynamic sub-agent spawning
- **Production guardrails** -- injection detection, PII filtering, toxicity blocking, kill switch, behavioral contracts
- **Ed25519 identity** -- real cryptographic agent certificates, RBAC, delegation, and audit trails
- **Cost tracking** -- complexity routing across 27 signals, semantic caching, budget enforcement with persistence across restarts
- **Professional metrics dashboard** -- EventBus-driven execution timeline, tool call summary, smart alerts, and cost estimation (zero manual instrumentation)
- **Required tools guard** -- ensure agents call critical tools before answering (static list or adaptive LLM inference)
- **Builder hardening** -- `withStrictValidation()`, `withTimeout()`, `withRetryPolicy()`, `withCacheTimeout()`, consolidated `withGuardrails()` thresholds, `withErrorHandler()`, `withFallbacks()`, `withLogging()`, `withHealthCheck()`, automatic strategy switching
- **ToolBuilder fluent API** -- define tools without raw schema objects
- **Provider fallback chains** -- `FallbackChain` + `withFallbacks()` for graceful degradation across providers/models
- **Structured logging** -- `makeLoggerService()` with level filtering, JSON/text format, and file output with rotation via `withLogging()`
- **Health checks** -- `withHealthCheck()` + `agent.health()` returns `{ status, checks[] }`
- **Reactive intelligence** -- 5-source entropy sensor (token, structural, semantic, behavioral, context pressure), conformal calibration, trajectory classification, `.withReactiveIntelligence()` builder method
- **2,091 tests** across 274 files

## Quick Start

Install and run your first TypeScript AI agent in under 60 seconds.

```bash
bun add reactive-agents
```

> **Note:** `effect` is included as a dependency of `reactive-agents` and installed automatically. If you import from `effect` directly in your own code (e.g. `import { Effect } from "effect"`), add it to your project explicitly: `bun add effect`.

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .build();

const result = await agent.run("Explain quantum entanglement");
console.log(result.output);
console.log(result.metadata); // { duration, cost, tokensUsed, stepsCount }
```

### Add Capabilities

Every capability is opt-in. Chain what you need:

```typescript
const agent = await ReactiveAgents.create()
  .withName("research-agent")
  .withProvider("anthropic")
  .withReasoning()                                       // ReAct reasoning loop
  .withTools()                                           // Built-in tools + MCP support
  .withMemory("1")                                       // Persistent memory (FTS5 search)
  .withGuardrails()                                      // Block injection, PII, toxicity
  .withKillSwitch()                                      // Per-agent + global emergency halt
  .withBehavioralContracts({                             // Enforce tool whitelist + iteration cap
    deniedTools: ["file-write"],
    maxIterations: 10,
  })
  .withVerification()                                    // Fact-check outputs
  .withCostTracking()                                    // Budget enforcement + model routing
  .withObservability({ verbosity: "verbose", live: true }) // Live log streaming + tracing
  .withContextProfile({ tier: "local" })                 // Adaptive context for model tier
  .withIdentity()                                        // RBAC + agent certificates (Ed25519)
  .withInteraction()                                     // 5 autonomy modes
  .withOrchestration()                                   // Multi-agent workflows
  .withSelfImprovement()                                 // Cross-task strategy outcome learning
  .withRequiredTools({                                   // Ensure critical tools are called
    tools: ["web-search"],
    maxRetries: 2,
  })
  .withStrictValidation()                                // Throw at build time if required config is missing
  .withTimeout(60_000)                                   // Execution timeout (ms)
  .withRetryPolicy({ maxRetries: 3, backoffMs: 1_000 })       // Retry on transient LLM failures
  .withCacheTimeout(3_600_000)                           // Semantic cache TTL (ms)
  .withErrorHandler((err, ctx) => {                      // Global error callback
    console.error("Agent error:", err.message);
  })
  .withFallbacks({                                       // Provider/model fallback chain
    providers: ["anthropic", "openai"],
    errorThreshold: 3,
  })
  .withLogging({ level: "info", format: "json", filePath: "./agent.log" }) // Structured logging
  .withHealthCheck()                                     // Enable agent.health() probe
  .withGateway({                                         // Persistent autonomous harness
    heartbeat: { intervalMs: 1_800_000, policy: "adaptive" },
    crons: [{ schedule: "0 9 * * MON", instruction: "Weekly review" }],
    policies: { dailyTokenBudget: 50_000 },
  })
  .build();
```

### Conversational Chat

Use `agent.chat()` for single-turn Q&A or `agent.session()` for multi-turn conversations with adaptive routing -- direct LLM for simple questions, full ReAct loop for tool-capable queries:

```typescript
// Single-turn chat
const answer = await agent.chat("What's the status of the deployment?");

// Multi-turn session
const session = agent.session();
await session.send("Summarize yesterday's logs");
await session.send("Which errors were most frequent?");
```

### Streaming

Tokens arrive as they're generated via AsyncGenerator. Pass an `AbortSignal` to cancel mid-stream:

```typescript
const controller = new AbortController();

for await (const event of agent.runStream("Analyze this dataset", { signal: controller.signal })) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "IterationProgress") console.log(`Step ${event.iteration}/${event.maxIterations}`);
  if (event._tag === "StreamCancelled") console.log("Stream cancelled");
  if (event._tag === "StreamCompleted") {
    console.log("\nDone!");
    // event.toolSummary: Array<{ toolName, calls, successRate }>
  }
}

// Cancel from elsewhere (e.g., HTTP request abort)
controller.abort();
```

### Lifecycle Hooks

Intercept any of the 10 execution phases with before, after, or error hooks:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withHook({
    phase: "think",
    timing: "after",
    handler: (ctx) => {
      console.log(`Step ${ctx.metadata.stepsCount}: ${ctx.metadata.strategyUsed}`);
      return Effect.succeed(ctx);
    },
  })
  .withHook({
    phase: "act",
    timing: "after",
    handler: (ctx) => {
      const lastTool = ctx.scratchpad.get("_last_tool_name");
      if (lastTool) console.log(`Tool called: ${lastTool}`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

Available phases: `bootstrap`, `guardrail`, `cost-route`, `strategy`, `think`, `act`, `observe`, `verify`, `memory-flush`, `complete`. Each supports `before`, `after`, and `on-error` timing.

## Comparison

How Reactive Agents compares to other TypeScript agent frameworks on shipped, working features:

| Capability                    | Reactive Agents | LangChain JS | Vercel AI SDK | Mastra |
| ----------------------------- | :-------------: | :----------: | :-----------: | :----: |
| Full type safety (Effect-TS)  | Yes             | --           | Partial       | Partial |
| Composable layer architecture | 13 layers       | --           | --            | --     |
| Reasoning strategies          | 5 + adaptive    | 1 (ReAct)    | --            | 1      |
| Model-adaptive context        | 4 tiers         | --           | --            | --     |
| Local model optimization      | Yes             | --           | --            | --     |
| Execution lifecycle hooks     | 10 phases       | Callbacks    | Middleware     | --     |
| Multi-agent orchestration     | A2A + workflows | Yes          | --            | Yes    |
| Token streaming               | Yes             | Yes          | Yes           | Yes    |
| Production guardrails         | Yes             | --           | --            | --     |
| Cost tracking + budgets       | Yes             | --           | --            | --     |
| Persistent gateway            | Yes             | --           | --            | --     |
| Agent debrief + chat          | Yes             | --           | --            | --     |
| Metrics dashboard             | Yes             | LangSmith    | --            | --     |
| Test suite                    | 2,091 tests     | --           | --            | --     |

## Use Cases

- **Autonomous engineering agents** with tool execution and code generation
- **Research and reporting workflows** with verifiable reasoning steps
- **Scheduled background agents** using heartbeats, cron jobs, and webhooks
- **Secure enterprise copilots** with RBAC, audit trails, and policy controls
- **Hybrid local/cloud AI deployments** with adaptive context profiles
- **Multi-agent teams** with A2A protocol and dynamic sub-agent delegation

## Architecture

```
ReactiveAgentBuilder
  -> createRuntime()
    -> Core Services     EventBus, AgentService, TaskService
    -> LLM Provider      Anthropic, OpenAI, Gemini, Ollama, LiteLLM, Test
    -> Memory            Working, Semantic, Episodic, Procedural
    -> Reasoning         ReAct, Reflexion, Plan-Execute, ToT, Adaptive
    -> Tools             Registry, Sandbox, MCP Client
    -> Guardrails        Injection, PII, Toxicity, Kill Switch, Behavioral Contracts
    -> Verification      Semantic Entropy, Fact Decomposition, NLI
    -> Cost              Complexity Router, Budget Enforcer, Cache
    -> Identity          Certificates, RBAC, Delegation, Audit
    -> Observability     Tracing, Metrics, Structured Logging
    -> Interaction       5 Modes, Checkpoints, Preference Learning
    -> Orchestration     Sequential, Parallel, Pipeline, Map-Reduce
    -> Prompts           Template Engine, Version Control
    -> Gateway           Heartbeats, Crons, Webhooks, Policy Engine
    -> ExecutionEngine   10-phase lifecycle with hooks
```

Every layer is an Effect `Layer` -- composable, independently testable, and tree-shakeable.

## 10-Phase Execution Engine

Every task flows through a deterministic lifecycle. Each phase calls its corresponding service when enabled:

```
Bootstrap --> Guardrail --> Cost Route --> Strategy Select
                                              |
                                    +--------------------+
                                    | Think -> Act -> Observe | <-- loop
                                    +--------------------+
                                              |
Verify --> Memory Flush --> Cost Track --> Audit --> Complete
```

| Phase             | Service Called           | What It Does                                       |
| ----------------- | ------------------------ | -------------------------------------------------- |
| Bootstrap         | MemoryService            | Load context from semantic/episodic memory         |
| Guardrail         | GuardrailService         | Block unsafe input before LLM sees it              |
| Cost Route        | CostService              | Select optimal model tier by complexity            |
| Strategy Select   | ReasoningService         | Pick reasoning strategy (or direct LLM)            |
| Think/Act/Observe | LLMService + ToolService | Reasoning loop with real tool execution            |
| Verify            | VerificationService      | Fact-check output (entropy, decomposition, NLI)    |
| Memory Flush      | MemoryService            | Persist session + episodic memories                |
| Cost Track        | CostService              | Record spend against budget                        |
| Audit             | ObservabilityService     | Log audit trail (tokens, cost, strategy, duration) |
| Complete          | --                       | Build final result with metadata                   |

Every phase supports `before`, `after`, and `on-error` lifecycle hooks. When observability is enabled, every phase emits trace spans and metrics.

## 5 Reasoning Strategies

| Strategy            | How It Works                             | Best For                      |
| ------------------- | ---------------------------------------- | ----------------------------- |
| **ReAct**           | Think -> Act -> Observe loop             | Tool use, step-by-step tasks  |
| **Reflexion**       | Generate -> Critique -> Improve          | Quality-critical output       |
| **Plan-Execute**    | Plan steps -> Execute -> Reflect -> Refine | Structured multi-step work  |
| **Tree-of-Thought** | Branch -> Score -> Prune -> Synthesize   | Creative, open-ended problems |
| **Adaptive**        | Analyze task -> Auto-select best strategy | Mixed workloads              |

```typescript
// Auto-select the best strategy per task
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .build();

// Automatic strategy switching on loop detection
const agent2 = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({
    enableStrategySwitching: true,
    maxStrategySwitches: 1,
    fallbackStrategy: "plan-execute-reflect",
  })
  .build();
```

## Multi-Provider Support

| Provider          | Models                        | Tool Calling | Streaming |
| ----------------- | ----------------------------- | :----------: | :-------: |
| **Anthropic**     | Claude Haiku, Sonnet, Opus    |      Yes     |    Yes    |
| **OpenAI**        | GPT-4o, GPT-4o-mini           |      Yes     |    Yes    |
| **Google Gemini** | Gemini Flash, Pro             |      Yes     |    Yes    |
| **Ollama**        | Any local model               |      --      |    Yes    |
| **LiteLLM**       | 40+ models via LiteLLM proxy  |      Yes     |    Yes    |
| **Test**          | Mock (deterministic)          |      --      |    --     |

Switch providers with one line -- agent code stays the same.

## Model-Adaptive Context

Optimize prompt construction and context compaction for your model tier:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withReasoning()
  .withTools()
  .withContextProfile({ tier: "local" }) // Lean prompts, aggressive compaction
  .build();
```

| Tier         | Models                     | Context Strategy                                                       |
| ------------ | -------------------------- | ---------------------------------------------------------------------- |
| `"local"`    | Ollama small models (<=14b) | Lean prompts, aggressive compaction after 6 steps, 800-char truncation |
| `"mid"`      | Mid-range models            | Balanced prompts, moderate compaction                                  |
| `"large"`    | Anthropic, OpenAI, Gemini  | Full context, standard compaction                                      |
| `"frontier"` | Flagship models            | Maximum context, minimal compaction                                    |

## Packages

| Package                                                    | Description                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`@reactive-agents/core`](packages/core)                   | EventBus pub/sub, AgentService lifecycle, TaskService state machine, canonical types |
| [`@reactive-agents/runtime`](packages/runtime)             | 10-phase ExecutionEngine, ReactiveAgentBuilder, `createRuntime()` layer composer |
| [`@reactive-agents/llm-provider`](packages/llm-provider)   | Unified LLM interface for Anthropic, OpenAI, Gemini, Ollama, LiteLLM, and Test providers |
| [`@reactive-agents/memory`](packages/memory)               | 4-layer memory (working, semantic, episodic, procedural) on bun:sqlite; ExperienceStore cross-agent learning; background consolidation + decay |
| [`@reactive-agents/reasoning`](packages/reasoning)         | 5 strategies (ReAct, Reflexion, Plan-Execute, ToT, Adaptive) with composable kernel architecture |
| [`@reactive-agents/tools`](packages/tools)                 | Tool registry with sandboxed execution, MCP client, agent-as-tool adapter, dynamic sub-agent spawning |
| [`@reactive-agents/guardrails`](packages/guardrails)       | Pre-LLM safety: injection detection, PII filtering, toxicity blocking          |
| [`@reactive-agents/verification`](packages/verification)   | Post-LLM quality: semantic entropy, fact decomposition, NLI hallucination detection |
| [`@reactive-agents/cost`](packages/cost)                   | 27-signal complexity routing, per-execution budget enforcement, semantic cache   |
| [`@reactive-agents/identity`](packages/identity)           | Ed25519 agent certificates, RBAC policies, delegation chains, audit logging     |
| [`@reactive-agents/observability`](packages/observability) | Distributed tracing (OTLP), MetricsCollector, structured logging, console + JSON exporters |
| [`@reactive-agents/interaction`](packages/interaction)     | 5 autonomy modes, checkpoint/resume, approval gates, preference learning        |
| [`@reactive-agents/orchestration`](packages/orchestration) | Multi-agent workflows: sequential, parallel, pipeline, map-reduce with A2A support |
| [`@reactive-agents/prompts`](packages/prompts)             | Version-controlled template engine with variable interpolation and prompt library |
| [`@reactive-agents/eval`](packages/eval)                   | Evaluation framework: LLM-as-judge scoring, EvalStore persistence, comparison reports |
| [`@reactive-agents/a2a`](packages/a2a)                     | A2A protocol: Agent Cards, JSON-RPC 2.0 server/client, SSE streaming            |
| [`@reactive-agents/gateway`](packages/gateway)             | Persistent autonomous harness: adaptive heartbeats, cron scheduling, webhook ingestion, composable policy engine |
| [`@reactive-agents/testing`](packages/testing)             | Mock services (LLM, tools, EventBus), assertion helpers, deterministic test fixtures |
| [`@reactive-agents/benchmarks`](packages/benchmarks)       | Benchmark suite: 20 tasks x 5 tiers, overhead measurement, report generation    |
| [`@reactive-agents/health`](packages/health)               | Health checks and readiness probes for production deployments                    |
| [`@reactive-agents/reactive-intelligence`](packages/reactive-intelligence) | Metacognitive entropy sensor: 5 entropy sources, composite scoring, conformal calibration, trajectory classification |

## Observability & Metrics Dashboard

When observability is enabled, the agent displays a professional metrics dashboard after each execution:

```
+-------------------------------------------------------------+
| Agent Execution Summary                                      |
+-------------------------------------------------------------+
| Status:    Success      Duration: 13.9s   Steps: 7          |
| Tokens:    1,963        Cost: ~$0.003     Model: claude-3.5 |
+-------------------------------------------------------------+

Execution Timeline
|- [bootstrap]       100ms    ok
|- [think]        10,001ms    warn  (7 iter, 72% of time)
|- [act]           1,000ms    ok    (2 tools)
|- [complete]         28ms    ok

Tool Execution (2 called)
|- file-write    ok  3 calls, 450ms avg
|- web-search    ok  2 calls, 280ms avg
```

- Per-phase execution timing and bottleneck identification
- Tool call summary (success/error counts, average duration)
- Smart alerts and optimization tips
- Cost estimation in USD
- EventBus-driven collection (no manual instrumentation)

Enable with:

```typescript
.withObservability({ verbosity: "normal", live: true })
```

## CLI (`rax`)

```bash
rax init my-project --template full              # Scaffold a project
rax create agent researcher --recipe researcher   # Generate an agent from recipe
rax create agent my-agent --interactive           # Interactive scaffolding (readline prompts)
rax run "Explain quantum computing" --provider anthropic  # Run an agent
```

## Register Custom Tools

Tools are registered at build time or via `ToolService.register()`. Built-in tools (web search, file I/O, HTTP, code execution, scratchpad, spawn-agent) are available automatically when the relevant builder methods are enabled.

Use the `ToolBuilder` fluent API to define tools without raw schema objects:

```typescript
import { ReactiveAgents } from "reactive-agents";
import { ToolBuilder } from "@reactive-agents/tools";
import { Effect } from "effect";

const webSearchTool = ToolBuilder.create("web_search")
  .description("Search the web for current information")
  .param("query", "string", "Search query", { required: true })
  .riskLevel("low")
  .timeout(10_000)
  .handler((args) => Effect.succeed(`Results for: ${args.query}`))
  .build();

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools({ tools: [webSearchTool] })
  .build();
```

Or use raw schema objects directly:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools({
    tools: [
      {
        definition: {
          name: "web_search",
          description: "Search the web for current information",
          parameters: [
            { name: "query", type: "string", description: "Search query", required: true },
          ],
          riskLevel: "low",
          timeoutMs: 10_000,
          requiresApproval: false,
          source: "function",
        },
        handler: (args) => Effect.succeed(`Results for: ${args.query}`),
      },
    ],
  })
  .build();
```

### Dynamic Sub-Agent Spawning

Use `.withDynamicSubAgents()` to let the model spawn ad-hoc sub-agents at runtime without pre-configuring named agent tools. This registers the built-in `spawn-agent` tool, which the model can invoke freely:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withTools()
  .withDynamicSubAgents({ maxIterations: 5 })
  .build();
```

Sub-agents receive a clean context window, inherit the parent's provider and model by default, and are depth-limited to `MAX_RECURSION_DEPTH = 3`.

| Approach                         | When to use                                            |
| -------------------------------- | ------------------------------------------------------ |
| `.withAgentTool("name", config)` | Named, purpose-built sub-agent with a specific role    |
| `.withDynamicSubAgents()`        | Ad-hoc delegation at model's discretion, unknown tasks |

## Testing

Built-in test scenario support for deterministic, offline tests:

```typescript
const agent = await ReactiveAgents.create()
  .withTestScenario([
    { match: "capital of France", text: "Paris is the capital of France." },
  ])
  .build();

const result = await agent.run("What is the capital of France?");
// result.output -> "Paris is the capital of France."
```

The `@reactive-agents/testing` package includes streaming assertions and pre-built scenario fixtures:

```typescript
import { expectStream, createGuardrailBlockScenario, createBudgetExhaustedScenario } from "@reactive-agents/testing";

// Stream assertions
const stream = agent.runStream("Write a haiku");
await expectStream(stream)
  .toEmitTextDeltas()
  .toComplete()
  .toEmitEvents(["TextDelta", "StreamCompleted"]);

// Pre-built scenario fixtures
const scenario = createGuardrailBlockScenario(); // agent + prompt that triggers guardrail
const budget = createBudgetExhaustedScenario();  // agent + prompt that exhausts budget
const maxIter = createMaxIterationsScenario();   // agent + prompt that hits max iterations
```

## FAQ

### Which models and providers are supported?

Reactive Agents supports 6 providers: Anthropic, OpenAI, Google Gemini, Ollama (local models), LiteLLM (40+ models via proxy), and a Test provider for deterministic offline testing via `withTestScenario()`.

### Is this framework production-ready?

Yes -- it includes guardrails, budget controls, auditability, observability, Ed25519 identity, and composable service layers for testable deployments. 2,091 tests across 274 files.

### Can I run fully local agents?

Yes -- use Ollama with local models plus context profiles tuned for local inference. The `"local"` tier optimizes prompts and compaction for small models (<=14b parameters).

### How does this compare to LangChain or Vercel AI SDK?

See the [comparison table](#comparison). The key differences are: full Effect-TS type safety, 13 composable layers instead of a monolithic runtime, 5 reasoning strategies with adaptive selection, and model-adaptive context profiles that help local models perform far beyond naive prompting.

## Development

```bash
bun install              # Install dependencies
bun test                 # Run full test suite (2,091 tests, 274 files)
bun run build            # Build all packages (22 packages, ESM + DTS)
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...          # Anthropic Claude
OPENAI_API_KEY=sk-...                 # OpenAI GPT-4o
GOOGLE_API_KEY=...                    # Google Gemini
EMBEDDING_PROVIDER=openai             # For vector memory
EMBEDDING_MODEL=text-embedding-3-small
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
```

## Documentation

Full documentation at **[docs.reactiveagents.dev](https://docs.reactiveagents.dev/)**

- [Getting Started](https://docs.reactiveagents.dev/guides/quickstart/) -- Build an agent in 5 minutes
- [Reasoning Strategies](https://docs.reactiveagents.dev/guides/reasoning/) -- All 5 strategies explained
- [Architecture](https://docs.reactiveagents.dev/concepts/architecture/) -- Layer system deep dive
- [Cookbook](https://docs.reactiveagents.dev/cookbook/testing-agents/) -- Testing, multi-agent patterns, production deployment

## Getting Help

- **Discord** -- [Join the community](https://discord.gg/498xEG5A) for questions, discussions, and support
- **GitHub Issues** -- [Report bugs or request features](https://github.com/tylerjrbuell/reactive-agents-ts/issues)
- **GitHub Discussions** -- [Ask questions and share ideas](https://github.com/tylerjrbuell/reactive-agents-ts/discussions)

## License

MIT
