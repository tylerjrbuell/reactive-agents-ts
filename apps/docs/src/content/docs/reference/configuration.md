---
title: Configuration Reference
description: 'Complete reference of all builder methods, defaults, and environment variables'
---

# Configuration Reference

Every aspect of Reactive Agents is configurable through the builder API. This page documents all available options, their defaults, and how they affect agent behavior. For ready-made chains, see [Common builder stacks](/cookbook/builder-stacks/).

## Declarative config: `createAgent(config)`

The declarative front door takes a single `AgentConfig` object and returns the
same agent the fluent builder produces — `createAgent({ tools: { allowedTools } })`
≡ `.withTools({ allowedTools })` (same key, same result). Unknown or malformed
keys are rejected loudly with the path named.

```typescript
import { createAgent } from 'reactive-agents'

const agent = await createAgent({
  name: 'researcher',
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  profile: 'balanced',
  tools: { allowedTools: ['web-search', 'file-write'] },
})
const result = await agent.run('Summarize the latest on X')
```

`profile` (`"lean" | "balanced" | "intelligent"`) sets a preset baseline applied
FIRST; explicit sibling keys override it.

### Complete `AgentConfig` field reference

Every key of `AgentConfig`, its type, and whether it is required. This table is
**generated** from `AgentConfigSchema` (the single source of truth) — see the
[Builder API](/reference/builder-api/) for the fluent method that sets each key.

<!-- BEGIN GENERATED: config-field-reference (via `bun run docs:gen:api` — DO NOT EDIT BY HAND) -->

| Config key | Type | Required | Description |
| --- | --- | --- | --- |
| `adaptiveHarness` | `boolean` | no |  |
| `agentId` | `string` | no |  |
| `budget.costLimit` | `number` | no |  |
| `budget.tokenLimit` | `number` | no |  |
| `budget.warningRatio` | `number` | no |  |
| `circuitBreaker` | `unknown` | no |  |
| `costTracking.daily` | `number` | no |  |
| `costTracking.monthly` | `number` | no |  |
| `costTracking.perRequest` | `number` | no |  |
| `costTracking.perSession` | `number` | no |  |
| `durableRuns.checkpointEvery` | `number` | no |  |
| `durableRuns.dir` | `string` | no |  |
| `execution.maxIterations` | `number` | no |  |
| `execution.minIterations` | `number` | no |  |
| `execution.retryPolicy.backoffMs` | `number` | **yes** |  |
| `execution.retryPolicy.maxRetries` | `number` | **yes** |  |
| `execution.strictValidation` | `boolean` | no |  |
| `execution.timeoutMs` | `number` | no |  |
| `fabricationGuard` | `off` \| `warn` \| `block` | no |  |
| `fallbacks.providers` | `array` | no |  |
| `features.audit` | `boolean` | no |  |
| `features.costTracking` | `boolean` | no |  |
| `features.guardrails` | `boolean` | no |  |
| `features.healthCheck` | `boolean` | no |  |
| `features.killSwitch` | `boolean` | no |  |
| `features.memory` | `boolean` | no |  |
| `features.observability` | `boolean` | no |  |
| `features.prompts` | `boolean` | no |  |
| `features.reactiveIntelligence` | `boolean` | no |  |
| `features.reasoning` | `boolean` | no |  |
| `features.selfImprovement` | `boolean` | no |  |
| `features.streaming` | `boolean` | no |  |
| `features.tools` | `boolean` | no |  |
| `features.verification` | `boolean` | no |  |
| `gateway.accessControl.accessPolicy` | `allowlist` \| `blocklist` \| `open` | no |  |
| `gateway.accessControl.allowedSenders` | `array` | no |  |
| `gateway.accessControl.blockedSenders` | `array` | no |  |
| `gateway.accessControl.mode` | `chat` \| `task` | no |  |
| `gateway.accessControl.replyToUnknown` | `string` | no |  |
| `gateway.accessControl.sessionTtlDays` | `number` | no |  |
| `gateway.accessControl.unknownSenderAction` | `skip` \| `escalate` | no |  |
| `gateway.crons` | `array` | no |  |
| `gateway.heartbeat.instruction` | `string` | no |  |
| `gateway.heartbeat.intervalMs` | `number` | no |  |
| `gateway.heartbeat.maxConsecutiveSkips` | `number` | no |  |
| `gateway.heartbeat.policy` | `always` \| `adaptive` \| `conservative` | no |  |
| `gateway.persistMemoryAcrossRuns` | `boolean` | no |  |
| `gateway.policies.dailyTokenBudget` | `number` | no |  |
| `gateway.policies.heartbeatPolicy` | `always` \| `adaptive` \| `conservative` | no |  |
| `gateway.policies.maxActionsPerHour` | `number` | no |  |
| `gateway.policies.mergeWindowMs` | `number` | no |  |
| `gateway.policies.requireApprovalFor` | `array` | no |  |
| `gateway.port` | `number` | no |  |
| `gateway.timezone` | `string` | no |  |
| `gateway.webhooks` | `array` | no |  |
| `grounding.maxRetries` | `number` | no |  |
| `grounding.mode` | `block` \| `warn` | **yes** |  |
| `grounding.tolerance` | `number` | no |  |
| `guardrails.customBlocklist` | `array` | no |  |
| `guardrails.injection` | `boolean` | no |  |
| `guardrails.pii` | `boolean` | no |  |
| `guardrails.toxicity` | `boolean` | no |  |
| `horizonProfile` | `long` | no |  |
| `logging.filePath` | `string` | no |  |
| `logging.format` | `text` \| `json` | no |  |
| `logging.level` | `debug` \| `info` \| `warn` \| `error` | no |  |
| `logging.maxFiles` | `number` | no |  |
| `logging.maxFileSizeBytes` | `number` | no |  |
| `logging.output` | `console` \| `file` | no |  |
| `maxTokens` | `number` | no |  |
| `mcpServers` | `array` | no |  |
| `memory.capacity` | `number` | no |  |
| `memory.dbPath` | `string` | no |  |
| `memory.evictionPolicy` | `fifo` \| `lru` \| `importance` | no |  |
| `memory.experienceLearning` | `boolean` | no |  |
| `memory.importanceThreshold` | `number` | no |  |
| `memory.maxEntries` | `number` | no |  |
| `memory.memoryConsolidation` | `boolean` | no |  |
| `memory.retainDays` | `number` | no |  |
| `memory.tier` | `standard` \| `enhanced` | no |  |
| `model` | `string` | no |  |
| `name` | `string` | **yes** |  |
| `numCtx` | `number` | no |  |
| `observability.audit` | `boolean` | no |  |
| `observability.cortex` | `unknown` | no |  |
| `observability.costs` | `unknown` | no |  |
| `observability.file` | `string` | no |  |
| `observability.health` | `boolean` | no |  |
| `observability.live` | `boolean` | no |  |
| `observability.logging.filePath` | `string` | no |  |
| `observability.logging.format` | `text` \| `json` | no |  |
| `observability.logging.level` | `debug` \| `info` \| `warn` \| `error` | no |  |
| `observability.logging.maxFiles` | `number` | no |  |
| `observability.logging.maxFileSizeBytes` | `number` | no |  |
| `observability.logging.output` | `console` \| `file` | no |  |
| `observability.logModelIO` | `boolean` | no |  |
| `observability.telemetry` | `unknown` | no |  |
| `observability.tracing` | `unknown` | no |  |
| `observability.verbosity` | `minimal` \| `normal` \| `verbose` \| `debug` | no |  |
| `outputSchemaOptions.abstainBelow` | `number` | no |  |
| `outputSchemaOptions.mode` | `auto` \| `fast` \| `grounded` | no |  |
| `outputSchemaOptions.onParseFail` | `degrade` \| `throw` | no |  |
| `persona.background` | `string` | no |  |
| `persona.instructions` | `string` | no |  |
| `persona.name` | `string` | no |  |
| `persona.role` | `string` | no |  |
| `persona.tone` | `string` | no |  |
| `pricingRegistry` | `object` | no |  |
| `profile` | `lean` \| `balanced` \| `intelligent` | no |  |
| `provider` | `anthropic` \| `openai` \| `ollama` \| `gemini` \| `litellm` \| `test` | **yes** |  |
| `rateLimiting.maxConcurrent` | `number` | no |  |
| `rateLimiting.requestsPerMinute` | `number` | no |  |
| `rateLimiting.tokensPerMinute` | `number` | no |  |
| `reactiveIntelligence.enabled` | `boolean` | no |  |
| `reasoning.auditRationale` | `boolean` | no |  |
| `reasoning.defaultStrategy` | `reactive` \| `plan-execute-reflect` \| `tree-of-thought` \| `reflexion` \| `adaptive` \| `direct` \| `code-action` \| `blueprint` | no |  |
| `reasoning.enableStrategySwitching` | `boolean` | no |  |
| `reasoning.fallbackStrategy` | `string` | no |  |
| `reasoning.maxStrategySwitches` | `number` | no |  |
| `requiredTools.adaptive` | `boolean` | no |  |
| `requiredTools.maxRetries` | `number` | no |  |
| `requiredTools.tools` | `array` | no |  |
| `skillPersistence` | `boolean` | no |  |
| `stallPolicy.escalateNudgeContent` | `boolean` | no |  |
| `stallPolicy.ignoredNudgeTolerance` | `number` | no |  |
| `systemPrompt` | `string` | no |  |
| `taskContext` | `object` | no |  |
| `temperature` | `number` | no |  |
| `thinking` | `boolean` | no |  |
| `tools.adaptive` | `boolean` | no |  |
| `tools.allowedTools` | `array` | no |  |
| `tools.focusedTools` | `array` | no |  |
| `tools.terminal` | `boolean` | no |  |
| `verification.factDecomposition` | `boolean` | no |  |
| `verification.hallucinationDetection` | `boolean` | no |  |
| `verification.hallucinationThreshold` | `number` | no |  |
| `verification.multiSource` | `boolean` | no |  |
| `verification.nli` | `boolean` | no |  |
| `verification.onReject` | `block` \| `annotate` \| `proceed` | no |  |
| `verification.passThreshold` | `number` | no |  |
| `verification.riskThreshold` | `number` | no |  |
| `verification.selfConsistency` | `boolean` | no |  |
| `verification.semanticEntropy` | `boolean` | no |  |
| `verification.useLLMTier` | `boolean` | no |  |

<!-- END GENERATED: config-field-reference -->

## Builder Methods

### Core

| Method | Default | Description |
|--------|---------|-------------|
| `.withName(name)` | `"agent"` | Agent identifier used in logs and metrics |
| `.withProvider(provider)` | `"test"` | LLM provider: `"anthropic"` \| `"openai"` \| `"gemini"` \| `"groq"` \| `"xai"` \| `"ollama"` \| `"litellm"` \| `"test"` |
| `.withModel(model)` | Provider default | Model string or `ModelParams` (`model`, `thinking?`, `temperature?`, `maxTokens?`, `numCtx?`). `numCtx` pins the exact provider context window (Ollama `num_ctx`); also a top-level `AgentConfig` field |
| `.withSystemPrompt(prompt)` | none | Custom system prompt prepended to all LLM calls |
| `.withPersona(persona)` | none | Structured persona: `{ name?, role?, background?, instructions?, tone? }` |
| `.withEnvironment(context)` | none | Extra `Record<string, string>` merged into system prompt (beyond built-in date/tz/platform) |
| `.withMaxIterations(n)` | `10` | Maximum reasoning loop iterations before stopping |
| `.withTimeout(ms)` | none | Per-execution timeout in milliseconds |
| `.withStrictValidation()` | off | Missing API keys / mismatches become build errors |
| `.withRetryPolicy({ maxRetries, backoffMs })` | `maxRetries: 0` | Transient LLM retries |
| `.withErrorHandler(fn)` | none | Observe-only callback when `run()` fails |

### Reasoning

| Method | Default | Description |
|--------|---------|-------------|
| `.withReasoning(options?)` | disabled | Strategies, ICS (`synthesis`, `synthesisModel`, …), strategy switching, `adaptive`, per-strategy bundles (may include e.g. `kernelMaxIterations` on `reflexion`). See [Reasoning](/guides/reasoning/) and [Builder API](/reference/builder-api/) |

### Tools & context

| Method | Default | Description |
|--------|---------|-------------|
| `.withTools(options?)` | disabled | `{ tools?` (custom defs + **Effect** handlers), `resultCompression?`, `allowedTools?`, `adaptive?` } |
| `.withDocuments(docs)` | none | `DocumentSpec[]` ingested at build for `rag-search` |
| `.withRequiredTools(config)` | none | `{ tools?, adaptive?, maxRetries? }` |
| `.withMCP(config)` | none | MCP: `{ name, transport, command?, args?, endpoint?, headers?, env?, cwd? }` (see [Builder API](/reference/builder-api/) transport table) |
| `.withMetaTools(config?)` | on with tools | Conductor suite; pass `false` to disable defaults |

### LLM resilience & pricing

| Method | Default | Description |
|--------|---------|-------------|
| `.withCircuitBreaker(config?)` | off until set | Provider circuit breaker (`failureThreshold`, `cooldownMs`, …) |
| `.withRateLimiting(config?)` | off until set | RPM / TPM / concurrency limits |
| `.withModelPricing(registry)` | none | Static $/1M token overrides |
| `.withDynamicPricing(provider)` | none | Fetch pricing at build |
| `.withFallbacks(config)` | none | Ordered provider cascade — `{ providers }`; falls back to the next provider on any error |
| `.withCacheTimeout(ms)` | `3_600_000` | Semantic cache TTL (1h) |

### Memory

| Method | Default | Description |
|--------|---------|-------------|
| `.withMemory(options?)` | disabled | Enable memory. No args = standard tier. Options: `{ tier: "standard" \| "enhanced" }` |
| `.withMemoryConsolidation(config?)` | disabled | Background memory intelligence: `{ threshold?, decayFactor?, pruneThreshold? }` |
| `.withExperienceLearning()` | disabled | Cross-agent tool-use pattern learning |

### Safety & control

| Method | Default | Description |
|--------|---------|-------------|
| `.withGuardrails(options?)` | disabled | Toggles: `{ injection?, pii?, toxicity? }` (default **true** each when enabled), plus `customBlocklist?` |
| `.withVerification(options?)` | disabled | Strategy toggles + thresholds (`passThreshold`, `hallucinationDetection`, …) |
| `.withKillSwitch()` | disabled | Pause / resume / stop / terminate |
| `.withBehavioralContracts(contract)` | none | Behavioral contract passed to guardrails layer |

### Cost & context

| Method | Default | Description |
|--------|---------|-------------|
| `.withCostTracking(options?)` | disabled | Budget enforcement (USD): `{ perRequest?, perSession?, daily?, monthly? }` |
| `.withContextProfile(profile)` | auto-detected | Model-adaptive context budgets / compaction — see [Context engineering](/guides/context-engineering/) |

### Observability & streaming

| Method | Default | Description |
|--------|---------|-------------|
| `.withObservability(options?)` | disabled | `{ verbosity?, live?, file?` (JSONL), `logPrefix?, logModelIO? }` |
| `.withStreaming(options?)` | `"tokens"` | Default `agent.runStream()` density: `{ density?: "tokens" \| "full" }` |
| `.withTelemetry(config?)` | `{ mode: "isolated" }` if enabled | Telemetry privacy / contribute modes |
| `.withLogging(config)` | none | Structured logs: level, format, `output` (console / file / stream), rotation |
| `.withAudit()` | disabled | Compliance audit logging |
| `.withEvents()` | — | Wire EventBus for `agent.subscribe()` |

### Metacognition & control

| Method | Default | Description |
|--------|---------|-------------|
| `.withSelfImprovement()` | disabled | Cross-task strategy outcome learning |
| `.withReactiveIntelligence(false)` | on | Pass `false` to disable entropy/controller/telemetry stack |
| `.withReactiveIntelligence(options?)` | defaults | Entropy, controller, hooks — see [Reactive Intelligence](/features/reactive-intelligence/) |
| `.withHealthCheck()` | disabled | Exposes `agent.health()` |

### Sub-agents & A2A

| Method | Default | Description |
|--------|---------|-------------|
| `.withA2A(options?)` | `{ port: 3000 }` | Local A2A JSON-RPC server (`port`, `basePath`) |
| `.withAgentTool(name, config)` | none | Register a static sub-agent as a tool |
| `.withDynamicSubAgents(options?)` | disabled | Allow LLM to spawn sub-agents at runtime |
| `.withRemoteAgent(name, url)` | none | Connect to a remote agent via A2A protocol |

### Gateway

| Method | Default | Description |
|--------|---------|-------------|
| `.withGateway(options?)` | disabled | Persistent autonomous harness: `{ heartbeat?, crons?, webhooks?, policies?, accessControl? }` |

### Build, test & serialization

| Method | Default | Description |
|--------|---------|-------------|
| `.withTestScenario(turns)` | none | Deterministic **test** provider. `TestTurn[]` from `@reactive-agents/llm-provider`; forces `provider: "test"`. |
| `.withLayers(layers)` | none | Merge custom Effect `Layer`s into the runtime |
| `.withSkills(config)` | disabled | Living skills: `{ paths }` — one or more SKILL.md directories (required; a path-less call throws) |
| `.toConfig()` / `ReactiveAgents.fromConfig()` / `fromJSON()` | — | **Agent as Data** — round-trip via `agentConfigToJSON` / `agentConfigFromJSON` (`reactive-agents` or `@reactive-agents/runtime`) |
| `agentFn` / `pipe` / `parallel` / `race` | — | Promise-based multi-agent composition (see [Builder API](/reference/builder-api/)) |
| `agent.registerTool()` / `unregisterTool()` / `ingest()` | — | Runtime tool + RAG ingestion on built agents |

## Environment Variables

| Variable | Required For | Default | Description |
|----------|-------------|---------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic provider | — | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI/LiteLLM provider | — | OpenAI API key |
| `GOOGLE_API_KEY` | Gemini provider | — | Google AI API key |
| `GROQ_API_KEY` | Groq provider | — | Groq API key |
| `XAI_API_KEY` | xAI provider | — | xAI API key |
| `TAVILY_API_KEY` | Web search tool (primary) | — | Tavily search API key |
| `BRAVE_SEARCH_API_KEY` | Web search tool (secondary) | — | Brave Search API key (`X-Subscription-Token`); alias: `BRAVE_API_KEY` |
| `EMBEDDING_PROVIDER` | Enhanced memory tier | `"openai"` | Embedding provider |
| `EMBEDDING_MODEL` | Enhanced memory tier | `"text-embedding-3-small"` | Embedding model name |
| `LLM_DEFAULT_MODEL` | All providers | Provider default | Override default model |

## Hardcoded Defaults

These values have sensible defaults but are not currently configurable via the builder:

| Value | Default | Where | Notes |
|-------|---------|-------|-------|
| Max sub-agent iterations | 4 | `packages/tools/src/` | Sub-agents capped at 4 iterations |
| Max recursion depth | 3 | `packages/tools/src/` | Nested sub-agent limit |
| Parent context forwarding | 2000 chars | `packages/tools/src/` | Max parent context sent to sub-agents |
| Memory decay half-life | 7 days | `packages/memory/src/` | Episodic memory decay rate |
| Compaction trigger | 6 iterations | `packages/reasoning/src/` | Steps before context compaction (local tier) |
