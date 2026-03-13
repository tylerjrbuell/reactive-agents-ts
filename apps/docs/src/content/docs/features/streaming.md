---
title: Streaming
description: Token-by-token output streaming with two density modes, fiber-isolated concurrent streams, and adapters for SSE, ReadableStream, and AsyncIterable.
sidebar:
  order: 8
---

Agent streaming delivers LLM tokens to your UI the moment they're generated — no waiting for the full response. The `runStream()` API emits a discriminated union of events that you consume with a standard `for await...of` loop, and two **density modes** let you choose between minimal overhead (tokens only) and full lifecycle visibility (phases, tools, thoughts). Concurrent streams are fiber-isolated via Effect-TS `FiberRef`, so multiple callers never see each other's tokens.

## Quick Start

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("streamer")
  .withProvider("anthropic")
  .withReasoning()
  .withStreaming({ density: "tokens" })
  .build();

for await (const event of agent.runStream("Write a haiku about Effect-TS")) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "StreamCompleted") console.log("\nDone!");
}

await agent.dispose();
```

`.withStreaming()` sets the default density. `runStream()` returns an `AsyncGenerator<AgentStreamEvent>` — each iteration yields the next event.

## Stream Events

Every event carries a `_tag` discriminant. Narrow with `switch` or `if` — TypeScript infers the payload automatically.

```typescript
type AgentStreamEvent =
  | { _tag: "TextDelta"; text: string }
  | { _tag: "StreamCompleted"; output: string; metadata: AgentResultMetadata; taskId?: string; agentId?: string; toolSummary?: ToolSummaryEntry[] }
  | { _tag: "StreamError"; cause: string }
  | { _tag: "StreamCancelled"; reason: string }
  | { _tag: "IterationProgress"; iteration: number; maxIterations: number; tokensUsed: number }
  | { _tag: "PhaseStarted"; phase: string; timestamp: number }
  | { _tag: "PhaseCompleted"; phase: string; durationMs: number }
  | { _tag: "ThoughtEmitted"; content: string; iteration: number }
  | { _tag: "ToolCallStarted"; toolName: string; callId: string }
  | { _tag: "ToolCallCompleted"; toolName: string; callId: string; durationMs: number; success: boolean };

interface ToolSummaryEntry {
  toolName: string;
  calls: number;
  successRate: number;  // 0.0–1.0
}
```

### Always Emitted

These events are emitted regardless of density mode:

| Event | Shape | Description |
|-------|-------|-------------|
| `TextDelta` | `{ text: string }` | A text token from the LLM. High-frequency during inference. |
| `StreamCompleted` | `{ output, metadata, taskId?, agentId?, toolSummary? }` | Execution succeeded. Always the last event on a successful stream. `toolSummary` contains per-tool call counts and success rates. |
| `StreamError` | `{ cause: string }` | Execution failed. Always the last event on a failed stream. |
| `StreamCancelled` | `{ reason: string }` | Stream was aborted via `AbortSignal`. Always the last event on a cancelled stream. |
| `IterationProgress` | `{ iteration, maxIterations, tokensUsed }` | Emitted at the start of each reasoning iteration. Useful for progress bars and loop monitoring. |

### Full Density Only

These five events are only emitted when density is `"full"`:

| Event | Shape | Description |
|-------|-------|-------------|
| `PhaseStarted` | `{ phase, timestamp }` | A lifecycle phase (bootstrap, think, act, etc.) started. |
| `PhaseCompleted` | `{ phase, durationMs }` | A lifecycle phase completed with its duration. |
| `ThoughtEmitted` | `{ content, iteration }` | The LLM produced a reasoning thought during a think phase. |
| `ToolCallStarted` | `{ toolName, callId }` | A tool call began execution. |
| `ToolCallCompleted` | `{ toolName, callId, durationMs, success }` | A tool call finished with its duration and success status. |

## Density Modes

| Mode | Events Emitted | Use Case |
|------|---------------|----------|
| `"tokens"` | TextDelta, StreamCompleted, StreamError, StreamCancelled, IterationProgress | Chat UIs — tokens and progress with minimal overhead |
| `"full"` | All event types | Dev tools, dashboards — full lifecycle visibility |

**Precedence:** per-call `options.density` > builder `.withStreaming({ density })` > config default > `"tokens"`.

```typescript
// Override density per call
for await (const event of agent.runStream("Analyze this data", { density: "full" })) {
  switch (event._tag) {
    case "TextDelta":
      process.stdout.write(event.text);
      break;
    case "PhaseStarted":
      console.log(`\n[${event.phase}] started`);
      break;
    case "PhaseCompleted":
      console.log(`[${event.phase}] ${event.durationMs}ms`);
      break;
    case "ThoughtEmitted":
      console.log(`  thought #${event.iteration}: ${event.content.slice(0, 80)}...`);
      break;
    case "ToolCallStarted":
      console.log(`  tool: ${event.toolName} (${event.callId})`);
      break;
    case "ToolCallCompleted":
      console.log(`  tool: ${event.toolName} ${event.success ? "ok" : "FAIL"} ${event.durationMs}ms`);
      break;
    case "StreamCompleted":
      console.log(`\nDone — ${event.output.length} chars`);
      break;
    case "StreamError":
      console.error(`\nError: ${event.cause}`);
      break;
  }
}
```

## Cancellation with AbortSignal

Pass a standard `AbortSignal` to cancel a running stream. When the signal fires, the execution fiber is interrupted and a `StreamCancelled` event is emitted as the final event.

```typescript
const controller = new AbortController();

// Cancel after 10 seconds
setTimeout(() => controller.abort(), 10_000);

for await (const event of agent.runStream("Write a long essay", { signal: controller.signal })) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "StreamCancelled") {
    console.log("\nCancelled:", event.reason);
    break;
  }
  if (event._tag === "StreamCompleted") console.log("\nDone!");
}
```

**HTTP request abort (Next.js / Hono example):**

```typescript
// Next.js App Router route handler
export async function POST(req: Request) {
  const body = await req.json();

  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const event of agent.runStream(body.prompt, { signal: req.signal })) {
          if (event._tag === "TextDelta")
            controller.enqueue(new TextEncoder().encode(event.text));
          if (event._tag === "StreamCompleted" || event._tag === "StreamCancelled")
            controller.close();
        }
      },
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
```

When the HTTP client closes the connection, `req.signal` fires automatically and the agent stops generating, saving tokens.

## AgentStream Adapters

The raw `runStream()` returns an `AsyncGenerator`. For HTTP servers and other environments, `AgentStream` provides four adapters that convert the underlying Effect stream.

### SSE

`AgentStream.toSSE(stream)` returns a standard `Response` with `Content-Type: text/event-stream`. Each event is JSON-encoded on a `data:` line. The forked fiber is interrupted when the HTTP client disconnects.

```typescript
import { ReactiveAgents, AgentStream } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withStreaming()
  .build();

Bun.serve({
  port: 3000,
  async fetch(req) {
    if (new URL(req.url).pathname === "/stream") {
      const stream = await agent.runtime.runPromise(
        agent.engine.executeStream(task, { density: "tokens" }),
      );
      return AgentStream.toSSE(stream);
    }
    return new Response("Not found", { status: 404 });
  },
});
```

Client-side:

```typescript
const source = new EventSource("/stream");
source.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event._tag === "TextDelta") appendToUI(event.text);
  if (event._tag === "StreamCompleted") source.close();
};
```

### ReadableStream

`AgentStream.toReadableStream(stream)` returns a `ReadableStream<AgentStreamEvent>` compatible with the Web Streams API.

```typescript
const readable = AgentStream.toReadableStream(effectStream);
const reader = readable.getReader();

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  if (value._tag === "TextDelta") process.stdout.write(value.text);
}
```

### AsyncIterable

`AgentStream.toAsyncIterable(stream)` converts the Effect stream into a standard `AsyncIterable<AgentStreamEvent>` for `for await...of` consumption. Works in Node 18+, Bun, and browsers.

```typescript
for await (const event of AgentStream.toAsyncIterable(effectStream)) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
}
```

### Collect

`AgentStream.collect(stream)` accumulates the entire stream into a single `AgentResult` — equivalent to calling `agent.run()`. Useful when you need to pass a stream to both a UI and a final-result handler.

```typescript
const result = await AgentStream.collect(effectStream);
console.log(result.output);   // Full response text
console.log(result.success);  // true
console.log(result.metadata); // { stepsCount, tokensUsed, ... }
```

## How It Works

```
                        agent.runStream("prompt")
                                 │
                    ┌────────────▼────────────────┐
                    │   ExecutionEngine            │
                    │                              │
                    │   Queue.unbounded()          │
                    │       ▲            │         │
                    │       │            ▼         │
                    │   TextDelta   Stream.unfold  │──▶ AsyncGenerator
                    │       ▲            │         │
                    │       │            ▼         │
                    │   FiberRef    StreamCompleted │
                    │   callback    / StreamError   │
                    │       ▲                      │
                    │       │                      │
                    │   Effect.locally(            │
                    │     execute(task),            │
                    │     StreamingTextCallback,    │
                    │     (text) => Queue.offer()   │
                    │   ).pipe(Effect.forkDaemon)   │
                    └──────────────────────────────┘
```

1. **Queue** — An unbounded `Queue<AgentStreamEvent>` acts as the bridge between the execution fiber and the consumer.
2. **FiberRef** — `StreamingTextCallback` is a `FiberRef` that the react-kernel reads during LLM streaming. When the LLM emits a text token, the callback pushes a `TextDelta` event onto the queue.
3. **Effect.locally** — Sets the `StreamingTextCallback` FiberRef for the execution scope only. This is what makes concurrent streams fiber-isolated — each `runStream()` call gets its own callback bound to its own queue.
4. **forkDaemon** — Execution runs in a forked daemon fiber so the stream can yield events as they arrive rather than waiting for execution to complete.
5. **Stream.unfoldEffect** — Reads events from the queue one at a time, yielding each to the consumer. Stops after receiving a terminal event (`StreamCompleted` or `StreamError`).

## Configuration Reference

### StreamDensity

| Value | Events | Overhead |
|-------|--------|----------|
| `"tokens"` | TextDelta, StreamCompleted, StreamError | Minimal — just text tokens |
| `"full"` | All 8 event types | Higher — includes phase timing, tool tracking, thoughts |

### Builder Methods

| Method | Description |
|--------|-------------|
| `.withStreaming()` | Enable streaming with default `"tokens"` density |
| `.withStreaming({ density: "full" })` | Enable streaming with full event density |
| `agent.runStream(input)` | Stream with builder-configured density |
| `agent.runStream(input, { density: "full" })` | Stream with per-call density override |
| `agent.runStream(input, { signal })` | Stream with AbortSignal cancellation |
| `agent.runStream(input, { density: "full", signal })` | Density override + cancellation combined |

### EventBus Events

When streaming is active, two events are published to the EventBus:

| Event | When |
|-------|------|
| `AgentStreamStarted` | `runStream()` begins execution (includes `density`, `taskId`, `agentId`) |
| `AgentStreamCompleted` | Stream terminates (includes `success`, `durationMs`) |

## Pitfalls

- **Handle `StreamError`** — Always check for `StreamError` events. If you only listen for `TextDelta`, errors will be silently swallowed.
- **`TextDelta` requires reasoning** — `TextDelta` events come from the LLM's streaming output, which flows through the react-kernel. Without `.withReasoning()`, you'll get `StreamCompleted` but no intermediate tokens.
- **Call `dispose()`** — After you're done streaming, call `agent.dispose()` to release the ManagedRuntime and any MCP subprocesses. Or use `await using` for automatic cleanup.
- **Streams are single-use** — Each `runStream()` call creates a new stream. You cannot replay or fork a stream — call `runStream()` again for a new execution.
- **SSE adapter runs in Effect context** — `AgentStream.toSSE()` calls `Effect.runFork` internally. If you need the stream within an existing Effect program, use `executeStream()` directly on the engine instead of the `agent.runStream()` facade.
