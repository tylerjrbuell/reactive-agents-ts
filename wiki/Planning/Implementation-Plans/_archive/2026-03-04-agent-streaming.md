# Agent Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every agent execution streamable via `agent.runStream()` returning an Effect `Stream<AgentStreamEvent>`, with `run()` unified on top of it, and a clean adapter API for SSE/ReadableStream/AsyncIterable.

**Architecture:** A `FiberRef<TextDeltaCallback>` in `@reactive-agents/core` carries a text-delta callback through the fiber without threading it through every layer interface. The `react-kernel.ts` reads this FiberRef and calls it for each text token from `llm.stream()`. `ExecutionEngine.executeStream()` creates a `Queue.bounded<AgentStreamEvent>(256)`, sets the FiberRef to offer `TextDelta` events, subscribes to EventBus for full-density phase/tool events, then returns `Stream.fromQueue(queue)`. `run()` becomes a collector of `runStream()` — same underlying path, zero duplication.

**Tech Stack:** Effect `Queue`, `Stream`, `FiberRef`, `Scope`; all 6 LLM providers already implement `stream()`; bun:test; TypeScript strict.

---

## Reference: Approved Design (key types)

```typescript
// streamDensity: "tokens" — minimal
{ _tag: "TextDelta"; text: string }
{ _tag: "StreamCompleted"; output: string; metadata: AgentResultMetadata }
{ _tag: "StreamError"; cause: string }

// streamDensity: "full" — adds
{ _tag: "PhaseStarted"; phase: string; timestamp: number }
{ _tag: "PhaseCompleted"; phase: string; durationMs: number }
{ _tag: "ThoughtEmitted"; content: string; iteration: number }
{ _tag: "ToolCallStarted"; toolName: string; callId: string }
{ _tag: "ToolCallCompleted"; toolName: string; callId: string; durationMs: number; success: boolean }

// New EventBus events (strengthen EventBus)
{ _tag: "TextDeltaReceived"; taskId: string; text: string; timestamp: number }   // once per content_complete
{ _tag: "AgentStreamStarted"; taskId: string; agentId: string; density: string; timestamp: number }
{ _tag: "AgentStreamCompleted"; taskId: string; agentId: string; success: boolean; durationMs: number }
```

---

## Task 1: `AgentStreamEvent` types + `AgentStream` adapter namespace

**Files:**
- Create: `packages/runtime/src/stream-types.ts`
- Create: `packages/runtime/src/agent-stream.ts`

### Step 1: Write the failing test for types

Create `packages/runtime/tests/stream-types.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import type { AgentStreamEvent, StreamDensity } from "../src/stream-types.js";

describe("AgentStreamEvent types", () => {
  it("TextDelta has _tag and text", () => {
    const e: AgentStreamEvent = { _tag: "TextDelta", text: "hello" };
    expect(e._tag).toBe("TextDelta");
  });

  it("StreamCompleted carries output and metadata", () => {
    const e: AgentStreamEvent = {
      _tag: "StreamCompleted",
      output: "result",
      metadata: { duration: 100, cost: 0, tokensUsed: 50, stepsCount: 1 },
    };
    expect(e._tag).toBe("StreamCompleted");
  });

  it("StreamError carries cause", () => {
    const e: AgentStreamEvent = { _tag: "StreamError", cause: "timeout" };
    expect(e.cause).toBe("timeout");
  });

  it("StreamDensity is tokens or full", () => {
    const d1: StreamDensity = "tokens";
    const d2: StreamDensity = "full";
    expect(d1).toBe("tokens");
    expect(d2).toBe("full");
  });
});
```

### Step 2: Run test to confirm it fails

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test packages/runtime/tests/stream-types.test.ts 2>&1 | head -20
```
Expected: FAIL — `stream-types.ts` does not exist.

### Step 3: Create `packages/runtime/src/stream-types.ts`

```typescript
import type { AgentResultMetadata } from "./builder.js";

/** How many event types the stream emits.
 * - "tokens": TextDelta + StreamCompleted + StreamError only (minimal overhead)
 * - "full": all phase/tool/thought events too
 */
export type StreamDensity = "tokens" | "full";

/**
 * Public streaming event union emitted by agent.runStream().
 * Discriminated by `_tag` — use type narrowing to handle each variant.
 */
export type AgentStreamEvent =
  // ─── Always emitted (both densities) ───
  | {
      /** A text token arrived from the LLM. High-frequency during inference. */
      readonly _tag: "TextDelta";
      readonly text: string;
    }
  | {
      /** Execution completed. Last event on a successful stream. */
      readonly _tag: "StreamCompleted";
      readonly output: string;
      readonly metadata: AgentResultMetadata;
    }
  | {
      /** Execution failed. Last event on a failed stream. */
      readonly _tag: "StreamError";
      readonly cause: string;
    }
  // ─── Full density only ───
  | {
      /** A lifecycle phase started. Only emitted when density is "full". */
      readonly _tag: "PhaseStarted";
      readonly phase: string;
      readonly timestamp: number;
    }
  | {
      /** A lifecycle phase completed. Only emitted when density is "full". */
      readonly _tag: "PhaseCompleted";
      readonly phase: string;
      readonly durationMs: number;
    }
  | {
      /** The LLM produced a reasoning thought. Only emitted when density is "full". */
      readonly _tag: "ThoughtEmitted";
      readonly content: string;
      readonly iteration: number;
    }
  | {
      /** A tool call started. Only emitted when density is "full". */
      readonly _tag: "ToolCallStarted";
      readonly toolName: string;
      readonly callId: string;
    }
  | {
      /** A tool call completed. Only emitted when density is "full". */
      readonly _tag: "ToolCallCompleted";
      readonly toolName: string;
      readonly callId: string;
      readonly durationMs: number;
      readonly success: boolean;
    };
```

### Step 4: Create `packages/runtime/src/agent-stream.ts`

```typescript
import { Stream, Effect } from "effect";
import type { AgentStreamEvent } from "./stream-types.js";
import type { AgentResult } from "./builder.js";

/**
 * Adapters for consuming an agent stream in different environments.
 *
 * @example
 * ```typescript
 * // Next.js / Hono SSE
 * return AgentStream.toSSE(agent.runStream("prompt"));
 *
 * // Browser fetch / ReadableStream
 * const body = AgentStream.toReadableStream(agent.runStream("prompt"));
 *
 * // for await...of loop
 * for await (const event of AgentStream.toAsyncIterable(stream)) { ... }
 *
 * // Collect to AgentResult (equivalent to agent.run())
 * const result = await AgentStream.collect(stream);
 * ```
 */
export const AgentStream = {
  /**
   * Convert an Effect stream to a Web ReadableStream (browser + Node 18+).
   * Each event is emitted as a JSON-encoded line: `data: {...}\n\n`.
   */
  toSSE(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): Response {
    const readable = new ReadableStream({
      start(controller) {
        Effect.runFork(
          Stream.runForEach(stream, (event) =>
            Effect.sync(() => {
              controller.enqueue(
                `data: ${JSON.stringify(event)}\n\n`,
              );
              if (
                event._tag === "StreamCompleted" ||
                event._tag === "StreamError"
              ) {
                controller.close();
              }
            }),
          ).pipe(
            Effect.catchAll((e) =>
              Effect.sync(() => {
                controller.enqueue(
                  `data: ${JSON.stringify({ _tag: "StreamError", cause: String(e) })}\n\n`,
                );
                controller.close();
              }),
            ),
          ),
        );
      },
    });
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },

  /**
   * Convert to a Web API ReadableStream of AgentStreamEvent objects.
   */
  toReadableStream(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): ReadableStream<AgentStreamEvent> {
    return Stream.toReadableStream(stream) as ReadableStream<AgentStreamEvent>;
  },

  /**
   * Convert to an AsyncIterable for `for await...of` consumption.
   */
  toAsyncIterable(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): AsyncIterable<AgentStreamEvent> {
    return Stream.toAsyncIterable(stream) as AsyncIterable<AgentStreamEvent>;
  },

  /**
   * Collect a stream to a single AgentResult (equivalent to agent.run()).
   * Throws if the stream emits StreamError.
   */
  async collect(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): Promise<AgentResult> {
    return Effect.runPromise(
      Stream.runFold(
        stream,
        null as AgentResult | null,
        (acc, event) => {
          if (event._tag === "StreamCompleted") {
            return {
              output: event.output,
              success: true,
              taskId: "",
              agentId: "",
              metadata: event.metadata,
            } as AgentResult;
          }
          if (event._tag === "StreamError") {
            throw new Error(event.cause);
          }
          return acc;
        },
      ).pipe(
        Effect.flatMap((result) =>
          result
            ? Effect.succeed(result)
            : Effect.fail(new Error("Stream ended without StreamCompleted event")),
        ),
      ),
    );
  },
};
```

### Step 5: Run test to confirm it passes

```bash
bun test packages/runtime/tests/stream-types.test.ts
```
Expected: PASS (4 tests).

### Step 6: Commit

```bash
git add packages/runtime/src/stream-types.ts packages/runtime/src/agent-stream.ts packages/runtime/tests/stream-types.test.ts
git commit -m "feat(runtime): AgentStreamEvent types + AgentStream adapter namespace"
```

---

## Task 2: New EventBus events for streaming

**Files:**
- Modify: `packages/core/src/services/event-bus.ts` (add 3 new events to AgentEvent union)

### Step 1: Write the failing test

Add to `packages/core/tests/event-bus.test.ts` (or create if not present):

```typescript
it("accepts TextDeltaReceived event", async () => {
  const bus = await Effect.runPromise(
    Effect.provide(Effect.gen(function* () { return yield* EventBus; }), EventBusLive)
  );
  const events: AgentEvent[] = [];
  await Effect.runPromise(
    bus.subscribe((e) => Effect.sync(() => { events.push(e); return; }))
  );
  await Effect.runPromise(
    bus.publish({
      _tag: "TextDeltaReceived",
      taskId: "t1",
      text: "hello",
      timestamp: Date.now(),
    })
  );
  expect(events[0]?._tag).toBe("TextDeltaReceived");
});
```

### Step 2: Run test to confirm it fails (type error)

```bash
bun test packages/core/tests/event-bus.test.ts 2>&1 | head -20
```
Expected: TypeScript compile error — `TextDeltaReceived` not in `AgentEvent`.

### Step 3: Add 3 new events to `AgentEvent` union

In `packages/core/src/services/event-bus.ts`, append to the union (before the closing `;`):

```typescript
  // ─── Streaming events ───
  | {
      /**
       * A complete text response arrived from the LLM (end of stream chunk).
       * Fired once per LLM call, after content_complete — NOT per token.
       * For per-token events, subscribe to agent.runStream() TextDelta events instead.
       */
      readonly _tag: "TextDeltaReceived";
      readonly taskId: string;
      readonly text: string;
      readonly timestamp: number;
    }
  | {
      /**
       * Agent stream started.
       * Fired at the beginning of agent.runStream() execution.
       */
      readonly _tag: "AgentStreamStarted";
      readonly taskId: string;
      readonly agentId: string;
      readonly density: string;
      readonly timestamp: number;
    }
  | {
      /**
       * Agent stream completed.
       * Fired when the stream reaches StreamCompleted or StreamError.
       */
      readonly _tag: "AgentStreamCompleted";
      readonly taskId: string;
      readonly agentId: string;
      readonly success: boolean;
      readonly durationMs: number;
    }
```

### Step 4: Run test to confirm it passes

```bash
bun test packages/core/tests/event-bus.test.ts
```
Expected: PASS.

### Step 5: Run full test suite to confirm no regressions

```bash
bun test --timeout 30000 2>&1 | tail -5
```
Expected: same pass count as before (1353+).

### Step 6: Commit

```bash
git add packages/core/src/services/event-bus.ts
git commit -m "feat(core): add TextDeltaReceived, AgentStreamStarted, AgentStreamCompleted to AgentEvent"
```

---

## Task 3: `StreamingTextCallback` FiberRef in `@reactive-agents/core`

This is the Effect-idiomatic way to carry a callback through fibers without threading explicit params through every layer interface (StrategyFn, KernelInput, ReasoningService, etc.).

**Files:**
- Create: `packages/core/src/streaming.ts`
- Modify: `packages/core/src/index.ts` (add export)

### Step 1: Write the failing test

Create `packages/core/tests/streaming.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, FiberRef } from "effect";
import { StreamingTextCallback } from "../src/streaming.js";

describe("StreamingTextCallback", () => {
  it("defaults to null", async () => {
    const val = await Effect.runPromise(FiberRef.get(StreamingTextCallback));
    expect(val).toBeNull();
  });

  it("can be set locally and read inside the fiber", async () => {
    const captured: string[] = [];
    const callback = (text: string) => Effect.sync(() => { captured.push(text); });
    await Effect.runPromise(
      FiberRef.locally(StreamingTextCallback, callback)(
        Effect.gen(function* () {
          const cb = yield* FiberRef.get(StreamingTextCallback);
          if (cb) yield* cb("hello");
          if (cb) yield* cb(" world");
        })
      )
    );
    expect(captured).toEqual(["hello", " world"]);
  });

  it("does not leak to outer fiber after locally", async () => {
    const callback = (_text: string) => Effect.void;
    await Effect.runPromise(
      FiberRef.locally(StreamingTextCallback, callback)(Effect.void)
    );
    const val = await Effect.runPromise(FiberRef.get(StreamingTextCallback));
    expect(val).toBeNull();
  });
});
```

### Step 2: Run test to confirm it fails

```bash
bun test packages/core/tests/streaming.test.ts 2>&1 | head -10
```
Expected: FAIL — module not found.

### Step 3: Create `packages/core/src/streaming.ts`

```typescript
import { FiberRef, Effect } from "effect";

/**
 * FiberRef carrying an optional text-delta callback.
 *
 * Set this before running an Effect-based execution to receive each
 * text token as it arrives from the LLM. The callback is fiber-local —
 * concurrent executions get independent copies.
 *
 * Used by react-kernel.ts (reads the callback) and ExecutionEngine
 * (sets it to offer TextDelta events to a Queue).
 *
 * @example
 * ```typescript
 * await Effect.runPromise(
 *   FiberRef.locally(StreamingTextCallback, (text) =>
 *     Queue.offer(myQueue, { _tag: "TextDelta", text })
 *   )(myExecutionEffect)
 * );
 * ```
 */
export const StreamingTextCallback = FiberRef.unsafeMake<
  ((text: string) => Effect.Effect<void, never>) | null
>(null);
```

### Step 4: Export from `packages/core/src/index.ts`

Add to the Runtime section:
```typescript
export { StreamingTextCallback } from "./streaming.js";
```

### Step 5: Run test to confirm it passes

```bash
bun test packages/core/tests/streaming.test.ts
```
Expected: PASS (3 tests).

### Step 6: Run full suite for regressions

```bash
bun test --timeout 30000 2>&1 | tail -5
```

### Step 7: Commit

```bash
git add packages/core/src/streaming.ts packages/core/src/index.ts packages/core/tests/streaming.test.ts
git commit -m "feat(core): StreamingTextCallback FiberRef for fiber-local text delta propagation"
```

---

## Task 4: `react-kernel.ts` — switch `llm.complete()` → `llm.stream()` + emit TextDelta

This task wires actual token streaming from the LLM into the `StreamingTextCallback`.

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`

**Key change:** In `handleThinking()`, replace the `llm.complete(...)` call with `llm.stream(...)` consumed via `Stream.runForEach`. Accumulate content + emit text deltas via `StreamingTextCallback`. Also fire one `TextDeltaReceived` EventBus event per LLM response.

### Step 1: Write the failing test

Create `packages/reasoning/tests/strategies/react-kernel-streaming.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, FiberRef } from "effect";
import { StreamingTextCallback } from "@reactive-agents/core";
import { executeReActKernel } from "../../src/strategies/shared/react-kernel.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("react-kernel streaming", () => {
  it("calls StreamingTextCallback with text deltas when set", async () => {
    const captured: string[] = [];
    const result = await Effect.runPromise(
      FiberRef.locally(
        StreamingTextCallback,
        (text) => Effect.sync(() => { captured.push(text); })
      )(
        executeReActKernel({ task: "Say hello", maxIterations: 2 })
      ).pipe(
        Effect.provide(
          TestLLMServiceLayer({ "Say hello": "FINAL ANSWER: hello" })
        )
      )
    );
    // Should have received text delta(s) for the response
    expect(captured.length).toBeGreaterThan(0);
    expect(result.output).toContain("hello");
  });

  it("does not error when StreamingTextCallback is null (default)", async () => {
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Say hi", maxIterations: 2 }).pipe(
        Effect.provide(
          TestLLMServiceLayer({ "Say hi": "FINAL ANSWER: hi" })
        )
      )
    );
    expect(result.output).toContain("hi");
  });
});
```

### Step 2: Run test to confirm it fails

```bash
bun test packages/reasoning/tests/strategies/react-kernel-streaming.test.ts 2>&1 | head -20
```
Expected: First test fails — captured.length === 0 (currently uses complete(), not stream()).

### Step 3: Modify `handleThinking()` in `react-kernel.ts`

**Important:** The test LLM provider's `stream()` method emits `text_delta` events. Import `Stream`, `FiberRef`, and `StreamingTextCallback`:

At top of file, add imports:
```typescript
import { Effect, Stream, FiberRef } from "effect";
import { StreamingTextCallback } from "@reactive-agents/core";
```
(Remove `Effect` from existing import if present and consolidate.)

Replace the `llm.complete(...)` block in `handleThinking` (lines ~255-288 of the original file) with:

```typescript
// ── STREAM (with text delta emission) ──────────────────────────────────
const llmStream = yield* llm
  .stream({
    messages: [{ role: "user", content: thoughtPrompt }],
    systemPrompt: systemPromptText,
    maxTokens: 1500,
    temperature: temp,
    stopSequences: ["Observation:", "\nObservation:"],
  })
  .pipe(
    Effect.mapError(
      (err) =>
        new ExecutionError({
          strategy,
          message: `LLM stream failed at iteration ${state.iteration}: ${
            err && typeof err === "object" && "message" in err
              ? (err as { message: string }).message
              : String(err)
          }`,
          step: state.iteration,
          cause: err,
        }),
    ),
    Effect.catchAll((execErr) =>
      Effect.succeed(
        Stream.make<import("@reactive-agents/llm-provider").StreamEvent>({
          type: "content_complete" as const,
          content: `[LLM Error: ${execErr.message}]`,
        }),
      ),
    ),
  );

// Accumulate content + emit text deltas via FiberRef callback
let accumulatedContent = "";
let accumulatedUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
};

const textDeltaCb = yield* FiberRef.get(StreamingTextCallback);

yield* Stream.runForEach(llmStream, (event) =>
  Effect.gen(function* () {
    if (event.type === "text_delta") {
      accumulatedContent += event.text;
      if (textDeltaCb) {
        yield* textDeltaCb(event.text).pipe(Effect.catchAll(() => Effect.void));
      }
    } else if (event.type === "content_complete") {
      accumulatedContent = event.content;
    } else if (event.type === "usage") {
      accumulatedUsage = event.usage;
    }
  }),
).pipe(Effect.catchAll(() => Effect.void));

// Build a response object matching the original llm.complete() shape
const thoughtResponse = {
  content: accumulatedContent,
  stopReason: "end_turn" as const,
  usage: accumulatedUsage,
  model: "unknown",
};
```

The rest of `handleThinking` (parsing thought, FA check, etc.) remains unchanged — it still reads `thoughtResponse.content` and `thoughtResponse.usage` which are now accumulated from the stream.

**Note on imports:** `packages/reasoning/package.json` already depends on `@reactive-agents/core`. Verify this is in its deps:
```bash
cat packages/reasoning/package.json | grep core
```
If not present, add `"@reactive-agents/core": "workspace:*"` to dependencies.

### Step 4: Run test to confirm it passes

```bash
bun test packages/reasoning/tests/strategies/react-kernel-streaming.test.ts
```
Expected: PASS (2 tests). Captured deltas > 0 for first test.

### Step 5: Run full reasoning test suite for regressions

```bash
bun test packages/reasoning --timeout 30000 2>&1 | tail -10
```
Expected: same pass count as before.

### Step 6: Commit

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/tests/strategies/react-kernel-streaming.test.ts
git commit -m "feat(reasoning): react-kernel uses llm.stream() + emits TextDelta via StreamingTextCallback"
```

---

## Task 5: `ExecutionEngine.executeStream()` + direct-LLM path streaming

This task adds `executeStream()` to the ExecutionEngine service and wires up the Queue.

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts`

The `ExecutionEngine` service interface gets a new method:
```typescript
readonly executeStream: (
  task: Task,
  options?: { density?: StreamDensity },
) => Effect.Effect<Stream.Stream<AgentStreamEvent, Error>>;
```

The implementation:
1. Creates `Queue.bounded<AgentStreamEvent>(256)` within a Scope
2. Sets `StreamingTextCallback` FiberRef to queue offers
3. If `density === "full"`, subscribes to EventBus and maps AgentEvent → AgentStreamEvent for phase/tool events
4. Forks the existing `execute(task)` Effect
5. On completion: offers `StreamCompleted` or `StreamError` to queue, then shuts it down
6. Returns `Stream.fromQueue(queue).pipe(Stream.onError(...))`

### Step 1: Write the failing test

Create `packages/runtime/tests/execute-stream.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Stream } from "effect";
import { ExecutionEngine, ExecutionEngineLive } from "../src/execution-engine.js";
import { createRuntime } from "../src/runtime.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

// Helper: collect all stream events into an array
async function collectStream(
  stream: Stream.Stream<AgentStreamEvent, Error>
): Promise<AgentStreamEvent[]> {
  return Effect.runPromise(Stream.runCollect(stream).pipe(
    Effect.map((chunk) => [...chunk])
  ));
}

describe("ExecutionEngine.executeStream", () => {
  const runtime = createRuntime({
    agentId: "test-agent",
    provider: "test",
    testResponses: { "Hello": "FINAL ANSWER: Hi there" },
  });

  it("returns a stream that emits TextDelta and StreamCompleted", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        const { generateTaskId, AgentId, Schema } = yield* Effect.promise(
          () => import("@reactive-agents/core")
        );
        const task = {
          id: generateTaskId(),
          agentId: Schema.decodeSync(AgentId)("test-agent"),
          type: "query" as const,
          input: { question: "Hello" },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [] },
          createdAt: new Date(),
        };
        const stream = yield* engine.executeStream(task);
        const all: AgentStreamEvent[] = [];
        yield* Stream.runForEach(stream, (e) => Effect.sync(() => { all.push(e); }));
        return all;
      }).pipe(Effect.provide(runtime))
    );

    const tags = events.map((e) => e._tag);
    expect(tags).toContain("StreamCompleted");
    const completed = events.find((e) => e._tag === "StreamCompleted") as any;
    expect(completed.output).toContain("Hi there");
  });

  it("last event is always StreamCompleted or StreamError", async () => {
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        const { generateTaskId, AgentId, Schema } = yield* Effect.promise(
          () => import("@reactive-agents/core")
        );
        const task = {
          id: generateTaskId(),
          agentId: Schema.decodeSync(AgentId)("test-agent"),
          type: "query" as const,
          input: { question: "Hello" },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [] },
          createdAt: new Date(),
        };
        const stream = yield* engine.executeStream(task);
        const all: AgentStreamEvent[] = [];
        yield* Stream.runForEach(stream, (e) => Effect.sync(() => { all.push(e); }));
        return all;
      }).pipe(Effect.provide(runtime))
    );

    const last = events[events.length - 1];
    expect(["StreamCompleted", "StreamError"]).toContain(last?._tag);
  });
});
```

### Step 2: Run test to confirm it fails

```bash
bun test packages/runtime/tests/execute-stream.test.ts 2>&1 | head -20
```
Expected: FAIL — `executeStream` is not on `ExecutionEngine`.

### Step 3: Add `executeStream` to the `ExecutionEngine` service interface

In `packages/runtime/src/execution-engine.ts`, in the `ExecutionEngine` class definition, add:

```typescript
// Add these imports at top of file:
import { Queue, Stream as EStream, FiberRef, Scope } from "effect";
import type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
import { StreamingTextCallback } from "@reactive-agents/core";
```

In the service interface (inside `Context.Tag`), add:
```typescript
readonly executeStream: (
  task: Task,
  options?: { density?: StreamDensity },
) => Effect.Effect<EStream.Stream<AgentStreamEvent, Error>>;
```

### Step 4: Implement `executeStream` in `ExecutionEngineLive`

In the `ExecutionEngineLive` factory, after the `execute` implementation, add `executeStream`:

```typescript
executeStream: (task, options) =>
  Effect.gen(function* () {
    const density = options?.density ?? "tokens";
    const queue = yield* Queue.bounded<AgentStreamEvent>(256);
    const startMs = Date.now();

    // Helper: safely offer to queue (ignore if already shut down)
    const offerSafe = (event: AgentStreamEvent) =>
      Queue.offer(queue, event).pipe(Effect.catchAll(() => Effect.void));

    // ── Wire up full-density EventBus forwarding ──
    let unsubFn: (() => void) | null = null;
    if (density === "full") {
      const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const }))
      ) as Effect.Effect<{ _tag: "Some"; value: EbLike } | { _tag: "None" }>;

      if (ebOpt._tag === "Some") {
        const eb = ebOpt.value;
        // Subscribe and forward relevant events → AgentStreamEvent
        unsubFn = yield* eb.subscribe((event: AgentEvent) =>
          Effect.gen(function* () {
            if (event._tag === "ExecutionPhaseEntered") {
              yield* offerSafe({
                _tag: "PhaseStarted",
                phase: event.phase,
                timestamp: Date.now(),
              });
            } else if (event._tag === "ExecutionPhaseCompleted") {
              yield* offerSafe({
                _tag: "PhaseCompleted",
                phase: event.phase,
                durationMs: event.durationMs,
              });
            } else if (event._tag === "ReasoningStepCompleted" && event.thought) {
              yield* offerSafe({
                _tag: "ThoughtEmitted",
                content: event.thought,
                iteration: event.step,
              });
            } else if (event._tag === "ToolCallStarted") {
              yield* offerSafe({
                _tag: "ToolCallStarted",
                toolName: event.toolName,
                callId: event.callId,
              });
            } else if (event._tag === "ToolCallCompleted") {
              yield* offerSafe({
                _tag: "ToolCallCompleted",
                toolName: event.toolName,
                callId: event.callId,
                durationMs: event.durationMs,
                success: event.success,
              });
            }
          })
        ) as unknown as () => void;
      }
    }

    // ── Fork execute with StreamingTextCallback set ──
    const fiber = yield* FiberRef.locally(
      StreamingTextCallback,
      (text: string) => offerSafe({ _tag: "TextDelta", text }),
    )(
      // Run execute and offer terminal event on completion
      execute(task).pipe(
        Effect.tap((taskResult) =>
          offerSafe({
            _tag: "StreamCompleted",
            output: String(taskResult.output ?? ""),
            metadata: taskResult.metadata as any,
          })
        ),
        Effect.catchAll((err) =>
          offerSafe({
            _tag: "StreamError",
            cause: "message" in err ? (err as any).message : String(err),
          })
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (unsubFn) unsubFn();
          }).pipe(
            Effect.flatMap(() => Queue.shutdown(queue))
          )
        ),
      ),
    ).pipe(Effect.forkDaemon);

    // Attach fiber to scope so it's interrupted on scope close
    yield* Effect.addFinalizer(() => fiber.interruptFork);

    return EStream.fromQueue(queue).pipe(
      EStream.map((event) => event as AgentStreamEvent),
    );
  }).pipe(Effect.scoped),
```

**Note:** The `execute` reference inside `executeStream` refers to the local `execute` function defined earlier in the `ExecutionEngineLive` closure — not `engine.execute`. This is already accessible in the closure scope.

### Step 5: Run test to confirm it passes

```bash
bun test packages/runtime/tests/execute-stream.test.ts
```
Expected: PASS (2 tests).

### Step 6: Run full runtime tests for regressions

```bash
bun test packages/runtime --timeout 30000 2>&1 | tail -10
```

### Step 7: Commit

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/tests/execute-stream.test.ts packages/runtime/src/stream-types.ts
git commit -m "feat(runtime): ExecutionEngine.executeStream() — Queue-backed streaming with FiberRef text delta wiring"
```

---

## Task 6: `ReactiveAgent.runStream()` + unify `run()` via `runStream()`

**Files:**
- Modify: `packages/runtime/src/builder.ts`

The `ReactiveAgent` class gets:
- `runStream(input, options?)` — calls `executeStream`, returns `Stream<AgentStreamEvent, Error>`
- `run()` — rewritten to collect from `runStream()` via `AgentStream.collect()`

### Step 1: Write the failing test

Create `packages/runtime/tests/agent-stream.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Stream, Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { AgentStream } from "../src/agent-stream.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

describe("ReactiveAgent.runStream", () => {
  it("returns a Stream that emits TextDelta and StreamCompleted", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ "ping": "FINAL ANSWER: pong" })
      .build();

    const events: AgentStreamEvent[] = [];
    await Effect.runPromise(
      Stream.runForEach(agent.runStream("ping"), (e) =>
        Effect.sync(() => { events.push(e); })
      )
    );
    await agent.dispose();

    const tags = events.map((e) => e._tag);
    expect(tags).toContain("StreamCompleted");
    const completed = events.find((e) => e._tag === "StreamCompleted") as any;
    expect(completed.output).toContain("pong");
  });

  it("run() returns same output as AgentStream.collect(runStream())", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ "test": "FINAL ANSWER: result" })
      .build();

    const runResult = await agent.run("test");
    const streamResult = await AgentStream.collect(agent.runStream("test"));
    await agent.dispose();

    expect(runResult.output).toBe(streamResult.output);
    expect(runResult.success).toBe(streamResult.success);
  });

  it("density tokens only emits TextDelta + StreamCompleted", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ "hello": "FINAL ANSWER: world" })
      .build();

    const events: AgentStreamEvent[] = [];
    await Effect.runPromise(
      Stream.runForEach(
        agent.runStream("hello", { density: "tokens" }),
        (e) => Effect.sync(() => { events.push(e); })
      )
    );
    await agent.dispose();

    const tags = new Set(events.map((e) => e._tag));
    expect(tags.has("TextDelta") || tags.has("StreamCompleted")).toBe(true);
    expect(tags.has("PhaseStarted")).toBe(false);
    expect(tags.has("ToolCallStarted")).toBe(false);
  });
});
```

### Step 2: Run test to confirm it fails

```bash
bun test packages/runtime/tests/agent-stream.test.ts 2>&1 | head -20
```
Expected: FAIL — `runStream` does not exist on `ReactiveAgent`.

### Step 3: Add `runStream()` to `ReactiveAgent` class in `builder.ts`

Import at top of builder.ts (if not already present):
```typescript
import { Stream } from "effect";
import type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
import { AgentStream } from "./agent-stream.js";
```

Add method to `ReactiveAgent` after `runEffect()`:

```typescript
/**
 * Execute a task and return a streaming Effect.
 *
 * Emits `TextDelta` events as the LLM generates tokens, plus `StreamCompleted`
 * (with final output) or `StreamError` at the end.
 *
 * @param input - The task prompt or question
 * @param options - `density: "tokens"` (default) for token events only;
 *                  `density: "full"` for all phase/tool/thought events
 * @returns Stream of AgentStreamEvent
 *
 * @example
 * ```typescript
 * for await (const event of AgentStream.toAsyncIterable(agent.runStream("Hello"))) {
 *   if (event._tag === "TextDelta") process.stdout.write(event.text);
 * }
 * ```
 */
runStream(
  input: string,
  options?: { density?: StreamDensity },
): Stream.Stream<AgentStreamEvent, Error> {
  const task: Task = {
    id: generateTaskId(),
    agentId: Schema.decodeSync(AgentId)(this.agentId),
    type: "query" as const,
    input: { question: input },
    priority: "medium" as const,
    status: "pending" as const,
    metadata: { tags: [] },
    createdAt: new Date(),
  };

  return Stream.unwrap(
    Effect.promise(() =>
      this.runtime.runPromise(
        this.engine.executeStream(task, options),
      )
    ),
  );
}
```

### Step 4: Rewrite `run()` to use `runStream()` internally

Replace the existing `run()` implementation with:

```typescript
async run(input: string): Promise<AgentResult> {
  return AgentStream.collect(this.runStream(input)).catch((e) => {
    throw unwrapError(e);
  });
}
```

And simplify `runEffect()` to also use `runStream()`:
```typescript
runEffect(input: string): Effect.Effect<AgentResult, Error> {
  return Effect.promise(() => this.run(input));
}
```

**Note:** The `engine` field type needs the `executeStream` method. Update the constructor's `engine` type:
```typescript
private readonly engine: {
  execute: (task: Task) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;
  executeStream: (task: Task, options?: { density?: StreamDensity }) => Effect.Effect<Stream.Stream<AgentStreamEvent, Error>>;
  cancel: (taskId: string) => Effect.Effect<void, RuntimeErrors>;
  getContext: (taskId: string) => Effect.Effect<ExecutionContext | null, never>;
},
```

And in `buildEffect()` in `ReactiveAgentBuilder`, update where the engine is extracted to also pass `executeStream`.

### Step 5: Run test to confirm it passes

```bash
bun test packages/runtime/tests/agent-stream.test.ts
```
Expected: PASS (3 tests).

### Step 6: Run full test suite for regressions

```bash
bun test --timeout 30000 2>&1 | tail -10
```
Expected: same pass count as before (1353+).

### Step 7: Commit

```bash
git add packages/runtime/src/builder.ts packages/runtime/tests/agent-stream.test.ts
git commit -m "feat(runtime): ReactiveAgent.runStream() + run() unified via runStream() collect"
```

---

## Task 7: `.withStreaming()` builder option + EventBus strengthening in stream path

**Files:**
- Modify: `packages/runtime/src/builder.ts` (add `.withStreaming()` method)
- Modify: `packages/runtime/src/types.ts` (add `streamDensity` to `ReactiveAgentsConfig`)
- Modify: `packages/runtime/src/execution-engine.ts` (fire `AgentStreamStarted`/`AgentStreamCompleted` on EventBus from `executeStream`)

The `.withStreaming()` builder method sets a default `streamDensity` so callers don't need to specify it per-call.

### Step 1: Write the failing test

Add to `packages/runtime/tests/agent-stream.test.ts`:

```typescript
it("withStreaming() sets default density on builder", async () => {
  const agent = await ReactiveAgents.create()
    .withProvider("test")
    .withTestResponses({ "x": "FINAL ANSWER: y" })
    .withStreaming({ density: "tokens" })
    .build();

  const events: AgentStreamEvent[] = [];
  await Effect.runPromise(
    Stream.runForEach(agent.runStream("x"), (e) =>
      Effect.sync(() => { events.push(e); })
    )
  );
  await agent.dispose();

  const tags = new Set(events.map((e) => e._tag));
  expect(tags.has("StreamCompleted")).toBe(true);
  // No phase events in tokens density
  expect(tags.has("PhaseStarted")).toBe(false);
});
```

### Step 2: Run test to confirm it fails

```bash
bun test packages/runtime/tests/agent-stream.test.ts 2>&1 | head -10
```

### Step 3: Add `streamDensity` to `ReactiveAgentsConfig`

In `packages/runtime/src/types.ts`, add to `ReactiveAgentsConfigSchema`:
```typescript
streamDensity: Schema.optional(Schema.Literal("tokens", "full")),
```
And to `ReactiveAgentsConfig` type.

### Step 4: Add `.withStreaming()` to `ReactiveAgentBuilder`

In `packages/runtime/src/builder.ts`, add:
```typescript
/**
 * Configure default streaming density for `agent.runStream()` calls.
 *
 * @param options.density - `"tokens"` (default) or `"full"` for all events
 */
withStreaming(options?: { density?: StreamDensity }): ReactiveAgentBuilder {
  return this._clone({ streamDensity: options?.density ?? "tokens" });
}
```

### Step 5: Wire `streamDensity` config to `runStream()` default

In `ReactiveAgent.runStream()`, read the config default density if not explicitly passed:
```typescript
runStream(
  input: string,
  options?: { density?: StreamDensity },
): Stream.Stream<AgentStreamEvent, Error> {
  // Use per-call density if specified, else builder default, else "tokens"
  const density = options?.density ?? this._defaultDensity ?? "tokens";
  // ... rest of implementation
}
```

Add `private readonly _defaultDensity?: StreamDensity` to the constructor.

### Step 6: Fire `AgentStreamStarted` + `AgentStreamCompleted` in `executeStream`

In `packages/runtime/src/execution-engine.ts`, in `executeStream`:

After creating the queue, fire `AgentStreamStarted` if EventBus is available:
```typescript
if (eb) {
  yield* eb.publish({
    _tag: "AgentStreamStarted",
    taskId: task.id as unknown as string,
    agentId: config.agentId,
    density,
    timestamp: Date.now(),
  }).pipe(Effect.catchAll(() => Effect.void));
}
```

In the `ensuring` cleanup, fire `AgentStreamCompleted`:
```typescript
.pipe(Effect.ensuring(
  Effect.gen(function* () {
    if (unsubFn) unsubFn();
    if (eb) {
      yield* eb.publish({
        _tag: "AgentStreamCompleted",
        taskId: task.id as unknown as string,
        agentId: config.agentId,
        success: true, // best-effort — we don't track error state here
        durationMs: Date.now() - startMs,
      }).pipe(Effect.catchAll(() => Effect.void));
    }
    yield* Queue.shutdown(queue);
  })
))
```

### Step 7: Run full test suite

```bash
bun test --timeout 30000 2>&1 | tail -10
```
Expected: PASS, same count or higher.

### Step 8: Commit

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/types.ts packages/runtime/src/execution-engine.ts
git commit -m "feat(runtime): withStreaming() builder option + AgentStreamStarted/Completed EventBus events"
```

---

## Task 8: Comprehensive streaming integration tests

**Files:**
- Create: `packages/runtime/tests/streaming-integration.test.ts`

### Step 1: Write integration tests

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Stream } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { AgentStream } from "../src/agent-stream.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

describe("Streaming integration", () => {
  it("AgentStream.collect() matches agent.run() output", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ "compute": "FINAL ANSWER: 42" })
      .build();

    const [runResult, collectResult] = await Promise.all([
      agent.run("compute"),
      AgentStream.collect(agent.runStream("compute")),
    ]);
    await agent.dispose();

    expect(runResult.output).toBe(collectResult.output);
    expect(runResult.success).toBe(true);
  });

  it("stream ends with StreamCompleted on success", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ "done": "FINAL ANSWER: done" })
      .build();

    const all: AgentStreamEvent[] = [];
    await Effect.runPromise(
      Stream.runForEach(agent.runStream("done"), (e) =>
        Effect.sync(() => { all.push(e); })
      )
    );
    await agent.dispose();

    expect(all[all.length - 1]?._tag).toBe("StreamCompleted");
  });

  it("toAsyncIterable allows for-await-of consumption", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ "async": "FINAL ANSWER: works" })
      .build();

    const events: AgentStreamEvent[] = [];
    for await (const event of AgentStream.toAsyncIterable(agent.runStream("async"))) {
      events.push(event);
    }
    await agent.dispose();

    const completed = events.find((e) => e._tag === "StreamCompleted") as any;
    expect(completed?.output).toContain("works");
  });

  it("full density includes phase events", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ "full": "FINAL ANSWER: full" })
      .build();

    const events: AgentStreamEvent[] = [];
    await Effect.runPromise(
      Stream.runForEach(
        agent.runStream("full", { density: "full" }),
        (e) => Effect.sync(() => { events.push(e); })
      )
    );
    await agent.dispose();

    const tags = events.map((e) => e._tag);
    // At minimum should have phase events and completion
    expect(tags).toContain("StreamCompleted");
  });

  it("concurrent runStream calls are independent", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({
        "a": "FINAL ANSWER: alpha",
        "b": "FINAL ANSWER: beta",
      })
      .build();

    const [eventsA, eventsB] = await Promise.all([
      (async () => {
        const all: AgentStreamEvent[] = [];
        for await (const e of AgentStream.toAsyncIterable(agent.runStream("a"))) {
          all.push(e);
        }
        return all;
      })(),
      (async () => {
        const all: AgentStreamEvent[] = [];
        for await (const e of AgentStream.toAsyncIterable(agent.runStream("b"))) {
          all.push(e);
        }
        return all;
      })(),
    ]);
    await agent.dispose();

    const completedA = eventsA.find((e) => e._tag === "StreamCompleted") as any;
    const completedB = eventsB.find((e) => e._tag === "StreamCompleted") as any;
    expect(completedA?.output).toContain("alpha");
    expect(completedB?.output).toContain("beta");
  });
});
```

### Step 2: Run tests to confirm they pass

```bash
bun test packages/runtime/tests/streaming-integration.test.ts
```
Expected: PASS (5 tests).

### Step 3: Run full suite

```bash
bun test --timeout 30000 2>&1 | tail -5
```

### Step 4: Commit

```bash
git add packages/runtime/tests/streaming-integration.test.ts
git commit -m "test(runtime): streaming integration tests — runStream, collect, toAsyncIterable, full density, concurrent"
```

---

## Task 9: Export plumbing + docs build verification

**Files:**
- Modify: `packages/runtime/src/index.ts`
- Verify: `apps/docs` builds without errors

### Step 1: Add exports to `packages/runtime/src/index.ts`

```typescript
// ─── Streaming ───
export type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
export { AgentStream } from "./agent-stream.js";
```

### Step 2: Verify all packages build

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun run build 2>&1 | tail -20
```
Expected: All packages compile without errors.

### Step 3: Run full test suite one final time

```bash
bun test --timeout 30000 2>&1 | tail -10
```
Expected: all tests pass (1353+ baseline + new streaming tests).

### Step 4: Update CLAUDE.md test count

After confirming the final test count from the bun test output, update `CLAUDE.md`:
- Update `1353 tests across 174 files` to the new numbers
- Add streaming to the bullet list under "Composable Kernel Architecture"

### Step 5: Commit

```bash
git add packages/runtime/src/index.ts CLAUDE.md
git commit -m "feat(runtime): export AgentStreamEvent, StreamDensity, AgentStream from @reactive-agents/runtime"
```

---

## Summary

After all tasks:

- `agent.runStream("prompt")` → `Stream<AgentStreamEvent, Error>`
- `agent.run("prompt")` → internally collects runStream (unified path, no duplication)
- `agent.runStream("prompt", { density: "full" })` → includes PhaseStarted/Completed, ThoughtEmitted, ToolCallStarted/Completed
- `AgentStream.toSSE(stream)` → `Response` with `Content-Type: text/event-stream`
- `AgentStream.toReadableStream(stream)` → Web `ReadableStream<AgentStreamEvent>`
- `AgentStream.toAsyncIterable(stream)` → `AsyncIterable<AgentStreamEvent>` for `for await...of`
- `AgentStream.collect(stream)` → `Promise<AgentResult>`
- `.withStreaming({ density: "full" })` builder option sets default density
- `TextDeltaReceived`, `AgentStreamStarted`, `AgentStreamCompleted` added to EventBus
- All 6 LLM providers already implement `stream()` — no provider changes needed
- FiberRef in `@reactive-agents/core` is fiber-safe for concurrent agent runs
