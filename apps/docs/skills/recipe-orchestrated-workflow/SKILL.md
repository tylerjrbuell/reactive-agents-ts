---
name: recipe-orchestrated-workflow
description: Full recipe for a 3-agent pipeline (researcher → writer → reviewer) coordinated by a lead orchestrator agent using withAgentTool() and withOrchestration().
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "recipe"
---

# Recipe: Orchestrated Workflow

## What this builds

A 3-agent pipeline where a lead orchestrator delegates to a researcher (web search + synthesis), a writer (document creation), and a reviewer (quality check). The lead coordinates the workflow, passes results between agents, and handles revision cycles.

## Skills loaded by this recipe

- `multi-agent-orchestration` — withAgentTool(), withOrchestration(), withRemoteAgent()
- `reasoning-strategy-selection` — plan-execute-reflect for the lead agent
- `memory-patterns` — shared checkpoint state between agents
- `cost-budget-enforcement` — per-session budgets per sub-agent

## Complete implementation

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const orchestrator = await ReactiveAgents.create()
  .withName("lead-orchestrator")
  .withProvider("anthropic")
  .withReasoning({
    defaultStrategy: "plan-execute-reflect",
    maxIterations: 30,
  })
  .withOrchestration()
  .withAgentTool("researcher", {
    name: "Research Specialist",
    description: "Searches the web for information on a topic and returns key findings with source URLs",
    maxIterations: 15,
    tools: ["web-search", "http-get", "checkpoint"],
  })
  .withAgentTool("writer", {
    name: "Content Writer",
    description: "Writes a well-structured document given research findings. Returns a markdown document.",
    maxIterations: 12,
    tools: ["file-write", "checkpoint"],
  })
  .withAgentTool("reviewer", {
    name: "Quality Reviewer",
    description: "Reviews a document for factual accuracy, completeness, and clarity. Returns pass/fail with specific feedback.",
    maxIterations: 8,
    tools: ["file-read", "checkpoint"],
  })
  .withTools({
    allowedTools: ["researcher", "writer", "reviewer", "checkpoint", "final-answer"],
  })
  .withCostTracking({ perSession: 5.0 })
  .withObservability({ verbosity: "normal" })
  .withSystemPrompt(`
    You coordinate a content production pipeline. Follow this workflow:

    1. Call researcher("Research [topic] thoroughly. Find 3-5 authoritative sources.")
    2. Checkpoint the research findings.
    3. Call writer("Write a comprehensive article about [topic]. Use these findings: [research output]")
    4. Call reviewer("Review this document at [file path]. Check: factual accuracy, completeness, clear structure.")
    5. If reviewer approves: return final-answer with the document path.
    6. If reviewer requests changes: call writer again with the feedback.
    7. Maximum 2 revision cycles before returning the best version.
  `)
  .build();

// Run the full pipeline
const result = await orchestrator.run(
  "Create a comprehensive guide on React Server Components and when to use them"
);

console.log(result.output);
console.log(`Total pipeline cost: $${result.cost?.total.toFixed(4)}`);

await orchestrator.dispose();
```

## Key variations

### Using cheaper models for sub-agents

```ts
.withAgentTool("researcher", {
  name: "Research Specialist",
  description: "...",
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",  // cheaper for research
  maxIterations: 15,
  tools: ["web-search", "http-get"],
})
.withAgentTool("writer", {
  name: "Content Writer",
  description: "...",
  // no model override — inherits orchestrator's model (Sonnet/Opus for quality writing)
  maxIterations: 12,
  tools: ["file-write"],
})
```

### Dynamic sub-agents (runtime spawning)

```ts
// Instead of pre-defined agents, enable the orchestrator to spawn agents as needed:
.withDynamicSubAgents({ maxIterations: 10 })
// The orchestrator can create specialized agents based on the task at hand.
// Use when the set of required specializations isn't known in advance.
```

### Connecting remote agents (separate services)

```ts
// If researcher and writer run as separate services:
.withRemoteAgent("researcher", "http://researcher-service:8001")
.withRemoteAgent("writer", "http://writer-service:8002")
// Each remote agent must expose a .withA2A() interface (see a2a-agent-networking skill)
```

### Parallel sub-agent execution

```ts
// For tasks that don't depend on each other, instruct the orchestrator to batch them:
.withSystemPrompt(`
  When multiple independent research topics are needed, call the researcher
  multiple times. Each call runs a separate research task.
  Synthesize all findings before calling the writer.
`)
// Note: sub-agent calls are sequential by default in the kernel.
// True parallelism requires withDynamicSubAgents() with concurrent dispatching logic.
```

## Expected output shape

```ts
const result = await orchestrator.run("Create an article about...");
// result.output   — path to the written document, or summary of pipeline execution
// result.cost     — combined cost of orchestrator + all sub-agents
// result.steps    — full trace including sub-agent invocations and results
```

## Pitfalls

- Sub-agents run in isolated contexts — they cannot access the orchestrator's conversation history or memory
- Sub-agent results are returned as strings — instruct agents to produce structured output (JSON or markdown) for reliable parsing
- `maxIterations` on sub-agents applies per invocation — a researcher called 3 times can use up to `3 × maxIterations` total
- Total cost = orchestrator cost + sum of all sub-agent costs — set `withCostTracking` budgets that account for the full pipeline
- `.withOrchestration()` must be called alongside `.withAgentTool()` — without it, the orchestration service layer is inactive
