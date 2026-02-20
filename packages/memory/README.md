# @reactive-agents/memory

Memory system for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Four memory types backed by `bun:sqlite` — Working, Semantic, Episodic, and Procedural — with FTS5 full-text search (Tier 1) and optional vector embeddings (Tier 2).

## Installation

```bash
bun add @reactive-agents/memory effect
```

> **Requires Bun** — uses `bun:sqlite` natively.

## Memory Types

| Type | Purpose | Backend |
|------|---------|---------|
| Working | Short-term in-session context | SQLite in-memory |
| Semantic | Long-term knowledge store | SQLite + FTS5 |
| Episodic | Conversation history | SQLite |
| Procedural | Learned workflows | SQLite |

## Tiers

- **Tier 1** — FTS5 full-text search. Fast, no external API needed.
- **Tier 2** — `sqlite-vec` KNN vector search. Requires an embedding provider.

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withMemory("1")   // Tier 1: FTS5
  // .withMemory("2") // Tier 2: vector embeddings
  .build();
```

## Environment Variables (Tier 2 only)

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=sk-...
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts/guides/memory/](https://tylerjrbuell.github.io/reactive-agents-ts/guides/memory/)
