---
title: A2A Protocol
stability: experimental
description: >-
  Agent-to-Agent communication using Google's A2A protocol — Agent Cards,
  JSON-RPC server/client, and agent discovery.
sidebar:
  order: 1
topic: agents
updated: "0.19"
related:
  - guides/sub-agents
  - cookbook/multi-agent-patterns
  - reference/builder-api/integrations
---

The A2A (Agent-to-Agent) protocol enables agents to discover each other and exchange tasks over HTTP. Reactive Agents implements the [A2A specification](https://a2a-protocol.org) with JSON-RPC 2.0 support. Real-time SSE streaming is not yet implemented — see [SSE Streaming](#sse-streaming) below.

## Overview

A2A communication follows this flow:

```
Agent B                          Agent A (Server)
  │                                 │
  │─── GET /.well-known/agent.json ─▶│  1. Discovery
  │◀── AgentCard ───────────────────│
  │                                 │
  │─── POST / (message/send) ──────▶│  2. Send Task
  │◀── A2ATask { id, status, … } ───│
  │                                 │
  │─── POST / (tasks/get) ─────────▶│  3. Poll Result
  │◀── A2ATask { id, status, … } ───│
```

## Agent Cards

Every A2A agent publishes an **Agent Card** — a JSON document describing its name, capabilities, and skills.

```typescript
import { generateAgentCard, toolsToSkills } from "@reactive-agents/a2a";

const card = generateAgentCard({
  name: "research-agent",
  description: "An agent that researches topics thoroughly",
  url: "https://my-agent.example.com",
  organization: "My Org",
  capabilities: {
    // Real SSE streaming isn't implemented yet — `generateAgentCard` defaults
    // this to `false`. Only set it to `true` if you've wired real streaming
    // yourself; see "SSE Streaming" below.
    streaming: false,
    pushNotifications: false,
  },
  skills: [
    { id: "web-search", name: "Web Search", description: "Search the web", tags: ["search"] },
    { id: "summarize", name: "Summarize", description: "Summarize documents", tags: ["nlp"] },
  ],
});
```

Cards are served at `GET /.well-known/agent.json` (standard) and `GET /agent/card` (fallback).

### From Tool Definitions

Convert existing tool definitions to skills:

<!-- docs-skip-typecheck -->
```typescript
const skills = toolsToSkills([
  { name: "calculator", description: "Perform math", parameters: [{ name: "expression" }] },
  { name: "web-search", description: "Search the web", parameters: [{ name: "query" }] },
]);
// [{ id: "calculator", name: "calculator", description: "Perform math", tags: [] }, ...]
```

## Starting an A2A Server

### Via CLI

The simplest way to expose an agent via A2A:

```bash
rax serve --name my-agent --provider anthropic --port 3000
rax serve --name my-agent --provider anthropic --port 3000 --with-tools   # Start A2A server with built-in tools enabled
```

This starts a fully functional A2A HTTP server with:
- Agent Card at `/.well-known/agent.json`
- JSON-RPC endpoint at `POST /`
- Supported methods: `message/send`, `tasks/get`, `tasks/cancel`, `agent/card`

### Via Builder

`.withA2A({ port, basePath })` only *configures* the defaults for serving — it
does not start a server by itself (an agent built with just `.withA2A()` and
nothing else serves nothing). Call `agent.serveA2A()` to actually bind and
start listening:

```typescript
const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withA2A({ port: 3000 })
  .build();

const handle = await agent.serveA2A();
// Agent Card now served at http://127.0.0.1:3000/.well-known/agent.json
console.log(`Listening on port ${handle.port}`);

// ...later
await handle.stop();
```

`serveA2A()` also accepts its own options — `port`, `basePath`, `hostname`,
`description`, `name`, and `token` — which override whatever `.withA2A()` set:

```typescript
const handle = await agent.serveA2A({ port: 4000, basePath: "/api/agents" });
```

### Programmatic Server

`agent.serveA2A()` covers the standard case. For lower-level control (e.g.
mounting A2A routes inside an existing `Bun.serve` app), use
`createA2AHttpServer` from `@reactive-agents/a2a` directly — it's the same
server implementation `serveA2A()` and `rax serve` both use under the hood.

## Client: Discovering and Calling Agents

### Discovery

```typescript
import { discoverAgent, discoverMultipleAgents } from "@reactive-agents/a2a";
import { Effect } from "effect";

// Discover a single agent
const card = await Effect.runPromise(
  discoverAgent("https://agent.example.com")
);
console.log(card.name, card.skills);

// Discover multiple agents (up to 5 concurrently)
const cards = await Effect.runPromise(
  discoverMultipleAgents([
    "https://agent-a.example.com",
    "https://agent-b.example.com",
  ])
);
```

### Sending Tasks

```typescript
import { A2AClient, createA2AClient } from "@reactive-agents/a2a";
import { Effect } from "effect";

const layer = createA2AClient({ baseUrl: "https://agent.example.com" });

const result = await Effect.gen(function* () {
  const client = yield* A2AClient;

  // Send a task — returns a spec-shaped A2ATask: { id, status, artifacts, ... }
  const task = yield* client.sendMessage({
    message: {
      role: "user",
      parts: [{ kind: "text", text: "Research quantum computing" }],
    },
  });

  // Poll for result using the task's id
  const finalTask = yield* client.getTask({ id: task.id });
  console.log(finalTask.status.state); // "completed" | "failed" | "working" | ...
  return finalTask;
}).pipe(Effect.provide(layer), Effect.runPromise);
```

By default `message/send` returns immediately with the task in `working`
state (non-blocking, per spec) and you poll `tasks/get` yourself, as above.
Pass `configuration: { blocking: true }` to have the server wait and return
the task once it reaches a terminal state.

### Authentication

<!-- docs-skip-typecheck -->
```typescript
const layer = createA2AClient({
  baseUrl: "https://agent.example.com",
  auth: {
    type: "bearer",
    token: "my-secret-token",
  },
});

// Or API key auth:
const layer2 = createA2AClient({
  baseUrl: "https://agent.example.com",
  auth: {
    type: "apiKey",
    apiKey: "my-api-key",
  },
});
```

The server accepts only `Authorization: Bearer <token>` (set via `RA_A2A_TOKEN` or the server options); the client's `apiKey` type is sent as `Authorization: Bearer <apiKey>`, the same header as `bearer`, so either type authenticates against the built-in server.

Agent-card discovery (`discoverAgent`, `getAgentCard`) uses the same pinned, SSRF-checked fetch and refuses redirects. It has its own time budget: 10 seconds by default, set with `egress: { timeoutMs }` on the client or the second argument of `discoverAgent`. A slow endpoint fails with `DiscoveryError`.

### Timeout, size cap and egress policy

`sendMessage`, `getTask` and `cancelTask` are bounded so a hostile or hung endpoint cannot stall a run or exhaust memory:

```typescript
import { createA2AClient } from "@reactive-agents/a2a";

const layer = createA2AClient({
  baseUrl: "https://agent.example.com",
  timeoutMs: 30_000,              // default 30s, covers connect + headers + body -> RequestTimeoutError
  maxResponseBytes: 5 * 1024 * 1024, // default 5 MiB, streamed read aborts past it -> ResponseTooLargeError
  allowPrivateNetwork: false,     // explicit: refuse loopback/RFC-1918 targets -> EgressDeniedError
});
```

Requests connect through the SSRF-safe pinned fetch: DNS is resolved once, every answer is validated, and the socket goes to the validated address. Cloud-metadata and link-local targets are always refused. Redirects are refused (`EgressDeniedError`) because they would forward credentials. When `allowPrivateNetwork` is unset the shared agent policy applies: private peers are allowed unless `egress: { strictEgress: true }` or `RA_AGENT_STRICT_EGRESS=1`. Set `allowPrivateNetwork: true` to permit private peers even under strict egress.

## Capability Matching

Find the best agent for a task based on skills and capabilities:

<!-- docs-skip-typecheck -->
```typescript
import { matchCapabilities, findBestAgent } from "@reactive-agents/a2a";

const agents = [card1, card2, card3]; // AgentCard[]

// Score and rank all agents
const ranked = matchCapabilities(agents, {
  skillIds: ["web-search"],
  tags: ["research", "nlp"],
  inputModes: ["text/plain"],
});
// Returns: [{ agent, score, matchedSkills }]

// Get the single best match
const best = findBestAgent(agents, { skillIds: ["web-search"] });
if (best) {
  console.log(`Best agent: ${best.agent.name} (score: ${best.score})`);
}
```

**Scoring:**
- Skill ID match: **10 points**
- Tag overlap: **5 points** per matching tag
- Input mode support: **2 points** per matching mode

## Agent-as-Tool

Register a remote agent as a callable tool on your agent:

```typescript
const agent = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("anthropic")
  .withRemoteAgent("researcher", "https://research-agent.example.com")
  .withReasoning()
  .build();

// The coordinator can now delegate research tasks to the remote agent
const result = await agent.run("Research and summarize recent AI breakthroughs");
```

Or register a local agent as a tool:

```typescript
const agent = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("anthropic")
  .withAgentTool("specialist", {
    name: "data-analyst",
    description: "Analyzes data and produces insights",
  })
  .build();
```

## SSE Streaming

**Not yet fully implemented.** The `message/stream` JSON-RPC method exists,
but `handleMessageStream` currently awaits the task to run to completion and
joins the resulting events into a single response body — it does not push
events incrementally as the task progresses. Because of this,
`generateAgentCard` defaults `capabilities.streaming` to `false`, and agent
cards no longer advertise streaming support they can't back up.

`@reactive-agents/a2a` still exports `formatSSEEvent` for formatting
individual `A2ATask` / task-update events into the `text/event-stream` wire
format, for callers building their own incremental streaming on top of it.
Real incremental SSE streaming (`message/stream` and `tasks/sendSubscribe`
pushing events as they happen) is a planned follow-up, not yet available.

## MCP Transports

When connecting to MCP (Model Context Protocol) tool servers, Reactive Agents supports four transport modes:

| Transport | When to Use |
|-----------|-------------|
| `stdio` | Subprocess — MCP server launched as a child process |
| `sse` | HTTP Server-Sent Events — remote server over HTTP |
| `websocket` | WebSocket — low-latency bidirectional connection |
| `streamable-http` | Streaming HTTP — persistent connection with multiplexed streams |

<!-- docs-skip-typecheck -->
```typescript
// stdio (subprocess)
.withMCP({ name: "local-tools", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] })

// SSE (HTTP server-sent events)
.withMCP({ name: "remote-tools", transport: "sse", url: "https://mcp.example.com/sse" })

// WebSocket
.withMCP({ name: "my-server", transport: "websocket", url: "ws://localhost:8080" })

// Streamable HTTP (persistent connection with multiplexed streams)
.withMCP({ name: "streaming-tools", transport: "streamable-http", url: "https://mcp.example.com/stream" })
```

## JSON-RPC Methods

| Method | Description | Params |
|--------|-------------|--------|
| `message/send` | Send a message and create a task | `{ message: A2AMessage }` |
| `message/stream` | Send and get SSE-formatted updates (not yet incremental — see [SSE Streaming](#sse-streaming)) | `{ message: A2AMessage }` |
| `tasks/get` | Get task status and result | `{ id: string }` |
| `tasks/cancel` | Cancel an in-progress task | `{ id: string }` |
| `agent/card` | Get the agent's card via RPC | — |

`message/send`, `message/stream`, `tasks/get` and `tasks/cancel` validate their `params` against a schema. Malformed params get a JSON-RPC `-32602` (invalid params) error instead of reaching the handler.

**`tasks/cancel` limitation:** canceling a task marks it `canceled` in the
task store immediately, but does not yet interrupt the underlying agent run
— the run keeps executing in the background to completion regardless. Full
cancellation (interrupting the in-flight run) is a planned follow-up.

## Error Types

| Error | When |
|-------|------|
| `A2AError` | General protocol errors |
| `DiscoveryError` | Agent card fetch failed |
| `TransportError` | HTTP/network failure |
| `TaskNotFoundError` | Task ID doesn't exist |
| `TaskCanceledError` | Task was already canceled |
| `InvalidTaskStateError` | Invalid state transition |
| `AuthenticationError` | Auth credentials invalid |
| `RequestTimeoutError` | Client RPC exceeded `timeoutMs` |
| `ResponseTooLargeError` | Client RPC response body exceeded `maxResponseBytes` |
| `EgressDeniedError` | Client RPC target refused by the egress policy, or the server redirected |

## What's Next

- [Sub-Agents](/guides/sub-agents/) — in-process delegation, the same-machine sibling of A2A
- [Multi-Agent Patterns](/cookbook/multi-agent-patterns/) — coordination and delegation patterns that use A2A
- [Agent Gateway](/features/gateway/) — expose an A2A-reachable agent as a persistent, always-on service
