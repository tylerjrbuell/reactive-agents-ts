# @reactive-agents/a2a

> Agent2Agent (A2A) protocol for TypeScript: Agent Cards plus a JSON-RPC 2.0 server and client, so independent agents can discover and delegate to each other over HTTP.

> **Stability:** experimental. A2A is an opt-in protocol surface, and the wire format and JSON-RPC method names may change as the A2A spec evolves.

[![npm](https://img.shields.io/npm/v/@reactive-agents/a2a?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/a2a)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/features/a2a-protocol/)

## Install

```bash
bun add @reactive-agents/a2a
# or: npm install @reactive-agents/a2a
```

## Usage

```ts
import { Effect } from "effect";
import { generateAgentCard, A2AClient, createA2AClient } from "@reactive-agents/a2a";

// Describe your agent for discovery (served at /.well-known/agent.json)
const card = generateAgentCard({
  name: "research-agent",
  description: "Searches the web and summarizes findings",
  url: "https://agents.example.com/research",
});

// Call a remote A2A agent over JSON-RPC 2.0
const clientLayer = createA2AClient({ baseUrl: "https://agents.example.com/research" });

const program = Effect.gen(function* () {
  const client = yield* A2AClient;
  const task = yield* client.sendMessage({
    message: { role: "user", parts: [{ kind: "text", text: "Summarize A2A" }] },
  });
  return yield* client.getTask({ id: task.id });
});

await Effect.runPromise(Effect.provide(program, clientLayer));
```

To serve an agent, use `agent.serveA2A()` from `@reactive-agents/runtime` (see the docs). Use this package's `createA2AServer` and `createA2AHttpServer` only when you host the JSON-RPC server yourself.

## API

| Export | Use it when |
|---|---|
| `generateAgentCard`, `toolsToSkills` | You build an Agent Card or map tool definitions to `AgentSkill[]`. |
| `createA2AServer`, `createA2AHttpServer(port, executor?, basePath?, options?)` | You host the task store and JSON-RPC server (`message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, `agent/card`). |
| `TaskExecutor`, `createTaskHandler` | You supply the function that runs a submitted task. Without one, `message/send` fails with `INTERNAL_ERROR`. |
| `A2AClient`, `createA2AClient` | You call a remote agent (`sendMessage`, `getTask`, `cancelTask`, `getAgentCard`). The client bounds requests with a timeout, a response size cap and the shared egress policy. |
| `discoverAgent`, `discoverMultipleAgents`, `matchCapabilities`, `findBestAgent` | You discover remote agents and pick one by capability. |
| `AgentCard`, `A2ATask`, `A2AMessage`, `TaskState`, `A2AError` | You type protocol data or handle errors. |

## Limitations

- Agent Cards advertise `streaming: false`. `message/stream` waits for task completion and returns the result as SSE events; it is not incremental.
- `message/send` is non-blocking by default; pass `configuration: { blocking: true }` to await completion.

## Documentation

- [A2A protocol](https://docs.reactiveagents.dev/features/a2a-protocol/)
- [Agent2Agent specification](https://a2a-protocol.org)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
