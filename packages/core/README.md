# @reactive-agents/core

Core services and types for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.3**

The foundational package every other `@reactive-agents/*` package depends on. Provides the EventBus, AgentService, TaskService, ContextWindowManager, framework error taxonomy, canonical schemas, and the narrow ports (`AgentMemory`, `EntropySensorService`) that other layers resolve.

## Installation

```bash
bun add @reactive-agents/core
```

Or install everything at once via the umbrella package:

```bash
bun add reactive-agents
```

## What This Package Provides

- **EventBus** — typed publish/subscribe for the full `AgentEvent` taxonomy (lifecycle, intelligence, cortex, error-swallowed)
- **AgentService** — agent registration, lookup, and lifecycle management
- **TaskService** — task creation, status tracking (pending → running → completed/failed/cancelled), and cancellation
- **ContextWindowManager** — token-aware truncation strategies for long conversations
- **Framework error taxonomy** — `TransientError`, `LLMTimeoutError`, `LLMRateLimitError`, `ContractError`, `SecurityError`, `VerificationFailed`, etc., with `isRetryable()` for retry-rule pattern matching
- **Canonical schemas** — `Agent`, `Task`, `TaskResult`, `Message`, `RuntimeConfig`, `ReasoningStep` (Effect Schema, branded IDs)
- **AgentMemory port** — narrow interface the kernel resolves, decoupled from the `@reactive-agents/memory` adapter
- **EntropySensorService tag** — service tag the reactive-intelligence layer plugs into

## Quick Example

```typescript
import { Effect } from "effect";
import {
  CoreServicesLive,
  AgentService,
  TaskService,
  EventBus,
} from "@reactive-agents/core";

const program = Effect.gen(function* () {
  const agents = yield* AgentService;
  const tasks = yield* TaskService;
  const bus = yield* EventBus;

  const agent = yield* agents.create({
    name: "my-agent",
    capabilities: [],
  });

  yield* bus.subscribe("TaskCompleted", (event) =>
    Effect.sync(() => console.log("done:", event.taskId)),
  );

  const task = yield* tasks.create(agent.id, { input: "hello" });
  return { agent, task };
});

await Effect.runPromise(program.pipe(Effect.provide(CoreServicesLive)));
```

## Key Exports

| Export                                 | Description                                              |
| -------------------------------------- | -------------------------------------------------------- |
| `CoreServicesLive`                     | Composite layer wiring AgentService + TaskService + EventBus |
| `EventBus`, `EventBusLive`             | Typed pub/sub for `AgentEvent`                           |
| `AgentService`, `AgentServiceLive`     | Create, register, and look up agents                     |
| `TaskService`, `TaskServiceLive`       | Create, update, and cancel tasks                         |
| `ContextWindowManager`                 | Token-aware conversation truncation                      |
| `AgentMemory`                          | Narrow port for memory adapters                          |
| `EntropySensorService`                 | Service tag consumed by reactive-intelligence            |
| `AgentId`, `TaskId`, `MessageId`       | Branded ID types + generators                            |
| `FrameworkError` and subtypes          | Tagged error taxonomy with `isRetryable()` guard         |
| `defaultRuntimeConfig`                 | Sensible defaults for `RuntimeConfigSchema`              |

## Event Taxonomy

The `AgentEvent` type unions every event flowing through `EventBus`:

- **Lifecycle** — `AgentCreated`, `TaskStarted`, `TaskCompleted`, `TaskFailed`, `TaskCancelled`
- **Intelligence** — `SkillActivated`, `SkillRefined`, `TemperatureAdjusted`, `MemoryBoostTriggered`, `AgentNeedsHuman`
- **Cortex** — `MemorySnapshot`, `ContextPressure`, `ChatTurnEvent`, `AgentHealthReport`, `ProviderFallbackActivated`, `DebriefCompleted`, `AgentConnected`, `AgentDisconnected`
- **Errors** — `ErrorSwallowed` (replaces silent `catchAll(() => Effect.void)` sites)

Subscribe to a single tag for type-narrowed handlers, or subscribe to `*` for all events.

## Error Taxonomy

```typescript
import { isRetryable, LLMTimeoutError, ContractError } from "@reactive-agents/core";

try {
  await runMyAgent();
} catch (err) {
  if (isRetryable(err)) {
    // TransientError, LLMTimeoutError, CapacityError, LLMRateLimitError
    return retry();
  }
  // ContractError, SecurityError, VerificationFailed → surface to caller
  throw err;
}
```

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Related packages: [`@reactive-agents/runtime`](https://www.npmjs.com/package/@reactive-agents/runtime), [`@reactive-agents/reasoning`](https://www.npmjs.com/package/@reactive-agents/reasoning)

## License

MIT
