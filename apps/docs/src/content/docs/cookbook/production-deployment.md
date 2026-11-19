---
title: Production Deployment
description: >-
  Best practices for deploying Reactive Agents to production — observability,
  cost controls, safety, and monitoring.
sidebar:
  order: 6
topic: gateway
related:
  - guides/production-checklist
  - guides/deploying-agents
  - features/gateway
---

This guide covers what to enable and configure when deploying agents to production environments.

## Production-Ready Agent

A fully configured production agent:

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("production-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")

  // Core capabilities
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({ builtins: true })  // opt in to built-in tools + any MCP servers
  .withMemory({ tier: "enhanced" }) // Vector + FTS5 for rich memory

  // Safety
  .withGuardrails()             // Block injection, PII, toxicity
  .withVerification()           // Fact-check outputs

  // Cost control
  .withCostTracking()           // Budget enforcement + model routing

  // Observability
  .withObservability()          // Tracing, metrics, logging
  .withAudit()                  // Compliance audit trail

  // Execution limits
  .withMaxIterations(20)        // Prevent runaway loops

  // Autonomous operation (optional)
  .withGateway({                  // Persistent event-driven harness
    heartbeat: { intervalMs: 1_800_000, policy: "adaptive" },
    policies: { dailyTokenBudget: 50_000 },  // all options: /features/gateway/
  })

  .build();
```

## Environment Variables

```bash
# LLM Provider
ANTHROPIC_API_KEY=sk-ant-...

# Embeddings (for Tier 2 memory)
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# Optional: OpenAI for fallback or specific tasks
OPENAI_API_KEY=sk-...

# Tools (optional)
TAVILY_API_KEY=tvly-...            # enables built-in web search tool
```

Tuning variables (`LLM_DEFAULT_MODEL`, `LLM_MAX_RETRIES`, `LLM_TIMEOUT_MS` and others) and their defaults: [Configuration: environment variables](/reference/configuration/#environment-variables).

## Cost Controls

### Budget Limits

Set spending limits to prevent runaway costs:

```typescript
// Budget enforcement happens automatically when .withCostTracking() is enabled
// Configure limits through the CostService layer if needed

// Opt in with .withModelRouting() and the complexity router picks a cheaper
// tier for simple tasks (Anthropic: haiku → sonnet → opus tier models).
// Tier prices come from the PriceBook; see /features/cost-tracking/.
```

### Monitor Spending

Track costs through lifecycle hooks:

```typescript
import { Effect } from "effect";
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withCostTracking()
  .withHook({
    phase: "cost-track",
    timing: "after",
    handler: (ctx) => {
      if (ctx.cost > 1.0) {
        console.warn(`High-cost task: $${ctx.cost.toFixed(4)}`);
      }
      return Effect.succeed(ctx);
    },
  })
  .build();
```

## Safety Checklist

### Input Safety

- Enable `.withGuardrails()` for all user-facing agents
- Guardrails check for injection attacks, PII, and toxicity **before** the LLM processes input
- Failed checks throw `GuardrailViolationError` — handle gracefully in your application

### Output Safety

- Enable `.withVerification()` for accuracy-sensitive applications
- Verification runs semantic entropy, fact decomposition, and consistency checks
- Low scores (< 0.7) trigger `"review"` or `"reject"` recommendations

## Observability

### What Gets Traced

With `.withObservability()` enabled:

- **Spans**: Every execution phase gets a trace span with timing data
- **Counters**: Phase completions, errors, tool executions
- **Histograms**: LLM latency, phase duration, token counts
- **Logs**: Structured entries with traceId/spanId for correlation

### Monitoring Hooks

Add custom monitoring at any phase:

```typescript
import { Effect } from "effect";
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withObservability()
  .withHook({
    phase: "complete",
    timing: "after",
    handler: (ctx) => {
      // Send metrics to your monitoring system
      metrics.record("agent.task.duration", ctx.metadata.duration);
      metrics.record("agent.task.tokens", ctx.tokensUsed);
      metrics.record("agent.task.cost", ctx.cost);
      metrics.increment("agent.task.completed");
      return Effect.succeed(ctx);
    },
  })
  .withHook({
    phase: "think",
    timing: "on-error",
    handler: (ctx) => {
      // think on-error receives { phase, iteration } (no agentId); use the agent name you already have.
      alerting.notify(`Agent failed during think phase, turn ${ctx.iteration}`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

## Error Handling

Handle errors at the application level:

<!-- docs-skip-typecheck -->
```typescript
try {
  const result = await agent.run(userInput);

  if (result.success) {
    return { response: result.output, metadata: result.metadata };
  } else {
    return { error: "Agent task failed", details: result.output };
  }
} catch (error) {
  if (error.message?.includes("Guardrail")) {
    return { error: "Input rejected for safety reasons" };
  }
  if (error.message?.includes("Budget")) {
    return { error: "Budget limit exceeded" };
  }
  return { error: "Internal agent error" };
}
```

## Memory Persistence

Memory is file-based SQLite, one database per agent, so it persists across process restarts. Mount the directory on a persistent volume. Location, tiers and retention are in the [Memory guide](/guides/memory/#storage-location).

## Performance Tips

1. **Use Adaptive strategy** — Auto-selects the cheapest strategy for each task
2. **Set `maxIterations`** — Prevent runaway reasoning loops (default: 10)
3. **Use Tier 1 memory** unless you need vector search — avoids embedding API calls
4. **Cache with CostTracking** — Semantic cache avoids duplicate LLM calls
5. **Use haiku for routing** — Let the cost layer use cheap models for simple tasks

## Deployment Architectures

### Single Process

Simplest deployment — one agent per process:

<!-- docs-skip-typecheck -->
```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .build();

// HTTP server
app.post("/agent", async (req, res) => {
  const result = await agent.run(req.body.input);
  res.json(result);
});
```

### Multi-Agent Service

Multiple specialized agents in one process:

<!-- docs-skip-typecheck -->
```typescript
const agents = {
  classifier: await ReactiveAgents.create()
    .withName("classifier")
    .withProvider("anthropic")
    .withModel("claude-haiku-4-5")
    .build(),

  researcher: await ReactiveAgents.create()
    .withName("researcher")
    .withProvider("anthropic")
    .withReasoning()
    .withTools({ builtins: true })
    .build(),

  writer: await ReactiveAgents.create()
    .withName("writer")
    .withProvider("anthropic")
    .withReasoning({ defaultStrategy: "reflexion" })
    .build(),
};

app.post("/agent/:type", async (req, res) => {
  const agent = agents[req.params.type];
  const result = await agent.run(req.body.input);
  res.json(result);
});
```

### Autonomous Agent (Gateway)

A long-running agent that responds to heartbeats, crons and webhooks uses `.withGateway({ ... })`. The [Agent Gateway](/features/gateway/) page is the one home for the heartbeat, cron, webhook and policy options and the gateway events. Messaging-platform setup is in [Messaging Channels](/guides/messaging-channels/).

Production practices for autonomous agents:

- **Always enable `.withKillSwitch()`** — emergency halt at any phase boundary
- **Set `dailyTokenBudget`** — prevents runaway costs overnight
- **Use `"adaptive"` heartbeats** — skip ticks when idle
- **Subscribe to `BudgetExhausted`** — get alerts when limits are hit (see [gateway events](/features/gateway/#gateway-status--stats))
- **Use `.withGuardrails()`** — webhook payloads are checked for injection before reaching the LLM
- Before you deploy, read [Before you deploy a gateway agent](/guides/deploying-agents/#before-you-deploy-a-gateway-agent)

## What's Next

- [Production Checklist](/guides/production-checklist/) — the full pre-deployment checklist this recipe is one worked example of
- [Security Hardening](/guides/security-hardening/) — a deeper hardening pass beyond the safety checklist above
- [Error Handling & Resilience](/cookbook/error-handling/) — typed errors and retry policies for production robustness
