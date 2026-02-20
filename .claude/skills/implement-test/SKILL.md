---
name: implement-test
description: Write tests for a Reactive Agents package or service using Bun test runner and Effect-TS patterns. Use when creating tests for any module in this project.
argument-hint: <package-name-or-service>
---

# Write Tests: $ARGUMENTS

## Test Framework

- **Runner:** `bun:test` (built into Bun)
- **Assertions:** `expect` from `bun:test`
- **Effect execution:** `Effect.runPromise` / `Effect.runSync`
- **Test files:** `tests/<module-name>.test.ts`

## Test Structure Template

```typescript
import { Effect, Layer, Ref } from "effect";
import { describe, it, expect, beforeEach } from "bun:test";

// Import the service under test
import { MyService, MyServiceLive } from "../src/services/my-service.js";
// Import dependencies (use real or mock)
import { EventBus, EventBusLive } from "@reactive-agents/core";

describe("MyService", () => {
  // ─── Test Layer Setup ────────────────────────────────────────────

  // Option A: Real dependencies (for integration tests)
  const testLayer = MyServiceLive.pipe(Layer.provide(EventBusLive));

  // Option B: Mock dependencies (for unit tests)
  const mockEventBus = Layer.succeed(EventBus, {
    publish: () => Effect.void,
    subscribe: () => Effect.sync(() => ({ unsubscribe: Effect.void })),
    getHistory: () => Effect.succeed([]),
  });
  const unitTestLayer = MyServiceLive.pipe(Layer.provide(mockEventBus));

  // ─── Helper: Run Effect in test layer ────────────────────────────

  const runTest = <A>(effect: Effect.Effect<A, any, MyService>) =>
    effect.pipe(Effect.provide(testLayer), Effect.runPromise);

  // ─── Tests ───────────────────────────────────────────────────────

  describe("methodA", () => {
    it("should return expected result for valid input", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const svc = yield* MyService;
          return yield* svc.methodA("valid-input");
        }),
      );
      expect(result).toBeDefined();
      expect(result.field).toBe("expected-value");
    });

    it("should return tagged error for invalid input", async () => {
      const error = await Effect.gen(function* () {
        const svc = yield* MyService;
        return yield* svc.methodA("");
      }).pipe(
        Effect.provide(testLayer),
        Effect.flip, // Invert: success becomes error, error becomes success
        Effect.runPromise,
      );
      expect(error._tag).toBe("MyError");
      expect(error.message).toContain("invalid");
    });
  });
});
```

## Testing Patterns

### Pattern 1: Test service creation and basic operations

```typescript
it("should create service and execute basic operation", async () => {
  const result = await Effect.gen(function* () {
    const svc = yield* MyService;
    yield* svc.create({ name: "test" });
    const items = yield* svc.list();
    return items;
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("test");
});
```

### Pattern 2: Test Ref-based state

```typescript
it("should maintain state across operations", async () => {
  const result = await Effect.gen(function* () {
    const svc = yield* MyService;
    yield* svc.add("item1");
    yield* svc.add("item2");
    return yield* svc.getAll();
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

  expect(result).toHaveLength(2);
});
```

### Pattern 3: Test EventBus integration

```typescript
it("should publish events on state change", async () => {
  const events: unknown[] = [];
  const capturingEventBus = Layer.succeed(EventBus, {
    publish: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
    subscribe: () => Effect.sync(() => ({ unsubscribe: Effect.void })),
    getHistory: () => Effect.succeed([]),
  });

  await Effect.gen(function* () {
    const svc = yield* MyService;
    yield* svc.doSomething();
  }).pipe(
    Effect.provide(MyServiceLive.pipe(Layer.provide(capturingEventBus))),
    Effect.runPromise,
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toHaveProperty("type", "something.done");
});
```

### Pattern 4: Test with TestLLMService (for LLM-dependent code)

```typescript
import { LLMService } from "@reactive-agents/llm-provider";

const mockLLM = Layer.succeed(LLMService, {
  complete: (req) =>
    Effect.succeed({
      content: "mock response",
      stopReason: "end_turn" as const,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        estimatedCost: 0.001,
      },
      model: "test-model",
    }),
  stream: () =>
    Effect.fail(
      new LLMError({ message: "not implemented", provider: "anthropic" }),
    ),
  completeStructured: () =>
    Effect.fail(
      new LLMError({ message: "not implemented", provider: "anthropic" }),
    ),
  embed: (texts) => Effect.succeed(texts.map(() => new Array(1536).fill(0))),
  countTokens: () => Effect.succeed(100),
  getModelConfig: () =>
    Effect.succeed({ provider: "anthropic" as const, model: "test" }),
});
```

### Pattern 5: Test SQLite-dependent services

```typescript
import { Database } from "bun:sqlite";

// Create in-memory database for testing
const testDb = Layer.scoped(
  MemoryDatabase,
  Effect.acquireRelease(
    Effect.sync(() => {
      const db = new Database(":memory:");
      db.exec("PRAGMA journal_mode=WAL");
      // Run migrations
      db.exec(`CREATE TABLE IF NOT EXISTS ...`);
      return { db, query: db.query.bind(db), exec: db.exec.bind(db) };
    }),
    ({ db }) => Effect.sync(() => db.close()),
  ),
);
```

## What to Test

For each service, cover:

1. **Happy path** — normal operation with valid inputs
2. **Error cases** — invalid inputs return correct `Data.TaggedError` (check `_tag`)
3. **State management** — Ref-based state is consistent across operations
4. **Edge cases** — empty inputs, boundary values, max capacity
5. **Dependencies** — service correctly calls its dependencies
6. **Event publishing** — EventBus events are published correctly (if applicable)

## Running Tests

```bash
# Run tests for a specific package
bun test packages/$ARGUMENTS

# Run a specific test file
bun test packages/$ARGUMENTS/tests/specific.test.ts

# Run with watch mode
bun test --watch packages/$ARGUMENTS

# Run all tests
bun test
```

## Common Test Mistakes

1. **Forgetting to `Effect.provide` the test layer** — tests will fail with "Service not found"
2. **Not using `Effect.flip` for error tests** — errors in Effect need to be flipped to assert on them
3. **Sharing state between tests** — each test should create its own layer instance or reset state
4. **Testing implementation details** — test the service interface, not internal Ref contents
5. **Missing `.js` extensions** in import paths
