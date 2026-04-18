---
title: Web Framework Integration
description: React hooks, Vue composables, and Svelte stores for streaming agent output in browser applications.
sidebar:
  order: 9
---

Reactive Agents includes first-class support for streaming agent output into React, Vue, and Svelte applications. The pattern is consistent across frameworks:

1. **Server** — A route handler calls `AgentStream.toSSE()` and returns a standard `Response`
2. **Client** — A hook/composable/store consumes the SSE stream and exposes reactive state

## Server Setup

The server-side is identical regardless of which client framework you use. `AgentStream.toSSE()` returns a standard Web API `Response`, making it compatible with any framework that accepts one.

### Next.js App Router

```typescript
// app/api/agent/route.ts
import { ReactiveAgents, AgentStream } from "reactive-agents";

export async function POST(req: Request) {
  const { prompt } = await req.json();

  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withReasoning()
    .withTools()
    .build();

  return AgentStream.toSSE(agent.runStream(prompt));
}
```

### SvelteKit

```typescript
// src/routes/api/agent/+server.ts
import { ReactiveAgents, AgentStream } from "reactive-agents";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  const { prompt } = await request.json();

  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withTools()
    .build();

  return AgentStream.toSSE(agent.runStream(prompt));
};
```

### Nuxt / H3

```typescript
// server/api/agent.post.ts
import { ReactiveAgents, AgentStream } from "reactive-agents";

export default defineEventHandler(async (event) => {
  const { prompt } = await readBody(event);

  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withTools()
    .build();

  // Return the Web API Response directly — h3 handles it
  return AgentStream.toSSE(agent.runStream(prompt));
});
```

### Bun.serve / Hono / Fastify

```typescript
// Bun.serve
Bun.serve({
  port: 3000,
  async fetch(req) {
    if (req.method === "POST" && new URL(req.url).pathname === "/agent") {
      const { prompt } = await req.json();
      const agent = await ReactiveAgents.create().withProvider("anthropic").withTools().build();
      return AgentStream.toSSE(agent.runStream(prompt));
    }
    return new Response("Not found", { status: 404 });
  },
});
```

## React

Install the package:

```bash
bun add @reactive-agents/react
```

### `useAgentStream` — Token-by-token streaming

```tsx
import { useAgentStream } from "@reactive-agents/react";

function Chat() {
  const { text, status, error, run, cancel } = useAgentStream("/api/agent");

  return (
    <div>
      <button
        onClick={() => run("Research the latest AI agent frameworks")}
        disabled={status === "streaming"}
      >
        {status === "streaming" ? "Thinking..." : "Ask"}
      </button>

      {status === "streaming" && (
        <button onClick={cancel}>Stop</button>
      )}

      <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>

      {status === "error" && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
```

**`useAgentStream` return values:**

| Property  | Type                                           | Description                                          |
| --------- | ---------------------------------------------- | ---------------------------------------------------- |
| `text`    | `string`                                       | Accumulated output (grows as tokens arrive)           |
| `status`  | `"idle" \| "streaming" \| "completed" \| "error"` | Current execution state                           |
| `output`  | `string \| null`                               | Full output when `status === "completed"`             |
| `events`  | `AgentStreamEvent[]`                           | All raw events received since last `run()`           |
| `error`   | `string \| null`                               | Error message when `status === "error"`              |
| `run`     | `(prompt: string, body?) => void`              | Start a stream; cancels any active stream            |
| `cancel`  | `() => void`                                   | Cancel the active stream                             |

### `useAgent` — One-shot (no streaming)

```tsx
import { useAgent } from "@reactive-agents/react";

function Summary({ text }: { text: string }) {
  const { output, loading, error, run } = useAgent("/api/agent");

  return (
    <div>
      <button onClick={() => run(`Summarize: ${text}`)} disabled={loading}>
        {loading ? "Summarizing..." : "Summarize"}
      </button>
      {output && <p>{output}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
```

### With custom headers or auth

```tsx
const { text, run } = useAgentStream("/api/agent", {
  headers: {
    Authorization: `Bearer ${token}`,
    "X-Session-Id": sessionId,
  },
});
```

### Iteration progress bar

```tsx
import { useAgentStream } from "@reactive-agents/react";

function AgentWithProgress() {
  const { text, events, status, run } = useAgentStream("/api/agent");

  const progress = events.findLast((e) => e._tag === "IterationProgress") as
    | { iteration: number; maxIterations: number }
    | undefined;

  return (
    <div>
      <button onClick={() => run("Research TypeScript 5.x features")}>Run</button>

      {progress && (
        <progress value={progress.iteration} max={progress.maxIterations} />
      )}

      <pre>{text}</pre>
    </div>
  );
}
```

## Vue 3

Install the package:

```bash
bun add @reactive-agents/vue
```

### `useAgentStream`

```vue
<script setup lang="ts">
import { useAgentStream } from "@reactive-agents/vue";

const { text, status, error, run, cancel } = useAgentStream("/api/agent");
</script>

<template>
  <div>
    <button
      @click="run('Research the latest AI agent frameworks')"
      :disabled="status === 'streaming'"
    >
      {{ status === 'streaming' ? 'Thinking...' : 'Ask' }}
    </button>

    <button v-if="status === 'streaming'" @click="cancel">Stop</button>

    <p style="white-space: pre-wrap">{{ text }}</p>

    <p v-if="status === 'error'" style="color: red">{{ error }}</p>
  </div>
</template>
```

All return values are Vue `readonly` refs — use them directly in templates or `watch` them:

```typescript
const { text, status, output } = useAgentStream("/api/agent");

watch(status, (s) => {
  if (s === "completed") console.log("Done:", output.value);
});
```

### `useAgent` — One-shot

```vue
<script setup lang="ts">
import { useAgent } from "@reactive-agents/vue";

const { output, loading, error, run } = useAgent("/api/agent");
</script>

<template>
  <button @click="run('Summarize this article')" :disabled="loading">
    {{ loading ? "Working..." : "Summarize" }}
  </button>
  <p v-if="output">{{ output }}</p>
</template>
```

## Svelte

Install the package:

```bash
bun add @reactive-agents/svelte
```

### `createAgentStream`

Returns a Svelte writable store — subscribe with `$` prefix in templates:

```svelte
<script lang="ts">
  import { createAgentStream } from "@reactive-agents/svelte";

  const agent = createAgentStream("/api/agent");
</script>

<button
  on:click={() => agent.run("Research the latest AI agent frameworks")}
  disabled={$agent.status === "streaming"}
>
  {$agent.status === "streaming" ? "Thinking..." : "Ask"}
</button>

{#if $agent.status === "streaming"}
  <button on:click={agent.cancel}>Stop</button>
{/if}

<p style="white-space: pre-wrap">{$agent.text}</p>

{#if $agent.status === "error"}
  <p style="color: red">{$agent.error}</p>
{/if}
```

**Store state shape:**

```typescript
interface AgentStreamState {
  text: string;        // Accumulated output
  status: "idle" | "streaming" | "completed" | "error";
  output: string | null;
  error: string | null;
  events: AgentStreamEvent[];
}
```

### `createAgent` — One-shot

```svelte
<script lang="ts">
  import { createAgent } from "@reactive-agents/svelte";

  const agent = createAgent("/api/agent");
</script>

<button
  on:click={() => agent.run("Summarize this article")}
  disabled={$agent.loading}
>
  {$agent.loading ? "Working..." : "Summarize"}
</button>

{#if $agent.output}
  <p>{$agent.output}</p>
{/if}
```

## Passing Extra Body Parameters

All hooks/stores accept an optional `body` object merged into the request body:

```typescript
// React
run("Summarize this", { sessionId: "abc", temperature: 0.3 });

// Vue
run("Summarize this", { sessionId: "abc" });

// Svelte
agent.run("Summarize this", { sessionId: "abc" });
```

Update your server endpoint to read these:

```typescript
// app/api/agent/route.ts
export async function POST(req: Request) {
  const { prompt, sessionId, temperature } = await req.json();

  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withModel({ model: "claude-sonnet-4-20250514", temperature: temperature ?? 0.7 })
    .build();

  return AgentStream.toSSE(agent.runStream(prompt));
}
```

## TypeScript — Event Types

All three packages export `AgentStreamEvent` for typed event handling:

```typescript
import type { AgentStreamEvent } from "@reactive-agents/react"; // or vue / svelte

function handleEvent(event: AgentStreamEvent) {
  if (event._tag === "TextDelta") console.log(event.text);
  if (event._tag === "IterationProgress") console.log(event.iteration, event.maxIterations);
  if (event._tag === "StreamCompleted") console.log(event.output, event.metadata);
  if (event._tag === "StreamError") console.error(event.cause);
}
```
