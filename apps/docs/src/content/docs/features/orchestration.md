---
title: Orchestration
description: Multi-agent workflows with 5 execution patterns, checkpoints, and event sourcing.
sidebar:
  order: 6
---

The orchestration layer coordinates multiple agents working together on complex tasks. Define workflows with different execution patterns, checkpoint progress for durability, and inspect the full event log.

## Quick Start

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withOrchestration()   // Enable multi-agent workflows
  .build();
```

## Workflow Patterns

Five execution patterns for different coordination needs:

### Sequential

Steps execute one after another. Output from each step is available to the next.

```typescript
import { OrchestrationService } from "@reactive-agents/orchestration";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const orch = yield* OrchestrationService;

  const workflow = yield* orch.executeWorkflow(
    "research-pipeline",
    "sequential",
    [
      { id: "1", name: "gather", agentId: "researcher", input: "Find papers on CRISPR" },
      { id: "2", name: "analyze", agentId: "analyst", input: "Summarize findings" },
      { id: "3", name: "write", agentId: "writer", input: "Draft report" },
    ],
    (step) => executeAgentStep(step),
  );
});
```

### Parallel

All steps run concurrently. Best for independent subtasks.

```typescript
const workflow = yield* orch.executeWorkflow(
  "multi-source-research",
  "parallel",
  [
    { id: "1", name: "academic", agentId: "scholar", input: "Search academic papers" },
    { id: "2", name: "news", agentId: "journalist", input: "Search recent news" },
    { id: "3", name: "patents", agentId: "analyst", input: "Search patent databases" },
  ],
  (step) => executeAgentStep(step),
);
```

### Pipeline

Output of step N becomes the input of step N+1. Data flows through the chain.

```typescript
const workflow = yield* orch.executeWorkflow(
  "data-pipeline",
  "pipeline",
  [
    { id: "1", name: "extract", agentId: "extractor", input: rawData },
    { id: "2", name: "transform", agentId: "transformer", input: "" },
    { id: "3", name: "load", agentId: "loader", input: "" },
  ],
  (step) => executeAgentStep(step),
);
```

### Map-Reduce

Map phase runs in parallel, reduce phase aggregates results sequentially.

```typescript
const workflow = yield* orch.executeWorkflow(
  "distributed-analysis",
  "map-reduce",
  [
    // Map phase (parallel)
    { id: "1", name: "analyze-chunk-1", agentId: "worker-1", input: chunk1 },
    { id: "2", name: "analyze-chunk-2", agentId: "worker-2", input: chunk2 },
    { id: "3", name: "analyze-chunk-3", agentId: "worker-3", input: chunk3 },
    // Reduce phase (sequential)
    { id: "4", name: "aggregate", agentId: "reducer", input: "Combine results" },
  ],
  (step) => executeAgentStep(step),
);
```

### Orchestrator-Workers

A central orchestrator dispatches work to a pool of worker agents.

```typescript
const workflow = yield* orch.executeWorkflow(
  "managed-research",
  "orchestrator-workers",
  [
    { id: "1", name: "plan", agentId: "orchestrator", input: "Plan research strategy" },
    { id: "2", name: "execute-1", agentId: "worker", input: "Task A" },
    { id: "3", name: "execute-2", agentId: "worker", input: "Task B" },
    { id: "4", name: "synthesize", agentId: "orchestrator", input: "Combine results" },
  ],
  (step) => executeAgentStep(step),
);
```

## Checkpoints and Durability

Workflows automatically checkpoint on completion. You can also create manual checkpoints:

```typescript
// Manual checkpoint
const checkpoint = yield* orch.checkpoint(workflow.id);

// Later: resume from checkpoint
const resumed = yield* orch.resumeWorkflow(
  workflow.id,
  (step) => executeAgentStep(step),
);
// Only re-executes pending/failed steps
```

### Pause and Resume

```typescript
// Pause a running workflow
yield* orch.pauseWorkflow(workflow.id, "Waiting for human review");

// Resume later
const resumed = yield* orch.resumeWorkflow(workflow.id, executeStep);
```

## Worker Pool

Spawn specialized worker agents:

```typescript
const worker = yield* orch.spawnWorker("data-processing");
// { agentId, specialty, status: "idle", completedTasks: 0, ... }
```

Workers track their performance:

| Field | Description |
|-------|-------------|
| `completedTasks` | Total tasks completed |
| `failedTasks` | Total tasks failed |
| `avgLatencyMs` | Average task duration |
| `status` | "idle", "busy", "failed", "draining" |

## Event Log

Every workflow action is event-sourced for full auditability:

```typescript
const events = yield* orch.getEventLog(workflow.id);

for (const event of events) {
  switch (event._tag) {
    case "WorkflowCreated":
      console.log(`Created: ${event.workflowName}`);
      break;
    case "StepCompleted":
      console.log(`Step ${event.stepId} completed`);
      break;
    case "WorkflowFailed":
      console.log(`Failed: ${event.error}`);
      break;
  }
}
```

### Event Types

| Event | When |
|-------|------|
| `WorkflowCreated` | Workflow starts |
| `StepStarted` | Individual step begins |
| `StepCompleted` | Step finishes successfully |
| `StepFailed` | Step encounters an error |
| `WorkflowCompleted` | All steps done |
| `WorkflowFailed` | Workflow fails (after retries) |
| `WorkflowPaused` | Workflow paused |
| `WorkflowResumed` | Workflow resumed from checkpoint |

## Workflow States

```
pending → running → completed
                  → failed
           ↕
         paused
           ↓
       recovering → running
```

## Retry Logic

Steps can be retried on failure:

```typescript
const workflow = yield* orch.executeWorkflow(
  "resilient-pipeline",
  "sequential",
  steps,
  executeStep,
  { maxRetries: 3 },  // Retry failed steps up to 3 times
);
```

Each step tracks its `retryCount` — you can inspect how many attempts were needed.

## Listing and Querying

```typescript
// All running workflows
const running = yield* orch.listWorkflows({ state: "running" });

// All sequential workflows
const sequential = yield* orch.listWorkflows({ pattern: "sequential" });

// Get specific workflow
const wf = yield* orch.getWorkflow(workflowId);
console.log(`State: ${wf.state}, Steps: ${wf.steps.length}`);
```
