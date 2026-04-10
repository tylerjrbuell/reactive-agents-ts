---
name: ui-integration
description: Wire agents into React, Vue, and Svelte frontends with streaming hooks, and set up server-side Next.js App Router or Express API routes using AgentStream.toSSE().
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# UI Integration

## Agent objective

Produce a working server-side API route using `AgentStream.toSSE()` and a client-side component using the appropriate framework hook, connected end-to-end.

## When to load this skill

- Building a chat UI or streaming text interface in React, Vue, or Svelte
- Wiring an agent into a Next.js App Router API route
- Connecting an agent to an Express or Elysia HTTP server
- Needing real-time token-by-token streaming to the browser

## Implementation baseline

### Server — Next.js App Router

```ts
// app/api/agent/route.ts
import { ReactiveAgents, AgentStream } from "@reactive-agents/runtime";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withReasoning({ defaultStrategy: "adaptive", maxIterations: 10 })
    .withTools({ allowedTools: ["web-search", "checkpoint"] })
    .build();
  return AgentStream.toSSE(agent.runStream(prompt));
}
```

### Client — React

```tsx
import { useAgentStream } from "@reactive-agents/react";

function Chat() {
  const { text, status, error, run, cancel } = useAgentStream("/api/agent");
  return (
    <div>
      <button onClick={() => run("Explain quantum entanglement")} disabled={status === "streaming"}>
        Ask
      </button>
      {status === "streaming" && <button onClick={cancel}>Stop</button>}
      <p>{text}</p>
      {error && <p style={{ color: "red" }}>{error.message}</p>}
    </div>
  );
}
```

## Key patterns

### React hooks

```tsx
import { useAgentStream, useAgent } from "@reactive-agents/react";

// Streaming — token-by-token delivery
const {
  text,      // string — accumulated text so far
  events,    // AgentStreamEvent[] — all events received
  status,    // "idle" | "streaming" | "completed" | "error"
  error,     // Error | null
  output,    // string | null — final output (set on completion)
  run,       // (prompt: string) => void — start the agent
  cancel,    // () => void — abort the stream
} = useAgentStream("/api/agent");

// One-shot — waits for full result
const {
  output,    // string | null — final output
  loading,   // boolean
  error,     // Error | null
  run,       // (prompt: string) => Promise<void>
} = useAgent("/api/agent");
```

### Vue composables

```vue
<script setup lang="ts">
import { useAgentStream, useAgent } from "@reactive-agents/vue";

// Same return shape as React hooks
const { text, status, error, run, cancel } = useAgentStream("/api/agent");
const { output, loading, error: err, run: fetch } = useAgent("/api/agent");
</script>

<template>
  <button @click="run('Explain AI')">Ask</button>
  <p>{{ text }}</p>
</template>
```

### Svelte stores

```svelte
<script lang="ts">
  import { createAgentStream, createAgent } from "@reactive-agents/svelte";

  // Returns a Svelte readable store
  const agent = createAgentStream("/api/agent");
  // $agent: AgentStreamState = { text, status, error, run, cancel }

  const oneShot = createAgent("/api/agent");
  // $oneShot: AgentState = { output, loading, error, run }
</script>

<button on:click={() => $agent.run("Explain AI")}>Ask</button>
<p>{$agent.text}</p>
{#if $agent.status === "streaming"}<span>●</span>{/if}
```

### Streaming density

```ts
// Default: "tokens" — TextDelta events only (minimal payload)
return AgentStream.toSSE(agent.runStream(prompt));

// Full: all events including phase changes and tool calls
return AgentStream.toSSE(agent.runStream(prompt, { density: "full" }));
// Use "full" density when the UI shows tool usage or reasoning steps
```

### Express / Elysia server

```ts
import express from "express";
import { ReactiveAgents, AgentStream } from "@reactive-agents/runtime";

const app = express();
app.use(express.json());

app.post("/api/agent", async (req, res) => {
  const { prompt } = req.body;
  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withReasoning({ defaultStrategy: "adaptive" })
    .withTools()
    .build();

  const stream = agent.runStream(prompt);
  for await (const event of stream) {
    if (event.type === "TextDelta") {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (event.type === "StreamCompleted") break;
  }
  res.end();
});
```

### Handling stream events client-side

```ts
const { events } = useAgentStream("/api/agent");

// Event types when density: "full":
// TextDelta       — { type: "TextDelta", content: string }
// ToolCallStart   — { type: "ToolCallStart", toolName: string }
// ToolCallResult  — { type: "ToolCallResult", toolName: string, result: unknown }
// StreamCompleted — { type: "StreamCompleted", output: string }
// StreamError     — { type: "StreamError", error: string }
// StreamCancelled — { type: "StreamCancelled" }
```

## Packages

| Package | Exports |
|---------|---------|
| `@reactive-agents/react` | `useAgent`, `useAgentStream` |
| `@reactive-agents/vue` | `useAgent`, `useAgentStream` |
| `@reactive-agents/svelte` | `createAgent`, `createAgentStream` |
| `@reactive-agents/runtime` | `AgentStream` (server-side SSE adapter) |

## Pitfalls

- The API route must be a server-side route — never build the agent in browser code (API keys would leak)
- `AgentStream.toSSE()` returns a `Response` object compatible with the Web Fetch API — it works in Next.js App Router and edge runtimes directly
- `density: "tokens"` (default) only sends `TextDelta` — use `density: "full"` if the client needs tool call visibility
- `useAgent` (one-shot) makes a POST and waits for JSON `{ output: string }` — the server route must return JSON, not SSE
- Always build the agent inside the request handler (not at module level) — module-level agents persist state across requests
- `cancel()` sends an AbortSignal to the server — the server route must pass the `AbortSignal` to `agent.runStream()` for it to take effect
