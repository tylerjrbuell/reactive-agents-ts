---
name: memory-patterns
description: Configure the 4-layer memory system with SQLite/FTS5/vec storage for persistent agent knowledge that survives sessions.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Memory Patterns

## Agent objective

Produce a builder with the right memory tier, database path, and tool configuration so the agent retains and retrieves knowledge correctly across interactions and sessions.

## When to load this skill

- Agent needs to remember facts across multiple `agent.run()` calls
- Agent accumulates knowledge over time (research, learning, preference tracking)
- Building a conversational agent with multi-turn context
- Agent must search past observations semantically (`recall`) or by key (`find`)

## Implementation baseline

```ts
// Standard (in-memory only — lost on restart)
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({ allowedTools: ["checkpoint", "recall"] })
  .withMemory()   // "standard" tier — working + semantic, in-memory
  .build();

// Enhanced (SQLite persistence — survives restarts)
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive" })
  .withTools({ allowedTools: ["checkpoint", "recall", "find"] })
  .withMemory({ tier: "enhanced", dbPath: "./agent-memory.db" })
  .build();
```

## 4-layer memory architecture

| Layer | Purpose | Storage | Tier required |
|-------|---------|---------|---------------|
| **Working** | Current task context, active reasoning | In-memory | `"standard"` |
| **Semantic** | Factual knowledge, SQLite + FTS5 full-text | SQLite | `"standard"` |
| **Episodic** | Past interactions, timestamped experience log | SQLite | `"enhanced"` |
| **Procedural** | Learned behaviors, skill patterns | SQLite | `"enhanced"` |

## Key patterns

### Memory tiers

```ts
// Standard — working + semantic, in-memory (fast, no persistence)
.withMemory()
.withMemory("standard")

// Enhanced — all 4 layers, SQLite persistence
.withMemory("enhanced")
.withMemory({ tier: "enhanced", dbPath: "./data/agent.db" })
.withMemory({ tier: "enhanced", dbPath: "./data/agent.db", capacity: 24 })
// capacity: max working memory entries (default varies)
```

### Memory tools

```ts
// recall — semantic search over episodic + semantic memory
.withTools({ allowedTools: ["recall", "find", "checkpoint"] })

// In system prompt: guide the agent to use memory tools
.withSystemPrompt(`
  Before answering questions about past work, use recall("topic keywords").
  After completing a task, checkpoint the key findings.
`)
```

### Combining memory with RAG documents

```ts
.withDocuments([
  { id: "docs-1", content: "Product documentation...", metadata: { source: "docs" } },
  { id: "policy-1", content: "Company policy...", metadata: { source: "policy" } },
])
.withMemory({ tier: "enhanced", dbPath: "./agent.db" })
.withTools({ allowedTools: ["find", "recall", "checkpoint"] })
// find: searches over .withDocuments() content (rag-search was removed — use find)
// recall: searches over past agent interactions in memory
```

### Multi-agent memory isolation

```ts
// Give each agent a separate DB to prevent cross-contamination
const researchAgent = await ReactiveAgents.create()
  .withMemory({ tier: "enhanced", dbPath: "./memory/researcher.db" })
  .build();

const writerAgent = await ReactiveAgents.create()
  .withMemory({ tier: "enhanced", dbPath: "./memory/writer.db" })
  .build();
```

## Builder API reference

| Method | Key params | Notes |
|--------|-----------|-------|
| `.withMemory(opts?)` | `"standard"\|"enhanced"\|{ tier, dbPath?, capacity? }` | No args = `"standard"` |
| `.withDocuments(docs)` | `DocumentSpec[]` | RAG context — pairs with `find` tool |
| `.withExperienceLearning()` | — | Injects prior-run experience tips from episodic memory |

## Pitfalls

- `"1"` and `"2"` are **deprecated** tier names — use `"standard"` and `"enhanced"`
- `"enhanced"` without `dbPath` uses a default path — always set `dbPath` explicitly in multi-agent environments to prevent collisions
- `recall` requires `.withMemory()` — silently returns empty results without it
- `find` routes across multiple sources: `scope: "documents"` needs `.withDocuments()`, `scope: "memory"` needs `.withMemory()`, `scope: "web"` needs web-search enabled, `scope: "auto"` (default) tries documents first, falls back to web
- SQLite requires a writable filesystem path — check permissions before deployment
- `capacity` too low causes premature eviction of working memory; keep at 12–24 for long tasks
- `.withExperienceLearning()` requires `.withMemory({ tier: "enhanced" })` — without it, no experience is persisted to inject
