# Reactive Agents — Coding Standards

> Authoritative coding standards for all agents and contributors. Derived from 353 source files, 274 test files, 22 packages. All code must conform.

---

## Core Principles

1. **Effect-TS is the runtime.** No raw `throw`, no raw `await`, no `Promise.then()`. Everything flows through `Effect.Effect<A, E>`.
2. **Types are the API.** Zero `@ts-ignore`. Minimize `as any` (see policy below). Branded IDs, tagged errors, discriminated unions.
3. **Immutable by default.** All object fields `readonly`. Mutable state only through `Ref`.
4. **Observable by design.** New behavior emits EventBus events. No silent side effects.
5. **Composable and testable.** Small Effect-TS services wired via Layers. Every service mockable.

---

## Type System

### Data Shapes: `Schema.Struct`

```typescript
import { Schema } from "effect";

export const AgentConfigSchema = Schema.Struct({
  id: AgentId,
  name: Schema.String,
  status: Schema.Literal("idle", "running", "completed", "failed"),
  description: Schema.optional(Schema.String),
});
export type AgentConfig = typeof AgentConfigSchema.Type;
```

**Rules:**
- Use `Schema.Struct` for all data shapes — not `interface` or plain `type { ... }`
- Use `Schema.brand()` for domain IDs (`AgentId`, `TaskId`, `StepId`)
- Use `Schema.Literal()` for enums/unions
- Use `Schema.optional()` — not `?:`
- Derive TypeScript types with `typeof XxxSchema.Type`

**Exception:** Strategy input interfaces (e.g., `ReactiveInput`, `PlanExecuteInput`) use plain `interface` because they carry `readonly` Effect types that Schema can't encode. This is acceptable for internal-only function parameters.

### Discriminated Unions (Tagged)

```typescript
export type AgentEvent =
  | { readonly _tag: "AgentStarted"; readonly taskId: string; readonly agentId: string }
  | { readonly _tag: "AgentCompleted"; readonly taskId: string; readonly success: boolean }
  | { readonly _tag: "ToolCallCompleted"; readonly toolName: string; readonly durationMs: number };
```

All union members have `readonly _tag: "LiteralString"` as the discriminant.

### The `as any` Policy

**Zero `@ts-ignore` and `@ts-expect-error`** — this is non-negotiable.

`as any` is permitted only in these contexts:

| Context | Acceptable? | Example |
|---------|-------------|---------|
| Test mocks | Yes | `Layer.succeed(LLMService, mockImpl as any)` |
| Accessing untyped `meta` bags | Tolerated | `(state.meta.entropy as any)?.modelId` |
| SDK type gaps (e.g., Ollama chunk) | Tolerated | `(chunk as any).logprobs` |
| Production service logic | **No** | Refactor the types instead |

**Target:** <0.5% of lines. Currently at 0.33% (318 instances). New code should not increase this ratio.

**When you need `as any`:** Comment _why_ it's necessary. If there are >2 casts for the same reason, define a typed helper instead.

---

## Services

### Definition: `Context.Tag`

```typescript
export class MyService extends Context.Tag("MyService")<
  MyService,
  {
    readonly doWork: (input: string) => Effect.Effect<string, MyError>;
    readonly getState: () => Effect.Effect<ReadonlyMap<string, string>, never>;
  }
>() {}
```

**Rules:**
- Tag string MUST match class name exactly
- All methods `readonly`
- All methods return `Effect.Effect<A, E>`
- Never use OOP classes with constructors for services

### Implementation: `Layer.effect`

```typescript
export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const dep = yield* OtherService;
    const state = yield* Ref.make(new Map<string, string>());

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
- Always `Layer.effect(Tag, Effect.gen(function* () { ... }))`
- Dependencies via `yield* OtherService`
- Mutable state via `Ref.make()` — never `let`
- Resources needing cleanup use `Layer.scoped` + `Effect.acquireRelease`

### Optional Dependencies

```typescript
const maybeService = yield* Effect.serviceOption(OptionalService).pipe(
  Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
);
if (maybeService._tag === "Some") {
  // use maybeService.value
}
```

---

## Errors

### Tagged Errors

```typescript
export class LLMError extends Data.TaggedError("LLMError")<{
  readonly message: string;
  readonly provider: string;
  readonly cause?: unknown;
}> {}

export type LLMErrors = LLMError | LLMRateLimitError | LLMTimeoutError;
```

**Rules:**
- Always `Data.TaggedError("Name")<{ readonly fields }>`
- Tag string matches class name
- All fields `readonly`
- Export a union type per package
- Never `throw new Error()` — always `Effect.fail(new MyError({...}))`

### Error Propagation

```typescript
// Good: typed error in signature
readonly complete: (req: Request) => Effect.Effect<Response, LLMErrors>;

// Good: catch and map
yield* service.method().pipe(
  Effect.catchAll((err) => Effect.fail(new WrappedError({ cause: err }))),
);

// Bad: swallowing errors
yield* service.method().pipe(Effect.catchAll(() => Effect.void)); // only acceptable for non-critical observability
```

---

## Async & Sync Operations

```typescript
// Sync (bun:sqlite, pure computation)
const rows = yield* Effect.sync(() => db.query("SELECT * FROM t").all());

// Async (HTTP, file I/O)
const data = yield* Effect.tryPromise({
  try: () => fetch(url).then((r) => r.json()),
  catch: (e) => new FetchError({ message: String(e) }),
});

// Never:
const data = await fetch(url); // ← raw await
```

---

## Layer Composition

```typescript
// Independent services: mergeAll
export const createCoreLayer = () =>
  Layer.mergeAll(EventBusLive, ContextWindowManagerLive);

// Dependent services: provide
export const createReasoningLayer = (config: ReasoningConfig) =>
  ReasoningServiceLive(config).pipe(
    Layer.provide(StrategyRegistryLive),
  );
```

**Rules:**
- Every package exports a `createXxxLayer()` factory
- `Layer.mergeAll()` for independent services
- `Layer.provide()` for dependencies (order matters: provider → consumer)

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | kebab-case | `kernel-runner.ts`, `tool-execution.ts` |
| Types/Classes | PascalCase | `AgentEvent`, `LLMError`, `ToolService` |
| Functions | camelCase | `computeEntropy()`, `parseToolRequest()` |
| Service methods | camelCase verbs | `publish()`, `subscribe()`, `execute()`, `get()` |
| Constants | UPPER_SNAKE | `MODEL_REGISTRY`, `COMPLETION_MARKERS` |
| Branded types | PascalCase + Schema | `AgentId = Schema.String.pipe(Schema.brand("AgentId"))` |
| Layer factories | `createXxxLayer` | `createMemoryLayer()`, `createLLMProviderLayer()` |
| Live implementations | `XxxServiceLive` | `EventBusLive`, `ReasoningServiceLive` |

---

## File Structure

### Package Layout

```
packages/<name>/
  src/
    index.ts              # Barrel export (types → schemas → services → errors → layer)
    types.ts              # All type/schema definitions
    errors.ts             # Data.TaggedError classes + union
    runtime.ts            # createXxxLayer() factory
    services/             # Service implementations
    providers/            # Provider-specific implementations (if applicable)
  tests/
    <name>.test.ts        # Tests mirror source structure
  package.json
  tsconfig.json
```

### Barrel Export Order (`index.ts`)

```typescript
// 1. Types (type-only exports first)
export type { Agent, AgentConfig } from "./types/agent.js";

// 2. Schemas
export { AgentSchema, AgentConfigSchema } from "./types/agent.js";

// 3. Services + Live implementations
export { AgentService, AgentServiceLive } from "./services/agent-service.js";

// 4. Errors
export { AgentError, type CoreErrors } from "./errors/errors.js";

// 5. Layer factory
export { createCoreLayer } from "./runtime.js";
```

### Import Order

```typescript
// 1. External packages
import { Effect, Context, Layer, Ref, Data, Schema } from "effect";

// 2. Internal types (same package, type-only)
import type { CompletionRequest, LLMErrors } from "./types.js";

// 3. Internal values (same package)
import { LLMService } from "./llm-service.js";

// 4. Cross-package imports
import { EventBus } from "@reactive-agents/core";
```

### File Size

- Target: 100–300 lines per file
- Split at natural seams (types, service, helpers)
- If a file exceeds 500 lines, it's doing too much — decompose

---

## Testing

### Standard Test Structure

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";

describe("ServiceName", () => {
  const mockDep = Layer.succeed(DependencyTag, {
    method: () => Effect.succeed(mockValue),
  });

  it("should do the expected thing", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ServiceTag;
      const result = yield* svc.method(input);
      expect(result).toBe(expected);
    });

    await Effect.runPromise(program.pipe(Effect.provide(mockDep)));
  });
});
```

**Rules:**
- Bun Test (`bun:test`) — never Jest or Vitest
- One `describe()` per file, named after the service/module
- Effect programs run via `Effect.runPromise(program.pipe(Effect.provide(layers)))`
- Mock services via `Layer.succeed(Tag, implementation)`
- Create factory functions for reusable mocks: `makeMockLLM(response: string)`
- Error assertions use `Effect.runPromiseExit()` + check `._tag === "Failure"`

### Test Naming

```typescript
it("should return commits when repository exists", ...);
it("should fail with LLMError when provider is down", ...);
it("should emit ToolCallCompleted event after execution", ...);
```

Imperative form. Describe the expected behavior, not the implementation.

---

## Documentation

### JSDoc (Public APIs)

```typescript
/**
 * Publish an event to all subscribed handlers.
 *
 * @param event - The AgentEvent to broadcast
 * @returns Effect completing after all handlers start
 */
readonly publish: (event: AgentEvent) => Effect.Effect<void, never>;
```

**Rules:**
- `/** */` blocks on all public exports
- First line: imperative sentence describing what it does
- `@param` for each parameter
- `@returns` for return value
- `@example` for complex behavior
- No JSDoc on private helpers unless logic is non-obvious

### Section Comments (Internal Structure)

```typescript
// ─── Service Tag ───
export class MyService extends Context.Tag(...) {}

// ─── Live Implementation ───
export const MyServiceLive = Layer.effect(...)

// ─── Helpers ──────────────────────────────────────────────
function internalHelper(...) {}
```

Use `// ─── Section Name ───` with box-drawing characters for visual separation.

---

## Deterministic vs. LLM-Driven Logic

A key architectural principle: **prefer deterministic logic over LLM calls** for anything computable.

| Data | Source | Example |
|------|--------|---------|
| Tool call history | EventBus `ToolCallCompleted` events | Debrief `toolsUsed` |
| Execution outcome | `terminatedBy` + error count | Debrief `outcome` |
| Token counts | `CompletionResponse.usage` | Metrics dashboard |
| Step durations | `Date.now()` timing | Phase timeline |
| Strategy selected | Deterministic config lookup | Strategy name |

LLM calls are reserved for:
- Summarization (debrief `summary`, `keyFindings`)
- Classification (tool relevance, strategy selection for ambiguous tasks)
- Content generation (final answers, user-facing text)

**Rule:** If a field can be computed from available data, compute it. Don't ask the LLM.

---

## EventBus Integration

All new behavior that affects agent state or observability MUST emit events:

```typescript
if (eventBus._tag === "Some") {
  yield* eventBus.value.publish({
    _tag: "MyNewEvent",
    taskId: state.taskId,
    // ... event-specific fields
  });
}
```

**Rules:**
- Event types added to `AgentEvent` union in `@reactive-agents/core`
- All event fields `readonly`
- Events are fire-and-forget (publish returns `Effect<void, never>`)
- MetricsCollector auto-subscribes; no manual wiring needed

---

## Performance

- **No unnecessary LLM calls.** Each call costs tokens and latency. Prefer heuristics first, LLM as fallback.
- **Tool result compression.** Large tool outputs go through `compressToolResult()` before entering context.
- **Adaptive tool filtering.** Show the LLM only relevant tools (4-8), not all 49.
- **Early exit.** When work is done, stop. Don't loop to maxIterations when the answer is ready.
- **Context pressure.** Monitor token utilization. Compress before hitting limits.

---

## Anti-Patterns (Never Do These)

| Anti-Pattern | Why | Do Instead |
|---|---|---|
| `throw new Error()` | Breaks Effect type system | `Effect.fail(new TaggedError({...}))` |
| `await promise` | Loses Effect context | `yield* Effect.tryPromise(...)` |
| `@ts-ignore` | Hides real type errors | Fix the types |
| `let` for service state | Not thread-safe | `Ref.make()` |
| Circular package imports | Build breaks | Restructure dependencies |
| `console.log` for observability | Not structured | EventBus events + ObservabilityService |
| Hardcoded thresholds | Not adaptive | Config params with sensible defaults |
| Swallowing errors silently | Hides bugs | `Effect.catchAll` with logging or re-throw |
| Manual version bumps | Conflicts with changesets | `bun run changeset` |
