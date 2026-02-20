---
name: effect-ts-patterns
description: Mandatory Effect-TS coding patterns for the Reactive Agents framework. Use when writing any TypeScript code, creating services, defining types, handling errors, or composing layers in this project.
user-invocable: false
---

# Effect-TS Patterns — Reactive Agents

Every file in this project MUST follow these patterns. Violations will break the build and type system.

## Types: Schema.Struct (NEVER plain interfaces)

```typescript
import { Schema } from "effect";

// Branded IDs
export const AgentId = Schema.String.pipe(Schema.brand("AgentId"));
export type AgentId = typeof AgentId.Type;

// Struct definitions
export const AgentSchema = Schema.Struct({
  id: AgentId,
  name: Schema.String,
  status: Schema.Literal("idle", "running", "completed", "failed"),
  description: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type Agent = typeof AgentSchema.Type;
```

**Rules:**

- ALWAYS use `Schema.Struct` for data shapes — never `interface` or `type { ... }`
- ALWAYS use `Schema.brand()` for ID types
- ALWAYS use `Schema.Literal()` for union/enum values
- ALWAYS use `Schema.optional()` for optional fields — never `?:`
- ALWAYS derive the TypeScript type with `typeof XxxSchema.Type`

## Errors: Data.TaggedError (NEVER throw)

```typescript
import { Data } from "effect";

export class AgentError extends Data.TaggedError("AgentError")<{
  readonly message: string;
}> {}

export class TaskError extends Data.TaggedError("TaskError")<{
  readonly message: string;
  readonly taskId: string;
}> {}

// Union type for service signatures
export type CoreErrors = AgentError | TaskError;
```

**Rules:**

- NEVER use `throw new Error()`
- ALWAYS use `Data.TaggedError("UniqueTag")<{ ... }>`
- The tag string MUST match the class name exactly
- All fields MUST be `readonly`
- ALWAYS create a union type for each package's errors

## Services: Context.Tag + Layer.effect (NEVER OOP classes)

```typescript
import { Effect, Context, Layer, Ref } from "effect";

// Step 1: Define the service tag with its interface
export class MyService extends Context.Tag("MyService")<
  MyService,
  {
    readonly doWork: (input: string) => Effect.Effect<string, MyError>;
    readonly getState: () => Effect.Effect<ReadonlyMap<string, string>, never>;
  }
>() {}

// Step 2: Create the Live layer
export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    // Resolve dependencies
    const dep = yield* OtherService;

    // Create mutable state via Ref
    const state = yield* Ref.make(new Map<string, string>());

    // Return the service implementation
    return {
      doWork: (input) =>
        Effect.gen(function* () {
          yield* Ref.update(state, (m) => new Map(m).set(input, input));
          return yield* dep.process(input);
        }),
      getState: () => Ref.get(state),
    };
  }),
);
```

**Rules:**

- Services ALWAYS extend `Context.Tag("ServiceName")<ServiceTag, Interface>()`
- The tag string MUST match the class name
- Implementations ALWAYS use `Layer.effect(Tag, Effect.gen(...))`
- State ALWAYS uses `Ref` — never mutable variables
- Dependencies are resolved with `yield* OtherService` inside `Effect.gen`
- All methods return `Effect.Effect<Success, Error>`

## Scoped Resources: Layer.scoped for cleanup

```typescript
export const MemoryDatabaseLive = Layer.scoped(
  MemoryDatabase,
  Effect.acquireRelease(
    Effect.sync(() => {
      const db = new Database(dbPath, { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      return db;
    }),
    (db) => Effect.sync(() => db.close()),
  ).pipe(
    Effect.map((db) => ({
      query: db.query.bind(db),
      exec: db.exec.bind(db),
      close: () => Effect.sync(() => db.close()),
    })),
  ),
);
```

**Rules:**

- Use `Layer.scoped` + `Effect.acquireRelease` for resources needing cleanup (DB, files, connections)
- Acquire returns the resource; release cleans it up
- Both acquire and release must be wrapped in `Effect.sync` or `Effect.tryPromise`

## Synchronous Operations: Effect.sync

```typescript
// bun:sqlite is synchronous — use Effect.sync
const rows = yield * Effect.sync(() => db.query("SELECT * FROM t").all());

// Pure computations
const value = yield * Effect.sync(() => computeHash(input));
```

## Async Operations: Effect.tryPromise

```typescript
// HTTP calls, file I/O, external APIs
const data =
  yield *
  Effect.tryPromise({
    try: () => fetch(url).then((r) => r.json()),
    catch: (e) => new FetchError({ message: String(e) }),
  });
```

**Rules:**

- ALWAYS provide a `catch` function that returns one of your `Data.TaggedError` types
- NEVER use raw `await`

## Layer Composition: Layer.mergeAll + Layer.provide

```typescript
// Merge independent layers
export const createMyLayer = () => Layer.mergeAll(ServiceALive, ServiceBLive);

// Provide dependencies from one layer to another
export const createMyLayer = () =>
  Layer.mergeAll(ServiceALive, ServiceBLive.pipe(Layer.provide(ServiceALive)));

// Full package layer factory
export const createCoreLayer = () =>
  Layer.mergeAll(
    EventBusLive,
    AgentServiceLive.pipe(Layer.provide(EventBusLive)),
    TaskServiceLive.pipe(Layer.provide(EventBusLive)),
    ContextWindowManagerLive,
  );
```

**Rules:**

- Every package exports a `createXxxLayer()` factory function
- Use `Layer.provide()` to wire dependencies between services
- Use `Layer.mergeAll()` to combine independent services
- The factory function takes configuration params if needed

## Optional Dependencies: Effect.serviceOption

```typescript
import { Context } from "effect";

// When a dependency may not be present in the runtime
const maybeReasoning =
  yield *
  Effect.serviceOption(
    Context.GenericTag<ReasoningServiceInterface>("ReasoningService"),
  );

const result = Option.match(maybeReasoning, {
  onNone: () => executeDefaultPath(),
  onSome: (svc) => svc.selectStrategy(context),
});
```

## Pattern Checklist

Before committing any file, verify:

- [ ] All types use `Schema.Struct`, not interfaces
- [ ] All IDs use `Schema.brand()`
- [ ] All errors use `Data.TaggedError`
- [ ] All services use `Context.Tag` + `Layer.effect`
- [ ] All state uses `Ref`
- [ ] No `throw`, no raw `await`, no mutable variables
- [ ] Package exports a `createXxxLayer()` factory
- [ ] `index.ts` re-exports all public types, errors, services, and the layer factory
