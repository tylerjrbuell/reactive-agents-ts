---
title: Multi-Agent Patterns
description: Patterns for building multi-agent systems — pipelines, map-reduce, orchestrator-workers, and delegation.
sidebar:
  order: 2
---

Reactive Agents supports multiple agents working together through the orchestration layer. This page shows patterns for common multi-agent architectures.

## Research Pipeline

Three specialized agents work sequentially — each builds on the previous agent's output:

```typescript
import { ReactiveAgents } from "reactive-agents";
import { OrchestrationService } from "@reactive-agents/orchestration";
import { Effect } from "effect";

// Create specialized agents
const researcher = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .build();

const analyst = await ReactiveAgents.create()
  .withName("analyst")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "reflexion" })
  .build();

const writer = await ReactiveAgents.create()
  .withName("writer")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "reflexion" })
  .build();

// Orchestrate as a pipeline
const program = Effect.gen(function* () {
  const orch = yield* OrchestrationService;

  const workflow = yield* orch.executeWorkflow(
    "research-report",
    "pipeline",
    [
      { id: "1", name: "research", agentId: "researcher", input: "Find recent CRISPR developments" },
      { id: "2", name: "analyze", agentId: "analyst", input: "" },  // Gets researcher's output
      { id: "3", name: "write", agentId: "writer", input: "" },     // Gets analyst's output
    ],
    async (step) => {
      const agent = { researcher, analyst, writer }[step.agentId];
      const input = step.input || step.output; // Pipeline chains output → input
      return await agent.run(input);
    },
  );

  return workflow;
});
```

## Parallel Research

Multiple agents research different angles simultaneously:

```typescript
const workflow = yield* orch.executeWorkflow(
  "multi-source-research",
  "parallel",
  [
    { id: "1", name: "academic", agentId: "scholar", input: "Search academic papers on quantum computing" },
    { id: "2", name: "industry", agentId: "analyst", input: "Search industry reports on quantum computing" },
    { id: "3", name: "news", agentId: "journalist", input: "Search recent news on quantum computing" },
  ],
  (step) => agents[step.agentId].run(step.input),
);

// All three run concurrently — results available when all complete
```

## Map-Reduce Analysis

Split a large task across workers, then aggregate results:

```typescript
// Split a large dataset into chunks
const chunks = splitData(largeDataset, 5);

const workflow = yield* orch.executeWorkflow(
  "distributed-analysis",
  "map-reduce",
  [
    // Map phase — all run in parallel
    ...chunks.map((chunk, i) => ({
      id: String(i + 1),
      name: `analyze-${i}`,
      agentId: "worker",
      input: `Analyze this data chunk: ${chunk}`,
    })),
    // Reduce phase — runs after map completes
    {
      id: String(chunks.length + 1),
      name: "aggregate",
      agentId: "aggregator",
      input: "Combine and summarize all analysis results",
    },
  ],
  (step) => agents[step.agentId].run(step.input),
);
```

## Orchestrator-Workers with Delegation

A central orchestrator dispatches tasks and delegates specific permissions:

```typescript
import { IdentityService } from "@reactive-agents/identity";

const program = Effect.gen(function* () {
  const orch = yield* OrchestrationService;
  const identity = yield* IdentityService;

  // Spawn specialized workers
  const dataWorker = yield* orch.spawnWorker("data-processing");
  const searchWorker = yield* orch.spawnWorker("web-search");

  // Delegate search permission to the search worker (1 hour)
  yield* identity.delegate(
    "orchestrator",
    searchWorker.agentId,
    [{ resource: "tools/web_search", actions: ["execute"] }],
    "Research subtask",
    3600_000,
  );

  // Execute workflow
  const workflow = yield* orch.executeWorkflow(
    "managed-research",
    "orchestrator-workers",
    [
      { id: "1", name: "plan", agentId: "orchestrator", input: "Plan research on AI safety" },
      { id: "2", name: "search", agentId: searchWorker.agentId, input: "Search for papers" },
      { id: "3", name: "process", agentId: dataWorker.agentId, input: "Process findings" },
      { id: "4", name: "synthesize", agentId: "orchestrator", input: "Write final report" },
    ],
    (step) => executeStep(step),
  );
});
```

## Durable Workflows with Checkpoints

For long-running workflows, use checkpoints to survive crashes:

```typescript
// Start a workflow
const workflow = yield* orch.executeWorkflow("long-task", "sequential", steps, executeStep);

// If the process crashes, resume from the last checkpoint:
const resumed = yield* orch.resumeWorkflow(workflow.id, executeStep);
// Only re-executes pending/failed steps — completed steps are skipped
```

## Agent Specialization

Build agents with different capability profiles for different roles:

```typescript
// Fast, cheap agent for simple classification
const classifier = await ReactiveAgents.create()
  .withName("classifier")
  .withProvider("anthropic")
  .withModel("claude-3-5-haiku-latest")
  .build();

// Quality-focused agent for writing
const writer = await ReactiveAgents.create()
  .withName("writer")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning({ defaultStrategy: "reflexion" })
  .withVerification()
  .build();

// Tool-using agent for research
const researcher = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withMemory("1")
  .build();

// Full production agent for critical tasks
const seniorAgent = await ReactiveAgents.create()
  .withName("senior")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-20250514")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools()
  .withMemory("2")
  .withGuardrails()
  .withVerification()
  .withCostTracking()
  .withObservability()
  .build();
```

## Event-Driven Coordination

Use the EventBus to coordinate agents through events:

```typescript
import { EventBus } from "@reactive-agents/core";

const program = Effect.gen(function* () {
  const bus = yield* EventBus;

  // Agent A publishes events
  yield* bus.publish({
    type: "research.complete",
    agentId: "researcher",
    data: { findings: "..." },
  });

  // Agent B subscribes and reacts
  const events = yield* bus.subscribe("research.complete");
  // Process events as they arrive
});
```

## Monitoring Multi-Agent Systems

Use observability to track the full system:

```typescript
const agent = await ReactiveAgents.create()
  .withName("orchestrator")
  .withProvider("anthropic")
  .withOrchestration()
  .withObservability()
  .withHook({
    phase: "complete",
    timing: "after",
    handler: (ctx) => {
      console.log(`Agent ${ctx.agentId} completed in ${ctx.metadata.duration}ms`);
      console.log(`Cost: $${ctx.cost}, Tokens: ${ctx.tokensUsed}`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

Each agent in the system gets its own trace, and workflow-level events are logged in the orchestration event log for full auditability.
