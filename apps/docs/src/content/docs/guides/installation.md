---
title: Installation
description: How to install and configure Reactive Agents.
sidebar:
  order: 4
---

## Simple Install

The easiest way to get started is with the `reactive-agents` meta-package, which bundles everything:

```bash
bun add reactive-agents
```

:::note[Effect dependency]
`effect` ships as a dependency of `reactive-agents` and is installed automatically. When you write hooks, tools, or tests, import helpers explicitly — e.g. `import { Effect } from "effect"` — then use **`Effect.succeed`**, **`Effect.fail`**, **`Effect.gen`**, **`Effect.runPromise`**, etc. See the [Effect-TS primer](/concepts/effect-ts/) for a cheat sheet. Add `effect` to your app’s `package.json` only if you import from it outside `reactive-agents`’ bundled usage.
:::

Then import from a single entry point:

```typescript
import { ReactiveAgents } from "reactive-agents";
```

## Modular Install

The framework is modular — install only the packages you need:

**Foundation (required)**

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@reactive-agents/core`          | EventBus, AgentService, TaskService, canonical types                      |
| `@reactive-agents/runtime`       | 12-phase ExecutionEngine, ReactiveAgentBuilder, `createRuntime()`         |
| `@reactive-agents/llm-provider`  | LLM adapters: Anthropic, OpenAI, Gemini, Ollama, LiteLLM (40+), Test      |

**Cognition (recommended)**

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@reactive-agents/reasoning`     | 5 strategies (ReAct, Plan-Execute, Reflexion, ToT, Adaptive) + composable kernel |
| `@reactive-agents/memory`        | 4-layer memory (working, semantic, episodic, procedural) on bun:sqlite    |
| `@reactive-agents/tools`         | Tool registry, sandbox, MCP client, healing pipeline                      |
| `@reactive-agents/prompts`       | Template engine, version-controlled prompt library                        |
| `@reactive-agents/reactive-intelligence` | Entropy sensor, reactive controller, learning engine, telemetry   |

**Production safety**

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@reactive-agents/guardrails`    | Injection, PII, toxicity detection, kill switch                           |
| `@reactive-agents/verification`  | Semantic entropy, fact decomposition, NLI hallucination detection         |
| `@reactive-agents/cost`          | 27-signal complexity routing, budget enforcement, semantic cache          |
| `@reactive-agents/identity`      | Ed25519 agent certificates, RBAC, delegation, audit                       |
| `@reactive-agents/diagnose`      | Output-leak detection (system-prompt, api-key, credential, internal)      |
| `@reactive-agents/health`        | Health checks and readiness probes                                        |

**Observability**

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@reactive-agents/observability` | OTLP tracing, MetricsCollector, structured logging                        |
| `@reactive-agents/trace`         | Trace event types and OTLP exporters                                      |

**Composition & multi-agent**

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@reactive-agents/orchestration` | Sequential, parallel, pipeline, map-reduce workflows                      |
| `@reactive-agents/a2a`           | Agent-to-Agent protocol: Agent Cards, JSON-RPC 2.0, SSE streaming         |
| `@reactive-agents/gateway`       | Persistent autonomous harness: heartbeats, crons, webhooks, policy engine |
| `@reactive-agents/channels`      | Per-sender access control + chat-mode session storage for the gateway     |
| `@reactive-agents/interaction`   | 5 autonomy modes, checkpoints, preference learning                        |

**Evaluation & testing**

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@reactive-agents/eval`          | Evaluation suites, LLM-as-judge scoring, `EvalStore` (SQLite)             |
| `@reactive-agents/scenarios`     | Pre-built test scenarios + scenario builder                               |
| `@reactive-agents/testing`       | Mock `LLMService` / `ToolService` / `EventBus`, assertion helpers (dev)   |

**Frontend integration**

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@reactive-agents/react`         | React 18+ hooks: `useAgentStream`, `useAgent`                             |
| `@reactive-agents/vue`           | Vue 3 composables: `useAgentStream`, `useAgent` with reactive refs        |
| `@reactive-agents/svelte`        | Svelte 4/5 stores: `createAgentStream`, `createAgent`                     |

**Developer tooling**

| Package                          | Description                                                               |
| -------------------------------- | ------------------------------------------------------------------------- |
| `@reactive-agents/cortex`        | Cortex Studio (Beacon, Thalamus, Lab, living skills) — `bunx @reactive-agents/cortex` |

```bash
bun add @reactive-agents/core @reactive-agents/runtime @reactive-agents/llm-provider
```

## Environment Variables

Create a `.env` file:

```bash
# LLM Provider — set at least one
ANTHROPIC_API_KEY=sk-ant-...        # Anthropic Claude
OPENAI_API_KEY=sk-...               # OpenAI GPT-4o
GOOGLE_API_KEY=...                  # Google Gemini
LITELLM_API_KEY=...                 # Optional — LiteLLM proxy auth when required

# Tools (optional)
TAVILY_API_KEY=tvly-...             # Enables built-in web search tool

# Embeddings (for enhanced / `"2"` memory tier — vector semantic search)
EMBEDDING_PROVIDER=openai           # "openai" | "ollama"
EMBEDDING_MODEL=text-embedding-3-small

# Tuning (optional)
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
LLM_DEFAULT_TEMPERATURE=0.7
LLM_MAX_RETRIES=3
LLM_TIMEOUT_MS=30000
```

## TypeScript Configuration

Reactive Agents requires TypeScript 5.5+ with strict mode:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```
