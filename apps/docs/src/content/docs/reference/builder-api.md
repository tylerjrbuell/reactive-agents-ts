---
title: ReactiveAgentBuilder
description: Method-by-method reference for the ReactiveAgentBuilder - signatures, option shapes and behavior.
topic: config-reference
related:
  - reference/configuration
  - reference/cheatsheet
  - cookbook/builder-stacks
---
The `ReactiveAgentBuilder` is the primary entry point for creating agents. It provides a fluent API for composing capabilities. This page is the **method reference**: signatures, option shapes and what each method does. For the defaults table, environment variables and the declarative `createAgent(config)` form, see [Configuration](/reference/configuration/).

:::tip[Guided stacks]
For copy-paste **recipe chains** (minimal LLM, ReAct + tools, memory, streaming, serialization), see [Common builder stacks](/cookbook/builder-stacks/). For defaults and env vars in one table, see [Configuration](/reference/configuration/).
:::

:::note[Composition order: prefer `HarnessProfile` presets]
Per architecture model §11.1, the canonical composition order is:

1. **`HarnessProfile.lean()/balanced()/intelligent()`** — primary. One
   line that composes the registry's default-on capability set.
2. **`.compose(harness => ...)`** — advanced. For users overriding
   specific tags / phases / hooks.
3. **`.withX()` methods** — backward compatible and fully supported.
   Each composes cleanly with presets; reach for a preset when you want
   the whole default-on set in one line, or `.compose(...)` for a
   precise chokepoint. No breaking changes.

```typescript
import { ReactiveAgents, HarnessProfile } from 'reactive-agents'

const agent = await ReactiveAgents.create()
  .withName('research-agent')
  .withProvider('anthropic')
  .withProfile(HarnessProfile.balanced())  // ← canonical entry
  .withTools({ builtins: true })
  .build()
```
:::

## Jump to section

The builder reference is split by concern. Pick the family you are configuring; the generated table below lists every method and the config key it sets.

| I am configuring... | Page | Methods |
| ------------------- | ---- | ------- |
| Identity, model, provider, profile | [Core, model and profiles](/reference/builder-api/core-and-model/) | `withName`, `withAgentId`, `withPersona`, `withSystemPrompt`, `withEnvironment`, `withModel`, `withThinking`, `withProvider`, `withProfile`, `withHarness`, `withPrompts` |
| Reasoning, tools, skills | [Reasoning, tools and skills](/reference/builder-api/reasoning-and-tools/) | `withReasoning`, `withTools`, `withRequiredTools`, `withMetaTools`, `withSkills` |
| Memory, learning, documents | [Memory, learning and context](/reference/builder-api/memory-and-context/) | `withMemory`, `withLearning`, `withExperienceLearning`, `withDebrief`, `withMemoryConsolidation`, `withDocuments`, `withTaskContext` |
| Guardrails, verification, approval | [Safety, quality and approval](/reference/builder-api/safety-and-quality/) | `withGuardrails`, `withKillSwitch`, `withContract`, `withVerification`, `withJudgment`, `withGrounding`, `withOutputSchema`, `withApprovalPolicy`, `withDurableRuns` |
| Iteration limits, cost, resilience | [Limits, cost and resilience](/reference/builder-api/limits-cost-resilience/) | `withMaxIterations`, `withTimeout`, `withRetryPolicy`, `withCostTracking`, `withBudget`, `withModelRouting`, `withCircuitBreaker`, `withRateLimiting`, `withFallbacks` |
| Observability, hooks, tests | [Observability, lifecycle and testing](/reference/builder-api/observability-and-lifecycle/) | `withObservability`, `withCortex`, `withStreaming`, `withLogging`, `withTracing`, `withHealthCheck`, `withAudit`, `withHook`, `withTestScenario` |
| Sub-agents, A2A, MCP, gateway | [Multi-agent, MCP and gateway](/reference/builder-api/integrations/) | `withA2A`, `withAgentTool`, `withDynamicSubAgents`, `withRemoteAgent`, `withMCP`, `withGateway`, `withChannels`, `withLayers` |
| The built agent | [Running and streaming](/reference/builder-api/agent-runtime/), [Chat, sessions and run control](/reference/builder-api/agent-sessions-and-control/) | `run`, `runStream`, `chat`, `session`, `resumeRun`, `approveRun`, `health`, `cancel` |
| What a run returns | [AgentResult and debrief](/reference/builder-api/agent-result/) | `AgentResult`, `AgentDebrief`, `terminatedBy` |
| Building and the factory | this page: [factory](#reactiveagents-factory), [build methods](#build-methods), [full example](#full-example) | `create`, `quick`, `fromConfig`, `fromJSON`, `build`, `buildEffect`, `runOnce` |

## Method ↔ config correspondence

Every builder method and the `AgentConfig` key(s) it sets. `config` methods are
expressible declaratively via [`createAgent(config)`](/reference/configuration/);
`overlay` methods are code-only (functions/secrets/registries) with the reason
recorded. This table is **generated** from the single source
(`AgentConfigSchema` + the builder prototype) — see the [Configuration
reference](/reference/configuration/) for the declarative field list.

<!-- BEGIN GENERATED: builder-method-reference (via `bun run docs:gen:api` — DO NOT EDIT BY HAND) -->

| Method | Config key(s) | Kind | Description |
| --- | --- | --- | --- |
| `withA2A` | _overlay — multi-agent transport topology primitive (not data)_ | overlay | Agent-to-Agent server. |
| `withAdaptiveHarness` | `adaptiveHarness` | config | Adaptive harness / policy compiler. |
| `withAgentId` | `agentId` | config | Stable agent identifier. |
| `withAgentTool` | `agentTools` | config | Register a sub-agent as a tool. |
| `withApprovalPolicy` | `approvalPolicy` | config | Human-in-the-loop tool approval gate. |
| `withAudit` | `features.audit` | config | Per-tool-call rationale auditing. |
| `withBehavioralContracts` | _overlay — behavioral-contract overlay (folds into withContract)_ | overlay | Behavioral contracts. |
| `withBudget` | `budget` | config | Declarative token/cost budget caps. |
| `withCalibration` | `calibration` | config | Model calibration mode + opt-in learned/community tiers. |
| `withChannels` | `channelRoutes` | config | Messaging channels and routes. |
| `withCircuitBreaker` | `circuitBreaker` | config | Circuit-breaker thresholds (false disables). |
| `withContextProfile` | _overlay — cross-field side-effect profile (not orthogonal data)_ | overlay | Context window profile. |
| `withContract` | _overlay — behavioral-contract overlay (not JSON data)_ | overlay | Behavioral contract. |
| `withCortex` | _overlay — Cortex desk integration — observability alias (see withObservability({cortex}))_ | overlay | Emit events to a Cortex desk. |
| `withCostTracking` | `costTracking`, `features.costTracking` | config | Cost budget caps. |
| `withCustomTermination` | _overlay — carries a termination predicate (folds into withReasoning)_ | overlay | Custom termination predicate. |
| `withDebrief` | `debrief` | config | Synthesize and store a post-run debrief (default: follows memory). |
| `withDocuments` | `documents` | config | RAG document ingestion. |
| `withDurableRuns` | `durableRuns` | config | Crash-resume durable execution. |
| `withDynamicPricing` | _overlay — pricing overlay (folds into withCostTracking)_ | overlay | Dynamic pricing overlay. |
| `withDynamicSubAgents` | `dynamicSubAgents` | config | Dynamic sub-agent spawning. |
| `withEnvironment` | _overlay — carries secrets/env (never serialized)_ | overlay | Environment secrets. |
| `withErrorHandler` | _overlay — carries an error-handler function (not JSON)_ | overlay | Custom error handler. |
| `withEvents` | _overlay — carries an event stream/callback (folds into withObservability)_ | overlay | Event stream sink. |
| `withExperienceLearning` | `memory.experienceLearning` | config | Learn from prior-run experience summaries. |
| `withFabricationGuard` | `fabricationGuard` | config | Fabrication-guard mode (off/warn/block). |
| `withFallbacks` | `fallbacks` | config | Provider/model fallbacks. |
| `withGateway` | `gateway` | config | Gateway (cron/webhook/access-control) config. |
| `withGrounding` | `grounding` | config | Opt-in numeric evidence grounding. |
| `withGuardrails` | `guardrails`, `features.guardrails` | config | Injection/PII/toxicity guardrails. |
| `withHarness` | _overlay — compose-power-tier harness injection (not data)_ | overlay | Inject a composed harness. |
| `withHealthCheck` | `features.healthCheck` | config | Enable agent.health() probes. |
| `withHook` | _overlay — carries a lifecycle callback function (not JSON)_ | overlay | Lifecycle hook. |
| `withJudgment` | _overlay — code-only_ | overlay | Configure judgment. |
| `withKillSwitch` | `features.killSwitch` | config | Emergency stop / terminate control. |
| `withLayers` | _overlay — Effect Layer DI escape hatch (not data)_ | overlay | Provide custom Effect layers. |
| `withLazyValidation` | _overlay — no schema field (folds into withVerification timing)_ | overlay | Lazy output validation. |
| `withLeanHarness` | _overlay — cross-field profile patch — use withProfile(lean())_ | overlay | Lean-harness mode. |
| `withLearning` | `memory`, `skillPersistence` | config | Compounding-intelligence bundle (memory + skill persistence). |
| `withLlmTimeout` | `execution.llmTimeoutMs` | config | LLM request timeout (ms). |
| `withLogging` | `logging` | config | Structured logging config. |
| `withLongHorizon` | `horizonProfile` | config | Long-horizon guard profile. |
| `withMCP` | `mcpServers` | config | Connect MCP servers. |
| `withMaxIterations` | `execution.maxIterations` | config | Iteration cap. |
| `withMemory` | `memory`, `features.memory` | config | Enable memory layers + tier/dbPath/capacity/experienceLearning/consolidation. |
| `withMemoryConsolidation` | `memory.memoryConsolidation` | config | Background memory consolidation/decay/prune. |
| `withMetaTools` | `metaTools` | config | Conductor's-suite meta-tools. |
| `withMinIterations` | `execution.minIterations` | config | Minimum iterations before termination. |
| `withModel` | `model`, `thinking`, `temperature`, `maxTokens`, `numCtx` | config | Model id + params (thinking/temperature/maxTokens/numCtx). |
| `withModelPricing` | `pricingRegistry` | config | Custom model pricing registry. |
| `withModelRouting` | `modelRouting` | config | Cost-aware model routing. |
| `withName` | `name` | config | Agent name. |
| `withObservability` | `observability`, `features.observability` | config | Observability umbrella (verbosity/live/cortex/tracing/logging/costs/…). |
| `withOpenInference` | _overlay — code-only_ | overlay | Configure open inference. |
| `withOutputSchema` | `outputSchema`, `outputSchemaOptions` | config | Typed structured output (Effect, Standard or JSON Schema; saved as JSON Schema). |
| `withOutputValidator` | _overlay — carries a validator function (folds into withVerification)_ | overlay | Custom output validator. |
| `withPersona` | `persona` | config | Role/tone/instructions persona. |
| `withProfile` | `profile` | config | Preset baseline capability profile. |
| `withPrompts` | `features.prompts` | config | Register custom prompt templates. |
| `withProvider` | `provider` | config | LLM provider. |
| `withRateLimiting` | `rateLimiting` | config | Outbound LLM rate limiting. |
| `withReactiveIntelligence` | `reactiveIntelligence`, `features.reactiveIntelligence` | config | Reactive intelligence posture. |
| `withReasoning` | `reasoning`, `features.reasoning` | config | Reasoning strategy + options. |
| `withReceiptSigning` | _overlay — carries a private signing key (secret, never serialized)_ | overlay | Ed25519 receipt signing. |
| `withRemoteAgent` | `agentTools` | config | Register a remote agent. |
| `withReplayLLM` | _overlay — deterministic replay test rig (not data)_ | overlay | Replay recorded LLM responses. |
| `withRequiredTools` | `requiredTools` | config | Tools that must be called before success. |
| `withRetryPolicy` | `execution.retryPolicy` | config | LLM retry policy (maxRetries/backoff). |
| `withSelfImprovement` | `features.selfImprovement` | config | Enable self-improvement loop. |
| `withSkillPersistence` | `skillPersistence` | config | Persist evolved skills across runs. |
| `withSkills` | `skills` | config | Living SKILL.md directories. |
| `withStallPolicy` | `stallPolicy` | config | Stall/no-progress escalation policy. |
| `withStreaming` | `features.streaming` | config | Enable event streaming. |
| `withStrictValidation` | `execution.strictValidation` | config | Strict output validation. |
| `withSystemPrompt` | `systemPrompt` | config | System prompt. |
| `withTaskContext` | `taskContext` | config | Background key/value facts for reasoning. |
| `withTestScenario` | _overlay — test-scenario rig (not data)_ | overlay | Load a test scenario. |
| `withThinking` | `thinking` | config | Extended thinking: on/off, effort, token budget. |
| `withTimeout` | `execution.timeoutMs` | config | Run timeout (ms). |
| `withToolIntent` | _overlay — code-only_ | overlay | Configure tool intent. |
| `withTools` | `tools`, `features.tools` | config | Tools layer + allowed/focused/adaptive/terminal/required options. |
| `withTracing` | _overlay — trace persistence — observability alias (see withObservability({tracing}))_ | overlay | JSONL trace persistence. |
| `withUserInteraction` | `userInteraction` | config | Agent-initiated user interaction (request_user_input). |
| `withVerification` | `verification`, `features.verification` | config | Verification package (entropy/nli/thresholds/useLLMTier/onReject). |
| `withVerificationStep` | `verificationStep` | config | Single post-answer reflect pass. |

<!-- END GENERATED: builder-method-reference -->

## `ReactiveAgents` factory

| API                                 | Description                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `ReactiveAgents.create()`           | New empty builder (defaults: `name: "agent"`, `provider: "test"`).               |
| `ReactiveAgents.quick(options?)`    | Async — resolve provider + model + `maxIterations` from the environment and `build()` a ready-to-run agent in one call. |
| `ReactiveAgents.fromConfig(config)` | Async — rebuild a builder from an `AgentConfig` object (`agentConfigToBuilder`). |
| `ReactiveAgents.fromJSON(json)`     | Async — parse JSON → validate → same as `fromConfig`.                            |

```typescript
import { ReactiveAgents } from 'reactive-agents'
// or: import { ReactiveAgents } from "@reactive-agents/runtime";

const builder = ReactiveAgents.create()
```

### `ReactiveAgents.quick()`

The two-line first-touch entry point — returns a **built `ReactiveAgent`**, not a builder:

```typescript
const agent = await ReactiveAgents.quick()
const result = await agent.run('Say hello')
```

Every field resolves from an environment variable, then a sensible default, so `quick()` with no arguments works out of the box:

<!-- docs-skip-typecheck -->
```typescript
interface QuickOptions {
    provider?: ProviderName // Default: REACTIVE_AGENTS_PROVIDER, else the first of anthropic/openai/gemini/groq/xai whose key is present, else "ollama"
    model?: string          // Default: REACTIVE_AGENTS_MODEL, else the provider's default model
    maxIterations?: number  // Default: REACTIVE_AGENTS_MAX_ITERATIONS, else 10
}
```

A misconfigured environment (e.g. missing key) warns at build and surfaces a clean typed error at `run()` time; use `ReactiveAgents.create()....withStrictValidation()` when you want a hard failure at build instead.

### Agent as Data (`toConfig` / serialization)

On a configured builder:

-   **`toConfig()`** → `AgentConfig` (plain object, JSON-serializable except documented exceptions).
-   Use **`agentConfigToJSON`** / **`agentConfigFromJSON`** from **`reactive-agents`** or **`@reactive-agents/runtime`** for string round-trips.

### Config as code (`agentConfigToSource`)

`agentConfigToSource(config, options?)` prints the TypeScript builder chain for an `AgentConfig`. It reads the same call list as `fromConfig()` (`agentConfigToBuilderCalls(config)`, an ordered `{ method, args }[]`), so the printed code builds the same agent: evaluating it and calling `toConfig()` gives back the original config.

```typescript
import { agentConfigToSource } from "reactive-agents";

agentConfigToSource({ name: "helper", provider: "anthropic", execution: { maxIterations: 5 } });
// import { ReactiveAgents } from "reactive-agents";
//
// export const agent = await ReactiveAgents.create()
//   .withName("helper")
//   .withProvider("anthropic")
//   .withMaxIterations(5)
//   .build();
```

| Option       | Default             | Effect                                                             |
| ------------ | ------------------- | ------------------------------------------------------------------ |
| `format`     | `"module"`          | `"module"` adds the import and `export const`; `"expression"` prints only the chain. |
| `importFrom` | `"reactive-agents"` | Package the `import` line names.                                   |
| `build`      | `true`              | `false` stops the chain before `.build()` (exported as `builder`). |

Secrets are never printed. MCP `env` values become `process.env.<KEY>`, MCP `headers` become `process.env.MCP_<SERVER>_<HEADER>`, and `apiKey`, `secret` and `password` strings become an upper-snake name from where they sit (a gateway webhook `secret` on `/hook` prints as `process.env.GATEWAY_HOOK_SECRET`). Set those variables before running the code. Two config keys print differently: `profile` prints as `.withProfile(HarnessProfile.<name>())`, and `outputSchemaOptions` prints as a comment, because the schema object is code-only. Code-only builder options (hooks, custom tools, layers) have no `AgentConfig` field, so they are not printed.

## Builder methods

All chain methods return `this` unless noted. Each method family is documented on its own page; use [Jump to section](#jump-to-section).

## Optional features

The optional `.withX()` methods used to be one table on this page. They now live with their concern: [reasoning and tools](/reference/builder-api/reasoning-and-tools/), [memory and context](/reference/builder-api/memory-and-context/), [safety, quality and approval](/reference/builder-api/safety-and-quality/), [limits, cost and resilience](/reference/builder-api/limits-cost-resilience/), [observability and lifecycle](/reference/builder-api/observability-and-lifecycle/) and [multi-agent, MCP and gateway](/reference/builder-api/integrations/). The generated [method and config table](#method--config-correspondence) lists every method in one place.

## Build Methods

### `build()`

<!-- docs-skip-typecheck -->
```typescript
async build(): Promise<ReactiveAgent>
```

Creates the agent, resolving the full Layer stack. Returns a `ReactiveAgent` instance.

### `buildEffect()`

<!-- docs-skip-typecheck -->
```typescript
buildEffect(): Effect.Effect<ReactiveAgent, Error>
```

Creates the agent as an Effect for composition in Effect programs.

### `runOnce(input: string): Promise<AgentResult>`

Builds the agent, runs a single task, disposes all resources, and returns the result — in one call. Use this for one-shot scripts where you don't need to hold a reference to the agent.

```typescript
const result = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withReasoning()
    .runOnce('Summarize the README in one paragraph')

console.log(result.output)
// Resources are already cleaned up
```

## Full Example

<!-- docs-skip-typecheck -->
```typescript
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

// await using — agent is disposed automatically when this block exits
await using agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withPersona({
    role: "CRISPR Research Specialist",
    background: "Expert in gene editing and molecular biology",
    instructions: "Provide detailed technical analysis with citations",
    tone: "professional",
  })
  .withMemory()
  .withReasoning({ defaultStrategy: "adaptive", adaptive: { enabled: true } })
  .withTools({ builtins: true })  // opt in to built-in tools (web search, file I/O, etc.)
  .withGuardrails()
  .withVerification()
  .withCostTracking()
  .withObservability()
  .withAudit()
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
