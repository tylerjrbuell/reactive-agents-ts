---
title: Configuration Reference
description: Complete reference of all builder methods, defaults, and environment variables
---

# Configuration Reference

Every aspect of Reactive Agents is configurable through the builder API. This page documents all available options, their defaults, and how they affect agent behavior. For ready-made chains, see [Common builder stacks](/cookbook/builder-stacks/).

## Builder Methods

### Core

| Method | Default | Description |
|--------|---------|-------------|
| `.withName(name)` | `"agent"` | Agent identifier used in logs and metrics |
| `.withProvider(provider)` | `"test"` | LLM provider: `"anthropic"` \| `"openai"` \| `"gemini"` \| `"ollama"` \| `"litellm"` \| `"test"` |
| `.withModel(model)` | Provider default | Model string or `ModelParams` (`model`, `thinking?`, `temperature?`, `maxTokens?`) |
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
| `.withFallbacks(config)` | none | Provider/model chain + `errorThreshold` |
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

### Identity & Orchestration

| Method | Default | Description |
|--------|---------|-------------|
| `.withIdentity()` | disabled | Ed25519 agent certificates + RBAC |
| `.withOrchestration()` | disabled | Multi-agent workflow engine |
| `.withInteraction()` | disabled | 5 autonomy modes + checkpoints |
| `.withSelfImprovement()` | disabled | Cross-task strategy outcome learning |
| `.withReactiveIntelligence(false)` | on | Pass `false` to disable entropy/controller/telemetry stack |
| `.withReactiveIntelligence(options?)` | defaults | Entropy, controller, hooks, `autonomy`, `constraints` — see [Reactive Intelligence](/features/reactive-intelligence/) |
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
| `.withGateway(options?)` | disabled | Persistent autonomous harness: `{ heartbeat?, crons?, webhooks?, policies?, channels? }` |

### Build, test & serialization

| Method | Default | Description |
|--------|---------|-------------|
| `.withTestScenario(turns)` | none | Deterministic **test** provider. `TestTurn[]` from `@reactive-agents/llm-provider`; forces `provider: "test"`. |
| `.withLayers(layers)` | none | Merge custom Effect `Layer`s into the runtime |
| `.withSkills(config?)` | disabled | Living skills: `paths`, `packages`, `evolution`, `overrides` |
| `.toConfig()` / `ReactiveAgents.fromConfig()` / `fromJSON()` | — | **Agent as Data** — round-trip via `agentConfigToJSON` / `agentConfigFromJSON` (`reactive-agents` or `@reactive-agents/runtime`) |
| `agentFn` / `pipe` / `parallel` / `race` | — | Promise-based multi-agent composition (see [Builder API](/reference/builder-api/)) |
| `agent.registerTool()` / `unregisterTool()` / `ingest()` | — | Runtime tool + RAG ingestion on built agents |

## Environment Variables

| Variable | Required For | Default | Description |
|----------|-------------|---------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic provider | — | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI/LiteLLM provider | — | OpenAI API key |
| `GOOGLE_API_KEY` | Gemini provider | — | Google AI API key |
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
