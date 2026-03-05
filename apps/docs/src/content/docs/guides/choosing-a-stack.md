---
title: Choosing a Stack
description: Pick the right provider, model tier, memory, and reasoning strategy for your workload.
sidebar:
  order: 10
---

Use this guide to choose a default stack quickly, then tune for cost and reliability.

## Default Recommendation

For most production apps:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools()
  .withMemory("1")
  .withGuardrails()
  .withCostTracking()
  .withObservability({ verbosity: "normal" })
  .build();
```

## Decision Matrix

| Decision | Start here | Move when |
|---|---|---|
| Provider | Anthropic | You need local/offline (`ollama`) or existing proxy infra (`litellm`) |
| Model tier | Mid/high capability | Latency or budget pressure dominates quality |
| Memory tier | Tier 1 | You need semantic similarity retrieval (Tier 2 vectors) |
| Reasoning strategy | Adaptive | Workload is consistent and you want deterministic behavior |
| Tools | Built-ins only | You need external systems via MCP/custom tools |

## Strategy Selection Cheat Sheet

| Workload | Strategy |
|---|---|
| API automation / deterministic tool work | `reactive` |
| Long multi-step tasks with explicit plans | `plan-execute` |
| Exploration and branching ideas | `tree-of-thought` |
| Self-critique and iterative improvement | `reflexion` |
| Mixed unknown workloads | `adaptive` |

## Cost-First vs Quality-First Profiles

### Cost-first profile

```typescript
.withProvider("ollama")
.withModel("qwen3.5")
.withContextProfile({ tier: "local", toolResultMaxChars: 800 })
.withReasoning({ defaultStrategy: "reactive" })
.withMaxIterations(6)
```

### Quality-first profile

```typescript
.withProvider("anthropic")
.withModel("claude-sonnet-4-20250514")
.withReasoning({ defaultStrategy: "adaptive" })
.withMemory("2")
.withVerification()
.withMaxIterations(20)
```

## Team-Based Starting Points

### Internal copilots
- Guardrails + identity + audit
- Tier 1 memory
- Adaptive strategy
- Normal observability

### Autonomous operations agents
- Gateway + policies + kill switch
- Strong budgets and alerts
- Event subscriptions for suppression/exhaustion events

### Research/reporting agents
- Tools + verification + memory tier 2
- Plan-execute or reflexion
- Higher max iterations

## Anti-Patterns to Avoid

- Turning on all layers before proving need
- Using Tier 2 memory without embedding provider configured
- Long max iterations without budget controls
- MCP subprocess usage without guaranteed disposal

## Next Steps

- Tune context budgets in [Context Engineering](./context-engineering/)
- Configure tools and MCP in [Tools](./tools/)
- Harden production defaults in [Production Deployment](../cookbook/production-deployment/)
