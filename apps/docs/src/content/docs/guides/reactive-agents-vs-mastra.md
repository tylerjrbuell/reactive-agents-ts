---
title: Reactive Agents vs Mastra
description: >-
  How Reactive Agents and Mastra compare for building TypeScript AI agents —
  type safety, reasoning strategies, local models, durability, and DX. An
  honest, sourced breakdown.
sidebar:
  order: 22
---

Both Reactive Agents and [Mastra](https://mastra.ai) are TypeScript-first frameworks for building AI agents, and both are genuinely good. The core difference is one of emphasis: Reactive Agents leans on **Effect-TS for end-to-end, compile-time type safety**, plus **reasoning-strategy depth** and **local-to-frontier model parity**; Mastra leans on **batteries-included DX** — a mature graph workflow engine, a polished local studio, a broad RAG/vector ecosystem, and a hosted cloud story. If you want maximum type rigor and pluggable reasoning, read on. If you want the fastest path from zero to a running, well-tooled agent app, Mastra is a strong default and we say so plainly below.

> Mastra moves fast. Details below were verified against [mastra.ai](https://mastra.ai) and its docs as of June 2026; if something is out of date, corrections are welcome via PR.

## At a glance

| Capability | Reactive Agents | Mastra |
|---|---|---|
| Language | TypeScript on Effect-TS | TypeScript (Vercel AI SDK lineage) |
| Type model | End-to-end typed: schema-validated boundaries, tagged errors, typed effects | Strong TypeScript types; standard async/throw error handling |
| Agent definition | `ReactiveAgents.create().withProvider(...).build()` | `new Agent({ id, name, instructions, model })` |
| Reasoning strategies | 6 pluggable (ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive, Code-Action) | Single tool-calling agent loop; multi-step logic via the workflow engine |
| Workflow engine | 12-phase execution engine with per-phase hooks | Graph workflows (`.then()`, `.branch()`, `.parallel()`) |
| RAG / vector stores | Via tools + memory; bring your own store | First-party RAG pipeline (chunk, embed, store, rerank) across many vector DBs |
| Memory | 4 layers (working / semantic / episodic / procedural) | Conversation history, semantic recall, working + observational memory |
| Local / small models | First-class: same code on Ollama 4B+ and frontier APIs; 4-tier context profiles | Supported via the model router; no dedicated small-model tuning found ¹ |
| Providers | Anthropic, OpenAI, Gemini, Ollama, LiteLLM (40+), Test | Model router across 40+ providers / many models |
| Structured output | `.withOutputSchema(zodSchema)` → typed `result.object` | Structured output via the underlying SDK |
| Durable execution | Built-in durable runs + crash-resume | Workflow suspend/resume; durable runs via the workflow engine |
| Human-in-the-loop | `.withApprovalPolicy()` + approve/deny/resume | Workflow suspend awaiting input/approval |
| Observability | OpenTelemetry; Cortex live studio | Built-in tracing; Mastra Studio playground |
| Evals | `evals` package | First-party evals (model-graded, rule-based, statistical) |
| Local dev UI | Cortex studio | Mastra Studio (`localhost:4111`) |
| Hosted cloud | — ¹ | Mastra Cloud (hosted deployment) |
| License | MIT | Apache 2.0 core; source-available Enterprise license for `ee/` |

¹ "—" means no first-party equivalent was found as of 2026; corrections welcome via PR.

## Where they differ

### Type system

This is the sharpest line between the two. Reactive Agents is built on **Effect-TS**: provider boundaries, tool I/O, and structured output are schema-validated, failures are **tagged errors** carried in the type signature rather than thrown, and capabilities compose as typed effects. The compiler tells you when a provider, tool, or output contract changes shape.

Mastra is also written in TypeScript with strong types, but it follows conventional `async`/`await` with thrown errors and SDK-typed results. That is familiar and productive for most teams; it just does not model failures and effects in the type system the way Effect-TS does. If "if it compiles, the wiring is correct" matters to you, Reactive Agents goes further. If you find Effect-TS's learning curve a tax, Mastra's plainer model may be the better fit.

### Reasoning strategies

Reactive Agents ships **six pluggable reasoning strategies** — ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive, and Code-Action (experimental) — selectable per agent, plus an Adaptive strategy that switches based on the task. The reasoning loop is a 12-phase deterministic engine with `before`/`after`/`on-error` hooks at every phase.

Mastra's agent is a **single tool-calling loop** that iterates until the model emits a final answer or a stop condition is met. For multi-step or branching logic, Mastra steers you to its **graph workflow engine** (`.then()`, `.branch()`, `.parallel()`), which is mature and explicit. So both can do multi-step work — Reactive Agents expresses it as swappable reasoning policies inside the agent; Mastra expresses it as an explicit workflow graph around the agent.

### Local / small-model support

Reactive Agents treats **local models as first-class**. The same agent code runs on a 4B-parameter Ollama model and on a frontier API, and **model-adaptive context profiles (4 tiers)** reshape prompting and context budgeting to help small local models behave. This is a deliberate design goal, not an afterthought.

Mastra reaches local models through its model router (including Ollama-class providers), so you can absolutely run locally. We did not find first-party tooling specifically aimed at squeezing reliability out of small local models the way the tiered context profiles do — if that is central to your use case, Reactive Agents is built for it.

### Durability & HITL

Both frameworks can pause and resume long-running work. Reactive Agents provides **durable execution with crash-resume** and **human-in-the-loop approvals** as agent-level primitives: `.withApprovalPolicy()`, then `approveRun` / `denyRun` / `listPendingApprovals`, with the run state persisted so it survives a process restart.

Mastra implements durability and HITL primarily through its **workflow engine**: a workflow can `suspend` awaiting user input or approval and `resume` later. Same outcome, different home — RA puts these on the agent; Mastra puts them on the workflow.

### Observability

Reactive Agents emits **OpenTelemetry** spans and ships **Cortex**, a live studio for inspecting runs. Mastra has **built-in tracing** and the **Mastra Studio** playground (served at `localhost:4111`) for building, testing, and managing agents, workflows, and tools. Both give you a real local feedback loop; Mastra's studio is more mature as a general-purpose build/test UI today.

## Side-by-side: a minimal agent

**Reactive Agents**

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .build();

const result = await agent.run("Summarize the latest release notes.");
console.log(result.output);
```

Add a typed output contract, and the result is typed and validated:

```typescript
import { z } from "zod";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withOutputSchema(z.object({ summary: z.string(), risk: z.enum(["low", "high"]) }))
  .build();

const result = await agent.run("Summarize and rate the release.");
result.object.summary; // typed string
result.object.risk;    // "low" | "high"
```

**Mastra**

```typescript
import { Agent } from "@mastra/core/agent";

export const agent = new Agent({
  id: "summary-agent",
  name: "Summary Agent",
  instructions: "You are a helpful assistant that summarizes text.",
  model: "openai/gpt-5.5", // provider/model via Mastra's model router
});

const response = await agent.generate("Summarize the latest release notes.");
// or stream tokens:
const stream = await agent.stream("Summarize the latest release notes.");
```

Both are concise. Reactive Agents uses a fluent builder so capabilities (memory, strategy, output schema, durability, approvals) are opt-in `.with*()` layers; Mastra uses a config object on the `Agent` constructor and registers agents on a central `Mastra` instance.

## When to choose Mastra

Mastra is the better fit when:

- **You want batteries-included DX fast.** A polished local studio (`localhost:4111`), a broad template gallery, and a mature getting-started path get you to a running app quickly.
- **RAG is central.** Mastra ships a first-party retrieval pipeline — chunking, embeddings, vector storage, similarity search, and reranking — across many vector databases (Pinecone, pgvector, Qdrant, Chroma, and more).
- **You think in workflows.** Its graph engine (`.then()`, `.branch()`, `.parallel()`, suspend/resume) is a clean, explicit way to model multi-step and branching processes.
- **You want a hosted deployment story.** Mastra Cloud offers a managed path to production.
- **You prefer plain TypeScript** over learning Effect-TS, and value a large, active community (1.0 shipped Jan 2026; 22k+ GitHub stars; 300k+ weekly npm downloads at that milestone).

## When to choose Reactive Agents

Reactive Agents is the better fit when:

- **End-to-end type safety matters.** Effect-TS gives schema-validated boundaries, tagged errors in the type signature, and typed effects — the compiler catches wiring mistakes before runtime.
- **You want pluggable reasoning.** Six strategies (ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive, Code-Action) selectable per agent, on a 12-phase engine with per-phase hooks.
- **Local-to-frontier parity is a requirement.** The same code runs on a 4B Ollama model and on Claude/GPT/Gemini, with 4-tier context profiles tuned to make small local models reliable.
- **You need durable execution and HITL as agent primitives.** Crash-resume runs plus `.withApprovalPolicy()` approval gates, persisted across restarts.
- **You like composable, opt-in layers.** Memory, guardrails (injection/PII/toxicity), cost routing + budgets, structured output, and OpenTelemetry observability are `.with*()` additions you turn on only when you need them. MIT-licensed, 33 packages, Bun + Node.js 22.5+.

---

Both frameworks are credible choices, and the honest answer is that the right one depends on what you are optimizing for. If you want to try Reactive Agents, start with the [quickstart](https://docs.reactiveagents.dev/guides/quickstart/).
