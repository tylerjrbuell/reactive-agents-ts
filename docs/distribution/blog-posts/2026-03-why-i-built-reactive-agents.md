---
title: Why I Built Another TypeScript Agent Framework (And What's Different This Time)
published: false
tags: typescript, ai, agents, effectts
description: Every TypeScript agent framework in 2025 felt like a Python port or a monolith. This is the story of what I built instead, and why Effect-TS service layers changed everything.
---

I spent about six months frustrated with TypeScript agent frameworks before I started building my own. I want to tell you exactly what frustrated me, because it shaped every decision in reactive-agents.

## The Frustration

LangChain JS is a port. Not just conceptually — the API signatures, the abstractions, the mental model. It made sense in Python where monkey-patching is a way of life and `__call__` is a valid method. In TypeScript, the same patterns produce runtime surprises and IDE autocomplete that lies to you.

The other category was "batteries included" monoliths: frameworks that gave you everything in one import, where memory, tools, guardrails, and reasoning were all tangled together. You could do the hello-world demo in five lines, but customizing anything required forking the source. Want to swap in a different memory backend? Good luck. Want to add cost tracking? It's already in there, hardcoded, and you can't turn it off.

The problem wasn't that these frameworks were bad. It was that they were making a specific architectural choice — one monolithic, tightly coupled system — and presenting it as the only way to build agents.

I kept thinking: this is exactly the problem that dependency injection solved for backend services in 2005. Why are we repeating it?

## The Effect-TS Insight

I'd been using Effect-TS for backend work, and at some point I realized that `Layer` was exactly what I needed. Effect's `Layer` type gives you dependency injection without reflection, without decorators, without any runtime magic. Each layer declares what services it provides and what it requires. The type system enforces the dependency graph at compile time.

The insight was straightforward: if each agent capability — memory, guardrails, cost tracking, streaming, observability — is its own `Layer`, then you can compose exactly the capabilities you need via `createRuntime()`. You get the architecture of a Spring application in TypeScript, with full type safety, and zero magic.

```typescript
const runtime = createRuntime({
  agentId: "my-agent",
  provider: "anthropic",
  enableReasoning: true,
  enableGuardrails: true,
  enableCostTracking: true,
});
```

Each `enable*` flag wires a real Layer into the composition graph. Not a flag that changes behavior inside a monolith — an actual service instance that gets injected into every downstream component that needs it.

## What Composability Actually Looks Like

Here is the thing about composable architecture: it has to be invisible to the people who don't want it. If you have to understand layers to use the framework, you have failed.

So `agent.run()` is a one-liner:

```typescript
const agent = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .build();

const result = await agent.run("Summarize the top HN posts today");
```

Under the hood, `ManagedRuntime` manages shared service instances across calls, so the EventBus you subscribe to in one call is the same EventBus that fires in another. That took several design iterations to get right.

When you want the full power, `agent.runEffect()` hands you an Effect value with the complete environment. You can compose it with your own services, run it inside your existing Effect runtime, or pipe it through custom error handling.

## The Reasoning Kernel SDK

After building the layer architecture, I wanted the same composability for reasoning algorithms. Why should ReAct be hardcoded? Why should Tree-of-Thought be a different framework?

The answer was `ThoughtKernel`: a standard interface for reasoning algorithms that plugs into the same observability, guardrails, and cost tracking that every other layer uses. ReAct, Plan-Execute, Tree-of-Thought, Reflexion, Adaptive — all registered in a `StrategyRegistry`. Your custom kernel, same registry:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ strategy: "plan-execute" })
  .build();
```

Switch to `"tree-of-thought"` and you get planning, execution, and reflection with no other changes. The guardrails still apply. The cost tracking still applies. The EventBus still fires. The kernel plugs in; everything else stays.

## The Gateway Surprise

Persistent autonomous agents — the kind that run on a heartbeat, respond to webhooks, execute scheduled tasks — felt like a different product when I started. Something you'd build a separate harness for.

Turned out it was just another composable feature:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withGateway({
    heartbeat: { intervalMs: 1800000, policy: "adaptive" },
    crons: [{ schedule: "0 9 * * MON", instruction: "Review open PRs" }],
    policies: { dailyTokenBudget: 50000 },
  })
  .build();
```

Ten lines. A policy engine, adaptive heartbeat, cron scheduler, and webhook router — all layered on top of the same execution engine as the regular `.run()` path. I expected this to be the hardest part. It was one of the easiest.

## The Meta Moment

We built a community growth agent — `apps/meta-agent/` in the repo — that monitors Hacker News and Reddit for TypeScript AI discussions and drafts responses for human review. The agent runs on a Gateway heartbeat. It uses the memory layer to avoid repeating itself across runs. It routes webhook events from the GitHub adapter.

There is something clarifying about your framework eating its own cooking at this scale. Every rough edge shows up immediately. Every missing abstraction becomes obvious. The architecture has held up well, which either means we got it right or we haven't pushed it hard enough yet. Probably some of both.

## Where It Goes Next

The current project on the roadmap is the Scout Layer: collective learning across agent runs. The idea is that individual agents share patterns — successful reasoning traces, tool call results, verified facts — via a shared experience pool. Each agent gets smarter from runs it wasn't part of.

That's built on the same Layer architecture. Plug in the Scout Layer, and existing agents start benefiting from collective experience without code changes.

## Try It

Reactive-agents has 24 runnable examples in the repo that work without an API key (the test LLM provider handles it). The quickstart gets you to a running agent in under five minutes.

```bash
bun add reactive-agents
```

If you're building TypeScript agents and have opinions about framework architecture — I want to hear them. The GitHub issues are open, and I read everything.

The framework is v0.6.3, 19 packages, 1,381 tests. Still evolving, but the core architecture has been stable for several months.
