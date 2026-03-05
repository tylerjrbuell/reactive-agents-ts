---
name: reactive-agents-framework
description: Build specialized production agents with the Reactive Agents builder using accurate layer composition and use-case-driven configuration.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/runtime and Effect-TS layers.
metadata:
  author: reactive-agents
  version: "1.0"
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

## Expected implementation output

- A concrete `ReactiveAgents.create()` builder chain tailored to the target use case.
- Any required transport/tool configuration (`withMCP`, `withA2A`, `withGateway`) with safe defaults.
- Validation path: focused package tests, then full build if scope is broad.

## Pitfalls to avoid

- Enabling many layers without a clear use-case objective.
- Skipping observability for long-running or delegated workflows.
- Using implicit model defaults when reproducibility matters.
