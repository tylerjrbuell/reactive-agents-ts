---
name: memory-patterns
description: SQLite and memory system patterns specific to the @reactive-agents/memory package. Use when working on the memory layer, database operations, FTS5 search, Zettelkasten, or sqlite-vec KNN.
user-invocable: false
---

# Memory System Patterns

## Architecture

```
.reactive-agents/memory/{agentId}/
├── memory.db      ← Source of truth (bun:sqlite, WAL mode)
└── memory.md      ← Human-readable projection (200-line cap, regenerated on flush)
```

SQLite is the source of truth. Markdown files are projections only.

## Four Memory Types

| Type         | Storage                               | Usage                                                   |
| ------------ | ------------------------------------- | ------------------------------------------------------- |
| `semantic`   | SQLite + memory.md                    | Long-term knowledge, bootstrapped at session start      |
| `episodic`   | SQLite                                | Daily logs + session snapshots                          |
| `procedural` | SQLite                                | Learned workflows and patterns                          |
| `working`    | In-process `Ref<WorkingMemoryItem[]>` | Capacity 7, FIFO/LRU/importance eviction, NOT persisted |

## Two Tiers

| Feature       | Tier 1                   | Tier 2                   |
| ------------- | ------------------------ | ------------------------ |
| Factory       | `createMemoryLayer("1")` | `createMemoryLayer("2")` |
| Search        | FTS5 BM25 only           | FTS5 + sqlite-vec KNN    |
| Embeddings    | None                     | Via `LLMService.embed()` |
| External deps | Zero                     | `sqlite-vec` npm package |

## Database Setup (bun:sqlite)

```typescript
import { Database } from "bun:sqlite";

// ─── Database creation with WAL mode ─────────────────────────────
export const MemoryDatabaseLive = Layer.scoped(
  MemoryDatabase,
  Effect.acquireRelease(
    Effect.sync(() => {
      const db = new Database(dbPath, { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA synchronous=NORMAL");
      db.exec("PRAGMA foreign_keys=ON");
      return db;
    }),
    (db) => Effect.sync(() => db.close()),
  ).pipe(
    Effect.map((db) => ({
      query: db.query.bind(db),
      exec: db.exec.bind(db),
      prepare: db.prepare.bind(db),
    })),
  ),
);
```

**Critical rules:**

- ALWAYS use `Effect.sync()` for bun:sqlite operations (they are synchronous)
- ALWAYS enable WAL mode
- ALWAYS use `Layer.scoped` + `Effect.acquireRelease` for DB lifecycle
- NEVER use `Effect.tryPromise` for SQLite (it's not async)

## FTS5 Setup

```sql
-- Create FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS semantic_fts
USING fts5(content, summary, tags, tokenize='porter unicode61');

-- Insert into FTS (must mirror inserts to main table)
INSERT INTO semantic_fts(rowid, content, summary, tags) VALUES (?, ?, ?, ?);

-- Search with BM25 ranking
SELECT rowid, rank FROM semantic_fts
WHERE semantic_fts MATCH ?
ORDER BY rank
LIMIT ?;
```

## sqlite-vec KNN (Tier 2 Only)

```sql
-- Create vec0 virtual table (Tier 2)
CREATE VIRTUAL TABLE IF NOT EXISTS semantic_vec
USING vec0(embedding float[1536]);

-- Insert vector
INSERT INTO semantic_vec(rowid, embedding) VALUES (?, ?);

-- KNN search
SELECT rowid, distance FROM semantic_vec
WHERE embedding MATCH ?
ORDER BY distance
LIMIT ?;
```

**Tier 2 rules:**

- Embeddings come ONLY from `LLMService.embed()` — never from an independent embedding service
- `sqlite-vec` is an optional npm dependency
- Vector dimensions MUST match `EmbeddingConfig.dimensions` (default: 1536)
- `createMemoryLayer("2")` requires `LLMService` in the layer context

## Working Memory (Ref-based)

```typescript
export const WorkingMemoryServiceLive = Layer.effect(
  WorkingMemoryService,
  Effect.gen(function* () {
    const items = yield* Ref.make<readonly WorkingMemoryItem[]>([]);
    const capacity = 7; // Miller's number

    return {
      add: (item) =>
        Ref.update(items, (current) => {
          const updated = [...current, item];
          // Evict oldest if over capacity
          return updated.length > capacity ? updated.slice(-capacity) : updated;
        }),
      get: () => Ref.get(items),
      clear: () => Ref.set(items, []),
      size: () => Ref.get(items).pipe(Effect.map((i) => i.length)),
    };
  }),
);
```

## Memory Service Lifecycle

```
bootstrap(agentId) → loads memory.md into working memory
                   → rehydrates semantic index from SQLite
                   → returns MemoryBootstrapResult

flush()            → persists working memory to appropriate stores
                   → regenerates memory.md from SQLite
                   → runs compaction if needed

snapshot()         → creates episodic session snapshot
                   → saves to SQLite episodic table
```

## Zettelkasten (Link Graph)

```sql
-- Stored in SQLite, NOT a separate system
CREATE TABLE IF NOT EXISTS zettel_links (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,  -- "relates-to", "contradicts", "supports", "extends"
  strength REAL DEFAULT 1.0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (source_id, target_id, relation),
  FOREIGN KEY (source_id) REFERENCES semantic_entries(id),
  FOREIGN KEY (target_id) REFERENCES semantic_entries(id)
);
```

Zettelkasten is included in Tier 1 (Phase 1). It uses FTS5 for similarity, not embeddings.

## Common Memory Mistakes

1. **Using LanceDB** — removed. Use bun:sqlite only.
2. **Using `EmbeddingProvider` service** — removed. Use `LLMService.embed()` only.
3. **Using Nomic API** — removed. Use OpenAI or Ollama for embeddings.
4. **Making memory.md the source of truth** — wrong. SQLite is source of truth.
5. **Using `Effect.tryPromise` for SQLite** — wrong. bun:sqlite is synchronous, use `Effect.sync`.
6. **Calling `embed()` in Tier 1** — wrong. Tier 1 has no embeddings.
7. **Creating separate embedding service** — wrong. `LLMService.embed()` is the sole source.
