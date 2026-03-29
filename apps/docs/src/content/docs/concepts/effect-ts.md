---
title: Effect-TS Primer
description: The key Effect-TS concepts used in Reactive Agents.
---

Reactive Agents is built on [Effect-TS](https://effect.website). You don't need to be an Effect expert to use the framework, but understanding these concepts helps.

## Common `Effect` helpers

The `effect` package is already installed when you use `reactive-agents`. Pull symbols explicitly so examples are copy-paste friendly:

```typescript
import { Effect } from "effect";
// Advanced composition (layers, services, tests):
import { Layer, Context, Schema, Data, Ref } from "effect";
```

| Helper | When to use |
|--------|-------------|
| **`Effect.succeed(x)`** | Pure success value — lifecycle hooks, trivial tool handlers |
| **`Effect.fail(e)`** | Fail the Effect with error `e` (prefer tagged errors in app code) |
| **`Effect.sync(() => …)`** | Wrap synchronous code; use **`Effect.try`** if it might throw |
| **`Effect.try(() => …)`** | Wrap synchronous code that might throw (e.g. JSON.parse) |
| **`Effect.promise(() => somePromise)`** | Bridge an existing `Promise` |
| **`Effect.gen(function* () { … yield* … })`** | Multi-step workflows, `yield*` services from `Context.Tag` |
| **`Effect.runPromise(program)`** | Run an `Effect` from `async` main or tests |
| **`program.pipe(Effect.provide(layer))`** | Supply dependencies before `runPromise` |
| **`Effect.catchTag("Tag", handler)`** | Recover from a single tagged error type |

Most **builder** users only touch **`Effect.succeed`**, **`Effect.fail`**, and sometimes **`Effect.try`** or **`Effect.promise`** inside hooks and tools.

## Framework Effect API (`@reactive-agents/runtime`)

These are **Reactive Agents** entry points and utilities — not re-exports from `effect`, but built to work with `Effect` programs:

| API | What it does | Defined in |
|-----|----------------|------------|
| **`ReactiveAgentBuilder.buildEffect()`** | Builds the agent as `Effect.Effect<ReactiveAgent, Error>` so you can `yield*` it inside `Effect.gen` | [`builder.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/packages/runtime/src/builder.ts) |
| **`ReactiveAgent.runEffect(input)`** | Runs a task as `Effect.Effect<AgentResult, Error>` — pipe **`Effect.retry`**, **`Effect.timeout`**, etc. | same |
| **`unwrapError`**, **`unwrapErrorWithSuggestion`**, **`errorContext`** | Unwrap nested **`FiberFailure` / Cause** from **`Effect.runPromise`** into plain errors and optional fix hints | [`errors.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/packages/runtime/src/errors.ts) |
| **`createRuntime()`** / **`createLightRuntime()`** | Produces **`Layer`** stacks you **`provide`** before running engine-level **`Effect`** programs | [`runtime.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/packages/runtime/src/runtime.ts) |
| **`LifecycleHook.handler`** | Must return **`Effect.Effect<ExecutionContext, ExecutionError>`** | [`types.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/packages/runtime/src/types.ts) |

**Note:** The lightweight **`agentFn`**, **`pipe`**, **`parallel`**, and **`race`** helpers in [`compose.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/packages/runtime/src/compose.ts) are **Promise-based** callables for chaining agents; they are not `Effect` wrappers.

```typescript
import { Effect } from "effect";
import {
  ReactiveAgents,
  unwrapError,
} from "@reactive-agents/runtime";

const program = Effect.gen(function* () {
  const agent = yield* ReactiveAgents.create()
    .withProvider("anthropic")
    .buildEffect();
  return yield* agent.runEffect("Summarize Effect-TS in one paragraph");
});

const result = await Effect.runPromise(program).catch((e) => {
  throw unwrapError(e);
});
```

Import **`unwrapError`** from **`@reactive-agents/runtime`** (the root **`reactive-agents`** package does not re-export it today).

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
import { Layer, Context, Effect } from "effect";

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
import { Data, Effect } from "effect";

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

The Effect-TS internals are only exposed when you need advanced control via **`buildEffect()`** and **`runEffect()`** — see [Framework Effect API](#framework-effect-api-reactive-agentsruntime). For raw `Effect.*` usage, add `import { Effect } from "effect"` — see the [generic helpers table](#common-effect-helpers) above.
