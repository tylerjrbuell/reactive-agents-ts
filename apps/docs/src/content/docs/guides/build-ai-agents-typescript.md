---
title: How to Build AI Agents in TypeScript
description: >-
  A practical guide to building AI agents in TypeScript — reasoning loops, tool
  calling, memory, streaming, and running the same agent on local Ollama models
  or frontier APIs.
sidebar:
  label: Build AI Agents in TypeScript
  order: 2
badge:
  text: New in v0.12
  variant: success
  __auto: '1'
lastCommit:
  subject: >-
    docs(badges): unified badge system — sync-page-metadata replaces
    new-page-indicator
  hash: 857138c
  date: '2026-07-01'
since: v0.12
---

If you want to **build AI agents in TypeScript** — agents that reason, call tools, remember context, and stream results into your app — this guide is the map. It explains what an agent actually is, the pieces you need for production, and how to assemble them with [Reactive Agents](https://docs.reactiveagents.dev), a type-safe TypeScript agent framework built on [Effect-TS](https://effect.website).

## What is an AI agent?

An AI agent is an LLM wrapped in a loop. Instead of answering once, it **thinks**, **acts** (calls a tool), **observes** the result, and repeats until the task is done. That loop — plus the machinery to keep it safe, observable, and affordable — is what an agent framework gives you, so you don't hand-roll retry logic, tool parsing, and context management for every project.

TypeScript is a strong fit for agents: you get end-to-end types across tool inputs/outputs and model responses, the same language on server and client, and the npm ecosystem. Reactive Agents leans into that — every tool, hook, and result is a typed value, and errors are tagged rather than thrown.

## The quickest path

Install the umbrella package and run your first agent in under a minute:

```bash
bun add reactive-agents
# or: npm install reactive-agents
```

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .build();

const result = await agent.run("Explain quantum entanglement in two sentences.");
console.log(result.output);
console.log(result.metadata); // { duration, cost, tokensUsed, stepsCount }
```

That's a working agent. Everything below is **opt-in** — you add capabilities one `.with()` call at a time, and only pay for what you enable. See the [Quickstart](/guides/quickstart/) for a guided version.

## What you need to build production agents

A toy agent is one LLM call. A production agent needs more, and each piece is a composable layer:

### A reasoning loop

The think → act → observe cycle. Reactive Agents ships six strategies — ReAct, Reflexion, Plan-Execute, Tree-of-Thought, Adaptive, and Code-Action — and switches between them when a task calls for it. Add it with `.withReasoning()`.
→ [Reasoning Strategies](/guides/reasoning/) · [Choosing a Strategy](/guides/choosing-strategies/)

### Tools and tool calling

Agents act by calling tools. Define your own with a typed builder, or plug in any MCP server (filesystem, GitHub, databases, browsers, and thousands more). Adaptive tool calling routes between native function-calling and text-parsing so the same code works on frontier and small local models.
→ [Tools guide](/guides/tools/) · [Tutorial: agent with tool calling + MCP](/cookbook/agent-tool-calling-mcp/)

### Memory

Working, episodic, semantic (vector + full-text), and procedural memory let an agent carry context across steps and sessions. Add it with `.withMemory()`.
→ [Memory guide](/guides/memory/)

### Streaming

Stream tokens into your UI as they generate, with cancellation. Bridge a server agent to a browser with one line of SSE, and consume it with first-party React, Vue, and Svelte adapters.
→ [Web Integration](/guides/web-integration/) · [Tutorial: add an agent to Next.js](/cookbook/nextjs-ai-agent/)

### Safety, cost, and observability

Production agents need guardrails (injection/PII/toxicity), budgets and model routing to control spend, and tracing to see every decision. Each is one builder call: `.withGuardrails()`, `.withBudget()`, `.withObservability()`.
→ [Guardrails](/guides/guardrails/) · [Cost Optimization](/guides/cost-optimization/) · [Production Checklist](/guides/production-checklist/)

### Local-to-frontier portability

The same agent code runs on a 4B-parameter local Ollama model and on Claude, GPT, or Gemini — swap one line. Model-adaptive context profiles tune prompts and compaction so small models punch above their weight.
→ [Local Models](/guides/local-models/) · [Tutorial: build a local agent with Ollama](/cookbook/local-agent-ollama/)

## A more complete agent

Composed, this is what a real agent looks like — a research agent with tools, memory, and a budget cap:

```typescript
import { ReactiveAgents, HarnessProfile } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("research-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withProfile(HarnessProfile.balanced()) // memory + reactive intelligence + verifier
  .withTools()                            // built-in tools + MCP
  .withMaxIterations(15)
  .withBudget({ tokenLimit: 100_000 })    // hard spend cap
  .build();

const result = await agent.run("Research the latest TypeScript 6 features and summarize them.");
```

`HarnessProfile.balanced()` turns on the production default set in one line; `lean()` and `intelligent()` are the other presets. See [Choosing a Stack](/guides/choosing-a-stack/).

## Pick your next step

Hands-on tutorials, each a complete build:

- **[Build a local AI agent with Ollama](/cookbook/local-agent-ollama/)** — private, no API key, runs on your machine.
- **[Agent with tool calling and MCP](/cookbook/agent-tool-calling-mcp/)** — give your agent the ability to act.
- **[Add an AI agent to a Next.js app](/cookbook/nextjs-ai-agent/)** — stream an agent into a React UI.

More patterns live in the [Cookbook](/cookbook/building-tools/).

## How does it compare?

If you're evaluating TypeScript agent frameworks, see the honest, sourced breakdowns:

- [Reactive Agents vs LangGraph](/guides/reactive-agents-vs-langgraph/)
- [Reactive Agents vs Mastra](/guides/reactive-agents-vs-mastra/)
- [Reactive Agents vs Vercel AI SDK](/guides/reactive-agents-vs-vercel-ai-sdk/)
- [Migrating from LangChain.js](/guides/migrating-from-langchain/)

## Why Reactive Agents

Most agent frameworks are dynamically typed, monolithic, and opaque — they assume a frontier model and hide every decision. Reactive Agents is the opposite: **end-to-end type-safe**, **composable** (enable only what you need), **observable** (a 12-phase execution engine with hooks on every phase), and **model-agnostic** (the same code from local Ollama to frontier APIs). It's MIT-licensed and published as 33 packages on npm.

Ready to build? Start with the [Quickstart](/guides/quickstart/) or [Your First Agent](/guides/your-first-agent/).
