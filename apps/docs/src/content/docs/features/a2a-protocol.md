---
title: A2A Protocol
description: Agent-to-Agent communication using Google's A2A protocol — Agent Cards, JSON-RPC server/client, SSE streaming, and agent discovery.
sidebar:
  order: 1
---

The A2A (Agent-to-Agent) protocol enables agents to discover each other, exchange tasks, and stream results over HTTP. Reactive Agents implements the [A2A specification](https://a2a-protocol.org) with full JSON-RPC 2.0 support.

## Overview

A2A communication follows this flow:

```
Agent B                          Agent A (Server)
  │                                 │
  │─── GET /.well-known/agent.json ─▶│  1. Discovery
  │◀── AgentCard ───────────────────│
  │                                 │
  │─── POST / (message/send) ──────▶│  2. Send Task
  │◀── { taskId } ─────────────────│
  │                                 │
  │─── POST / (tasks/get) ─────────▶│  3. Poll Result
  │◀── { status, result } ─────────│
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
    streaming: true,
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

```typescript
const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withA2A({ port: 3000 })
  .build();
```

### Programmatic Server

For full control, use the A2A server directly:

```typescript
import { generateAgentCard } from "@reactive-agents/a2a";

const card = generateAgentCard({ name: "my-agent", url: "http://localhost:3000" });

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/.well-known/agent.json") {
      return Response.json(card);
    }
    if (req.method === "POST" && url.pathname === "/") {
      const body = await req.json();
      // Handle JSON-RPC methods...
    }
    return new Response("Not Found", { status: 404 });
  },
});
```

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

  // Send a task
  const { taskId } = yield* client.sendMessage({
    message: {
      role: "user",
      parts: [{ kind: "text", text: "Research quantum computing" }],
    },
  });

  // Poll for result
  const task = yield* client.getTask({ id: taskId });
  return task;
}).pipe(Effect.provide(layer), Effect.runPromise);
```

### Authentication

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

## Capability Matching

Find the best agent for a task based on skills and capabilities:

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

For real-time task updates, use Server-Sent Events:

```typescript
import { createSSEStream, formatSSEEvent } from "@reactive-agents/a2a";

// Server side: create an SSE stream
const { stream, enqueue, close } = createSSEStream();

// Push events as the task progresses
enqueue({ type: "status", taskId: "abc", data: { state: "working" } });
enqueue({ type: "artifact", taskId: "abc", data: { parts: [{ kind: "text", text: "Partial result..." }] } });
enqueue({ type: "status", taskId: "abc", data: { state: "completed" } });
close();

// Return as SSE response
return new Response(stream, {
  headers: { "Content-Type": "text/event-stream" },
});
```

## MCP Transports

When connecting to MCP (Model Context Protocol) tool servers, Reactive Agents supports four transport modes:

| Transport | When to Use |
|-----------|-------------|
| `stdio` | Subprocess — MCP server launched as a child process |
| `sse` | HTTP Server-Sent Events — remote server over HTTP |
| `websocket` | WebSocket — low-latency bidirectional connection |
| `streamable-http` | Streaming HTTP — persistent connection with multiplexed streams |

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
| `message/stream` | Send and subscribe to SSE updates | `{ message: A2AMessage }` |
| `tasks/get` | Get task status and result | `{ id: string }` |
| `tasks/cancel` | Cancel an in-progress task | `{ id: string }` |
| `agent/card` | Get the agent's card via RPC | — |

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
