---
title: Effect-TS Primer
description: The key Effect-TS concepts used in Reactive Agents.
---

Reactive Agents is built on [Effect-TS](https://effect.website). You don't need to be an Effect expert to use the framework, but understanding these concepts helps.

## Effect\<A, E, R\>

An `Effect` is a description of a computation that:
- **Succeeds** with value `A`
- **Fails** with error `E`
- **Requires** services `R`

```typescript
import { Effect } from "effect";

// A simple Effect that succeeds
const hello = Effect.succeed("Hello, world!");

// An Effect that might fail
const parse = (input: string): Effect.Effect<number, Error> =>
  Effect.try(() => JSON.parse(input));

// An Effect that requires a service
const greet = Effect.gen(function* () {
  const agent = yield* AgentService;
  return yield* agent.getAgent("agent-1");
});
```

## Layer\<Out, Err, In\>

A `Layer` is a recipe for constructing services:
- **Provides** service `Out`
- **Might fail** with `Err`
- **Requires** dependency `In`

```typescript
import { Layer, Context } from "effect";

// Define a service
class MyService extends Context.Tag("MyService")<
  MyService,
  { readonly greet: (name: string) => Effect.Effect<string> }
>() {}

// Create a Layer that provides it
const MyServiceLive = Layer.succeed(MyService, {
  greet: (name) => Effect.succeed(`Hello, ${name}!`),
});
```

## Context.Tag

Tags identify services in the Effect dependency injection system:

```typescript
class AgentService extends Context.Tag("AgentService")<
  AgentService,
  {
    readonly createAgent: (config: AgentConfig) => Effect.Effect<Agent, AgentError>;
    readonly getAgent: (id: AgentId) => Effect.Effect<Agent, AgentNotFoundError>;
  }
>() {}
```

## Schema

Effect Schema provides runtime validation with TypeScript types:

```typescript
import { Schema } from "effect";

const AgentConfig = Schema.Struct({
  name: Schema.String,
  model: Schema.String,
  maxIterations: Schema.Number.pipe(Schema.between(1, 100)),
});

type AgentConfig = typeof AgentConfig.Type;
```

## Data.TaggedError

Typed, pattern-matchable errors:

```typescript
import { Data } from "effect";

class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
  readonly agentId: string;
}> {}

// Pattern match on _tag
const handle = Effect.catchTag("AgentNotFoundError", (e) =>
  Effect.succeed(`Agent ${e.agentId} not found`)
);
```

## Ref

Mutable state in a pure, concurrent-safe way:

```typescript
import { Ref } from "effect";

const counter = yield* Ref.make(0);
yield* Ref.update(counter, (n) => n + 1);
const value = yield* Ref.get(counter);
```

## For Framework Users

If you're using the `ReactiveAgents.create()` builder, you interact with standard `async/await`:

```typescript
// No Effect knowledge needed!
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .build();

const result = await agent.run("Hello!");
```

The Effect-TS internals are only exposed when you need advanced control via `buildEffect()` and `runEffect()`.
