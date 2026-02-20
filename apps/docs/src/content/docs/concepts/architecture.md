---
title: Architecture
description: The layered architecture of Reactive Agents.
---

Reactive Agents uses a layered, composable architecture built on Effect-TS.

## Layer Stack

```
                    ┌─────────────────────────┐
                    │    ReactiveAgentBuilder  │  Public API
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      ExecutionEngine     │  10-phase lifecycle
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
    ┌────▼────┐            ┌─────▼─────┐           ┌─────▼─────┐
    │  Memory │            │ Reasoning │           │   Tools   │
    │ (L2)    │            │ (L3)      │           │ (L8)      │
    └────┬────┘            └─────┬─────┘           └─────┬─────┘
         │                       │                       │
    ┌────▼────────────────────────▼───────────────────────▼────┐
    │                    LLM Provider (L1.5)                    │
    └────────────────────────────┬─────────────────────────────┘
                                 │
    ┌────────────────────────────▼─────────────────────────────┐
    │           Core Services (L1)                             │
    │   EventBus  ·  AgentService  ·  TaskService              │
    └──────────────────────────────────────────────────────────┘
```

## Optional Layers

These can be enabled independently:

| Layer | Package | What It Does |
|-------|---------|-------------|
| Guardrails | `@reactive-agents/guardrails` | Input/output safety |
| Verification | `@reactive-agents/verification` | Fact-checking, semantic entropy |
| Cost | `@reactive-agents/cost` | Model routing, budget enforcement |
| Identity | `@reactive-agents/identity` | Agent certificates, RBAC |
| Observability | `@reactive-agents/observability` | Tracing, metrics, logging |
| Interaction | `@reactive-agents/interaction` | 5 autonomy modes |
| Orchestration | `@reactive-agents/orchestration` | Multi-agent workflows |
| Prompts | `@reactive-agents/prompts` | Template engine |

## Dependency Graph

```
Core ← LLM Provider ← Memory
                     ← Reasoning
                     ← Tools

Core ← Guardrails (standalone)
     ← Verification (standalone)
     ← Cost (standalone)
     ← Identity (standalone)
     ← Observability (standalone)
     ← Interaction (needs EventBus)
     ← Orchestration (standalone)
     ← Prompts (standalone)
```

## How Layers Compose

Every layer is an Effect `Layer` — a recipe for building a service. Layers compose through `Layer.merge` and `Layer.provide`:

```typescript
import { createRuntime } from "@reactive-agents/runtime";

// The runtime composes all enabled layers into a single Layer
const runtime = createRuntime({
  agentId: "my-agent",
  provider: "anthropic",
  enableGuardrails: true,
  enableReasoning: true,
  enableCostTracking: true,
});

// This Layer provides ALL services needed by the ExecutionEngine
```

This means:
- **No singletons** — Each agent gets its own service instances
- **No global state** — Everything is scoped to the Layer
- **Testable** — Swap any layer with a test implementation
- **Tree-shakeable** — Disabled layers aren't loaded
