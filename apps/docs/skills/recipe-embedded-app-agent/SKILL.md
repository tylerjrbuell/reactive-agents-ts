---
name: recipe-embedded-app-agent
description: Full recipe for embedding an agent in a Next.js app with streaming API routes, React hooks, progressive disclosure of reasoning steps, and error handling.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "recipe"
---

# Recipe: Embedded App Agent

## What this builds

A complete Next.js application with an agent embedded end-to-end: streaming API route on the server, React streaming hook on the client, progressive display of reasoning steps, and production-safe error handling. Adaptable to Vue and Svelte with equivalent packages.

## Skills loaded by this recipe

- `ui-integration` — AgentStream.toSSE(), useAgentStream, framework hooks
- `reasoning-strategy-selection` — adaptive strategy for interactive use
- `cost-budget-enforcement` — per-session budgets

## File layout

```
app/
  api/
    agent/
      route.ts          ← server: agent build + SSE streaming
  components/
    AgentChat.tsx        ← client: useAgentStream hook + UI
  page.tsx              ← render AgentChat
```

## Server — app/api/agent/route.ts

```ts
import { ReactiveAgents, AgentStream } from "@reactive-agents/runtime";

export const runtime = "nodejs";  // required for streaming

export async function POST(req: Request) {
  const { prompt } = await req.json();

  if (!prompt || typeof prompt !== "string") {
    return new Response(JSON.stringify({ error: "prompt required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const agent = await ReactiveAgents.create()
    .withName("app-agent")
    .withProvider("anthropic")
    .withReasoning({
      defaultStrategy: "adaptive",
      maxIterations: 10,
    })
    .withTools({
      allowedTools: ["web-search", "http-get", "checkpoint", "final-answer"],
    })
    .withCostTracking({ perSession: 0.25 })
    .withObservability({ verbosity: "minimal" })
    .build();

  // Stream events with full density so the client can show tool calls
  return AgentStream.toSSE(
    agent.runStream(prompt, { density: "full" })
  );
}
```

## Client — app/components/AgentChat.tsx

```tsx
"use client";
import { useState } from "react";
import { useAgentStream } from "@reactive-agents/react";

export function AgentChat() {
  const [input, setInput] = useState("");
  const { text, events, status, error, output, run, cancel } = useAgentStream("/api/agent");

  const toolEvents = events.filter(
    (e) => e.type === "ToolCallStart" || e.type === "ToolCallResult"
  );

  return (
    <div className="chat">
      <div className="input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && run(input)}
          placeholder="Ask anything..."
          disabled={status === "streaming"}
        />
        {status === "streaming" ? (
          <button onClick={cancel}>Stop</button>
        ) : (
          <button onClick={() => run(input)} disabled={!input.trim()}>
            Send
          </button>
        )}
      </div>

      {/* Show tool calls as they happen */}
      {toolEvents.length > 0 && (
        <div className="tool-trace">
          {toolEvents.map((e, i) => (
            <div key={i} className="tool-step">
              {e.type === "ToolCallStart" && `⚙ ${e.toolName}...`}
              {e.type === "ToolCallResult" && `✓ ${e.toolName}`}
            </div>
          ))}
        </div>
      )}

      {/* Stream text as it arrives */}
      {text && (
        <div className="response">
          {text}
          {status === "streaming" && <span className="cursor">▋</span>}
        </div>
      )}

      {error && (
        <div className="error">
          {error.message.includes("Budget") ? "Usage limit reached." : "Something went wrong."}
        </div>
      )}
    </div>
  );
}
```

## Vue equivalent

```vue
<!-- components/AgentChat.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { useAgentStream } from "@reactive-agents/vue";

const input = ref("");
const { text, status, error, run, cancel } = useAgentStream("/api/agent");
</script>

<template>
  <div>
    <input v-model="input" @keydown.enter="run(input)" :disabled="status === 'streaming'" />
    <button @click="cancel" v-if="status === 'streaming'">Stop</button>
    <button @click="run(input)" v-else>Send</button>
    <p>{{ text }}</p>
    <p v-if="error" style="color:red">{{ error.message }}</p>
  </div>
</template>
```

## Svelte equivalent

```svelte
<!-- src/routes/chat/+page.svelte -->
<script lang="ts">
  import { createAgentStream } from "@reactive-agents/svelte";
  const agent = createAgentStream("/api/agent");
</script>

<input
  bind:value={$agent.input}
  on:keydown={(e) => e.key === "Enter" && $agent.run($agent.input)}
/>
<button on:click={() => $agent.cancel()} disabled={$agent.status !== "streaming"}>Stop</button>
<p>{$agent.text}</p>
```

## One-shot (non-streaming) variant

When streaming isn't needed (e.g., background processing):

```ts
// Server — returns JSON instead of SSE
export async function POST(req: Request) {
  const { prompt } = await req.json();
  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withTools()
    .build();
  const result = await agent.run(prompt);
  return Response.json({ output: result.output, cost: result.cost });
}

// Client
import { useAgent } from "@reactive-agents/react";
const { output, loading, error, run } = useAgent("/api/agent");
```

## Pitfalls

- `export const runtime = "nodejs"` is required in Next.js App Router — edge runtime does not support all Node.js APIs used by the agent
- Build the agent inside `POST()`, not at module level — module-level agents share state across concurrent requests
- `density: "full"` sends tool call events — the client must filter for `TextDelta` if only displaying text
- `useAgentStream` manages AbortController internally — `cancel()` sends an abort signal to the server
- The server-side agent must be disposed after the stream ends — `AgentStream.toSSE()` calls `agent.dispose()` automatically on stream completion
- Never put API keys in client-side code — the agent must always be built server-side
