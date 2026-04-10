---
name: reactive-agents
description: Orient to the Reactive Agents framework, understand the builder API shape, and select the right capability skills for your task.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "discovery"
---

# Reactive Agents — Framework Orientation

## Agent objective

After loading this skill you know: (1) what the framework does, (2) the canonical builder chain pattern, (3) which capability skills to load for the task at hand.

## Framework overview

Reactive Agents is an Effect-TS layered runtime for building autonomous AI agents in TypeScript. Agents are composed via a fluent `ReactiveAgentBuilder` — each `.withX()` call wires in an optional capability layer. The runtime ships 25 packages covering reasoning, memory, tools, MCP, guardrails, identity, observability, orchestration, cost, verification, eval, A2A networking, and web framework integrations (React, Vue, Svelte).

Six LLM providers are supported: `anthropic`, `openai`, `gemini`, `ollama`, `litellm`, and `test`.

## Canonical builder pattern

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")          // required
  .withModel("claude-sonnet-4-6")     // optional — uses provider default if omitted
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 10 })
  .withTools()                        // enables all built-in tools
  .withMemory({ tier: "enhanced", dbPath: "./agent.db" })
  .withObservability({ verbosity: "normal", live: true })
  .build();                           // always await — returns Promise<ReactiveAgent>

const result = await agent.run("Your task here");
console.log(result.output);
console.log(result.metadata.stepsCount, result.metadata.strategyUsed);
```

## Skill routing — select by what you're building

| Building... | Load these skills |
|---|---|
| Any agent (start here) | `builder-api-reference` |
| Task agent (research, analysis, coding) | `reasoning-strategy-selection`, `tool-creation` |
| Agent that runs shell commands | `shell-execution-sandbox` |
| Agent with persistent memory | `memory-patterns`, `context-and-continuity` |
| Agent using MCP tools | `mcp-tool-integration` |
| Always-on / scheduled agent | `gateway-persistent-agents` |
| Multi-agent workflow | `multi-agent-orchestration` |
| Agent embedded in a web app | `ui-integration`, `interaction-autonomy` |
| Production / multi-tenant agent | `identity-and-guardrails`, `cost-budget-enforcement` |
| Agent with output quality guarantees | `reasoning-strategy-selection`, `quality-assurance` |
| Agent-to-agent networking | `a2a-agent-networking` |
| Custom provider behavior or local models | `provider-patterns` |

## Recipe skills — complete reference implementations

Load a recipe skill for a full working example:

| Recipe | What it builds |
|---|---|
| `recipe-research-agent` | Research/analysis agent with memory + verification |
| `recipe-code-assistant` | Code generation + sandboxed shell execution |
| `recipe-persistent-monitor` | Always-on monitoring via gateway + crons |
| `recipe-orchestrated-workflow` | Multi-agent pipeline, lead/worker pattern |
| `recipe-saas-agent` | Multi-tenant agent with identity + cost controls |
| `recipe-embedded-app-agent` | Agent in React/Vue/Svelte with streaming UI |

## Builder factory methods

```ts
ReactiveAgents.create()                      // blank builder
ReactiveAgents.fromConfig(config)            // from AgentConfig object
ReactiveAgents.fromJSON(json)                // from JSON string
ReactiveAgents.runOnce("task", builder)      // build + run + dispose in one call
builder.buildEffect()                        // returns Effect<ReactiveAgent> for Effect runtimes
```

## Pitfalls

- `.build()` is async — always `await` it; forgetting causes silent "agent is undefined" errors
- `.withProvider()` is required — there is no default provider
- `.withTools()` with no args enables **all** built-in tools including `file-write` and `shell-execute`; use `allowedTools` to restrict
- Strategy name is `"plan-execute-reflect"` — **not** `"plan-execute"` (throws `StrategyNotFoundError`)
- Memory tiers are `"standard"` and `"enhanced"` — **not** `"1"` and `"2"` (those are deprecated)
- `"groq"` and `"openrouter"` are not valid provider names — use `"litellm"` for proxy/router providers
