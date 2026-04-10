---
name: agent-tdd
description: Test-Driven Development for the Reactive Agents codebase. Effect-TS aware TDD with mandatory timeout flags, Effect.flip error testing, Layer isolation, and dangling-server prevention. Use when implementing any feature or fixing any bug.
user-invocable: false
---

# TDD for Reactive Agents

## The Rule (unchanged from all TDD)

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
```

If you wrote code before a test: delete it. Start from the test.

## Three Failure Modes This Codebase Adds

Generic TDD skills don't cover these. They cause hung CI, false greens, and leaked state:

1. **Hangs** — missing `--timeout` flag keeps Effect event loop handles alive forever
2. **Dangling servers** — `Bun.serve()` left open permanently traps the test process
3. **Silent error false-greens** — forgetting `Effect.flip` makes error path tests always pass

The patterns below prevent all three.

## Mandatory File Header

Every test file starts with this comment. It prevents timeout amnesia.

```typescript
// Run: bun test packages/<pkg>/tests/<this-file>.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect, afterAll } from "bun:test";
```

## Red-Green-Refactor for Effect-TS

### RED — Write the Failing Test First

```typescript
it("should store and retrieve a tool by name", async () => {
  const result = await Effect.gen(function* () {
    const svc = yield* ToolService;
    yield* svc.register(myTool);
    return yield* svc.get("my-tool");
  }).pipe(Effect.provide(testLayer), Effect.runPromise);

  expect(result.name).toBe("my-tool");
}, 15000); // timeout on EVERY test
```

Run it:

```bash
bun test packages/tools/tests/tool-service.test.ts --timeout 15000
```

Expected output: `FAIL — ToolService not defined` (or your specific error)

**If the test passes immediately: your test is wrong. Delete it. Start over.**

### GREEN — Minimal Implementation

Write only the code needed to pass this specific test. No extra validation, no future-proofing.

Run the test again. Expected: `PASS`.

### REFACTOR

Clean up implementation and tests. Run again. Must stay green.

## Testing Error Cases: Always Use Effect.flip

```typescript
// WRONG — silent false green (Effect errors don't throw):
it("should fail on missing tool", async () => {
  try {
    await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.get("nonexistent");
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  } catch (e) {
    expect(e).toBeDefined(); // This block may never execute
  }
});

// CORRECT — flip inverts success and error channels:
it("should return ToolNotFoundError for unknown tool name", async () => {
  const error = await Effect.gen(function* () {
    const svc = yield* ToolService;
    return yield* svc.get("nonexistent");
  }).pipe(
    Effect.provide(testLayer),
    Effect.flip,        // ← error becomes the success value
    Effect.runPromise,
  );

  expect(error._tag).toBe("ToolNotFoundError");
  expect(error.toolName).toBe("nonexistent");
}, 15000);
```

## Layer Composition for Test Isolation

Do not share mutable service state between tests. Each test block gets its own layer.

```typescript
// WRONG — shared layer leaks state across tests:
const testLayer = MyServiceLive.pipe(Layer.provide(EventBusLive));

describe("MyService", () => {
  it("adds item", async () => { /* mutates shared layer */ });
  it("lists items", async () => { /* sees leaked state from previous test */ });
});

// CORRECT — factory function creates fresh layer per test:
const makeTestLayer = () =>
  MyServiceLive.pipe(Layer.provide(EventBusLive));

describe("MyService", () => {
  it("adds item", async () => {
    const result = await effect.pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise,
    );
    // ...
  }, 15000);
});
```

## Dangling Server Teardown

Any test that binds a port MUST release it. Otherwise the test process hangs permanently.

```typescript
import { afterAll } from "bun:test";

describe("HTTP endpoint tests", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterAll(async () => {
    await server?.stop(true); // true = force-close all connections immediately
  });

  it("responds to health check", async () => {
    server = Bun.serve({ port: 0, fetch: myHandler });
    const port = (server as any).port;
    const resp = await fetch(`http://localhost:${port}/health`);
    expect(resp.status).toBe(200);
  }, 15000);
});
```

This applies to: `Bun.serve()`, Elysia apps, Express apps, any HTTP server.

## Run Commands

```bash
# During development — always targeted:
bun test packages/<pkg>/tests/<file>.test.ts --timeout 15000

# Run specific test by name:
bun test packages/<pkg>/tests/<file>.test.ts --timeout 15000 -t "test name"

# After implementing — full package:
bun test packages/<pkg> --timeout 15000

# Before committing — full suite:
bun test --timeout 15000
```

**Never omit `--timeout 15000`.** There is no scenario in this codebase where it is safe to omit.

## Real vs Mock Dependencies

| Dependency | Use Real When | Use Mock When |
|-----------|--------------|--------------|
| `EventBus` | Testing event-emitting behavior | Testing services that don't use events |
| `LLMService` | Never — expensive, flaky, slow | Always — use `makeMockLLM()` |
| `ToolService` | Integration tests of tools | Unit tests of non-tool services |
| SQLite (memory) | Use `:memory:` in-process DB | N/A — in-memory IS the mock |
| HTTP server | Real port with `Bun.serve({ port: 0 })` | N/A |
| `@reactive-agents/testing` mocks | Preferred for standard scenarios | N/A |

Always prefer `@reactive-agents/testing` pre-built mocks (`makeMockLLM`, `makeMockToolService`, `makeMockEventBus`) over hand-rolled ones. Only hand-roll when you need fine-grained per-call behavior.

## Multi-Turn Kernel Tests

For testing full agent execution with a scripted tool call sequence:

```typescript
import { ReactiveAgents } from "reactive-agents";

it("completes a two-turn task using search then summarize", async () => {
  const agent = await ReactiveAgents.create()
    .withTestScenario([
      { toolCall: { name: "search", args: { query: "AI trends" } } },
      { text: "Here are the AI trends: ..." },
    ])
    .withTools({ tools: [searchTool] })
    .build();

  const result = await agent.run("Find and summarize AI trends");

  expect(result.success).toBe(true);
  expect(result.output).toContain("trends");
}, 30000); // Multi-turn needs a longer timeout
```
