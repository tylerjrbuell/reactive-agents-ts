# @reactive-agents/a2a

> A2A (Agent2Agent) protocol for TypeScript — Agent Cards, JSON-RPC 2.0 server/client, and SSE streaming.

[![npm](https://img.shields.io/npm/v/@reactive-agents/a2a?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/a2a)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

An Effect-TS implementation of the [Agent2Agent (A2A) protocol](https://a2a-protocol.org) for agent-to-agent interoperability. Generate A2A-compliant Agent Cards, expose your agent as a JSON-RPC 2.0 server (with SSE streaming for long-running tasks), and discover or call remote agents as a client. Lets independent agents advertise capabilities and delegate work to one another over HTTP.

## Install
```bash
bun add @reactive-agents/a2a
# or: npm install @reactive-agents/a2a
```

## Usage

### Generate an Agent Card and call a remote agent
```ts
import { Effect } from "effect";
import { generateAgentCard, A2AClient, createA2AClient } from "@reactive-agents/a2a";

// Describe your agent for discovery (served at /.well-known/agent.json)
const card = generateAgentCard({
  name: "research-agent",
  description: "Searches the web and summarizes findings",
  url: "https://agents.example.com/research",
});

// Talk to a remote A2A agent over JSON-RPC 2.0
const clientLayer = createA2AClient({ baseUrl: "https://agents.example.com/research" });

const program = Effect.gen(function* () {
  const client = yield* A2AClient;
  const { taskId } = yield* client.sendMessage({
    message: { role: "user", parts: [{ kind: "text", text: "Summarize A2A" }] },
  });
  return yield* client.getTask({ id: taskId });
});

await Effect.runPromise(Effect.provide(program, clientLayer));
```

### Serve your agent over HTTP
```ts
import { createA2AServer, createA2AHttpServer } from "@reactive-agents/a2a";

const serverLayer = createA2AServer(card);          // task store + lifecycle
const httpLayer = createA2AHttpServer(3000);        // Bun.serve JSON-RPC + SSE
```

## API

- `generateAgentCard(config)` / `toolsToSkills(tools)` — build an A2A Agent Card; map tool definitions to `AgentSkill[]`.
- `A2AServer` / `createA2AServer(card)` — task store service (`getTask`, `cancelTask`, `getAgentCard`).
- `A2AHttpServer` / `createA2AHttpServer(port, executor?)` — JSON-RPC 2.0 HTTP server with SSE streaming.
- `createTaskHandler(store, executor?)` / `TaskExecutor` — wire task execution and persistence.
- `formatSSEEvent` / `createSSEStream` / `StreamEvent` — Server-Sent Events helpers for streaming tasks.
- `A2AClient` / `createA2AClient(config)` — remote client (`sendMessage`, `getTask`, `cancelTask`, `getAgentCard`).
- `discoverAgent(url)` / `discoverMultipleAgents(urls)` — fetch Agent Cards for discovery.
- `matchCapabilities` / `findBestAgent` — capability-based agent selection.
- `A2AService` / `A2AServiceLive` — unified server + client Effect service.
- `createA2AServerLayer` / `createA2AClientLayer` / `A2AServerLive` / `A2AClientLive` — composable runtime layers.
- Protocol types: `AgentCard`, `AgentSkill`, `A2AMessage`, `A2ATask`, `TaskState`, `Part`, `Artifact`, plus error types (`A2AError`, `TransportError`, `DiscoveryError`, `TaskNotFoundError`).

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [full documentation](https://docs.reactiveagents.dev).
