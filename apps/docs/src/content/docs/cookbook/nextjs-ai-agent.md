---
title: Add an AI Agent to a Next.js App
description: >-
  Build a streaming AI agent in a Next.js (App Router) TypeScript app. A Route
  Handler runs the agent server-side and streams tokens to a React component
  over Server-Sent Events.
sidebar:
  order: 32
badge:
  text: New in v0.12
  variant: success
  __auto: '1'
lastCommit:
  subject: >-
    docs(badges): unified badge system — sync-page-metadata replaces
    new-page-indicator
  hash: 857138c
  date: '2026-07-01'
since: v0.12
---

This tutorial shows how to add a streaming **AI agent to a Next.js app** using TypeScript and the App Router. You'll build the agent on the server, expose it through a Route Handler, and render tokens as they arrive in a client component — the same pattern you'd reach for to **stream an AI agent in Next.js** without writing any SSE plumbing by hand.

The shape of a **Next.js AI agent** with Reactive Agents is two pieces:

1. **Server** — a Route Handler builds the agent and returns `AgentStream.toSSE(agent.runStream(prompt))`, a standard Web API `Response` carrying a Server-Sent Events (SSE) body.
2. **Client** — a `'use client'` component calls the `useAgentStream` hook, which consumes that SSE stream and exposes reactive `text`, `status`, and `error` state.

SSE is the bridge: the server agent reasons and calls tools, and each token streams to the browser as it's produced.

## Prerequisites

- A Next.js 13+ project using the **App Router** (`app/` directory)
- Node.js 18+
- An API key for a model provider (this guide uses Anthropic)

## Step 1 — Install

```bash
bun add reactive-agents @reactive-agents/react
```

Using npm, pnpm, or yarn instead:

```bash
npm install reactive-agents @reactive-agents/react
```

`reactive-agents` is the framework you run on the server. `@reactive-agents/react` provides the client hooks.

## Step 2 — The server Route Handler

Create a Route Handler at `app/api/agent/route.ts`. It builds an agent and returns the SSE `Response` directly — Next.js streams it to the browser.

```typescript
// app/api/agent/route.ts
import { ReactiveAgents, AgentStream } from "reactive-agents";

// The agent framework uses Node.js APIs — run this route on the Node runtime,
// not the Edge runtime. (Node is the App Router default; this makes it explicit.)
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { prompt } = await req.json();

  const agent = await ReactiveAgents.create()
    .withProvider("anthropic")
    .withModel("claude-sonnet-4-6")
    .withReasoning()
    .withTools()
    .build();

  // toSSE() returns a standard Web API Response with a Server-Sent Events body.
  return AgentStream.toSSE(agent.runStream(prompt));
}
```

What each call does:

- `.withProvider("anthropic")` — picks the model provider. Swap in `"openai"`, `"google"`, `"ollama"`, etc.
- `.withModel("claude-sonnet-4-6")` — selects the model.
- `.withReasoning()` — enables the reasoning loop so the agent can plan across multiple steps.
- `.withTools()` — enables the built-in tools (file, fetch, shell, and friends) so the agent can take actions, not just talk.
- `agent.runStream(prompt)` — runs the agent and yields a stream of events (`TextDelta`, `IterationProgress`, `StreamCompleted`, …).
- `AgentStream.toSSE(...)` — adapts that stream into an SSE `Response`. No manual `ReadableStream` wiring needed.

:::caution[Use the Node.js runtime]
The framework depends on Node.js APIs, so this Route Handler must run on the **Node.js runtime** (the App Router default). Don't set `export const runtime = "edge"` — the Edge runtime is not supported here.
:::

## Step 3 — The client component

Create a client component that calls `useAgentStream("/api/agent")` and renders the streaming text. The `'use client'` directive is required because the hook uses React state and `fetch`.

```tsx
// app/agent-chat.tsx
"use client";

import { useState } from "react";
import { useAgentStream } from "@reactive-agents/react";

export function AgentChat() {
  const [prompt, setPrompt] = useState("");
  const { text, status, error, run, cancel } = useAgentStream("/api/agent");

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(prompt);
        }}
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask the agent anything..."
        />
        <button type="submit" disabled={status === "streaming"}>
          {status === "streaming" ? "Thinking..." : "Ask"}
        </button>
        {status === "streaming" && (
          <button type="button" onClick={cancel}>
            Stop
          </button>
        )}
      </form>

      {/* Tokens accumulate in `text` as they stream from the server */}
      <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>

      {status === "error" && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
```

Drop it into a page:

```tsx
// app/page.tsx
import { AgentChat } from "./agent-chat";

export default function Home() {
  return <AgentChat />;
}
```

That's the full loop. Click **Ask** and the agent's reasoning streams into the page token by token.

### What `useAgentStream` returns

`useAgentStream(endpoint, requestInit?)` returns:

| Property  | Type                                                | Description                                            |
| --------- | --------------------------------------------------- | ----------------------------------------------------- |
| `text`    | `string`                                            | Accumulated output, growing as tokens arrive          |
| `status`  | `"idle" \| "streaming" \| "completed" \| "error"`   | Current execution state                               |
| `output`  | `string \| null`                                    | Full output once `status === "completed"`             |
| `events`  | `AgentStreamEvent[]`                                | All raw events received since the last `run()`        |
| `error`   | `string \| null`                                    | Error message when `status === "error"`               |
| `run`     | `(prompt: string, body?) => void`                   | Start a stream; cancels any active one                |
| `cancel`  | `() => void`                                         | Cancel the active stream                              |

Pass extra fields to the server via the second `run` argument — they're merged into the request body:

```tsx
run("Summarize this thread", { sessionId, temperature: 0.3 });
```

Then read them in the Route Handler: `const { prompt, sessionId, temperature } = await req.json();`.

Need a one-shot call instead of streaming? Use `useAgent("/api/agent")`, which returns `{ output, loading, error, run }` and resolves on completion. It expects the endpoint to return JSON (`{ output: "..." }`) rather than an SSE stream.

## Step 4 — Production notes

- **Keep API keys on the server.** The Route Handler runs server-side, so your provider key (e.g. `ANTHROPIC_API_KEY`) stays in server-only environment variables. Never expose it to the client or prefix it with `NEXT_PUBLIC_`.
- **Pin the Node runtime.** As noted above, set `export const runtime = "nodejs"` on the agent route.
- **Cancellation.** `useAgentStream` aborts the in-flight `fetch` when you call `cancel()` or start a new `run()`, so abandoned requests don't keep streaming.

## Stability note

`@reactive-agents/react` is currently **experimental**. The hooks work, but the SSE event contract between the server adapter and the client hooks may change in a future minor release. Pin your versions and check the changelog before upgrading if you depend on the raw `events` shape. The server-side `AgentStream.toSSE` adapter and the core framework are stable.

## Next steps

- [Web Framework Integration](/guides/web-integration/) — the same pattern for Vue and Svelte, plus iteration-progress bars and typed events.
- [Quickstart](/guides/quickstart/) — build and run your first agent from scratch.
