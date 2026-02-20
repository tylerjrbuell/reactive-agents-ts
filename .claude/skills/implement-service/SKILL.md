---
name: implement-service
description: Create a new Effect-TS service following the mandatory Reactive Agents patterns. Use when adding a service to any package.
argument-hint: <ServiceName> <package-name>
---

# Implement Service: $ARGUMENTS

## Step 1: Check the spec

Before writing any code, read the spec for the target package to confirm:

- The service name and interface are defined in the spec
- The service's dependencies are identified
- The service's methods and return types are specified

## Step 2: Create the service file

Create the service file at the path specified in the package's spec (usually `src/services/<name>.ts` or `src/<name>.ts`).

Follow this exact template:

```typescript
import { Effect, Context, Layer, Ref } from "effect";
// Import error types from this package
import { MyError } from "../errors.js";
// Import dependency services
import { DependencyService } from "@reactive-agents/some-package";

// ─── Service Tag ─────────────────────────────────────────────────────────────

/**
 * Brief description of what this service does.
 * Which layers/phases use it.
 */
export class ServiceName extends Context.Tag("ServiceName")<
  ServiceName,
  {
    /** Method description */
    readonly methodA: (input: InputType) => Effect.Effect<OutputType, ServiceError>;
    /** Method description */
    readonly methodB: () => Effect.Effect<readonly ResultType[], ServiceError>;
  }
>() {}

// ─── Live Implementation ─────────────────────────────────────────────────────

export const ServiceNameLive = Layer.effect(
  ServiceName,
  Effect.gen(function* () {
    // 1. Resolve dependencies
    const dep = yield* DependencyService;

    // 2. Initialize state (if needed)
    const state = yield* Ref.make(initialState);

    // 3. Return implementation
    return {
      methodA: (input) =>
        Effect.gen(function* () {
          // Implementation using Effect patterns
          const result = yield* dep.someMethod(input);
          yield* Ref.update(state, (s) => /* update state */);
          return result;
        }),

      methodB: () =>
        Ref.get(state).pipe(
          Effect.map((s) => Array.from(s.values())),
        ),
    };
  }),
);
```

## Step 3: Verify patterns

Check every line against these rules:

| Pattern                                     | Required                              | Anti-Pattern          |
| ------------------------------------------- | ------------------------------------- | --------------------- |
| `Context.Tag("Name")`                       | Service tag string matches class name | Different strings     |
| `Layer.effect(Tag, Effect.gen(...))`        | Layer creation                        | `new ServiceClass()`  |
| `yield* DependencyService`                  | Dependency resolution                 | Constructor injection |
| `Ref.make()` / `Ref.get()` / `Ref.update()` | State management                      | `let mutableVar`      |
| `Effect.Effect<T, E>`                       | Return types                          | `Promise<T>`          |
| `Effect.sync(() => ...)`                    | Synchronous operations (bun:sqlite)   | Raw synchronous calls |
| `Effect.tryPromise(...)`                    | Async operations (fetch, file I/O)    | Raw `await`           |
| `Data.TaggedError`                          | Error creation                        | `throw new Error()`   |

## Step 4: Wire into the package layer

Add the service to the package's `createXxxLayer()` factory in `src/runtime.ts`:

```typescript
export const createMyPackageLayer = () =>
  Layer.mergeAll(
    ExistingServiceLive,
    NewServiceLive.pipe(Layer.provide(DependencyServiceLive)),
  );
```

## Step 5: Export from index.ts

Add to `src/index.ts`:

```typescript
export { ServiceName, ServiceNameLive } from "./services/service-name.js";
```

## Step 6: Write tests

Create `tests/service-name.test.ts`:

```typescript
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { ServiceName, ServiceNameLive } from "../src/services/service-name.js";

describe("ServiceName", () => {
  // Compose test layer with mock dependencies
  const testLayer = ServiceNameLive.pipe(Layer.provide(MockDependencyLive));

  it("should handle methodA correctly", async () => {
    const result = await Effect.gen(function* () {
      const svc = yield* ServiceName;
      return yield* svc.methodA(testInput);
    }).pipe(Effect.provide(testLayer), Effect.runPromise);

    expect(result).toEqual(expectedOutput);
  });

  it("should return tagged error on failure", async () => {
    const result = await Effect.gen(function* () {
      const svc = yield* ServiceName;
      return yield* svc.methodA(badInput);
    }).pipe(
      Effect.provide(testLayer),
      Effect.flip, // Flip to get the error
      Effect.runPromise,
    );

    expect(result._tag).toBe("ServiceError");
  });
});
```

## Common Mistakes

1. **Forgetting `.js` extension in imports** — Bun ESM requires explicit `.js` extensions for relative imports
2. **Using `interface` instead of `Schema.Struct`** for data types passed between services
3. **Wrapping `LLMService.complete()` in `Effect.tryPromise`** — it already returns Effect
4. **Using `let` for state** — always use `Ref`
5. **Missing `readonly` on service method types** — all methods must be `readonly`
