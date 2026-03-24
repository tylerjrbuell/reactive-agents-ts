---
name: reactive-agents-framework
description: Build specialized production agents with the Reactive Agents builder using accurate layer composition and use-case-driven configuration.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/runtime and Effect-TS layers.
metadata:
  author: reactive-agents
  version: "1.1"
---

# Reactive Agents Framework

Use this skill as the primary guide for building specialized agents for concrete use cases.

## Agent objective

When an agent is asked to build with this framework, it should:

- Choose the smallest builder composition that satisfies the use case.
- Prefer explicit layer configuration over implicit defaults.
- Produce runnable code that composes correctly with existing runtime features.

## What this skill does

- Maps use cases to concrete builder compositions.
- Applies safe defaults for reasoning, tools, memory, guardrails, and observability.
- Recommends validation flow (targeted tests first, then broader build/test).

## Specialized agent templates

```ts
const researchAgent = await ReactiveAgents.create()
  .withName("research-agent")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools()
  .withVerification()
  .withObservability({ verbosity: "normal", live: true })
  .build();
```

```ts
const scheduledOpsAgent = await ReactiveAgents.create()
  .withName("scheduled-ops-agent")
  .withProvider("openai")
  .withTools()
  .withGateway({
    heartbeat: { intervalMs: 1800000, policy: "adaptive" },
    crons: [{ schedule: "0 9 * * MON", instruction: "Review open PRs" }],
  })
  .build();
```

## Use-case guidance

- Research/synthesis: reasoning + tools + verification.
- Persistent automation: gateway + policies + observability.
- Integration-heavy agents: tools + MCP + guardrails.
- Multi-agent systems: A2A + agent-tool delegation + orchestration.
- Conversational Q&A: `agent.chat()` for direct questions, `agent.session()` for multi-turn.
- Self-improving agents: `.withSkills()` + `.withReactiveIntelligence()` for skill discovery, activation, and evolution.
- Production hardening: `withFallbacks()`, `withLogging()`, `withErrorHandler()`, `withHealthCheck()`.

## Conversational patterns

```ts
// Single conversational turn (routes directly to LLM for questions, ReAct for tool tasks)
const reply = await agent.chat("What did you accomplish last run?");
console.log(reply.message);

// Multi-turn session with history
const session = agent.session();
await session.chat("Start researching quantum computing");
await session.chat("Summarize what you found so far");
await session.end();

// Persistent session — survives process restarts
const session = agent.session({ persist: true, id: "research-001" });
await session.chat("Continue where we left off");
```

## Production hardening

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withFallbacks({ providers: ["anthropic", "openai"], errorThreshold: 2 })
  .withLogging({ level: "info", format: "json", output: "file", filePath: "/var/log/agent.jsonl" })
  .withErrorHandler((err, ctx) => metrics.increment("agent.error", { phase: ctx.phase }))
  .withHealthCheck()
  .withStrictValidation()  // Throws at build time if config is incomplete
  .build();

const health = await agent.health();
console.log(health.status); // "healthy" | "degraded" | "unhealthy"
```

## Living Skills

```ts
// Self-improving agent with skill discovery and evolution
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withSkills({
    paths: ["./project-skills/"],
    evolution: { mode: "auto", refinementThreshold: 5 },
    overrides: { "critical-workflow": { evolutionMode: "locked" } },
  })
  .withReactiveIntelligence({
    onSkillActivated: (skill, trigger) => console.log(`Skill ${skill.name} activated via ${trigger}`),
    constraints: { protectedSkills: ["critical-workflow"] },
    autonomy: "full",
  })
  .build();

// Runtime skill management
const skills = await agent.skills();
await agent.exportSkill("data-analysis", "./exported/");
await agent.loadSkill("./new-skill/");
await agent.refineSkills();
```

## Expected implementation output

- A concrete `ReactiveAgents.create()` builder chain tailored to the target use case.
- Any required transport/tool configuration (`withMCP`, `withA2A`, `withGateway`) with safe defaults.
- Validation path: focused package tests, then full build if scope is broad.

## Pitfalls to avoid

- Enabling many layers without a clear use-case objective.
- Skipping observability for long-running or delegated workflows.
- Using implicit model defaults when reproducibility matters.
- Not calling `dispose()` (or using `await using`) when MCP transports are active.
