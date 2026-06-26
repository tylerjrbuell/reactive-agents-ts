# @reactive-agents/vue

> Vue composables for Reactive Agents — useAgentStream, useAgent

[![npm](https://img.shields.io/npm/v/@reactive-agents/vue?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/vue)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

> **Stability: experimental.** The SSE event contract may change in a minor release. Pin a version for production use.

Vue 3 composables for streaming AI agents — stream agent output token-by-token
into reactive refs, fire one-shot calls, or progressively render a structured
JSON object as it streams. Built for chat UIs, copilots, and any Vue app talking
to an LLM agent. These composables consume a Server-Sent Events (SSE) endpoint
produced by `AgentStream.toSSE()` on the server, so token streaming works with
plain `fetch` and no extra client deps.

## Install

```bash
bun add @reactive-agents/vue
# or: npm install @reactive-agents/vue
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

```vue
<script setup lang="ts">
import { useAgentStream } from "@reactive-agents/vue";
const { text, status, error, run } = useAgentStream("/api/agent");
</script>

<template>
  <button @click="run('Explain quantum computing')">Ask</button>
  <p style="white-space: pre-wrap">{{ text }}</p>
  <span v-if="status === 'streaming'">●</span>
  <p v-if="error" style="color: red">{{ error }}</p>
</template>
```

Client — structured object:

```vue
<script setup lang="ts">
import { useStructuredObject } from "@reactive-agents/vue";
const { object, status, run } = useStructuredObject("/api/agent/structured");
</script>

<template>
  <button @click="run('Generate a user profile')">Run</button>
  <p v-if="object.name">Name: {{ object.name }}</p>
  <pre v-if="status === 'completed'">{{ JSON.stringify(object, null, 2) }}</pre>
</template>
```

## API

- `useAgentStream(endpoint, requestInit?)` — streaming composable. Returns
  readonly refs `{ text, events, status, error, output }` plus `run(prompt, body?)`
  and `cancel()`. `status` is `"idle" | "streaming" | "completed" | "error"`.
- `useAgent(endpoint, requestInit?)` — one-shot composable. Returns readonly
  refs `{ output, loading, error }` plus `run(prompt, body?)` which resolves with
  the final output string.
- `useStructuredObject(endpoint, requestInit?)` — streams a JSON object,
  surfacing a progressively-filled `object` ref. Returns
  `{ object, text, status, error, run, cancel }`.
- `parsePartialObject(buf)` — best-effort parse of a streaming JSON prefix into
  a partial object (used internally by `useStructuredObject`).
- Types: `AgentStreamEvent`, `AgentHookState`.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [Web Integration guide](https://docs.reactiveagents.dev/guides/web-integration/) and the [full docs](https://docs.reactiveagents.dev).
