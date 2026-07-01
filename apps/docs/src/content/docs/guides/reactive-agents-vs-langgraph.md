---
title: Reactive Agents vs LangGraph
description: >-
  How Reactive Agents and LangGraph compare for building TypeScript AI agents —
  type safety, control flow, model support, and ecosystem. An honest, sourced
  breakdown.
sidebar:
  order: 21
badge:
  text: New in v0.12
  variant: success
  __auto: '1'
lastCommit:
  subject: 'docs(seo): add ''vs LangGraph / Mastra / Vercel AI SDK'' comparison pages'
  hash: 11be989
  date: '2026-06-25'
  daysAgo: 6
since: v0.12
---

[LangGraph](https://langchain-ai.github.io/langgraphjs/) and Reactive Agents both help you build agentic LLM systems, but they start from different premises. LangGraph models an agent as an **explicit graph state machine** — you define nodes, edges, and a shared state object, and the runtime drives transitions between them. It is part of the LangChain ecosystem, is Python-first in depth, and ships a mature TypeScript port (LangGraph.js). Reactive Agents is a **composable, typed harness** that is TypeScript-first end to end (built on [Effect-TS](https://effect.website/)), aims for the same code running on a local 4B Ollama model or a frontier API, and bundles reasoning strategies, memory, guardrails, durable execution, and HITL as opt-in layers. If you want to hand-draw control flow as a graph, LangGraph is purpose-built for that. If you want a strongly typed agent you assemble from layers without wiring a state machine, that is what Reactive Agents optimizes for.

## At a glance

| Capability | Reactive Agents | LangGraph |
|---|---|---|
| Primary language | TypeScript-first (Effect-TS) | Python-first; mature TS port (LangGraph.js) |
| Core model | Composable typed harness + builder | Explicit graph state machine (`StateGraph`) |
| Compile-time type safety | End-to-end: typed errors, schema-validated boundaries | TypeScript types on state via annotations |
| Prebuilt agent loop | `.withReasoning()` + 6 strategies | `createReactAgent` prebuilt |
| Reasoning strategies built in | ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive, Code-Action | ReAct prebuilt; others authored as custom graphs |
| Custom control flow | 12-phase engine + per-phase hooks | Arbitrary node/edge graphs (very flexible) |
| Local model parity | First-class (Ollama 4B+, same code as frontier) | Via provider integrations (e.g. `ChatOllama`) |
| Providers | Anthropic, OpenAI, Gemini, Ollama, LiteLLM (40+), Test | Any LangChain `Chat*` model integration |
| Tools | MCP-native, typed `ToolDefinition` | `tool()` + ToolNode; MCP via adapters |
| Multi-agent | A2A protocol | Supervisor / subgraph patterns, `langgraph-supervisor` |
| Persistence / resume | Durable execution + crash-resume | Checkpointers (Memory/SQLite/Postgres/Redis/Mongo) |
| Human-in-the-loop | `.withApprovalPolicy()` + approve/deny | `interrupt` + checkpointer |
| Structured output | `.withOutputSchema(zodSchema)` → `result.object` | `.withStructuredOutput()` on the model |
| Streaming | `agent.runStream()` / `streamObject()` | Stream modes: `values`, `messages`, `updates` |
| Guardrails (injection/PII/toxicity) | Built in (`.withGuardrails()`) | — |
| Cost routing + budgets | Built in | — |
| Observability | OpenTelemetry + Cortex live studio | LangSmith (deep, first-party) |
| License | MIT | MIT |

> "—" means **no first-party equivalent found as of 2026, not that none exists.** LangGraph's flexibility means many of these can be built by hand or via a community package. Corrections welcome via PR.

## Where they differ

### Type safety & DX

Reactive Agents is built on Effect-TS, so service boundaries, tool I/O, and hook contexts are typed, errors are tagged values in an explicit error channel rather than thrown exceptions, and structured output is validated against a Zod schema before it reaches you. LangGraph.js is fully usable from TypeScript and types your graph state through its annotation system, but its core design and deepest documentation are Python-first; the type system describes state shape rather than threading typed errors through the whole pipeline.

### Control flow model

This is the central philosophical split. LangGraph asks you to **draw the machine**: declare a state object, add nodes (functions that read/write state), and connect them with edges (including conditional edges that branch on state). That is enormously flexible — cycles, branches, subgraphs, and human pauses are all first-class — and it is the right tool when your control flow is genuinely a custom graph. Reactive Agents instead gives you a **fixed 12-phase execution engine** (`bootstrap → guardrail → cost-route → strategy-select → think → act → observe → verify → memory-flush → cost-track → audit → complete`) with `before`/`after`/`on-error` hooks at each phase, plus a choice of reasoning strategy. You compose behavior by adding layers rather than authoring the graph. Less raw flexibility, less wiring.

### Model support & local models

Both can talk to many providers. The difference is emphasis: Reactive Agents treats **local-to-frontier parity** as a design goal — the same builder code is meant to run on a 4B Ollama model or Claude/GPT/Gemini, with a LiteLLM provider covering 40+ more. LangGraph reaches local models through LangChain integrations (e.g. `ChatOllama`), which works well, but the framework does not specifically optimize agent behavior for small local models the way Reactive Agents does.

### Observability & ecosystem

This is a genuine LangGraph strength. [LangSmith](https://www.langchain.com/langsmith) gives LangGraph deep, first-party tracing, evaluation, and monitoring, backed by a large ecosystem and adoption base. Reactive Agents emits [OpenTelemetry](https://opentelemetry.io/) and ships Cortex, a live studio for inspecting runs — vendor-neutral and self-hostable, but a younger ecosystem with far less third-party tooling around it. If ecosystem maturity and a managed tracing/eval product matter most, LangGraph + LangSmith is hard to beat today.

## Side-by-side: a minimal agent

**Reactive Agents**

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withTools({ tools: [weatherTool] })
  .withReasoning() // ReAct by default
  .build();

const result = await agent.run("What is the weather in San Francisco?");
console.log(result.output);
```

**LangGraph.js** (prebuilt ReAct agent)

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: "claude-sonnet-4-6", temperature: 0 }),
  tools: [weatherTool],
  checkpointSaver: new MemorySaver(), // optional: enables resume
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "What is the weather in San Francisco?" }],
});
console.log(result.messages.at(-1)?.content);
```

Both are concise for the prebuilt path. The contrast shows up when you go beyond it: in LangGraph you drop down to `StateGraph` and author nodes/edges; in Reactive Agents you add builder layers (`.withMemory()`, `.withGuardrails()`, `.withApprovalPolicy()`, `.withOutputSchema()`) and hooks.

## When to choose LangGraph

- **You are already in the LangChain / LangSmith ecosystem** and want tracing, evals, and integrations that work out of the box.
- **Your team is Python-first**, or you want one framework spanning Python and TypeScript with the deepest support on the Python side.
- **You want explicit graph / state-machine control** — custom cycles, branches, and subgraphs that you draw by hand. This is LangGraph's core competency, and nothing here matches its raw flexibility for bespoke control flow.
- **You need a battle-tested, widely-adopted framework** with a large community and many production deployments today.

## When to choose Reactive Agents

- **You want type safety end to end** — Effect-TS tagged errors, schema-validated tool and output boundaries, no thrown exceptions leaking through your pipeline.
- **Local-model parity matters** — the same code runs on a 4B Ollama model and a frontier API, with LiteLLM covering 40+ more providers.
- **You prefer composing layers over wiring a graph** — opt-in `.withMemory()`, `.withGuardrails()`, `.withCostTracking()`, `.withReasoning()` instead of authoring nodes and edges.
- **You want durable execution + human-in-the-loop out of the box** — crash-resume and `.withApprovalPolicy()` approve/deny flows are first-class, not assembled from primitives.

---

Both frameworks are MIT-licensed and actively developed; the right choice depends on whether you want to draw the machine (LangGraph) or compose a typed harness (Reactive Agents). To try Reactive Agents, start with the [Quickstart](https://docs.reactiveagents.dev/guides/quickstart/). If you are moving from the LangChain ecosystem, the [Migrating from LangChain.js guide](/guides/migrating-from-langchain/) maps concepts and shows side-by-side code.
