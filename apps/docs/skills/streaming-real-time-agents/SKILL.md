---
name: streaming-real-time-agents
description: Build agents that stream tokens and lifecycle events to users in real-time via runStream(), AgentStream adapters, and density modes.
compatibility: Reactive Agents projects using agent.runStream(), AgentStream, .withStreaming().
metadata:
  author: reactive-agents
  version: "1.1"
---

# Streaming Real-Time Agents

Use this skill when building agents that stream output to users in real-time.

## Agent objective

When implementing streaming agents, generate code that:

- Uses `agent.runStream()` with an explicit density mode (`"tokens"` or `"full"`).
- Chooses the correct `AgentStream` adapter for the target environment (SSE for HTTP, AsyncIterable for CLI, collect for batch).
- Handles all terminal events (`StreamCompleted`, `StreamError`) to prevent silent failures.

## What this skill does

- Enables token-by-token LLM output via `runStream()` and `FiberRef`-based `StreamingTextCallback` propagation.
- Converts the Effect stream to SSE responses, ReadableStreams, or AsyncIterables via `AgentStream` adapters.
- Preserves fiber isolation so concurrent `runStream()` calls never leak tokens across streams.

## Workflow

1. Configure the agent with `.withStreaming()` and optionally set a default density.
2. Call `agent.runStream(input)` or `agent.runStream(input, { density: "full" })`.
3. Consume events via `for await...of` — switch on `_tag` to handle each variant.
4. For HTTP endpoints, use `AgentStream.toSSE(stream)` to return a standard `Response`.
5. Call `agent.dispose()` after the stream completes to release resources.

## Expected implementation output

- A streaming agent configuration with `.withStreaming()` and `.withReasoning()` enabled.
- An event consumption loop that handles `TextDelta`, `StreamCompleted`, and `StreamError`.
- Proper resource cleanup via `dispose()` or `await using`.

## Code Examples

### Basic Token Streaming

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("streamer")
  .withProvider("anthropic")
  .withReasoning()
  .withStreaming({ density: "tokens" })
  .build();

for await (const event of agent.runStream("Explain quantum computing")) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "StreamCompleted") console.log("\n\nDone!");
  if (event._tag === "StreamError") console.error("\nError:", event.cause);
}

await agent.dispose();
```

### SSE HTTP Endpoint

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
    const url = new URL(req.url);
    if (url.pathname === "/stream") {
      const prompt = url.searchParams.get("q") ?? "Hello";
      // Collect into a ReadableStream and pipe as SSE
      const events = agent.runStream(prompt, { density: "tokens" });
      return AgentStream.toSSE(await AgentStream.toReadableStream(events));
    }
    return new Response("Not found", { status: 404 });
  },
});
```

### Full Density with Phase Tracking

```typescript
for await (const event of agent.runStream("Research and summarize", { density: "full" })) {
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
      console.log(`  thought #${event.iteration}: ${event.content.slice(0, 80)}`);
      break;
    case "ToolCallStarted":
      console.log(`  tool: ${event.toolName}`);
      break;
    case "ToolCallCompleted":
      console.log(`  tool: ${event.toolName} ${event.success ? "ok" : "FAIL"} ${event.durationMs}ms`);
      break;
    case "IterationProgress":
      // Emitted after each reasoning iteration (density: "full" only)
      console.log(`  iteration ${event.iteration}/${event.maxIterations} — ${event.status}`);
      break;
    case "StreamCompleted":
      console.log(`\nDone — ${event.output.length} chars`);
      if (event.toolSummary) {
        console.log(`Tools called: ${event.toolSummary.map(t => t.name).join(", ")}`);
      }
      break;
    case "StreamCancelled":
      console.log(`\nCancelled after ${event.iterationsCompleted} iterations`);
      break;
    case "StreamError":
      console.error(`\nError: ${event.cause}`);
      break;
  }
}
```

### Cancellation via AbortSignal

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // Cancel after 5s

for await (const event of agent.runStream("Long task", { signal: controller.signal })) {
  if (event._tag === "TextDelta") process.stdout.write(event.text);
  if (event._tag === "StreamCancelled") console.log("\nStream cancelled.");
  if (event._tag === "StreamCompleted") console.log("\nDone.");
}
```

## Pitfalls to avoid

- Forgetting `.withReasoning()` — without it, `TextDelta` events won't be emitted because the `StreamingTextCallback` FiberRef is set in the react-kernel's LLM streaming path.
- Ignoring `StreamError` events — always handle errors or they'll be silently dropped.
- Not calling `dispose()` after streaming — the ManagedRuntime and any MCP subprocesses will keep the process alive.
