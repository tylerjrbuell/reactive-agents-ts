# @reactive-agents/vue

> Vue 3 composables that stream a Reactive Agents run into reactive refs, token by token, from a Server-Sent Events endpoint.

[![npm](https://img.shields.io/npm/v/@reactive-agents/vue?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/vue)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/guides/web-integration/)

> **Stability:** unstable. The SSE event contract may change in a minor release. Pin a version.

## Install

```bash
bun add @reactive-agents/vue
# or: npm install @reactive-agents/vue
```

## Usage

Server, any route that returns the agent stream as SSE:

```ts
import { ReactiveAgents, AgentStream } from "reactive-agents";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const agent = await ReactiveAgents.create().withProvider("anthropic").withTools().build();
  return AgentStream.toSSE(agent.runStream(prompt));
}
```

Client:

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

## API

| Export | Use it when |
|---|---|
| `useAgentStream(endpoint, requestInit?)` | You stream text. Returns readonly refs `{ text, events, status, error, output }` plus `run(prompt, body?)` and `cancel()`. `status` is `"idle" \| "streaming" \| "completed" \| "error"`. |
| `useAgent(endpoint, requestInit?)` | You want a one-shot call. Returns `{ output, loading, error }` plus `run(prompt, body?)`. |
| `useStructuredObject(endpoint, requestInit?)` | You render a JSON object as it streams. Returns `{ object, text, status, error, run, cancel }`. |
| `parsePartialObject(buf)` | You parse a streaming JSON prefix yourself. |
| `formatCost`, `formatTokens`, `statusOfRun`, `statusOfTurn` | You show cost, tokens or run status with the shared display vocabulary (re-exported from `@reactive-agents/ui-core`). |
| `AgentStreamEvent`, `AgentHookState` | You need the types. |

## Documentation

- [Web integration guide](https://docs.reactiveagents.dev/guides/web-integration/)
- [Agentic UI core](https://docs.reactiveagents.dev/features/agentic-ui-core/)

## Runtime

Vue 3 (`vue >= 3.0.0`) in the browser. Server code that builds the agent needs Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
