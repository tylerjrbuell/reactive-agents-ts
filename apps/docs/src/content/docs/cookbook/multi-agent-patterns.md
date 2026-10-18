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
  .withTools({ builtins: true })
  .withMemory()
  .build();

// Full production agent for critical tasks
const seniorAgent = await ReactiveAgents.create()
  .withName("senior")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({ builtins: true })
  .withMemory({ tier: "enhanced" })
  .withGuardrails()
  .withVerification()
  .withCostTracking()
  .withObservability()
  .build();
```

## Event-Driven Coordination

Use the EventBus to coordinate agents through events:

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
  .withTools({ builtins: true })
  .withDynamicSubAgents({ maxIterations: 5 })
  .build();

// The model can now call spawn-agent tool:
// spawn-agent({ task: "Analyze this dataset", role: "Data Analyst" })
const result = await parent.run("Analyze this CSV and write a report.");
```

Sub-agents spawn with a clean context window and inherit the parent's tool
configuration. Recursion depth is limited to 3 by default (`MAX_RECURSION_DEPTH`),
so a sub-agent can itself delegate (depth 2+) under the same cap.

Delegation is honest by construction: a child's completion envelope crosses
back on its result, and the parent terminal joins children worst-of — a child
that finished `partial` (budget stop, unmet requirements, harness-authored
output) caps a `completed` parent claim at `partial` rather than laundering it
into a success. Child spend also folds into the parent's `.withBudget()` meter,
so the run total the budget gates on includes delegation.

Sub-agent persona can be specified via the `spawn-agent` tool parameters:
- `role`: string — e.g., "Data Analyst", "Code Reviewer"
- `instructions`: string — specific behavior instructions
- `tone`: string — e.g., "formal", "concise"

## Static Sub-Agent Tools with Structured Parameters

`.withAgentTool()` registers a sub-agent as a named, callable tool on the parent.
Unlike `spawn-agent` (which the model configures at runtime), a static sub-agent's
configuration is fixed at build time — but its **input parameters can be dynamic**.

Declare typed `parameters` on the sub-agent config so the parent LLM passes
structured arguments per invocation instead of a free-form `input` string:

```typescript
const coordinator = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("anthropic")
  .withAgentTool("review-pr", {
    name: "PR Reviewer",
    description: "Reviews a pull request for a given focus area",
    systemPrompt: "Review {{repo}} pull request #{{prNumber}} with focus on {{focus}}. Return concrete, line-referenced findings.",
    persona: {
      role: "{{focus}} reviewer",
      instructions: "Check {{repo}} for {{focus}} issues. Be thorough.",
    },
    tools: ["file-read", "web-search"],
    parameters: [
      { name: "repo", type: "string", description: "Repository owner/repo", required: true },
      { name: "prNumber", type: "number", description: "Pull request number", required: true },
      { name: "focus", type: "string", description: "Review focus area", required: false, enum: ["security", "performance", "style"] },
    ],
    // Unattended delegation — no human approval per call
    requiresApproval: false,
    // Long-running review can take up to 10 minutes
    timeoutMs: 600_000,
  })
  .build();
```

The parent LLM calls it with typed arguments:

```typescript
// Generated dynamically by the parent LLM:
toolCall("review-pr", { repo: "owner/repo", prNumber: 42, focus: "security" });
```

**How parameters work:**
- Declared `parameters` are merged into the tool's JSON Schema alongside the catch-all `input` string.
- `{{paramName}}` placeholders in `systemPrompt`, `persona.role`, `persona.instructions`, and `persona.background` are interpolated with the call-time values before the sub-agent runs. Follows the same `{{key}}` convention as the prompts template engine.
- Missing optional keys are left as-is (no throw) — the sub-agent still runs.
- `input` remains available as a free-form catch-all argument.

**`withAgentTool()` vs `spawn-agent`:**

| | `.withAgentTool()` | `spawn-agent` (via `.withDynamicSubAgents()`) |
|---|---|---|
| Config | Fixed at build time | Generated by model at runtime |
| Input | Typed `parameters` + `input` | `task`, `role`, `instructions`, `tone`, `tools` |
| Approval | Configurable (`requiresApproval`) | No approval required |
| Timeout | Configurable (`timeoutMs`) | Fixed (120s / 300s) |
| Best for | Known, repeatable delegation | Dynamic, task-dependent delegation |

Use `.withAgentTool()` when the sub-agent's purpose is known at build time and you want tight control over tools, approval, and timeout. Use `spawn-agent` when the type of sub-agent needed depends on the task at hand.

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

## What's Next

- [Sub-Agents](/guides/sub-agents/) — persona control, lifecycle, and context forwarding for the delegation patterns above
- [Agent Gateway](/features/gateway/) — host a multi-agent system as a persistent, always-on service
- [Testing Agents](/cookbook/testing-agents/) — deterministic testing for multi-agent coordination
