# @reactive-agents/core

Core services and types for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Provides the foundational building blocks that all other packages depend on: the EventBus, AgentService, TaskService, and shared schemas.

## Installation

```bash
bun add @reactive-agents/core effect
```

Or install everything at once:

```bash
bun add reactive-agents effect
```

## What's Included

| Export | Description |
|--------|-------------|
| `EventBusLive` | Publish/subscribe event bus layer |
| `AgentServiceLive` | Create and manage agent instances |
| `TaskServiceLive` | Create, track, and cancel tasks |
| `CoreServicesLive` | Composite layer wiring all three above |
| `AgentId`, `TaskId` | Branded ID types |
| `AgentConfig`, `TaskInput` | Validated schemas |
| `AgentError`, `TaskError` | Tagged error types |

## Usage

```typescript
import { Effect } from "effect";
import { CoreServicesLive, AgentService } from "@reactive-agents/core";

const program = Effect.gen(function* () {
  const agents = yield* AgentService;
  const agent = yield* agents.create({ name: "my-agent", capabilities: [] });
  return agent;
});

const result = await Effect.runPromise(
  program.pipe(Effect.provide(CoreServicesLive))
);
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
