# @reactive-agents/react

> React hooks for Reactive Agents — useAgentStream, useAgent

[![npm](https://img.shields.io/npm/v/@reactive-agents/react?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/react)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

> **Stability: experimental.** The SSE event contract may change in a minor release. Pin a version for production use.

React hooks for AI agents — stream agent output token-by-token into your UI, or
fire a one-shot call and await the result. Built for chat UIs, copilots, and any
React app that talks to an LLM agent. These hooks consume a Server-Sent Events
(SSE) endpoint produced by `AgentStream.toSSE()` on the server, so token
streaming "just works" with `fetch` and no extra client deps.

## Install

```bash
bun add @reactive-agents/react
# or: npm install @reactive-agents/react
```

## Usage

Server (Next.js App Router):

```ts
// app/api/agent/route.ts
import { ReactiveAgents, AgentStream } from "reactive-agents";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const agent = await ReactiveAgents.create().withProvider("anthropic").withTools().build();
  return AgentStream.toSSE(agent.runStream(prompt));
}
```

Client — streaming:

```tsx
import { useAgentStream } from "@reactive-agents/react";

function Chat() {
  const { text, status, error, run } = useAgentStream("/api/agent");
  return (
    <div>
      <button onClick={() => run("Explain quantum entanglement")}>Ask</button>
      <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
      {status === "streaming" && <span>●</span>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
```

Client — one-shot:

```tsx
import { useAgent } from "@reactive-agents/react";

function Summary({ text }: { text: string }) {
  const { output, loading, run } = useAgent("/api/agent");
  return (
    <button onClick={() => run(`Summarize: ${text}`)} disabled={loading}>
      {loading ? "Summarizing..." : output ?? "Summarize"}
    </button>
  );
}
```

## API

- `useAgentStream(endpoint, requestInit?)` — streaming hook. Returns
  `{ text, events, status, error, output, run, cancel }`. `run(prompt, body?)`
  starts a stream (cancelling any in-flight one); `text` grows as `TextDelta`
  events arrive; `status` is `"idle" | "streaming" | "completed" | "error"`.
- `useAgent(endpoint, requestInit?)` — one-shot hook. Returns
  `{ output, loading, error, run }`; `run(prompt, body?)` resolves with the
  final output string.
- Types: `AgentStreamEvent`, `AgentHookState`, `UseAgentStreamReturn`,
  `UseAgentReturn`.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [Web Integration guide](https://docs.reactiveagents.dev/guides/web-integration/) and the [full docs](https://docs.reactiveagents.dev).
