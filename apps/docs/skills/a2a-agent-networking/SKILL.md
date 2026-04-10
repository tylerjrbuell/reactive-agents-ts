---
name: a2a-agent-networking
description: Expose agents as A2A JSON-RPC servers discoverable via Agent Cards, and connect agents to remote A2A agents using the client discovery and capability-matching APIs.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Agent-to-Agent (A2A) Networking

## Agent objective

Produce a builder with `.withA2A()` configured to expose an agent as an A2A server, or connect to remote A2A agents using the client APIs from `@reactive-agents/a2a`.

## When to load this skill

- Exposing an agent as a remotely callable A2A service
- Connecting a lead agent to remote specialist agents at different URLs
- Discovering available agents in a network via Agent Cards
- Building agent microservices that communicate over HTTP

## Implementation baseline

### Exposing an agent as an A2A server

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("specialist")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 10 })
  .withTools({ allowedTools: ["web-search", "http-get", "checkpoint"] })
  .withA2A({ port: 8000 })   // starts A2A HTTP server on port 8000
  .build();

// Agent is now discoverable at:
//   GET  http://localhost:8000/.well-known/agent.json  (Agent Card)
//   POST http://localhost:8000/rpc                     (JSON-RPC 2.0)
```

### Connecting from a lead agent

```ts
const lead = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 20 })
  .withOrchestration()
  .withRemoteAgent("specialist", "http://specialist-service:8000")
  // Registers the remote A2A agent as a callable tool named "specialist"
  .withTools({ allowedTools: ["specialist", "checkpoint", "final-answer"] })
  .build();
```

## Key patterns

### withA2A() — expose as A2A server

```ts
.withA2A()
// Default port: 3000, basePath: "/"
// Endpoints:
//   /.well-known/agent.json  → Agent Card
//   /rpc                     → JSON-RPC 2.0 task endpoint

.withA2A({ port: 8000 })
// Custom port

.withA2A({ port: 8000, basePath: "/api/agents" })
// Agent Card at: http://localhost:8000/api/agents/.well-known/agent.json
// RPC at:        http://localhost:8000/api/agents/rpc
```

### A2A client — discover and call agents

```ts
import {
  A2AClient,
  createA2AClient,
  discoverAgent,
  discoverMultipleAgents,
  matchCapabilities,
  findBestAgent,
} from "@reactive-agents/a2a";
import { Effect } from "effect";

// Discover a single agent's card
const program = Effect.gen(function* () {
  const card = yield* discoverAgent("http://specialist:8000");
  console.log("Agent name:", card.name);
  console.log("Skills:", card.skills);
});

// Discover multiple agents
const multi = Effect.gen(function* () {
  const cards = yield* discoverMultipleAgents([
    "http://researcher:8001",
    "http://coder:8002",
    "http://reviewer:8003",
  ]);
  // Find best match for a capability
  const best = findBestAgent(cards, { capability: "code-review" });
});

// Direct A2A client call
const call = Effect.gen(function* () {
  const client = yield* A2AClient;
  const result = yield* client.send({
    agentCardUrl: "http://specialist:8000/.well-known/agent.json",
    message: { role: "user", content: "Analyze this dataset..." },
  });
  console.log(result.output);
});
```

### Generating Agent Cards

```ts
import { generateAgentCard, toolsToSkills } from "@reactive-agents/a2a";

const card = generateAgentCard({
  name: "Data Analyst",
  description: "Analyzes datasets and produces statistical summaries",
  skills: toolsToSkills(myTools),   // converts ToolDefinition[] to A2A skill format
  version: "1.0.0",
  url: "http://analyst-agent:8000",
});
```

### A2A vs withRemoteAgent()

Two ways to connect to remote agents:

```ts
// Option 1: withRemoteAgent() on the builder (simpler — agent-as-tool pattern)
.withRemoteAgent("analyst", "http://analyst:8000")
// The remote agent appears as a tool named "analyst" in the LLM's tool list.
// No client code needed — the framework handles the A2A protocol.

// Option 2: A2AClient directly (more control — for custom orchestration)
import { A2AClient } from "@reactive-agents/a2a";
// Use when you need capability discovery, load balancing, or custom retry logic.
```

## A2AOptions reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `port` | `number` | `3000` | HTTP port for the A2A server |
| `basePath` | `string` | `"/"` | Base path for A2A endpoints |

## Endpoints exposed by withA2A()

| Endpoint | Method | Description |
|----------|--------|-------------|
| `<basePath>/.well-known/agent.json` | GET | Agent Card (capabilities, skills, metadata) |
| `<basePath>/rpc` | POST | JSON-RPC 2.0 task execution endpoint |

## Pitfalls

- `.withA2A()` starts an HTTP server — the agent process must stay alive for the server to serve requests (combine with `.withGateway()` for persistent agents)
- The A2A server is started during `.build()` — port conflicts will throw at build time, not at call time
- `withRemoteAgent()` connects to the remote agent at build time to fetch its Agent Card — the remote agent must be up when `.build()` is called
- Agent Cards are generated from the agent's name, description, and registered tools — populate `.withName()` and the system prompt for a meaningful card
- A2A uses JSON-RPC 2.0 over HTTP — ensure firewalls and network policies allow traffic between agent services on the configured ports
- Each agent has its own A2A server instance — `port` must be unique per agent process to avoid conflicts
