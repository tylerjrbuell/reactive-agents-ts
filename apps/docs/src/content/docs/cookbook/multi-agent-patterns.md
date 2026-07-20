---
title: Multi-Agent Patterns
description: >-
  Patterns for building multi-agent systems — agent specialization,
  event-driven coordination, dynamic sub-agent spawning, and A2A delegation.
sidebar:
  order: 4
---

Reactive Agents supports multiple agents working together. This page shows patterns for common multi-agent architectures — specializing agents by role, coordinating them through the EventBus, spawning sub-agents at runtime, and delegating across process boundaries with the A2A protocol.

## Agent Specialization

Build agents with different capability profiles for different roles:

```typescript
// Fast, cheap agent for simple classification
const classifier = await ReactiveAgents.create()
  .withName("classifier")
  .withProvider("anthropic")
  .withModel("claude-haiku-4-5")
  .build();

// Quality-focused agent for writing
const writer = await ReactiveAgents.create()
  .withName("writer")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning({ defaultStrategy: "reflexion" })
  .withVerification()
  .build();

// Tool-using agent for research
const researcher = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withMemory()
  .build();

// Full production agent for critical tasks
const seniorAgent = await ReactiveAgents.create()
  .withName("senior")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools()
  .withMemory({ tier: "enhanced" })
  .withGuardrails()
  .withVerification()
  .withCostTracking()
  .withObservability()
  .build();
```

## Event-Driven Coordination

Use the EventBus to coordinate agents through events:

<!-- docs-skip-typecheck -->
```typescript
import { EventBus } from "@reactive-agents/core";

const program = Effect.gen(function* () {
  const bus = yield* EventBus;

  // Agent A publishes a typed lifecycle event (AgentEvent is a discriminated
  // union — pick the variant that fits; here the research task completed).
  yield* bus.publish({
    _tag: "TaskCompleted",
    taskId: "research-1",
    success: true,
  });

  // Agent B subscribes with a handler and reacts to matching events.
  yield* bus.subscribe((event) =>
    Effect.sync(() => {
      if (event._tag === "TaskCompleted") {
        // react to completion
      }
    }),
  );
});
```

## Monitoring Multi-Agent Systems

Use observability to track the full system:

```typescript
import { Effect } from "effect";
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("orchestrator")
  .withProvider("anthropic")
  .withObservability()
  .withHook({
    phase: "complete",
    timing: "after",
    handler: (ctx) => {
      console.log(`Agent ${ctx.agentId} completed in ${ctx.metadata.duration}ms`);
      console.log(`Cost: $${ctx.cost}, Tokens: ${ctx.tokensUsed}`);
      return Effect.succeed(ctx);
    },
  })
  .build();
```

Each agent in the system gets its own trace, and workflow-level events are logged in the orchestration event log for full auditability.

## Dynamic Sub-Agent Spawning

The `.withDynamicSubAgents()` builder method enables the `spawn-agent` built-in tool.
The parent agent can spawn specialist sub-agents at runtime — the model itself decides
when and what to delegate.

```typescript
const parent = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("anthropic")
  .withTools()
  .withDynamicSubAgents({ maxIterations: 5 })
  .build();

// The model can now call spawn-agent tool:
// spawn-agent({ task: "Analyze this dataset", role: "Data Analyst" })
const result = await parent.run("Analyze this CSV and write a report.");
```

Sub-agents spawn with a clean context window and inherit the parent's tool
configuration. Recursion depth is limited to 3 by default (`MAX_RECURSION_DEPTH`).

Sub-agent persona can be specified via the `spawn-agent` tool parameters:
- `role`: string — e.g., "Data Analyst", "Code Reviewer"
- `instructions`: string — specific behavior instructions
- `tone`: string — e.g., "formal", "concise"

## A2A Remote Agent Communication

Agents can communicate across process boundaries using the A2A protocol:

<!-- docs-skip-typecheck -->
```typescript
import { ReactiveAgents } from "reactive-agents";
import { discoverAgent, findBestAgent } from "@reactive-agents/a2a";
import { Effect } from "effect";

// Discover available agents on the network
const agents = await Effect.runPromise(
  discoverMultipleAgents([
    "https://agent-a.example.com",
    "https://agent-b.example.com",
    "https://agent-c.example.com",
  ])
);

// Find the best agent for a research task
const best = findBestAgent(agents, {
  skillIds: ["web-search"],
  tags: ["research"],
});

if (best) {
  console.log(`Delegating to ${best.agent.name} (score: ${best.score})`);

  // Register the remote agent as a tool on your coordinator
  const coordinator = await ReactiveAgents.create()
    .withName("coordinator")
    .withProvider("anthropic")
    .withRemoteAgent("researcher", best.agent.url)
    .withReasoning()
    .build();

  const result = await coordinator.run("Research the latest in quantum computing");
}
```

### Exposing Your Agent via A2A

```bash
# Start your agent as an A2A server
rax serve --name my-agent --provider anthropic --port 3000

# Other agents can now discover and call yours at:
# http://localhost:3000/.well-known/agent.json
```

See the [A2A Protocol](/features/a2a-protocol/) docs for complete server/client API details.
