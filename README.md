<div align="center">

# Reactive Agents

**The composable AI agent framework built on Effect-TS.**

Type-safe from prompt to production.

[![CI](https://github.com/tylerjrbuell/reactive-agents-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/tylerjrbuell/reactive-agents-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/reactive-agents)](https://www.npmjs.com/package/reactive-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Documentation](https://tylerjrbuell.github.io/reactive-agents-ts/) | [Getting Started](#quick-start) | [Architecture](#architecture)

</div>

---

## Why Reactive Agents?

Most AI agent frameworks are dynamically typed, monolithic, and opaque. Reactive Agents is different:

- **Type-safe** — Effect-TS schemas validate every boundary. Errors surface at compile time.
- **Composable** — Enable only the layers you need. Memory, reasoning, guardrails, cost — mix and match.
- **Observable** — 10-phase execution engine with lifecycle hooks. Every agent decision is inspectable.
- **Safe** — Built-in guardrails (injection, PII, toxicity), verification, and budget controls.

## Quick Start

```bash
bun add reactive-agents
```

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("research-assistant")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withMemory("1")
  .withReasoning()
  .withGuardrails()
  .build();

const result = await agent.run("Summarize the key findings from this paper");
console.log(result.output);
```

## Architecture

```
ReactiveAgentBuilder
  → createRuntime()
    → Core Services     (EventBus, AgentService, TaskService)
    → LLM Provider      (Anthropic, OpenAI, Ollama)
    → Memory            (Working, Semantic, Episodic, Procedural)
    → Reasoning         (ReAct, Plan-Execute, Tree-of-Thought)
    → Tools             (Registry, Sandbox, MCP)
    → Guardrails        (Injection, PII, Toxicity, Contracts)
    → Verification      (Semantic Entropy, Fact Decomposition)
    → Cost              (Complexity Router, Budget Enforcer)
    → Interaction       (5 Modes, Checkpoints, Collaboration)
    → Orchestration     (Multi-Agent Workflows)
    → ExecutionEngine   (10-phase lifecycle with hooks)
```

Every layer is an Effect `Layer` — composable, testable, and tree-shakeable. Enable only what you need.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@reactive-agents/core`](packages/core) | EventBus, AgentService, TaskService, types | Stable |
| [`@reactive-agents/runtime`](packages/runtime) | ExecutionEngine, ReactiveAgentBuilder | Stable |
| [`@reactive-agents/llm-provider`](packages/llm-provider) | LLM adapters (Anthropic, OpenAI, Ollama) | Stable |
| [`@reactive-agents/memory`](packages/memory) | Working, Semantic, Episodic, Procedural memory | Stable |
| [`@reactive-agents/reasoning`](packages/reasoning) | ReAct, Plan-Execute, ToT strategies | Stable |
| [`@reactive-agents/tools`](packages/tools) | Tool registry, sandbox, MCP client | Stable |
| [`@reactive-agents/guardrails`](packages/guardrails) | Injection, PII, toxicity detection | Stable |
| [`@reactive-agents/verification`](packages/verification) | Semantic entropy, fact decomposition | Stable |
| [`@reactive-agents/cost`](packages/cost) | Complexity routing, budget enforcement | Stable |
| [`@reactive-agents/identity`](packages/identity) | Agent certificates, RBAC | Stable |
| [`@reactive-agents/observability`](packages/observability) | Tracing, metrics, structured logging | Stable |
| [`@reactive-agents/interaction`](packages/interaction) | 5 interaction modes, checkpoints | Stable |
| [`@reactive-agents/orchestration`](packages/orchestration) | Multi-agent workflow engine | Stable |
| [`@reactive-agents/prompts`](packages/prompts) | Template engine, built-in prompt library | Stable |
| [`@reactive-agents/cli`](apps/cli) | `rax` CLI for scaffolding and running | Stable |

## 10-Phase Execution Engine

Every task flows through a deterministic lifecycle:

1. **Bootstrap** — Load memory context
2. **Guardrail** — Safety checks on input
3. **Cost Route** — Select optimal model
4. **Strategy Select** — Choose reasoning strategy
5. **Think** — LLM completion
6. **Act** — Tool execution
7. **Observe** — Append results
8. **Verify** — Fact-check output
9. **Memory Flush** — Persist session
10. **Complete** — Return result

Each phase supports `before`, `after`, and `on-error` lifecycle hooks.

## 5 Interaction Modes

Agents dynamically adjust their autonomy:

| Mode | Autonomy | When |
|------|----------|------|
| Autonomous | Full | High confidence, routine tasks |
| Supervised | High | Periodic checkpoints |
| Collaborative | Medium | Complex decisions |
| Consultative | Low | High-cost or risky actions |
| Interrogative | Minimal | Information gathering |

Mode transitions happen automatically based on confidence, cost, and user activity.

## CLI (`rax`)

```bash
rax init my-project --template full    # Scaffold a project
rax create agent my-bot --recipe researcher  # Generate an agent
rax run "Explain quantum computing" --provider anthropic  # Run an agent
```

## Development

```bash
bun install              # Install dependencies
bun test                 # Run all tests (283 tests, 52 files)
bun run build            # Type-check all packages

# Docs
bun run docs:dev         # Start docs dev server (http://localhost:4321)
bun run docs:build       # Build docs for production
bun run docs:preview     # Preview built docs locally
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...     # Anthropic API key
OPENAI_API_KEY=sk-...            # OpenAI API key (alternative)
EMBEDDING_PROVIDER=openai        # For Tier 2 memory
EMBEDDING_MODEL=text-embedding-3-small
```

## Testing

The framework includes a built-in test LLM provider for deterministic tests:

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("test")
  .withTestResponses({
    "capital of France": "Paris is the capital of France.",
  })
  .build();

const result = await agent.run("What is the capital of France?");
// result.output contains "Paris is the capital of France."
```

## License

MIT
