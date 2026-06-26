# @reactive-agents/svelte

> Svelte stores for Reactive Agents — agentStream, agentRun

[![npm](https://img.shields.io/npm/v/@reactive-agents/svelte?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/svelte)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

> **Stability: experimental.** The SSE event contract may change in a minor release. Pin a version for production use.

Svelte stores for LLM agents — stream agent output token-by-token into a
reactive store, fire one-shot calls, or progressively render a structured JSON
object as it streams. Built for chat UIs, copilots, and any Svelte app talking to
an AI agent. These stores consume a Server-Sent Events (SSE) endpoint produced by
`AgentStream.toSSE()` on the server, so token streaming works with plain `fetch`
and no extra client deps.

## Install

```bash
bun add @reactive-agents/svelte
# or: npm install @reactive-agents/svelte
```

## Usage

Server:

```ts
// server route
import { ReactiveAgents, AgentStream } from "reactive-agents";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const agent = await ReactiveAgents.create().withProvider("anthropic").withTools().build();
  return AgentStream.toSSE(agent.runStream(prompt));
}
```

Client — streaming:

```svelte
<script lang="ts">
  import { createAgentStream } from "@reactive-agents/svelte";
  const agent = createAgentStream("/api/agent");
</script>

<button on:click={() => agent.run("Explain quantum computing")}>Ask</button>
<p style="white-space: pre-wrap">{$agent.text}</p>
{#if $agent.status === "streaming"}<span>●</span>{/if}
{#if $agent.error}<p style="color: red">{$agent.error}</p>{/if}
```

Client — structured object:

```svelte
<script lang="ts">
  import { createStructuredStream } from "@reactive-agents/svelte";
  const stream = createStructuredStream("/api/agent/structured");
</script>

<button on:click={() => stream.run("Generate a user profile")}>Run</button>
{#if $stream.object.name}<p>Name: {$stream.object.name}</p>{/if}
{#if $stream.status === "completed"}<pre>{JSON.stringify($stream.object, null, 2)}</pre>{/if}
```

## API

- `createAgentStream(endpoint, requestInit?)` — streaming store. Returns
  `{ subscribe, run, cancel }`; the store value (`AgentStreamState`) holds
  `{ text, events, status, error, output }`. `status` is
  `"idle" | "streaming" | "completed" | "error"`.
- `createAgent(endpoint, requestInit?)` — one-shot store. Returns
  `{ subscribe, run }`; the store value (`AgentState`) holds
  `{ output, loading, error }`. `run(prompt, body?)` resolves with the final
  output string.
- `createStructuredStream(endpoint, requestInit?)` — streams a JSON object,
  surfacing a progressively-filled `object` in the store value
  (`StructuredStreamState`). Returns `{ subscribe, run, cancel }`.
- `parsePartialObject(buf)` — best-effort parse of a streaming JSON prefix into
  a partial object (used internally by `createStructuredStream`).
- Types: `AgentStreamState`, `AgentState`, `StructuredStreamState`,
  `AgentStreamEvent`, `AgentHookState`, `UseAgentReturn`, `UseAgentStreamReturn`.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [Web Integration guide](https://docs.reactiveagents.dev/guides/web-integration/) and the [full docs](https://docs.reactiveagents.dev).
