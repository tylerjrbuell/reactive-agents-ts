---
title: Memory
description: How agent memory works in Reactive Agents.
---

Reactive Agents provides a four-tier memory architecture inspired by cognitive science.

## Memory Types

### Working Memory

Short-term, capacity-limited (default 7 items). Automatically evicts based on FIFO or importance policy.

```typescript
// Items are automatically managed during agent execution.
// Working memory holds the current conversation context,
// recent tool results, and active reasoning state.
```

### Semantic Memory

Long-term factual knowledge stored in SQLite with FTS5 full-text search.

```typescript
// Semantic entries have importance scores, access counts,
// and support Zettelkasten-style linking between concepts.
```

### Episodic Memory

Event log of agent actions and experiences. Supports session snapshots for conversation continuity.

### Procedural Memory

Stored workflows and learned procedures with success rate tracking. Agents improve their strategies over time.

## Memory Tiers

| Tier | Storage | Search | Use Case |
|------|---------|--------|----------|
| **1** | bun:sqlite WAL | FTS5 full-text | Most applications |
| **2** | bun:sqlite WAL + sqlite-vec | FTS5 + KNN vector | Semantic similarity |

### Tier 1 (Default)

```typescript
const agent = await ReactiveAgents.create()
  .withMemory("1")  // FTS5 search, no embeddings needed
  .build();
```

### Tier 2 (Vector Search)

Requires an embedding provider:

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
```

```typescript
const agent = await ReactiveAgents.create()
  .withMemory("2")  // FTS5 + KNN vector search
  .build();
```

## Memory Bootstrap

At the start of each task, the memory layer bootstraps context:

1. Loads recent semantic entries for the agent
2. Retrieves the last session snapshot
3. Generates a markdown projection of relevant knowledge
4. Injects this into the agent's system prompt

This gives agents continuity across conversations without explicit context management.

## ExperienceStore — Cross-Agent Learning

The ExperienceStore records tool usage patterns and error recovery hints across all runs, then injects relevant tips at bootstrap time. This lets agents benefit from what previous agents (or previous runs of the same agent) learned.

### Enabling

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMemory({ tier: "1", dbPath: "./memory-db" })
  .withExperienceLearning()   // Enable ExperienceStore
  .withReasoning()
  .withTools()
  .build();
```

### How It Works

1. **After each task**, the execution engine records: which tools were used, whether the run succeeded, step count, and token count — keyed by `(taskType, toolPattern)`.
2. **At the next bootstrap**, patterns with ≥ 2 occurrences and ≥ 50% success rate are loaded and converted to natural-language tips injected into the agent's context.
3. **Error recoveries** are tracked separately: when a tool fails and the agent recovers, the recovery strategy is stored and suggested on future similar errors.

```
◉ [experience]  1 tip(s) from prior runs
```

The tip in context looks like:

```
For query tasks, use [file-write] — 100% success rate over 3 runs (avg 4 steps, 1,190 tokens)
```

### What Gets Recorded

| Field | Description |
|-------|-------------|
| Tool pattern | Ordered unique list of tools called in the run |
| Success / failure | Whether the task completed without errors |
| Avg steps | Running average across all occurrences |
| Avg tokens | Running average token usage |
| Error recoveries | `(tool, errorPattern) → recovery` mappings |

### Inspecting the Database

Experience is stored in the same SQLite database as memory:

```bash
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('./memory-db');
const patterns = db.query('SELECT * FROM experience_tool_patterns').all();
console.log(patterns);
"
```

## MemoryConsolidatorService — Background Memory Intelligence

The MemoryConsolidatorService runs background maintenance cycles on episodic memory: decaying stale entries, pruning noise, and replaying recent experience for potential semantic promotion.

### Enabling

```typescript
const agent = await ReactiveAgents.create()
  .withMemory({ tier: "1", dbPath: "./memory-db" })
  .withMemoryConsolidation({
    threshold: 10,       // Trigger consolidation after 10 new episodic entries
    decayFactor: 0.95,   // Multiply importance × 0.95 each cycle
    pruneThreshold: 0.1, // Remove entries with importance < 0.1
  })
  .build();
```

All config fields are optional — defaults are `threshold: 10`, `decayFactor: 0.95`, `pruneThreshold: 0.1`.

### Consolidation Cycle

Each cycle runs two phases:

1. **COMPRESS** — All episodic entries have their `importance` multiplied by `decayFactor`. Entries that fall below `pruneThreshold` are deleted, keeping the episodic log focused on recent, high-signal events.
2. **REPLAY** — Counts episodic entries added since the last consolidation run. This count can drive future LLM-based semantic extraction (connecting episodic → semantic memory).

The cycle is triggered automatically when the agent has accumulated `threshold` new episodic entries since the last run. You can also trigger it manually via the Effect API:

```typescript
import { MemoryConsolidatorService } from "@reactive-agents/memory";
import { Effect } from "effect";

// Trigger a consolidation cycle for a specific agent
yield* MemoryConsolidatorService.consolidate("my-agent-id");
```
