---
title: Installation
description: How to install and configure Reactive Agents.
---

## Package Manager

Reactive Agents is distributed as a set of npm packages. Use any package manager:

```bash
# Bun (recommended)
bun add @reactive-agents/core @reactive-agents/runtime effect

# npm
npm install @reactive-agents/core @reactive-agents/runtime effect

# pnpm
pnpm add @reactive-agents/core @reactive-agents/runtime effect
```

## Packages

The framework is modular. Install only what you need:

| Package | Description | Required? |
|---------|-------------|-----------|
| `@reactive-agents/core` | EventBus, AgentService, TaskService, types | Yes |
| `@reactive-agents/runtime` | ExecutionEngine, ReactiveAgentBuilder | Yes |
| `@reactive-agents/llm-provider` | LLM adapters (Anthropic, OpenAI, Ollama) | Yes |
| `effect` | Effect-TS runtime | Yes |
| `@reactive-agents/memory` | Working, Semantic, Episodic, Procedural memory | Optional |
| `@reactive-agents/reasoning` | ReAct, Plan-Execute, Tree-of-Thought | Optional |
| `@reactive-agents/tools` | Tool registry, sandbox, MCP client | Optional |
| `@reactive-agents/guardrails` | Injection, PII, toxicity detection | Optional |
| `@reactive-agents/verification` | Semantic entropy, fact decomposition | Optional |
| `@reactive-agents/cost` | Complexity routing, budget enforcement | Optional |
| `@reactive-agents/identity` | Agent certificates, RBAC | Optional |
| `@reactive-agents/observability` | Tracing, metrics, structured logging | Optional |
| `@reactive-agents/interaction` | 5 interaction modes, checkpoints | Optional |
| `@reactive-agents/orchestration` | Multi-agent workflows | Optional |
| `@reactive-agents/prompts` | Template engine, built-in prompt library | Optional |

## Install Everything

For a full-featured setup:

```bash
bun add @reactive-agents/core @reactive-agents/runtime @reactive-agents/llm-provider \
  @reactive-agents/memory @reactive-agents/reasoning @reactive-agents/tools \
  @reactive-agents/guardrails @reactive-agents/verification @reactive-agents/cost \
  @reactive-agents/identity @reactive-agents/observability @reactive-agents/interaction \
  @reactive-agents/orchestration @reactive-agents/prompts effect
```

## Environment Variables

Create a `.env` file:

```bash
# LLM Provider (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Embeddings (for Tier 2 memory)
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small

# Optional
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
LLM_MAX_RETRIES=3
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
