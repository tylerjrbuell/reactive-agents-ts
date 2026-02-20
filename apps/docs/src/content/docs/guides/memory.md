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
