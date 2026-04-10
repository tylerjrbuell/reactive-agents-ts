---
name: multi-agent-orchestration
description: Compose multiple agents as callable tools, spawn dynamic sub-agents at runtime, and wire remote A2A agents into a coordinated pipeline.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Multi-Agent Orchestration

## Agent objective

Produce a builder with agent tools registered and the orchestration layer enabled so an agent can delegate subtasks to specialized sub-agents and integrate their results.

## When to load this skill

- Building a lead agent that coordinates specialist sub-agents
- Splitting complex tasks across research, writing, coding, or review agents
- Connecting to remote agents via A2A protocol
- Allowing the agent to dynamically spawn sub-agents at runtime based on task needs

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

// Lead agent with registered sub-agents as tools
const agent = await ReactiveAgents.create()
  .withName("lead")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 20 })
  .withOrchestration()
  .withAgentTool("researcher", {
    name: "Research Agent",
    description: "Gathers information, reads web pages, and synthesizes findings",
    maxIterations: 12,
    tools: ["web-search", "http-get", "checkpoint"],
  })
  .withAgentTool("coder", {
    name: "Code Agent",
    description: "Writes, tests, and refactors TypeScript code",
    maxIterations: 15,
    strategy: "plan-execute-reflect",
    tools: ["file-read", "file-write", "code-execute"],
  })
  .withAgentTool("reviewer", {
    name: "Review Agent",
    description: "Reviews code for correctness, style, and security issues",
    maxIterations: 8,
    tools: ["file-read"],
  })
  .withTools({ allowedTools: ["researcher", "coder", "reviewer", "checkpoint", "final-answer"] })
  .withSystemPrompt(`
    You coordinate a team of specialists. Delegate tasks to the appropriate agent.
    Always checkpoint results from sub-agents before continuing to the next phase.
  `)
  .build();
```

## Key patterns

### withAgentTool() — register a named sub-agent

```ts
.withAgentTool("analyst", {
  name: "Data Analyst",                        // display name for the agent
  description: "Analyzes datasets and produces statistics",  // tool description shown to LLM
  provider: "anthropic",                       // defaults to parent's provider
  model: "claude-haiku-4-5-20251001",          // use a cheaper model for sub-tasks
  maxIterations: 10,                           // sub-agent iteration limit
  strategy: "adaptive",                        // sub-agent reasoning strategy
  tools: ["file-read", "code-execute"],        // tools available to sub-agent
})
```

The sub-agent runs as a tool call — the LLM calls it with a task description and receives the result.

### Dynamic sub-agents (runtime spawning)

```ts
.withDynamicSubAgents({ maxIterations: 8 })
// Enables spawning ad-hoc agents at runtime.
// The agent can dynamically create and call sub-agents based on task needs.
// Sub-agents inherit the parent's provider and model by default.
```

### Remote agent via A2A

```ts
.withRemoteAgent("data-service", "http://data-agent:8000")
// Connects to a remote A2A agent at the given URL.
// Remote agent is exposed as a tool — called exactly like a local sub-agent.
// Remote agent must expose the A2A JSON-RPC interface (see a2a-agent-networking skill).
```

### Pipeline pattern: research → write → review

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 25 })
  .withOrchestration()
  .withAgentTool("researcher", {
    name: "Researcher",
    description: "Research a topic and return key findings",
    tools: ["web-search", "http-get", "checkpoint"],
  })
  .withAgentTool("writer", {
    name: "Writer",
    description: "Write a document given research findings",
    tools: ["file-write", "checkpoint"],
  })
  .withAgentTool("reviewer", {
    name: "Reviewer",
    description: "Review a document and return critique",
    tools: ["file-read"],
  })
  .withTools({ allowedTools: ["researcher", "writer", "reviewer", "final-answer"] })
  .withSystemPrompt(`
    1. Call researcher to gather information on the topic.
    2. Call writer with the research to produce the document.
    3. Call reviewer with the document path.
    4. Revise if the reviewer finds critical issues.
    5. Return final-answer when approved.
  `)
  .build();
```

### withAgentTool() parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `name` | `string` | Human-readable display name |
| `description` | `string` | Tool description shown to the orchestrating LLM |
| `provider` | `ProviderName` | Defaults to parent's provider |
| `model` | `string` | Defaults to parent's model — use cheaper models for sub-agents |
| `maxIterations` | `number` | Sub-agent iteration cap |
| `strategy` | `string` | Sub-agent reasoning strategy |
| `tools` | `string[]` | Tools available to the sub-agent |

## Builder API reference

| Method | Notes |
|--------|-------|
| `.withOrchestration()` | Enables the orchestration service layer |
| `.withAgentTool(name, opts)` | Registers a local sub-agent as a named tool |
| `.withDynamicSubAgents(opts?)` | Allows the agent to spawn sub-agents at runtime |
| `.withRemoteAgent(name, url)` | Connects to a remote A2A agent as a named tool |

## Pitfalls

- `.withOrchestration()` must be called alongside `.withAgentTool()` — without it, sub-agent tools are registered but the coordination layer is inactive
- Sub-agent `tools` are scoped to that sub-agent only — the parent's tool set does not propagate down
- Each sub-agent runs in an isolated context — it has no access to the parent's conversation history
- `withDynamicSubAgents` is open-ended — the agent can create arbitrary sub-agents, which can significantly increase costs
- Remote agents must be up and serving A2A requests at build time — connection failures surface during `.build()`
- Always include `"final-answer"` in the orchestrator's `allowedTools` or it cannot complete
