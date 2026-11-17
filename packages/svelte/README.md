# @reactive-agents/svelte

> Svelte stores that stream a Reactive Agents run into your UI, token by token, from a Server-Sent Events endpoint.

[![npm](https://img.shields.io/npm/v/@reactive-agents/svelte?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/svelte)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/guides/web-integration/)

> **Stability:** unstable. The SSE event contract may change in a minor release. Pin a version.

## Install

```bash
bun add @reactive-agents/svelte
# or: npm install @reactive-agents/svelte
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

## API

| Export | Use it when |
|---|---|
| `createAgentStream(endpoint, requestInit?)` | You stream text. Store value `{ text, events, status, error, output }`; methods `run`, `cancel`. `status` is `"idle" \| "streaming" \| "completed" \| "error"`. |
| `createAgent(endpoint, requestInit?)` | You want a one-shot call. Store value `{ output, loading, error }`; `run(prompt, body?)`. |
| `createStructuredStream(endpoint, requestInit?)` | You render a JSON object as it streams (`$stream.object`). |
| `createRun`, `createResumableRun`, `createInteractions` | You need the run state machine, durable reattach or human-in-the-loop answers. |
| `runCost`, `runSteps` | You show live cost or the tool and step trace. |
| `parsePartialObject(buf)` | You parse a streaming JSON prefix yourself. |
| `AgentStreamState`, `AgentState`, `StructuredStreamState`, `RunState` | You need the types. |

## Documentation

- [Web integration guide](https://docs.reactiveagents.dev/guides/web-integration/)
- [Agentic UI core](https://docs.reactiveagents.dev/features/agentic-ui-core/)

## Runtime

Svelte (`svelte >= 4.0.0`) in the browser. Server code that builds the agent needs Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
