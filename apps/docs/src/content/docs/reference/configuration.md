---
title: Configuration Reference
description: Complete reference of all builder methods, defaults, and environment variables
---

# Configuration Reference

Every aspect of Reactive Agents is configurable through the builder API. This page documents all available options, their defaults, and how they affect agent behavior.

## Builder Methods

### Core

| Method | Default | Description |
|--------|---------|-------------|
| `.withName(name)` | `"agent"` | Agent identifier used in logs and metrics |
| `.withProvider(provider)` | `"test"` | LLM provider: `"anthropic"` \| `"openai"` \| `"gemini"` \| `"ollama"` \| `"litellm"` \| `"test"` |
| `.withModel(model)` | Provider default | Model name or preset (e.g., `"claude-sonnet-4-20250514"`, `"gpt-4o"`) |
| `.withSystemPrompt(prompt)` | none | Custom system prompt prepended to all LLM calls |
| `.withPersona(persona)` | none | Structured persona: `{ name?, role?, background?, instructions?, tone? }` |
| `.withMaxIterations(n)` | `10` | Maximum reasoning loop iterations before stopping |
| `.withTimeout(ms)` | none | Per-execution timeout in milliseconds |

### Reasoning

| Method | Default | Description |
|--------|---------|-------------|
| `.withReasoning(options?)` | disabled | Enable reasoning loop. Options: `{ defaultStrategy?: string }` |
| `.withCircuitBreaker(config?)` | auto | Loop detection: `{ maxSameToolCalls?, maxConsecutiveThoughts? }` |

### Tools

| Method | Default | Description |
|--------|---------|-------------|
| `.withTools(options?)` | disabled | Enable tool registry. Options: `{ include?, exclude?, custom?, allowedTools?, adaptiveToolFiltering?, resultCompression? }` |
| `.withRequiredTools(config)` | none | Tools that must be called: `{ tools?, adaptive?, maxRetries? }` |
| `.withMCP(config)` | none | MCP server connections: `{ name, transport, command?, args?, url? }` |

### Memory

| Method | Default | Description |
|--------|---------|-------------|
| `.withMemory(options?)` | disabled | Enable memory. No args = standard tier. Options: `{ tier: "standard" \| "enhanced" }` |
| `.withMemoryConsolidation(config?)` | disabled | Background memory intelligence: `{ threshold?, decayFactor?, pruneThreshold? }` |
| `.withExperienceLearning()` | disabled | Cross-agent tool-use pattern learning |

### Safety & Control

| Method | Default | Description |
|--------|---------|-------------|
| `.withGuardrails(options?)` | disabled | Enable injection/PII/toxicity detection. Options include `thresholds: { injection?, pii?, toxicity? }` (0.0–1.0) |
| `.withVerification(options?)` | disabled | Post-LLM fact-checking (semantic entropy, NLI) |
| `.withKillSwitch()` | disabled | Enable pause/resume/stop/terminate controls |
| `.withBehavioralContracts(config?)` | none | Rule enforcement: `{ deniedTools?, maxIterations?, allowedActions? }` |

### Cost & Efficiency

| Method | Default | Description |
|--------|---------|-------------|
| `.withCostTracking(options?)` | disabled | Budget enforcement. Options: `{ budget?: { perRequest?, perSession?, daily?, monthly? } }` |
| `.withCacheTimeout(ms)` | `3,600,000` (1hr) | Semantic cache TTL in milliseconds |
| `.withRetryPolicy(policy)` | `{ maxRetries: 0 }` | LLM call retry: `{ maxRetries, backoffMs }` |
| `.withContextProfile(profile)` | auto-detected | Model-adaptive context: `{ tier: "local" \| "mid" \| "large" \| "frontier" }` |

### Observability

| Method | Default | Description |
|--------|---------|-------------|
| `.withObservability(options?)` | disabled | Metrics dashboard + tracing. Options: `{ verbosity?, live? }` |
| `.withStreaming(options?)` | disabled | Token streaming. Options: `{ density?: "tokens" \| "full" }` |
| `.withTelemetry(config?)` | disabled | OpenTelemetry export configuration |
| `.withAudit()` | disabled | Compliance audit logging |

### Identity & Orchestration

| Method | Default | Description |
|--------|---------|-------------|
| `.withIdentity()` | disabled | Ed25519 agent certificates + RBAC |
| `.withOrchestration()` | disabled | Multi-agent workflow engine |
| `.withInteraction()` | disabled | 5 autonomy modes + checkpoints |
| `.withSelfImprovement()` | disabled | Cross-task strategy outcome learning |

### Sub-Agents

| Method | Default | Description |
|--------|---------|-------------|
| `.withAgentTool(name, config)` | none | Register a static sub-agent as a tool |
| `.withDynamicSubAgents(options?)` | disabled | Allow LLM to spawn sub-agents at runtime |
| `.withRemoteAgent(name, url)` | none | Connect to a remote agent via A2A protocol |

### Gateway

| Method | Default | Description |
|--------|---------|-------------|
| `.withGateway(options?)` | disabled | Persistent autonomous harness: `{ heartbeat?, crons?, webhooks?, policies?, channels? }` |

### Build Options

| Method | Default | Description |
|--------|---------|-------------|
| `.withStrictValidation()` | `false` | Make build-time warnings (missing API keys, model mismatches) into hard errors |
| `.withTestResponses(map)` | none | Deterministic test responses: `Record<string, string>` |
| `.withLayers(layers)` | none | Inject custom Effect-TS layers |

## Environment Variables

| Variable | Required For | Default | Description |
|----------|-------------|---------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic provider | — | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI/LiteLLM provider | — | OpenAI API key |
| `GOOGLE_API_KEY` | Gemini provider | — | Google AI API key |
| `TAVILY_API_KEY` | Web search tool | — | Tavily search API key |
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
