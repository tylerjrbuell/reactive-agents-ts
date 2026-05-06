# @reactive-agents/orchestration

Multi-agent orchestration for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.3**

Coordinate fleets of agents through workflow patterns: sequential pipelines, parallel fan-out / fan-in, map-reduce, and durable event-sourced executions. The `WorkflowEngine` runs workflows as Effects with typed message passing, checkpoint persistence, and per-step failure isolation.

## Installation

```bash
bun add @reactive-agents/orchestration
```

Or via the umbrella:

```bash
bun add reactive-agents
```

## Features

- **Workflow patterns** — `WorkflowPattern` enum exposes `sequential`, `parallel`, `pipeline`, `map-reduce`, `agent-as-tool`
- **Worker pool** — pool of registered `WorkerAgent`s, dispatched per-step
- **Durable execution** — `EventSourcing` records every state transition; resume from checkpoints
- **Typed handoffs** — Effect Schemas validate inter-agent messages
- **Failure isolation** — one agent failing emits `WorkflowStepError`; the workflow can continue, retry, or abort per the policy
- **A2A integration** — pairs with `@reactive-agents/a2a` for cross-process agent communication

## Quick Example

```typescript
import { Effect } from "effect";
import {
  OrchestrationService,
  OrchestrationServiceLive,
  WorkflowPattern,
} from "@reactive-agents/orchestration";

const program = Effect.gen(function* () {
  const orch = yield* OrchestrationService;

  const workflow = yield* orch.createWorkflow({
    name: "research-pipeline",
    pattern: WorkflowPattern.Sequential,
    steps: [
      { id: "search",     agentId: "searcher",   input: (ctx) => ctx.query },
      { id: "summarize",  agentId: "summarizer", input: (ctx) => ctx.search },
      { id: "critique",   agentId: "critic",     input: (ctx) => ctx.summarize },
    ],
  });

  return yield* orch.runWorkflow(workflow.id, {
    query: "Latest advances in fusion energy",
  });
});

await Effect.runPromise(program.pipe(Effect.provide(OrchestrationServiceLive)));
```

## Patterns

| Pattern        | Behaviour                                                            |
| -------------- | -------------------------------------------------------------------- |
| `sequential`   | Step N+1 receives the output of step N                               |
| `parallel`     | All steps run concurrently against the same input                    |
| `pipeline`     | Streaming hand-off — outputs flow as soon as available               |
| `map-reduce`   | Fan-out per input element, then reduce results                       |
| `agent-as-tool` | One agent invokes another as a tool inside its own kernel loop      |

## Durable Execution

```typescript
import { makeEventSourcing } from "@reactive-agents/orchestration";

const sourcing = yield* makeEventSourcing({ store: mySqliteStore });
// every workflow state transition is appended; resume by replaying events
const resumed = yield* sourcing.replay(workflowId);
```

## Key Exports

| Export                                            | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| `OrchestrationService`, `OrchestrationServiceLive` | Composite orchestration entry point              |
| `makeWorkflowEngine`                              | Pluggable workflow engine                          |
| `makeEventSourcing`                               | Durable event log for workflow state               |
| `makeWorkerPool`                                  | Worker-agent registry + dispatcher                 |
| `createOrchestrationLayer`                        | Factory for the runtime layer                      |
| `WorkflowPattern`, `WorkflowState`, `Workflow`, `WorkflowStep`, `Checkpoint`, `WorkerAgent` | Schemas + types |
| `WorkflowError`, `WorkflowStepError`, `CheckpointError`, `WorkerPoolError` | Tagged errors           |

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Orchestration guide: [docs.reactiveagents.dev/guides/orchestration/](https://docs.reactiveagents.dev/guides/orchestration/)
- Pairs with [`@reactive-agents/a2a`](https://www.npmjs.com/package/@reactive-agents/a2a) for cross-process agent comms

## License

MIT
