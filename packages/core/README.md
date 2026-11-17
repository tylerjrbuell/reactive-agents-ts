# @reactive-agents/core

> Event bus, agent and task services, error taxonomy and canonical schemas that every other Reactive Agents package builds on.

> **Stability:** unstable. The event bus tags are stable; service and schema shapes may change between minor versions.

## Install

```bash
bun add @reactive-agents/core
# or: npm install @reactive-agents/core
```

Most apps get this package through the facade (`bun add reactive-agents`).

## Usage

```ts
import { Effect } from "effect";
import { CoreServicesLive, EventBusLive, AgentService, TaskService, EventBus } from "@reactive-agents/core";

const program = Effect.gen(function* () {
  const agents = yield* AgentService;
  const tasks = yield* TaskService;
  const bus = yield* EventBus;

  const agent = yield* agents.create({ name: "my-agent", capabilities: [] });

  yield* bus.on("TaskCompleted", (event) =>
    Effect.sync(() => console.log("done:", event.taskId)),
  );

  return yield* tasks.create({ agentId: agent.id, type: "query", input: "hello" });
});

await Effect.runPromise(
  program.pipe(Effect.provide(CoreServicesLive), Effect.provide(EventBusLive)),
);
```

`bus.on(tag, handler)` narrows the event type by tag. `bus.subscribe(handler)` receives every event.

## API

| Export | Use it when |
|---|---|
| `CoreServicesLive` | You want AgentService, TaskService and EventBus wired in one layer. |
| `EventBus`, `EventBusLive` | You publish or subscribe to `AgentEvent`s (lifecycle, intelligence, errors). |
| `AgentService`, `TaskService` | You create agents and track tasks (pending, running, completed, failed, cancelled). |
| `ContextWindowManager` | You need token-aware truncation of long conversations. |
| `AgentMemory` | You provide your own memory adapter behind the narrow port the kernel resolves. |
| `EntropySensorService` | You plug an entropy sensor in (used by reactive-intelligence). |
| `AgentId`, `TaskId`, `MessageId` | You need branded IDs and `generate*Id` helpers. |
| `isRetryable` and the framework errors | You branch on error type (`TransientError`, `LLMTimeoutError`, `LLMRateLimitError`, `ContractError`, `SecurityError`). |
| `defaultRuntimeConfig` | You want default `RuntimeConfig` values. |

## Documentation

- [Architecture](https://docs.reactiveagents.dev/concepts/architecture/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
