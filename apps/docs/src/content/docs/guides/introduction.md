---
title: Introduction
description: What is Reactive Agents and why should you use it?
---

Reactive Agents is a TypeScript framework for building autonomous AI agents. It's built on [Effect-TS](https://effect.website) — giving you type-safe, composable, and observable agent systems from day one.

## The Problem

Building production AI agents is hard:

- **No type safety** — Most agent frameworks are dynamically typed. Errors surface at runtime, often in production.
- **Monolithic** — You get everything or nothing. Want memory but not guardrails? Too bad.
- **Opaque** — Agent decisions are black boxes. When something goes wrong, good luck debugging.
- **Unsafe** — Prompt injection, PII leaks, and runaway costs are afterthoughts.

## The Solution

Reactive Agents solves each of these with a layered, composable architecture:

| Problem | Solution |
|---------|----------|
| No type safety | Effect-TS schemas validate every boundary |
| Monolithic | Layer system — enable only what you need |
| Opaque | 10-phase execution engine with lifecycle hooks |
| Unsafe | Built-in guardrails, verification, and cost controls |

## Key Features

### Composable Layer System

Every capability is an independent Effect Layer. Compose them like building blocks:

```typescript
const agent = await ReactiveAgents.create()
  .withMemory("1")       // Working + Semantic + Episodic memory
  .withReasoning()       // ReAct reasoning loop
  .withGuardrails()      // Injection & PII detection
  .withCostTracking()    // Budget enforcement
  .build();
```

### 10-Phase Execution Engine

Every agent task flows through a deterministic lifecycle:

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

### 5 Interaction Modes

Agents dynamically adjust their autonomy level:

- **Autonomous** — Full self-direction
- **Supervised** — Periodic checkpoints
- **Collaborative** — Back-and-forth with the user
- **Consultative** — Ask before acting
- **Interrogative** — Gather information first

Mode transitions happen automatically based on confidence thresholds, cost, and user activity.

## Who Is This For?

- **TypeScript developers** building AI-powered applications
- **Teams** that need observable, auditable agent behavior
- **Projects** that require fine-grained control over agent capabilities
- **Anyone** tired of agent frameworks that feel like magic boxes

## Next Steps

- [Quickstart](/guides/quickstart/) — Build your first agent in 5 minutes
- [Installation](/guides/installation/) — Set up your project
- [Architecture](/concepts/architecture/) — Understand the layer system
