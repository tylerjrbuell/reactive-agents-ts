---
title: Production Deployment
description: Best practices for deploying Reactive Agents to production — observability, cost controls, safety, and monitoring.
sidebar:
  order: 4
---

This guide covers what to enable and configure when deploying agents to production environments.

## Production-Ready Agent

A fully configured production agent:

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("production-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")

  // Core capabilities
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools([...productionTools])
  .withMemory("2")              // Vector + FTS5 for rich memory

  // Safety
  .withGuardrails()             // Block injection, PII, toxicity
  .withVerification()           // Fact-check outputs

  // Cost control
  .withCostTracking()           // Budget enforcement + model routing

  // Observability
  .withObservability()          // Tracing, metrics, logging
  .withAudit()                  // Compliance audit trail

  // Identity
  .withIdentity()               // RBAC + certificates

  // Execution limits
  .withMaxIterations(20)        // Prevent runaway loops

  .build();
```

## Environment Variables

```bash
# LLM Provider
ANTHROPIC_API_KEY=sk-ant-...
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
LLM_DEFAULT_TEMPERATURE=0.7
LLM_MAX_RETRIES=3
LLM_TIMEOUT_MS=30000

# Embeddings (for Tier 2 memory)
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# Optional: OpenAI for fallback or specific tasks
OPENAI_API_KEY=sk-...
```

## Cost Controls

### Budget Limits

Set spending limits to prevent runaway costs:

```typescript
// Budget enforcement happens automatically when .withCostTracking() is enabled
// Configure limits through the CostService layer if needed

// The complexity router automatically selects cheaper models for simple tasks:
// Simple questions → Haiku ($1/M tokens)
// Medium tasks → Sonnet ($3/M tokens)
// Complex tasks → Opus ($15/M tokens)
```

### Monitor Spending

Track costs through lifecycle hooks:

```typescript
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

### Identity

- Use `.withIdentity()` to enforce RBAC on tool and resource access
- Assign the minimum required role to each agent
- Use delegation for temporary permissions with automatic expiry

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
      alerting.notify(`Agent ${ctx.agentId} failed during think phase`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

## Error Handling

Handle errors at the application level:

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

For production, memory is stored in SQLite (bun:sqlite):

- **WAL mode** enabled by default for concurrent reads
- **FTS5** indexes for full-text search
- **File-based** — persists across process restarts
- **Per-agent** — each agent has its own database

## Performance Tips

1. **Use Adaptive strategy** — Auto-selects the cheapest strategy for each task
2. **Set `maxIterations`** — Prevent runaway reasoning loops (default: 10)
3. **Use Tier 1 memory** unless you need vector search — avoids embedding API calls
4. **Cache with CostTracking** — Semantic cache avoids duplicate LLM calls
5. **Use haiku for routing** — Let the cost layer use cheap models for simple tasks

## Deployment Architectures

### Single Process

Simplest deployment — one agent per process:

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

```typescript
const agents = {
  classifier: await ReactiveAgents.create()
    .withName("classifier")
    .withProvider("anthropic")
    .withModel("claude-3-5-haiku-latest")
    .build(),

  researcher: await ReactiveAgents.create()
    .withName("researcher")
    .withProvider("anthropic")
    .withReasoning()
    .withTools([searchTool])
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

### Orchestrated Workflow

Multi-agent workflows with checkpoints:

```typescript
const program = Effect.gen(function* () {
  const orch = yield* OrchestrationService;

  const workflow = yield* orch.executeWorkflow(
    "customer-support",
    "pipeline",
    [
      { id: "1", name: "classify", agentId: "classifier", input: userMessage },
      { id: "2", name: "research", agentId: "researcher", input: "" },
      { id: "3", name: "respond", agentId: "writer", input: "" },
    ],
    executeStep,
  );

  return workflow;
});
```
