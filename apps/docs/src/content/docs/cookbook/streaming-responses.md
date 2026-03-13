---
title: Streaming Responses
description: Stream tokens in real time, show iteration progress, and handle cancellation with agent.runStream().
sidebar:
  order: 5
---

`agent.runStream()` returns an `AsyncGenerator` of typed events. Use it to show tokens as they arrive, display step progress, or build live UIs.

## Basic Streaming

Print tokens as the model generates them:

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("streamer")
  .withProvider("anthropic")
  .build();

for await (const event of agent.runStream("Explain quantum entanglement")) {
  if (event._tag === "TextDelta") {
    process.stdout.write(event.text);
  }
  if (event._tag === "StreamCompleted") {
    console.log("\n\nDone!");
  }
}
```

## All Event Types

```typescript
for await (const event of agent.runStream(prompt)) {
  switch (event._tag) {
    case "TextDelta":
      // A chunk of generated text (token or word depending on density)
      process.stdout.write(event.text);
      break;

    case "IterationProgress":
      // Emitted at the start of each reasoning iteration
      console.log(`\nStep ${event.iteration}/${event.maxIterations}`);
      if (event.toolsCalledThisStep.length > 0) {
        console.log(`  Tools: ${event.toolsCalledThisStep.join(", ")}`);
      }
      break;

    case "StreamCompleted":
      // Final event — includes full output and metrics
      console.log(`\nCompleted in ${event.metadata.duration}ms`);
      console.log(`Steps: ${event.metadata.stepsCount}`);
      if (event.toolSummary?.length) {
        for (const t of event.toolSummary) {
          console.log(`  ${t.name}: ${t.calls} call(s), avg ${t.avgMs}ms`);
        }
      }
      break;

    case "StreamError":
      console.error("Stream failed:", event.cause);
      break;

    case "StreamCancelled":
      console.log("Stream was cancelled.");
      break;
  }
}
```

## Cancellation with AbortController

Use the Web-standard `AbortController` to cancel a running stream:

```typescript
const controller = new AbortController();

// Cancel after 10 seconds
const timeout = setTimeout(() => controller.abort(), 10_000);

try {
  for await (const event of agent.runStream(prompt, { signal: controller.signal })) {
    if (event._tag === "TextDelta") process.stdout.write(event.text);
    if (event._tag === "StreamCancelled") console.log("\nCancelled.");
    if (event._tag === "StreamCompleted") clearTimeout(timeout);
  }
} catch {
  // AbortError when signal fires mid-stream
}
```

## Collecting the Full Output

`AgentStream.collect()` buffers all events and returns the final output string:

```typescript
import { AgentStream } from "reactive-agents";

const output = await AgentStream.collect(agent.runStream(prompt));
console.log(output); // full text after completion
```

## Server-Sent Events (SSE)

Send a stream over HTTP with `AgentStream.toSSE()`:

```typescript
import { AgentStream } from "reactive-agents";
import { Hono } from "hono";

const app = new Hono();

app.get("/stream", async (c) => {
  const { readable, headers } = AgentStream.toSSE(agent.runStream(c.req.query("q") ?? ""));
  return c.body(readable, { headers });
});
```

Clients receive standard SSE events. `TextDelta` events include `data: {"text":"..."}`.

## Web ReadableStream

Convert to `ReadableStream` for use with `Response` in edge runtimes:

```typescript
export async function GET(req: Request) {
  const stream = AgentStream.toReadableStream(
    agent.runStream(new URL(req.url).searchParams.get("q") ?? "")
  );
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

## Controlling Token Density

`streamDensity` controls how many tokens are batched per `TextDelta` event:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withStreaming({ density: "tokens" })  // "tokens" | "words" | "sentences" | "paragraphs"
  .build();
```

Use `"tokens"` for the most responsive UI; `"sentences"` for lower overhead.
