---
title: Installation
description: How to install and configure Reactive Agents.
---

## Simple Install

The easiest way to get started is with the `reactive-agents` meta-package, which bundles everything:

```bash
# Bun (recommended)
bun add reactive-agents effect

# npm
npm install reactive-agents effect

# pnpm
pnpm add reactive-agents effect
```

Then import from a single entry point:

```typescript
import { ReactiveAgents } from "reactive-agents";
```

## Modular Install

The framework is modular — install only the packages you need:

| Package | Description | Required? |
|---------|-------------|-----------|
| `@reactive-agents/core` | EventBus, AgentService, TaskService, types | Yes |
| `@reactive-agents/runtime` | ExecutionEngine, ReactiveAgentBuilder | Yes |
| `@reactive-agents/llm-provider` | LLM adapters (Anthropic, OpenAI, Gemini, Ollama) | Yes |
| `effect` | Effect-TS runtime | Yes |
| `@reactive-agents/memory` | Working, Semantic, Episodic, Procedural memory | Optional |
| `@reactive-agents/reasoning` | ReAct, Plan-Execute, Tree-of-Thought, Reflexion | Optional |
| `@reactive-agents/tools` | Tool registry, sandbox, MCP client | Optional |
| `@reactive-agents/guardrails` | Injection, PII, toxicity detection | Optional |
| `@reactive-agents/verification` | Semantic entropy, fact decomposition | Optional |
| `@reactive-agents/cost` | Complexity routing, budget enforcement | Optional |
| `@reactive-agents/identity` | Agent certificates, RBAC | Optional |
| `@reactive-agents/observability` | Tracing, metrics, structured logging | Optional |
| `@reactive-agents/interaction` | 5 interaction modes, checkpoints | Optional |
| `@reactive-agents/orchestration` | Multi-agent workflows | Optional |
| `@reactive-agents/prompts` | Template engine, built-in prompt library | Optional |

```bash
bun add @reactive-agents/core @reactive-agents/runtime @reactive-agents/llm-provider effect
```

## Environment Variables

Create a `.env` file:

```bash
# LLM Provider — set at least one
ANTHROPIC_API_KEY=sk-ant-...        # Anthropic Claude
OPENAI_API_KEY=sk-...               # OpenAI GPT-4o
GOOGLE_API_KEY=...                  # Google Gemini

# Tools (optional)
TAVILY_API_KEY=tvly-...             # Enables built-in web search tool

# Embeddings (for Tier 2 semantic memory)
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
