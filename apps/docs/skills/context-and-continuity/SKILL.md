---
name: context-and-continuity
description: Manage context pressure, configure message windowing, and use checkpoint tools to preserve critical findings across context compaction.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Context and Continuity

## Agent objective

Produce an agent that survives long tasks without losing key findings — correct windowing configuration, explicit checkpoint tool usage, and cross-session memory where needed.

## When to load this skill

- Task is long-running (10+ iterations expected)
- Agent must preserve intermediate results across context pressure events
- Agent needs to resume work across sessions
- Task involves accumulating findings that must survive to the final answer

## Implementation baseline

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 20 })
  .withTools({
    allowedTools: ["web-search", "file-read", "checkpoint", "recall", "find"],
  })
  .withMemory({ tier: "enhanced", dbPath: "./agent.db" })
  .withSystemPrompt(`
    You are a research assistant.
    Use the checkpoint tool to save key findings before moving on.
    Call checkpoint() with no args to review what you've saved.
  `)
  .build();
```

## Key patterns

### Using the checkpoint tool

The `checkpoint` tool has three modes:

```ts
// SAVE — persist a named finding
checkpoint("api-endpoints", "Found: /users, /orders, /products at base URL https://api.example.com")

// RETRIEVE — get a saved finding by name
checkpoint("api-endpoints")

// LIST — show all saved checkpoints
checkpoint()
```

Instruct the agent explicitly in the system prompt:

```ts
.withSystemPrompt(`
  After each major discovery, call checkpoint(label, content) to save it.
  Before writing your final answer, call checkpoint() to review all saved findings.
  Never rely on context alone for facts you found more than 3 steps ago.
`)
```

### Context pressure thresholds

The kernel auto-checkpoints and applies message windowing based on token utilization:

| Tier | Hard gate | Auto-checkpoint fires at |
|------|-----------|--------------------------|
| `local` | 80% | 75% |
| `mid` | 85% | 80% |
| `large` | 90% | 85% |
| `frontier` | 95% | 90% |

Auto-checkpoint captures successful non-meta tool observations. It is a safety net — **explicit checkpoints for structured findings are better**.

### Cross-session memory with `.withMemory()`

```ts
// Within-session only (default)
.withTools({ allowedTools: ["checkpoint"] })

// Cross-session persistence — findings survive agent restarts
.withMemory({ tier: "enhanced", dbPath: "./research-memory.db" })
.withTools({ allowedTools: ["checkpoint", "recall", "find"] })
// recall — semantic search over past episodic memory
// find — exact lookup by memory key
```

### Reducing context pressure on long tasks

```ts
// Lower maxIterations forces tighter reasoning loops
.withReasoning({ defaultStrategy: "adaptive", maxIterations: 12 })

// Use plan-execute-reflect to front-load planning and avoid re-exploring
.withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 15 })
```

## Builder API reference

| Method | Key params | Notes |
|--------|-----------|-------|
| `.withTools({ allowedTools })` | include `"checkpoint"`, `"recall"`, `"find"` | Checkpoint is a built-in meta-tool |
| `.withMemory(opts?)` | `{ tier: "enhanced", dbPath }` | Episodic + semantic memory persist across sessions |
| `.withReasoning({ maxIterations })` | number | Lower = tighter loops = less context pressure |
| `.withSystemPrompt(s)` | string | Instruct agent to use checkpoint tool proactively |

## Pitfalls

- Auto-checkpoint captures tool observations only — it won't save the agent's reasoning or intermediate conclusions; use explicit `checkpoint(label, content)` for those
- Checkpoint labels must be unique within a session — reusing a label overwrites the previous value
- `.withMemory({ tier: "enhanced" })` without `dbPath` uses a default path; set explicitly in multi-agent environments to prevent collisions
- `recall` and `find` tools require `.withMemory()` — enabling them without memory configured is a no-op
- Context windowing is automatic; you cannot configure the window size directly — control pressure through iteration budget and explicit checkpointing instead
