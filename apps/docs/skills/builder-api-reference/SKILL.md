---
name: builder-api-reference
description: Configure a ReactiveAgentBuilder with the correct layer composition for any agent use case.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Builder API Reference

## Agent objective

Produce a complete, correctly-ordered builder chain with the right `.withX()` calls for the task. Every method used must exist in this reference.

## When to load this skill

- Before writing any agent builder chain
- When unsure which methods are available or what their params are
- When upgrading from an older API version

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

// Minimal — provider + reasoning is enough to run
const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 10 })
  .build();

// Production — adds reliability, observability, cost controls
const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withModel("claude-opus-4-6")
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 15 })
  .withTools({ allowedTools: ["web-search", "file-read", "checkpoint"] })
  .withMemory({ tier: "enhanced", dbPath: "./agent.db" })
  .withGuardrails({ injection: true, pii: true, toxicity: true })
  .withVerification()
  .withCostTracking({ perRequest: 0.50, daily: 20.0 })
  .withObservability({ verbosity: "normal", live: true })
  .withMaxIterations(20)
  .build();
```

## Full builder API reference

### Identity & persona

| Method | Params | Notes |
|--------|--------|-------|
| `.withName(name)` | `string` | Display name; defaults to "agent" |
| `.withAgentId(id)` | `string` | Override auto-generated ID |
| `.withPersona(p)` | `{ role?, background?, instructions?, tone? }` | Generates system prompt from fields |
| `.withSystemPrompt(s)` | `string` | Raw system prompt — overwrites `.withPersona()` |
| `.withEnvironment(ctx)` | `Record<string, string>` | Key-value pairs injected into system prompt |

### Provider & model

| Method | Params | Notes |
|--------|--------|-------|
| `.withProvider(p)` | `"anthropic"\|"openai"\|"gemini"\|"ollama"\|"litellm"\|"test"` | Required |
| `.withModel(m)` | `string \| { model, thinking?, temperature? }` | Uses provider default if omitted |
| `.withRateLimiting(cfg)` | `{ requestsPerMinute?, tokensPerMinute?, maxConcurrent? }` | Provider-level rate limits |
| `.withCircuitBreaker(cfg?)` | `{ failureThreshold?, cooldownMs?, halfOpenRequests? }` | Retries with backoff on errors |
| `.withDynamicPricing(provider)` | `PricingProvider` | Fetches live pricing during build |
| `.withModelPricing(registry)` | `Record<string, { input, output }>` | Custom per-model USD pricing |

### Reasoning & iteration

| Method | Params | Notes |
|--------|--------|-------|
| `.withReasoning(opts?)` | `{ defaultStrategy?, maxIterations?, enableStrategySwitching?, maxStrategySwitches?, fallbackStrategy? }` | Strategies: `"reactive"`, `"plan-execute-reflect"`, `"tree-of-thought"`, `"reflexion"`, `"adaptive"` |
| `.withMaxIterations(n)` | `number` | Hard cap; overrides `.withReasoning` value |
| `.withRequiredTools(cfg)` | `{ tools?, adaptive?, maxRetries? }` | Forces tool calls before completion |

### Tools

| Method | Params | Notes |
|--------|--------|-------|
| `.withTools(opts?)` | `{ tools?, allowedTools?, adaptive?, resultCompression? }` | No args = all built-ins enabled |
| `.withDocuments(docs)` | `DocumentSpec[]` | RAG context injection |
| `.withPrompts(opts?)` | prompts config | Custom prompt templates |

### Memory

| Method | Params | Notes |
|--------|--------|-------|
| `.withMemory(opts?)` | `"standard" \| "enhanced" \| { tier, dbPath?, capacity? }` | `"enhanced"` requires writable SQLite path |

### Safety & compliance

| Method | Params | Notes |
|--------|--------|-------|
| `.withGuardrails(opts?)` | `{ injection?, pii?, toxicity?, customBlocklist? }` | All default `true` |
| `.withKillSwitch()` | — | Exposes `.pause()`, `.resume()`, `.stop()`, `.terminate()` |
| `.withBehavioralContracts(c)` | `{ deniedTools?, allowedTools?, maxToolCalls?, maxIterations?, maxOutputLength?, deniedTopics?, requireDisclosure? }` | Rule-based constraints |
| `.withVerification(opts?)` | `{ semanticEntropy?, factDecomposition?, nli?, hallucinationDetection?, passThreshold?, useLLMTier? }` | Runtime hallucination detection |
| `.withIdentity()` | — | Ed25519 certs, RBAC, delegation, audit trail |
| `.withAudit()` | — | Append-only action audit log |

### Cost

| Method | Params | Notes |
|--------|--------|-------|
| `.withCostTracking(opts?)` | `{ perRequest?, perSession?, daily?, monthly? }` | USD budgets; throws on breach |

### Observability & logging

| Method | Params | Notes |
|--------|--------|-------|
| `.withObservability(opts?)` | `{ verbosity?, live?, logModelIO?, file? }` | `file` is JSONL output path |
| `.withLogging(cfg)` | `{ level?, format?, output?, filePath?, maxFileSizeBytes?, maxFiles? }` | Structured logging |
| `.withTelemetry(cfg?)` | `{ mode: "contribute"\|"isolated" }` | OTEL telemetry |

### Persistence & integration

| Method | Params | Notes |
|--------|--------|-------|
| `.withGateway(opts?)` | `GatewayOptions` | Persistent agent with heartbeats/crons/webhooks |
| `.withA2A(opts?)` | `{ port?, basePath? }` | A2A server (JSON-RPC 2.0 + SSE) |
| `.withInteraction()` | — | Autonomy modes, approval gates, checkpoints |
| `.withOrchestration()` | — | Multi-agent orchestration layer |
| `.withStreaming(opts?)` | `{ density?: "tokens"\|"full" }` | Streaming output |
| `.withAgentTool(name, cfg)` | name + `{ agent }` | Local agent registered as a tool |
| `.withDynamicSubAgents(opts?)` | `{ maxIterations? }` | Dynamic sub-agent spawning |
| `.withRemoteAgent(name, url)` | name + A2A URL | Remote A2A agent as callable tool |
| `.withCortex(url?)` | optional URL | Cortex desk server integration |
| `.withHealthCheck()` | — | Self-monitoring health endpoint |
| `.withErrorHandler(fn)` | `(err, ctx) => void` | Custom error handling callback |
| `.withHook(hook)` | `LifecycleHook` | Lifecycle callbacks (beforeRun, afterStep, etc.) |
| `.withSelfImprovement()` | — | Meta-learning from past runs |
| `.withExperienceLearning()` | — | Injects prior-run experience tips into context |

### Build

| Method | Returns | Notes |
|--------|---------|-------|
| `.build()` | `Promise<ReactiveAgent>` | Always `await` |
| `.buildEffect()` | `Effect<ReactiveAgent>` | For Effect runtime callers |
| `ReactiveAgents.fromConfig(cfg)` | `Promise<ReactiveAgentBuilder>` | From `AgentConfig` object |
| `ReactiveAgents.fromJSON(json)` | `Promise<ReactiveAgentBuilder>` | From JSON string |
| `ReactiveAgents.runOnce(task, builder)` | `Promise<AgentResult>` | Build + run + dispose |

## Pitfalls

- `.build()` is async — always `await` or you get an unresolved Promise
- `.withPersona()` and `.withSystemPrompt()` both set the system prompt — the **last** call wins
- `.withTools()` no-args enables `shell-execute` (riskLevel: high, requiresApproval: true) — restrict with `allowedTools` in production
- `.withMemory("enhanced")` without `dbPath` uses a default path — set it explicitly in multi-agent environments to avoid collisions
- `.withGateway()` requires calling `.start()` on the built agent; `.build()` alone does not start the loop
- `enableStrategySwitching: true` without `maxStrategySwitches` defaults to 2 switches max
