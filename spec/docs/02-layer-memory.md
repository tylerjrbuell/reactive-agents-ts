# Layer 2: Memory System - AI Agent Implementation Spec

## Overview

SQLite-first memory system with four memory types: Working (in-process Ref, capacity 7), Semantic
(long-term markdown + SQLite), Episodic (daily logs + session snapshots), and Procedural (learned
workflows). Built on `bun:sqlite` (built-in, zero deps) with optional `sqlite-vec` for vector KNN
search. Markdown files are human-readable projections of SQLite — **not** the source of truth.

**Package:** `@reactive-agents/memory`
**Dependencies:** `@reactive-agents/core`, `@reactive-agents/llm-provider` (optional, for
extraction/consolidation), `effect@^3.10`, `sqlite-vec` (optional, Tier 2 only)
**Phase:** 1B (Weeks 2-3)

---

## Two-Tier Architecture

| Feature         | Tier 1 (Zero Deps)       | Tier 2 (Full)                      |
| --------------- | ------------------------ | ---------------------------------- |
| Storage         | bun:sqlite + FTS5        | bun:sqlite + FTS5 + sqlite-vec     |
| Semantic search | Full-text search (FTS5)  | FTS5 + KNN vector search (vec0)    |
| Embeddings      | None (text-only)         | Via `LLMService.embed()` from L1.5 |
| External deps   | Zero (bun built-in)      | `sqlite-vec` native module         |
| Factory         | `createMemoryLayer("1")` | `createMemoryLayer("2")`           |
| Performance     | < 2ms bootstrap          | < 5ms bootstrap                    |

**Important:** `bun:sqlite` is built into Bun — no package install needed. `EmbeddingProvider`
(old Nomic service) is **removed**. Embeddings go through `LLMService.embed()`.

---

## Package Structure

```
@reactive-agents/memory/
├── src/
│   ├── index.ts                            # Public API re-exports
│   ├── types.ts                            # All Schema types
│   ├── errors.ts                           # All Data.TaggedError definitions
│   ├── database.ts                         # MemoryDatabase (bun:sqlite setup, migrations, WAL)
│   ├── search.ts                           # MemorySearchService (FTS5 + optional vec0 KNN)
│   ├── services/
│   │   ├── working-memory.ts               # WorkingMemoryService (Ref, capacity 7)
│   │   ├── semantic-memory.ts              # SemanticMemoryService (SQLite + markdown)
│   │   ├── episodic-memory.ts              # EpisodicMemoryService (daily logs + snapshots)
│   │   ├── procedural-memory.ts            # ProceduralMemoryService (workflows + patterns)
│   │   └── memory-service.ts               # MemoryService orchestrator
│   ├── fs/
│   │   └── memory-file-system.ts           # MemoryFileSystem (markdown export/import)
│   ├── compaction/
│   │   └── compaction-service.ts           # CompactionService (4 strategies)
│   ├── extraction/
│   │   ├── memory-extractor.ts             # MemoryExtractor (LLM-driven, optional)
│   │   └── memory-consolidator.ts          # MemoryConsolidator (merge/decay/promote)
│   ├── indexing/
│   │   └── zettelkasten.ts                 # ZettelkastenService (link graph in SQLite)
│   └── runtime.ts                          # createMemoryLayer("1"|"2") factory
├── tests/
│   ├── database.test.ts
│   ├── working-memory.test.ts
│   ├── semantic-memory.test.ts
│   ├── episodic-memory.test.ts
│   ├── procedural-memory.test.ts
│   ├── search.test.ts
│   ├── zettelkasten.test.ts
│   └── memory-service.test.ts
├── package.json
└── tsconfig.json
```

---

## File Layout on Disk

```
.reactive-agents/
└── memory/
    └── {agentId}/
        ├── memory.db          # Single SQLite file (WAL mode) — source of truth
        └── memory.md          # Human-readable projection (200-line cap, regenerated on flush)
```

---

## Build Order

1. `src/types.ts` — All Schema types (MemoryEntry, SemanticEntry, DailyLogEntry, SessionSnapshot,
   ProceduralEntry, ZettelLink, CompactionConfig, SearchOptions, MemoryBootstrapResult)
2. `src/errors.ts` — All TaggedErrors
3. `src/database.ts` — MemoryDatabase service (bun:sqlite setup, schema migrations, WAL mode)
4. `src/search.ts` — MemorySearchService (FTS5 queries + optional sqlite-vec KNN)
5. `src/services/working-memory.ts` — WorkingMemoryService (Ref, capacity 7, FIFO/LRU/importance)
6. `src/services/semantic-memory.ts` — SemanticMemoryService (SQLite read/write/consolidate)
7. `src/services/episodic-memory.ts` — EpisodicMemoryService (daily logs + session snapshots)
8. `src/services/procedural-memory.ts` — ProceduralMemoryService (workflows + patterns)
9. `src/fs/memory-file-system.ts` — MemoryFileSystem (markdown export/import via node:fs)
10. `src/compaction/compaction-service.ts` — CompactionService (4 strategies)
11. `src/extraction/memory-extractor.ts` — MemoryExtractor (LLM-driven, optional dep on LLMService)
12. `src/extraction/memory-consolidator.ts` — MemoryConsolidator (merge/decay/promote cycles)
13. `src/indexing/zettelkasten.ts` — ZettelkastenService (link graph in SQLite, FTS5 + optional vec0)
14. `src/services/memory-service.ts` — MemoryService orchestrator (bootstrap, flush, snapshot)
15. `src/runtime.ts` — createMemoryLayer(tier: "1" | "2") factory function
16. `src/index.ts` — Public re-exports
17. Tests for each module

---

## Core Types & Schemas

### File: `src/types.ts`

```typescript
import { Schema } from "effect";

// ─── Memory ID (branded string) ───

export const MemoryId = Schema.String.pipe(Schema.brand("MemoryId"));
export type MemoryId = typeof MemoryId.Type;

// ─── Memory Type (4 types) ───

export const MemoryType = Schema.Literal(
  "semantic", // Always-loaded markdown summary + SQLite long-term store
  "episodic", // Daily logs + session snapshots
  "procedural", // Learned workflows and patterns
  "working", // In-process Ref, capacity 7, not persisted to SQLite
);
export type MemoryType = typeof MemoryType.Type;

// ─── Memory Source ───

export const MemorySourceSchema = Schema.Struct({
  type: Schema.Literal("agent", "user", "tool", "system", "llm-extraction"),
  id: Schema.String,
  taskId: Schema.optional(Schema.String),
});
export type MemorySource = typeof MemorySourceSchema.Type;

// ─── Base Memory Entry ───

export const MemoryEntrySchema = Schema.Struct({
  id: MemoryId,
  agentId: Schema.String,
  type: MemoryType,
  content: Schema.String,
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  source: MemorySourceSchema,
  tags: Schema.Array(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type MemoryEntry = typeof MemoryEntrySchema.Type;

// ─── Semantic Memory Entry (long-term knowledge) ───

export const SemanticEntrySchema = Schema.Struct({
  id: MemoryId,
  agentId: Schema.String,
  content: Schema.String,
  summary: Schema.String, // Compressed for memory.md projection
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  verified: Schema.Boolean,
  tags: Schema.Array(Schema.String),
  embedding: Schema.optional(Schema.Array(Schema.Number)), // Tier 2 only
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  accessCount: Schema.Number, // For LRU/importance-based eviction
  lastAccessedAt: Schema.DateFromSelf,
});
export type SemanticEntry = typeof SemanticEntrySchema.Type;

// ─── Daily Log Entry (episodic) ───

export const DailyLogEntrySchema = Schema.Struct({
  id: MemoryId,
  agentId: Schema.String,
  date: Schema.String, // ISO date string (YYYY-MM-DD)
  content: Schema.String,
  taskId: Schema.optional(Schema.String),
  eventType: Schema.Literal(
    "task-started",
    "task-completed",
    "task-failed",
    "decision-made",
    "error-encountered",
    "user-feedback",
    "tool-call",
    "observation",
  ),
  cost: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  createdAt: Schema.DateFromSelf,
});
export type DailyLogEntry = typeof DailyLogEntrySchema.Type;

// ─── Session Snapshot (episodic) ───

export const SessionSnapshotSchema = Schema.Struct({
  id: Schema.String, // session ID
  agentId: Schema.String,
  messages: Schema.Array(Schema.Unknown), // LLMMessage[] (serialized)
  summary: Schema.String,
  keyDecisions: Schema.Array(Schema.String),
  taskIds: Schema.Array(Schema.String),
  startedAt: Schema.DateFromSelf,
  endedAt: Schema.DateFromSelf,
  totalCost: Schema.Number,
  totalTokens: Schema.Number,
});
export type SessionSnapshot = typeof SessionSnapshotSchema.Type;

// ─── Procedural Entry (learned workflows) ───

export const ProceduralEntrySchema = Schema.Struct({
  id: MemoryId,
  agentId: Schema.String,
  name: Schema.String,
  description: Schema.String,
  pattern: Schema.String, // JSON-encoded steps or template
  successRate: Schema.Number.pipe(Schema.between(0, 1)),
  useCount: Schema.Number,
  tags: Schema.Array(Schema.String),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});
export type ProceduralEntry = typeof ProceduralEntrySchema.Type;

// ─── Working Memory Item (in-process only) ───

export const WorkingMemoryItemSchema = Schema.Struct({
  id: MemoryId,
  content: Schema.String,
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  addedAt: Schema.DateFromSelf,
  source: MemorySourceSchema,
});
export type WorkingMemoryItem = typeof WorkingMemoryItemSchema.Type;

// ─── Zettelkasten Link ───

export const LinkType = Schema.Literal(
  "similar",
  "sequential",
  "causal",
  "contradicts",
  "supports",
  "elaborates",
);
export type LinkType = typeof LinkType.Type;

export const ZettelLinkSchema = Schema.Struct({
  source: MemoryId,
  target: MemoryId,
  strength: Schema.Number.pipe(Schema.between(0, 1)),
  type: LinkType,
  createdAt: Schema.DateFromSelf,
});
export type ZettelLink = typeof ZettelLinkSchema.Type;

// ─── Compaction Config ───

export const CompactionStrategySchema = Schema.Literal(
  "count", // Compact when entry count exceeds threshold
  "time", // Compact on schedule (daily/weekly)
  "semantic", // Compact when semantic similarity is high (merge near-duplicates)
  "progressive", // Progressive: count → time → semantic → decay
);
export type CompactionStrategy = typeof CompactionStrategySchema.Type;

export const CompactionConfigSchema = Schema.Struct({
  strategy: CompactionStrategySchema,
  maxEntries: Schema.optional(Schema.Number), // For "count" strategy
  intervalMs: Schema.optional(Schema.Number), // For "time" strategy
  similarityThreshold: Schema.optional(Schema.Number), // For "semantic"
  decayFactor: Schema.optional(Schema.Number), // For "progressive" decay
});
export type CompactionConfig = typeof CompactionConfigSchema.Type;

// ─── Search Options ───

export const SearchOptionsSchema = Schema.Struct({
  query: Schema.String,
  types: Schema.optional(Schema.Array(MemoryType)),
  limit: Schema.optional(Schema.Number),
  threshold: Schema.optional(Schema.Number), // Relevance threshold (0-1)
  useVector: Schema.optional(Schema.Boolean), // Tier 2 only
  agentId: Schema.String,
});
export type SearchOptions = typeof SearchOptionsSchema.Type;

// ─── Memory Bootstrap Result (returned by MemoryService.bootstrap()) ───

export const MemoryBootstrapResultSchema = Schema.Struct({
  agentId: Schema.String,
  semanticContext: Schema.String, // Contents of memory.md
  recentEpisodes: Schema.Array(DailyLogEntrySchema),
  activeWorkflows: Schema.Array(ProceduralEntrySchema),
  workingMemory: Schema.Array(WorkingMemoryItemSchema),
  bootstrappedAt: Schema.DateFromSelf,
  tier: Schema.Literal("1", "2"),
});
export type MemoryBootstrapResult = typeof MemoryBootstrapResultSchema.Type;

// ─── Eviction Policy ───

export const EvictionPolicy = Schema.Literal("fifo", "lru", "importance");
export type EvictionPolicy = typeof EvictionPolicy.Type;

// ─── Memory Config ───

export const MemoryConfigSchema = Schema.Struct({
  tier: Schema.Literal("1", "2"),
  agentId: Schema.String,
  dbPath: Schema.String, // .reactive-agents/memory/{agentId}/memory.db
  working: Schema.Struct({
    capacity: Schema.Number,
    evictionPolicy: EvictionPolicy,
  }),
  semantic: Schema.Struct({
    maxMarkdownLines: Schema.Number, // default: 200
    importanceThreshold: Schema.Number, // default: 0.7
  }),
  episodic: Schema.Struct({
    retainDays: Schema.Number, // default: 30
    maxSnapshotsPerSession: Schema.Number, // default: 3
  }),
  compaction: CompactionConfigSchema,
  zettelkasten: Schema.Struct({
    enabled: Schema.Boolean,
    linkingThreshold: Schema.Number.pipe(Schema.between(0, 1)),
    maxLinksPerEntry: Schema.Number,
  }),
});
export type MemoryConfig = typeof MemoryConfigSchema.Type;

export const defaultMemoryConfig = (agentId: string): MemoryConfig => ({
  tier: "1",
  agentId,
  dbPath: `.reactive-agents/memory/${agentId}/memory.db`,
  working: { capacity: 7, evictionPolicy: "fifo" },
  semantic: { maxMarkdownLines: 200, importanceThreshold: 0.7 },
  episodic: { retainDays: 30, maxSnapshotsPerSession: 3 },
  compaction: {
    strategy: "progressive",
    maxEntries: 1000,
    intervalMs: 86_400_000, // 24 hours
    similarityThreshold: 0.92,
    decayFactor: 0.05,
  },
  zettelkasten: {
    enabled: true,
    linkingThreshold: 0.85,
    maxLinksPerEntry: 10,
  },
});
```

---

## Error Types

### File: `src/errors.ts`

```typescript
import { Data } from "effect";

export class MemoryError extends Data.TaggedError("MemoryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class MemoryNotFoundError extends Data.TaggedError(
  "MemoryNotFoundError",
)<{
  readonly memoryId: string;
  readonly message: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly operation: "read" | "write" | "delete" | "search" | "migrate";
  readonly cause?: unknown;
}> {}

export class CapacityExceededError extends Data.TaggedError(
  "CapacityExceededError",
)<{
  readonly message: string;
  readonly capacity: number;
  readonly current: number;
}> {}

export class ContextError extends Data.TaggedError("ContextError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CompactionError extends Data.TaggedError("CompactionError")<{
  readonly message: string;
  readonly strategy: string;
  readonly cause?: unknown;
}> {}
```

---

## Database Layer

### File: `src/database.ts`

```typescript
import { Effect, Context, Layer } from "effect";
import { Database } from "bun:sqlite";
import { DatabaseError } from "./errors.js";
import type { MemoryConfig } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Service Tag ───

export class MemoryDatabase extends Context.Tag("MemoryDatabase")<
  MemoryDatabase,
  {
    /** Execute a query with parameters. Returns rows. */
    readonly query: <T = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => Effect.Effect<T[], DatabaseError>;

    /** Execute a statement (INSERT/UPDATE/DELETE). Returns changes count. */
    readonly exec: (
      sql: string,
      params?: readonly unknown[],
    ) => Effect.Effect<number, DatabaseError>;

    /** Execute multiple statements in a transaction. */
    readonly transaction: <T>(
      fn: (db: MemoryDatabase["Type"]) => Effect.Effect<T, DatabaseError>,
    ) => Effect.Effect<T, DatabaseError>;

    /** Close the database connection. */
    readonly close: () => Effect.Effect<void, never>;
  }
>() {}

// ─── Schema SQL ───

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS semantic_memory (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    content     TEXT NOT NULL,
    summary     TEXT NOT NULL,
    importance  REAL NOT NULL DEFAULT 0.5,
    verified    INTEGER NOT NULL DEFAULT 0,
    tags        TEXT NOT NULL DEFAULT '[]',   -- JSON array
    embedding   BLOB,                         -- Float32Array (Tier 2 only)
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS episodic_log (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    date        TEXT NOT NULL,               -- YYYY-MM-DD
    content     TEXT NOT NULL,
    task_id     TEXT,
    event_type  TEXT NOT NULL,
    cost        REAL,
    duration    REAL,
    metadata    TEXT DEFAULT '{}',           -- JSON object
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_snapshots (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    messages    TEXT NOT NULL,               -- JSON array of LLMMessages
    summary     TEXT NOT NULL,
    key_decisions TEXT NOT NULL DEFAULT '[]',-- JSON array
    task_ids    TEXT NOT NULL DEFAULT '[]',  -- JSON array
    started_at  TEXT NOT NULL,
    ended_at    TEXT NOT NULL,
    total_cost  REAL NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS procedural_memory (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    pattern     TEXT NOT NULL,              -- JSON-encoded workflow steps
    success_rate REAL NOT NULL DEFAULT 0,
    use_count   INTEGER NOT NULL DEFAULT 0,
    tags        TEXT NOT NULL DEFAULT '[]', -- JSON array
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS zettel_links (
    source_id   TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    strength    REAL NOT NULL DEFAULT 0,
    type        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id)
  );

  -- FTS5 virtual table for full-text search (Tier 1 semantic search)
  CREATE VIRTUAL TABLE IF NOT EXISTS semantic_fts USING fts5(
    id UNINDEXED,
    content,
    tags,
    content='semantic_memory',
    content_rowid='rowid'
  );

  -- FTS5 for episodic log
  CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
    id UNINDEXED,
    content,
    content='episodic_log',
    content_rowid='rowid'
  );

  -- Triggers to keep FTS5 in sync
  CREATE TRIGGER IF NOT EXISTS semantic_fts_insert
    AFTER INSERT ON semantic_memory BEGIN
      INSERT INTO semantic_fts(rowid, id, content, tags)
      VALUES (new.rowid, new.id, new.content, new.tags);
    END;

  CREATE TRIGGER IF NOT EXISTS semantic_fts_delete
    AFTER DELETE ON semantic_memory BEGIN
      INSERT INTO semantic_fts(semantic_fts, rowid, id, content, tags)
      VALUES ('delete', old.rowid, old.id, old.content, old.tags);
    END;

  CREATE TRIGGER IF NOT EXISTS semantic_fts_update
    AFTER UPDATE ON semantic_memory BEGIN
      INSERT INTO semantic_fts(semantic_fts, rowid, id, content, tags)
      VALUES ('delete', old.rowid, old.id, old.content, old.tags);
      INSERT INTO semantic_fts(rowid, id, content, tags)
      VALUES (new.rowid, new.id, new.content, new.tags);
    END;
`;

// ─── Live Implementation ───

export const MemoryDatabaseLive = (config: MemoryConfig) =>
  Layer.scoped(
    MemoryDatabase,
    Effect.gen(function* () {
      // Ensure directory exists
      const dbDir = path.dirname(config.dbPath);
      yield* Effect.sync(() => {
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
      });

      // Open SQLite connection
      const db = yield* Effect.try({
        try: () => new Database(config.dbPath, { create: true }),
        catch: (e) =>
          new DatabaseError({
            message: `Failed to open database: ${e}`,
            operation: "migrate",
            cause: e,
          }),
      });

      // Run schema migrations
      yield* Effect.try({
        try: () => db.exec(SCHEMA_SQL),
        catch: (e) =>
          new DatabaseError({
            message: `Schema migration failed: ${e}`,
            operation: "migrate",
            cause: e,
          }),
      });

      // Register finalizer to close DB cleanly
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          try {
            db.close();
          } catch {
            /* ignore */
          }
        }),
      );

      const service: MemoryDatabase["Type"] = {
        query: <T>(sql: string, params: readonly unknown[] = []) =>
          Effect.try({
            try: () => {
              const stmt = db.prepare(sql);
              return stmt.all(...params) as T[];
            },
            catch: (e) =>
              new DatabaseError({
                message: `Query failed: ${e}\nSQL: ${sql}`,
                operation: "read",
                cause: e,
              }),
          }),

        exec: (sql, params = []) =>
          Effect.try({
            try: () => {
              const stmt = db.prepare(sql);
              const result = stmt.run(...params);
              return result.changes;
            },
            catch: (e) =>
              new DatabaseError({
                message: `Exec failed: ${e}\nSQL: ${sql}`,
                operation: "write",
                cause: e,
              }),
          }),

        transaction: (fn) =>
          Effect.gen(function* () {
            // Wrap fn in SQLite transaction
            let result: unknown;
            yield* Effect.try({
              try: () => {
                const txn = db.transaction(() => {
                  // Run the effect synchronously via runSync
                  // Note: fn must use only sync-safe Effects within transaction
                  result = Effect.runSync(fn(service));
                });
                txn();
              },
              catch: (e) =>
                new DatabaseError({
                  message: `Transaction failed: ${e}`,
                  operation: "write",
                  cause: e,
                }),
            });
            return result as Awaited<typeof result>;
          }),

        close: () =>
          Effect.sync(() => {
            try {
              db.close();
            } catch {
              /* ignore */
            }
          }),
      };

      return service;
    }),
  );
```

---

## Search Service

### File: `src/search.ts`

```typescript
import { Effect, Context, Layer } from "effect";
import { MemoryDatabase } from "./database.js";
import type { SearchOptions, SemanticEntry, DailyLogEntry } from "./types.js";
import { DatabaseError } from "./errors.js";

// ─── Service Tag ───

export class MemorySearchService extends Context.Tag("MemorySearchService")<
  MemorySearchService,
  {
    /** Full-text search across semantic memory (FTS5). Tier 1 + 2. */
    readonly searchSemantic: (
      options: SearchOptions,
    ) => Effect.Effect<SemanticEntry[], DatabaseError>;

    /** Full-text search across episodic log (FTS5). Tier 1 + 2. */
    readonly searchEpisodic: (
      options: SearchOptions,
    ) => Effect.Effect<DailyLogEntry[], DatabaseError>;

    /**
     * Vector KNN search across semantic memory (sqlite-vec). Tier 2 only.
     * Returns MemoryError if vec0 extension not loaded.
     */
    readonly searchVector: (
      queryEmbedding: readonly number[],
      agentId: string,
      limit: number,
    ) => Effect.Effect<SemanticEntry[], DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const MemorySearchServiceLive = Layer.effect(
  MemorySearchService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    return {
      searchSemantic: (options) =>
        Effect.gen(function* () {
          const limit = options.limit ?? 10;
          // FTS5 MATCH query — ranks by BM25 relevance
          const rows = yield* db.query<{
            id: string;
            agent_id: string;
            content: string;
            summary: string;
            importance: number;
            verified: number;
            tags: string;
            created_at: string;
            updated_at: string;
            access_count: number;
            last_accessed_at: string;
          }>(
            `SELECT sm.*
             FROM semantic_memory sm
             JOIN semantic_fts ON semantic_fts.id = sm.id
             WHERE semantic_fts MATCH ?
               AND sm.agent_id = ?
             ORDER BY rank
             LIMIT ?`,
            [options.query, options.agentId, limit],
          );

          return rows.map((r) => ({
            id: r.id as any,
            agentId: r.agent_id,
            content: r.content,
            summary: r.summary,
            importance: r.importance,
            verified: Boolean(r.verified),
            tags: JSON.parse(r.tags),
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
            accessCount: r.access_count,
            lastAccessedAt: new Date(r.last_accessed_at),
          })) satisfies SemanticEntry[];
        }),

      searchEpisodic: (options) =>
        Effect.gen(function* () {
          const limit = options.limit ?? 20;
          const rows = yield* db.query<{
            id: string;
            agent_id: string;
            date: string;
            content: string;
            task_id: string | null;
            event_type: string;
            cost: number | null;
            duration: number | null;
            metadata: string;
            created_at: string;
          }>(
            `SELECT el.*
             FROM episodic_log el
             JOIN episodic_fts ON episodic_fts.id = el.id
             WHERE episodic_fts MATCH ?
               AND el.agent_id = ?
             ORDER BY rank
             LIMIT ?`,
            [options.query, options.agentId, limit],
          );

          return rows.map((r) => ({
            id: r.id as any,
            agentId: r.agent_id,
            date: r.date,
            content: r.content,
            taskId: r.task_id ?? undefined,
            eventType: r.event_type as any,
            cost: r.cost ?? undefined,
            duration: r.duration ?? undefined,
            metadata: JSON.parse(r.metadata),
            createdAt: new Date(r.created_at),
          })) satisfies DailyLogEntry[];
        }),

      // Tier 2 only — requires sqlite-vec extension loaded on db connection
      searchVector: (_queryEmbedding, _agentId, _limit) =>
        Effect.fail(
          new DatabaseError({
            message:
              "Vector search requires Tier 2 (sqlite-vec). Use createMemoryLayer('2').",
            operation: "search",
          }),
        ),
    };
  }),
);
```

---

## Working Memory Service

### File: `src/services/working-memory.ts`

```typescript
import { Effect, Context, Layer, Ref } from "effect";
import type { WorkingMemoryItem, EvictionPolicy } from "../types.js";
import { MemoryError, CapacityExceededError } from "../errors.js";

// ─── Service Tag ───

export class WorkingMemoryService extends Context.Tag("WorkingMemoryService")<
  WorkingMemoryService,
  {
    /** Add item to working memory. Evicts according to policy if at capacity. */
    readonly add: (item: WorkingMemoryItem) => Effect.Effect<void, never>;

    /** Get all items in working memory (newest first). */
    readonly get: () => Effect.Effect<readonly WorkingMemoryItem[], never>;

    /** Clear all items. */
    readonly clear: () => Effect.Effect<void, never>;

    /** Evict one item according to policy and return it. */
    readonly evict: () => Effect.Effect<WorkingMemoryItem, MemoryError>;

    /** Current count. */
    readonly size: () => Effect.Effect<number, never>;

    /** Find item by content similarity (text contains). */
    readonly find: (
      query: string,
    ) => Effect.Effect<readonly WorkingMemoryItem[], never>;
  }
>() {}

// ─── Live Implementation ───

export const WorkingMemoryServiceLive = (
  capacity: number = 7,
  evictionPolicy: EvictionPolicy = "fifo",
) =>
  Layer.effect(
    WorkingMemoryService,
    Effect.gen(function* () {
      const store = yield* Ref.make<WorkingMemoryItem[]>([]);

      const evictOne = (items: WorkingMemoryItem[]): WorkingMemoryItem[] => {
        if (items.length === 0) return items;
        switch (evictionPolicy) {
          case "fifo":
            return items.slice(1);
          case "lru":
            // Evict least recently added (same as FIFO for add-only workloads)
            return items.slice(1);
          case "importance":
            // Evict lowest importance
            const minIdx = items.reduce(
              (minI, item, i) =>
                item.importance < items[minI]!.importance ? i : minI,
              0,
            );
            return [...items.slice(0, minIdx), ...items.slice(minIdx + 1)];
        }
      };

      return {
        add: (item) =>
          Ref.update(store, (items) => {
            const withRoom = items.length >= capacity ? evictOne(items) : items;
            return [...withRoom, item];
          }),

        get: () =>
          Ref.get(store).pipe(
            Effect.map(
              (items) => [...items].reverse() as readonly WorkingMemoryItem[],
            ),
          ),

        clear: () => Ref.set(store, []),

        evict: () =>
          Effect.gen(function* () {
            const items = yield* Ref.get(store);
            if (items.length === 0) {
              return yield* Effect.fail(
                new MemoryError({
                  message: "Working memory is empty, cannot evict",
                }),
              );
            }
            const evicted = items[0]!;
            yield* Ref.set(store, items.slice(1));
            return evicted;
          }),

        size: () => Ref.get(store).pipe(Effect.map((items) => items.length)),

        find: (query) =>
          Ref.get(store).pipe(
            Effect.map((items) =>
              items.filter((item) =>
                item.content.toLowerCase().includes(query.toLowerCase()),
              ),
            ),
          ),
      };
    }),
  );
```

---

## Semantic Memory Service

### File: `src/services/semantic-memory.ts`

```typescript
import { Effect, Context, Layer } from "effect";
import type { SemanticEntry, MemoryId } from "../types.js";
import { MemoryNotFoundError, DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Service Tag ───

export class SemanticMemoryService extends Context.Tag("SemanticMemoryService")<
  SemanticMemoryService,
  {
    /** Store a semantic memory entry. */
    readonly store: (
      entry: SemanticEntry,
    ) => Effect.Effect<MemoryId, DatabaseError>;

    /** Get entry by ID. */
    readonly get: (
      id: MemoryId,
    ) => Effect.Effect<SemanticEntry, MemoryNotFoundError>;

    /** Update an existing entry. */
    readonly update: (
      id: MemoryId,
      patch: Partial<
        Pick<
          SemanticEntry,
          "content" | "summary" | "importance" | "verified" | "tags"
        >
      >,
    ) => Effect.Effect<void, DatabaseError>;

    /** Delete an entry. */
    readonly delete: (id: MemoryId) => Effect.Effect<void, DatabaseError>;

    /** Get all entries for an agent, sorted by importance desc. */
    readonly listByAgent: (
      agentId: string,
      limit?: number,
    ) => Effect.Effect<SemanticEntry[], DatabaseError>;

    /** Increment access count and update last_accessed_at. */
    readonly recordAccess: (id: MemoryId) => Effect.Effect<void, DatabaseError>;

    /** Generate memory.md projection (top N entries by importance, max 200 lines). */
    readonly generateMarkdown: (
      agentId: string,
      maxLines?: number,
    ) => Effect.Effect<string, DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const SemanticMemoryServiceLive = Layer.effect(
  SemanticMemoryService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    const rowToEntry = (r: Record<string, unknown>): SemanticEntry => ({
      id: r.id as MemoryId,
      agentId: r.agent_id as string,
      content: r.content as string,
      summary: r.summary as string,
      importance: r.importance as number,
      verified: Boolean(r.verified),
      tags: JSON.parse(r.tags as string),
      embedding: r.embedding
        ? Array.from(new Float32Array(r.embedding as ArrayBuffer))
        : undefined,
      createdAt: new Date(r.created_at as string),
      updatedAt: new Date(r.updated_at as string),
      accessCount: r.access_count as number,
      lastAccessedAt: new Date(r.last_accessed_at as string),
    });

    return {
      store: (entry) =>
        Effect.gen(function* () {
          yield* db.exec(
            `INSERT OR REPLACE INTO semantic_memory
             (id, agent_id, content, summary, importance, verified, tags, created_at, updated_at, access_count, last_accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.agentId,
              entry.content,
              entry.summary,
              entry.importance,
              entry.verified ? 1 : 0,
              JSON.stringify(entry.tags),
              entry.createdAt.toISOString(),
              entry.updatedAt.toISOString(),
              entry.accessCount,
              entry.lastAccessedAt.toISOString(),
            ],
          );
          return entry.id;
        }),

      get: (id) =>
        Effect.gen(function* () {
          const rows = yield* db.query(
            `SELECT * FROM semantic_memory WHERE id = ?`,
            [id],
          );
          if (rows.length === 0) {
            return yield* Effect.fail(
              new MemoryNotFoundError({
                memoryId: id,
                message: `Semantic entry ${id} not found`,
              }),
            );
          }
          return rowToEntry(rows[0]!);
        }),

      update: (id, patch) =>
        Effect.gen(function* () {
          const sets: string[] = [];
          const params: unknown[] = [];

          if (patch.content !== undefined) {
            sets.push("content = ?");
            params.push(patch.content);
          }
          if (patch.summary !== undefined) {
            sets.push("summary = ?");
            params.push(patch.summary);
          }
          if (patch.importance !== undefined) {
            sets.push("importance = ?");
            params.push(patch.importance);
          }
          if (patch.verified !== undefined) {
            sets.push("verified = ?");
            params.push(patch.verified ? 1 : 0);
          }
          if (patch.tags !== undefined) {
            sets.push("tags = ?");
            params.push(JSON.stringify(patch.tags));
          }

          sets.push("updated_at = ?");
          params.push(new Date().toISOString());
          params.push(id);

          yield* db.exec(
            `UPDATE semantic_memory SET ${sets.join(", ")} WHERE id = ?`,
            params,
          );
        }),

      delete: (id) =>
        db
          .exec(`DELETE FROM semantic_memory WHERE id = ?`, [id])
          .pipe(Effect.asVoid),

      listByAgent: (agentId, limit = 100) =>
        db
          .query(
            `SELECT * FROM semantic_memory WHERE agent_id = ? ORDER BY importance DESC LIMIT ?`,
            [agentId, limit],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry))),

      recordAccess: (id) =>
        db
          .exec(
            `UPDATE semantic_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`,
            [new Date().toISOString(), id],
          )
          .pipe(Effect.asVoid),

      generateMarkdown: (agentId, maxLines = 200) =>
        Effect.gen(function* () {
          const entries = yield* db.query<{
            content: string;
            summary: string;
            importance: number;
            tags: string;
            updated_at: string;
          }>(
            `SELECT content, summary, importance, tags, updated_at
             FROM semantic_memory
             WHERE agent_id = ?
             ORDER BY importance DESC, updated_at DESC
             LIMIT 50`,
            [agentId],
          );

          const lines: string[] = [
            `# Agent Memory — ${agentId}`,
            `> Generated: ${new Date().toISOString()}`,
            "",
          ];

          for (const entry of entries) {
            const tags = JSON.parse(entry.tags) as string[];
            const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
            const importanceBar = "█".repeat(Math.round(entry.importance * 5));
            lines.push(
              `## ${importanceBar} (${entry.importance.toFixed(2)})${tagStr}`,
            );
            lines.push(entry.summary);
            lines.push("");

            if (lines.length >= maxLines) break;
          }

          return lines.slice(0, maxLines).join("\n");
        }),
    };
  }),
);
```

---

## Episodic Memory Service

### File: `src/services/episodic-memory.ts`

```typescript
import { Effect, Context, Layer } from "effect";
import type { DailyLogEntry, SessionSnapshot, MemoryId } from "../types.js";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Service Tag ───

export class EpisodicMemoryService extends Context.Tag("EpisodicMemoryService")<
  EpisodicMemoryService,
  {
    /** Log an episodic event. */
    readonly log: (
      entry: DailyLogEntry,
    ) => Effect.Effect<MemoryId, DatabaseError>;

    /** Get today's log for an agent. */
    readonly getToday: (
      agentId: string,
    ) => Effect.Effect<DailyLogEntry[], DatabaseError>;

    /** Get recent log entries (newest first). */
    readonly getRecent: (
      agentId: string,
      limit: number,
    ) => Effect.Effect<DailyLogEntry[], DatabaseError>;

    /** Get entries by task ID. */
    readonly getByTask: (
      taskId: string,
    ) => Effect.Effect<DailyLogEntry[], DatabaseError>;

    /** Save a session snapshot. */
    readonly saveSnapshot: (
      snapshot: SessionSnapshot,
    ) => Effect.Effect<void, DatabaseError>;

    /** Get the most recent session snapshot for an agent. */
    readonly getLatestSnapshot: (
      agentId: string,
    ) => Effect.Effect<SessionSnapshot | null, DatabaseError>;

    /** Prune entries older than retainDays. */
    readonly prune: (
      agentId: string,
      retainDays: number,
    ) => Effect.Effect<number, DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const EpisodicMemoryServiceLive = Layer.effect(
  EpisodicMemoryService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    const rowToEntry = (r: Record<string, unknown>): DailyLogEntry => ({
      id: r.id as MemoryId,
      agentId: r.agent_id as string,
      date: r.date as string,
      content: r.content as string,
      taskId: (r.task_id as string | null) ?? undefined,
      eventType: r.event_type as any,
      cost: (r.cost as number | null) ?? undefined,
      duration: (r.duration as number | null) ?? undefined,
      metadata: JSON.parse((r.metadata as string) ?? "{}"),
      createdAt: new Date(r.created_at as string),
    });

    return {
      log: (entry) =>
        Effect.gen(function* () {
          yield* db.exec(
            `INSERT INTO episodic_log
             (id, agent_id, date, content, task_id, event_type, cost, duration, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.agentId,
              entry.date,
              entry.content,
              entry.taskId ?? null,
              entry.eventType,
              entry.cost ?? null,
              entry.duration ?? null,
              JSON.stringify(entry.metadata ?? {}),
              entry.createdAt.toISOString(),
            ],
          );
          return entry.id;
        }),

      getToday: (agentId) => {
        const today = new Date().toISOString().slice(0, 10);
        return db
          .query(
            `SELECT * FROM episodic_log WHERE agent_id = ? AND date = ? ORDER BY created_at DESC`,
            [agentId, today],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry)));
      },

      getRecent: (agentId, limit) =>
        db
          .query(
            `SELECT * FROM episodic_log WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?`,
            [agentId, limit],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry))),

      getByTask: (taskId) =>
        db
          .query(
            `SELECT * FROM episodic_log WHERE task_id = ? ORDER BY created_at ASC`,
            [taskId],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry))),

      saveSnapshot: (snapshot) =>
        db
          .exec(
            `INSERT OR REPLACE INTO session_snapshots
             (id, agent_id, messages, summary, key_decisions, task_ids, started_at, ended_at, total_cost, total_tokens)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              snapshot.id,
              snapshot.agentId,
              JSON.stringify(snapshot.messages),
              snapshot.summary,
              JSON.stringify(snapshot.keyDecisions),
              JSON.stringify(snapshot.taskIds),
              snapshot.startedAt.toISOString(),
              snapshot.endedAt.toISOString(),
              snapshot.totalCost,
              snapshot.totalTokens,
            ],
          )
          .pipe(Effect.asVoid),

      getLatestSnapshot: (agentId) =>
        db
          .query(
            `SELECT * FROM session_snapshots WHERE agent_id = ? ORDER BY ended_at DESC LIMIT 1`,
            [agentId],
          )
          .pipe(
            Effect.map((rows) => {
              if (rows.length === 0) return null;
              const r = rows[0]!;
              return {
                id: r.id,
                agentId: r.agent_id,
                messages: JSON.parse(r.messages as string),
                summary: r.summary,
                keyDecisions: JSON.parse(r.key_decisions as string),
                taskIds: JSON.parse(r.task_ids as string),
                startedAt: new Date(r.started_at as string),
                endedAt: new Date(r.ended_at as string),
                totalCost: r.total_cost as number,
                totalTokens: r.total_tokens as number,
              } satisfies SessionSnapshot;
            }),
          ),

      prune: (agentId, retainDays) => {
        const cutoff = new Date(
          Date.now() - retainDays * 86_400_000,
        ).toISOString();
        return db.exec(
          `DELETE FROM episodic_log WHERE agent_id = ? AND created_at < ?`,
          [agentId, cutoff],
        );
      },
    };
  }),
);
```

---

## Procedural Memory Service

### File: `src/services/procedural-memory.ts`

```typescript
import { Effect, Context, Layer } from "effect";
import type { ProceduralEntry, MemoryId } from "../types.js";
import { DatabaseError, MemoryNotFoundError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Service Tag ───

export class ProceduralMemoryService extends Context.Tag(
  "ProceduralMemoryService",
)<
  ProceduralMemoryService,
  {
    /** Store a new workflow/pattern. */
    readonly store: (
      entry: ProceduralEntry,
    ) => Effect.Effect<MemoryId, DatabaseError>;

    /** Get workflow by ID. */
    readonly get: (
      id: MemoryId,
    ) => Effect.Effect<ProceduralEntry, MemoryNotFoundError>;

    /** Update success rate and use count after execution. */
    readonly recordOutcome: (
      id: MemoryId,
      success: boolean,
    ) => Effect.Effect<void, DatabaseError>;

    /** List active workflows for an agent (sorted by success rate). */
    readonly listActive: (
      agentId: string,
    ) => Effect.Effect<ProceduralEntry[], DatabaseError>;

    /** Find workflows matching tags. */
    readonly findByTags: (
      agentId: string,
      tags: readonly string[],
    ) => Effect.Effect<ProceduralEntry[], DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const ProceduralMemoryServiceLive = Layer.effect(
  ProceduralMemoryService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    const rowToEntry = (r: Record<string, unknown>): ProceduralEntry => ({
      id: r.id as MemoryId,
      agentId: r.agent_id as string,
      name: r.name as string,
      description: r.description as string,
      pattern: r.pattern as string,
      successRate: r.success_rate as number,
      useCount: r.use_count as number,
      tags: JSON.parse(r.tags as string),
      createdAt: new Date(r.created_at as string),
      updatedAt: new Date(r.updated_at as string),
    });

    return {
      store: (entry) =>
        Effect.gen(function* () {
          yield* db.exec(
            `INSERT OR REPLACE INTO procedural_memory
             (id, agent_id, name, description, pattern, success_rate, use_count, tags, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.id,
              entry.agentId,
              entry.name,
              entry.description,
              entry.pattern,
              entry.successRate,
              entry.useCount,
              JSON.stringify(entry.tags),
              entry.createdAt.toISOString(),
              entry.updatedAt.toISOString(),
            ],
          );
          return entry.id;
        }),

      get: (id) =>
        Effect.gen(function* () {
          const rows = yield* db.query(
            `SELECT * FROM procedural_memory WHERE id = ?`,
            [id],
          );
          if (rows.length === 0) {
            return yield* Effect.fail(
              new MemoryNotFoundError({
                memoryId: id,
                message: `Procedural entry ${id} not found`,
              }),
            );
          }
          return rowToEntry(rows[0]!);
        }),

      recordOutcome: (id, success) =>
        Effect.gen(function* () {
          const rows = yield* db.query<{
            success_rate: number;
            use_count: number;
          }>(
            `SELECT success_rate, use_count FROM procedural_memory WHERE id = ?`,
            [id],
          );
          if (rows.length === 0) return;
          const { success_rate, use_count } = rows[0]!;
          const newCount = use_count + 1;
          // Exponential moving average (alpha = 0.1)
          const newRate = success_rate * 0.9 + (success ? 1 : 0) * 0.1;
          yield* db.exec(
            `UPDATE procedural_memory SET success_rate = ?, use_count = ?, updated_at = ? WHERE id = ?`,
            [newRate, newCount, new Date().toISOString(), id],
          );
        }),

      listActive: (agentId) =>
        db
          .query(
            `SELECT * FROM procedural_memory WHERE agent_id = ? ORDER BY success_rate DESC, use_count DESC`,
            [agentId],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry))),

      findByTags: (agentId, tags) =>
        Effect.gen(function* () {
          const all = yield* db.query(
            `SELECT * FROM procedural_memory WHERE agent_id = ?`,
            [agentId],
          );
          return all
            .map(rowToEntry)
            .filter((e) => tags.some((t) => e.tags.includes(t)));
        }),
    };
  }),
);
```

---

## Zettelkasten Service

### File: `src/indexing/zettelkasten.ts`

```typescript
import { Effect, Context, Layer } from "effect";
import type { MemoryId, ZettelLink, LinkType } from "../types.js";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Service Tag ───

export class ZettelkastenService extends Context.Tag("ZettelkastenService")<
  ZettelkastenService,
  {
    /** Add a link between two memory entries. */
    readonly addLink: (link: ZettelLink) => Effect.Effect<void, DatabaseError>;

    /** Get all links for a memory ID (as source or target). */
    readonly getLinks: (
      memoryId: MemoryId,
    ) => Effect.Effect<ZettelLink[], DatabaseError>;

    /** Get IDs of all memories linked to a given ID. */
    readonly getLinked: (
      memoryId: MemoryId,
    ) => Effect.Effect<MemoryId[], DatabaseError>;

    /** Traverse link graph up to `depth` hops from startId. */
    readonly traverse: (
      startId: MemoryId,
      depth: number,
    ) => Effect.Effect<MemoryId[], DatabaseError>;

    /** Delete all links for a memory (when entry is deleted). */
    readonly deleteLinks: (
      memoryId: MemoryId,
    ) => Effect.Effect<void, DatabaseError>;

    /**
     * Auto-link via FTS5 similarity (find semantically similar entries
     * and create "similar" links if above threshold).
     * Requires MemorySearchService in scope for Tier 1.
     */
    readonly autoLinkText: (
      memoryId: MemoryId,
      content: string,
      agentId: string,
      threshold?: number,
    ) => Effect.Effect<ZettelLink[], DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const ZettelkastenServiceLive = Layer.effect(
  ZettelkastenService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    const rowToLink = (r: Record<string, unknown>): ZettelLink => ({
      source: r.source_id as MemoryId,
      target: r.target_id as MemoryId,
      strength: r.strength as number,
      type: r.type as LinkType,
      createdAt: new Date(r.created_at as string),
    });

    return {
      addLink: (link) =>
        db
          .exec(
            `INSERT OR REPLACE INTO zettel_links (source_id, target_id, strength, type, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [
              link.source,
              link.target,
              link.strength,
              link.type,
              link.createdAt.toISOString(),
            ],
          )
          .pipe(Effect.asVoid),

      getLinks: (memoryId) =>
        db
          .query(
            `SELECT * FROM zettel_links WHERE source_id = ? OR target_id = ? ORDER BY strength DESC`,
            [memoryId, memoryId],
          )
          .pipe(Effect.map((rows) => rows.map(rowToLink))),

      getLinked: (memoryId) =>
        db
          .query(
            `SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END as linked_id
             FROM zettel_links
             WHERE source_id = ? OR target_id = ?
             ORDER BY strength DESC`,
            [memoryId, memoryId, memoryId],
          )
          .pipe(Effect.map((rows) => rows.map((r) => r.linked_id as MemoryId))),

      traverse: (startId, depth) =>
        Effect.gen(function* () {
          const visited = new Set<string>();
          const result: MemoryId[] = [];
          const queue: Array<{ id: MemoryId; d: number }> = [
            { id: startId, d: 0 },
          ];

          while (queue.length > 0) {
            const item = queue.shift()!;
            if (visited.has(item.id) || item.d > depth) continue;
            visited.add(item.id);
            if (item.id !== startId) result.push(item.id);

            const links = yield* db.query<{ linked_id: string }>(
              `SELECT CASE WHEN source_id = ? THEN target_id ELSE source_id END as linked_id
               FROM zettel_links WHERE source_id = ? OR target_id = ?`,
              [item.id, item.id, item.id],
            );

            for (const link of links) {
              if (!visited.has(link.linked_id)) {
                queue.push({ id: link.linked_id as MemoryId, d: item.d + 1 });
              }
            }
          }

          return result;
        }),

      deleteLinks: (memoryId) =>
        db
          .exec(
            `DELETE FROM zettel_links WHERE source_id = ? OR target_id = ?`,
            [memoryId, memoryId],
          )
          .pipe(Effect.asVoid),

      // Text-based auto-linking via FTS5 search
      autoLinkText: (memoryId, content, agentId, threshold = 0.85) =>
        Effect.gen(function* () {
          // Use a simplified text similarity: FTS5 rank as proxy
          const similar = yield* db.query<{
            id: string;
            rank: number;
          }>(
            `SELECT sm.id, semantic_fts.rank
             FROM semantic_memory sm
             JOIN semantic_fts ON semantic_fts.id = sm.id
             WHERE semantic_fts MATCH ?
               AND sm.agent_id = ?
               AND sm.id != ?
             ORDER BY rank
             LIMIT 5`,
            [content.split(" ").slice(0, 10).join(" OR "), agentId, memoryId],
          );

          const now = new Date();
          const links: ZettelLink[] = [];

          for (const row of similar) {
            // Convert FTS rank to 0-1 strength (rank is negative BM25 score)
            const strength = Math.min(1, Math.max(0, 1 + row.rank / 10));
            if (strength < threshold) continue;

            const link: ZettelLink = {
              source: memoryId,
              target: row.id as MemoryId,
              strength,
              type: "similar",
              createdAt: now,
            };

            yield* db.exec(
              `INSERT OR REPLACE INTO zettel_links (source_id, target_id, strength, type, created_at)
               VALUES (?, ?, ?, ?, ?)`,
              [
                link.source,
                link.target,
                link.strength,
                link.type,
                link.createdAt.toISOString(),
              ],
            );
            links.push(link);
          }

          return links;
        }),
    };
  }),
);
```

---

## Memory File System

### File: `src/fs/memory-file-system.ts`

```typescript
import { Effect, Context, Layer } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MemoryError } from "../errors.js";

// ─── Service Tag ───

export class MemoryFileSystem extends Context.Tag("MemoryFileSystem")<
  MemoryFileSystem,
  {
    /** Write memory.md projection for an agent. */
    readonly writeMarkdown: (
      agentId: string,
      content: string,
      basePath: string,
    ) => Effect.Effect<void, MemoryError>;

    /** Read memory.md for bootstrap. Returns empty string if not found. */
    readonly readMarkdown: (
      agentId: string,
      basePath: string,
    ) => Effect.Effect<string, MemoryError>;

    /** Ensure agent memory directory exists. */
    readonly ensureDirectory: (
      agentId: string,
      basePath: string,
    ) => Effect.Effect<void, MemoryError>;
  }
>() {}

// ─── Live Implementation ───

export const MemoryFileSystemLive = Layer.succeed(MemoryFileSystem, {
  writeMarkdown: (agentId, content, basePath) =>
    Effect.tryPromise({
      try: async () => {
        const dir = path.join(basePath, agentId);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "memory.md"), content, "utf8");
      },
      catch: (e) =>
        new MemoryError({
          message: `Failed to write memory.md: ${e}`,
          cause: e,
        }),
    }),

  readMarkdown: (agentId, basePath) =>
    Effect.tryPromise({
      try: async () => {
        const filePath = path.join(basePath, agentId, "memory.md");
        try {
          return await fs.readFile(filePath, "utf8");
        } catch {
          return "";
        }
      },
      catch: (e) =>
        new MemoryError({
          message: `Failed to read memory.md: ${e}`,
          cause: e,
        }),
    }),

  ensureDirectory: (agentId, basePath) =>
    Effect.tryPromise({
      try: async () => {
        await fs.mkdir(path.join(basePath, agentId), { recursive: true });
      },
      catch: (e) =>
        new MemoryError({
          message: `Failed to create memory directory: ${e}`,
          cause: e,
        }),
    }),
});
```

---

## Memory Service (Orchestrator)

### File: `src/services/memory-service.ts`

Six persistence mechanisms:

1. **Bootstrap loading** — read memory.md + recent SQLite entries on agent start
2. **Pre-compaction flush** — write SQLite → memory.md before compaction
3. **Session snapshot** — save full conversation to `session_snapshots` table
4. **User-initiated** — explicit `flush()` call
5. **Auto-extraction** — LLM-driven extraction from conversation (optional, requires LLMService)
6. **Consolidation cycles** — merge/dedup/update/decay (optional, requires LLMService)

```typescript
import { Effect, Context, Layer } from "effect";
import type {
  MemoryBootstrapResult,
  MemoryConfig,
  SemanticEntry,
  DailyLogEntry,
  WorkingMemoryItem,
  MemoryId,
  SessionSnapshot,
} from "../types.js";
import { MemoryError, DatabaseError } from "../errors.js";
import { WorkingMemoryService } from "./working-memory.js";
import { SemanticMemoryService } from "./semantic-memory.js";
import { EpisodicMemoryService } from "./episodic-memory.js";
import { ProceduralMemoryService } from "./procedural-memory.js";
import { MemoryFileSystem } from "../fs/memory-file-system.js";
import { ZettelkastenService } from "../indexing/zettelkasten.js";

// ─── Service Tag ───

export class MemoryService extends Context.Tag("MemoryService")<
  MemoryService,
  {
    /**
     * Bootstrap: load semantic context + recent episodes for agent.
     * Called by ExecutionEngine at Phase 1 (BOOTSTRAP).
     */
    readonly bootstrap: (
      agentId: string,
    ) => Effect.Effect<MemoryBootstrapResult, MemoryError | DatabaseError>;

    /**
     * Flush: generate memory.md projection from SQLite and write to disk.
     * Called before compaction, on user request, or on session end.
     */
    readonly flush: (
      agentId: string,
    ) => Effect.Effect<void, MemoryError | DatabaseError>;

    /**
     * Snapshot: save session messages to episodic SQLite storage.
     * Called by ExecutionEngine at Phase 7 (MEMORY_FLUSH).
     */
    readonly snapshot: (
      snapshot: SessionSnapshot,
    ) => Effect.Effect<void, DatabaseError>;

    /**
     * Store a working memory item (adds to in-process Ref).
     */
    readonly addToWorking: (
      item: WorkingMemoryItem,
    ) => Effect.Effect<void, never>;

    /**
     * Store a semantic memory entry (persists to SQLite).
     * Auto-links via Zettelkasten if enabled.
     */
    readonly storeSemantic: (
      entry: SemanticEntry,
    ) => Effect.Effect<MemoryId, DatabaseError>;

    /**
     * Log an episodic event (persists to SQLite).
     */
    readonly logEpisode: (
      entry: DailyLogEntry,
    ) => Effect.Effect<MemoryId, DatabaseError>;

    /**
     * Get current working memory contents.
     */
    readonly getWorking: () => Effect.Effect<
      readonly WorkingMemoryItem[],
      never
    >;
  }
>() {}

// ─── Live Implementation ───

export const MemoryServiceLive = (config: MemoryConfig) =>
  Layer.effect(
    MemoryService,
    Effect.gen(function* () {
      const working = yield* WorkingMemoryService;
      const semantic = yield* SemanticMemoryService;
      const episodic = yield* EpisodicMemoryService;
      const _procedural = yield* ProceduralMemoryService;
      const fileSystem = yield* MemoryFileSystem;
      const zettel = yield* ZettelkastenService;

      const basePath = `.reactive-agents/memory`;

      return {
        bootstrap: (agentId) =>
          Effect.gen(function* () {
            // Ensure directory exists
            yield* fileSystem
              .ensureDirectory(agentId, basePath)
              .pipe(Effect.catchAll(() => Effect.void));

            // Read memory.md for semantic context
            const semanticContext = yield* fileSystem
              .readMarkdown(agentId, basePath)
              .pipe(Effect.catchAll(() => Effect.succeed("")));

            // Get recent episodic entries (last 20)
            const recentEpisodes = yield* episodic
              .getRecent(agentId, 20)
              .pipe(Effect.catchAll(() => Effect.succeed([])));

            // Get active workflows
            const activeWorkflows = yield* _procedural
              .listActive(agentId)
              .pipe(Effect.catchAll(() => Effect.succeed([])));

            // Get current working memory
            const workingMemory = yield* working.get();

            return {
              agentId,
              semanticContext,
              recentEpisodes,
              activeWorkflows,
              workingMemory: [...workingMemory],
              bootstrappedAt: new Date(),
              tier: config.tier,
            } satisfies MemoryBootstrapResult;
          }),

        flush: (agentId) =>
          Effect.gen(function* () {
            const markdown = yield* semantic.generateMarkdown(
              agentId,
              config.semantic.maxMarkdownLines,
            );
            yield* fileSystem.writeMarkdown(agentId, markdown, basePath);
          }),

        snapshot: (snap) => episodic.saveSnapshot(snap),

        addToWorking: (item) => working.add(item),

        storeSemantic: (entry) =>
          Effect.gen(function* () {
            const id = yield* semantic.store(entry);
            // Auto-link if Zettelkasten enabled
            if (config.zettelkasten.enabled) {
              yield* zettel
                .autoLinkText(
                  entry.id,
                  entry.content,
                  entry.agentId,
                  config.zettelkasten.linkingThreshold,
                )
                .pipe(Effect.catchAll(() => Effect.succeed([])));
            }
            return id;
          }),

        logEpisode: (entry) => episodic.log(entry),

        getWorking: () => working.get(),
      };
    }),
  );
```

---

## Runtime Factory

### File: `src/runtime.ts`

```typescript
import { Layer } from "effect";
import { WorkingMemoryServiceLive } from "./services/working-memory.js";
import { SemanticMemoryServiceLive } from "./services/semantic-memory.js";
import { EpisodicMemoryServiceLive } from "./services/episodic-memory.js";
import { ProceduralMemoryServiceLive } from "./services/procedural-memory.js";
import { MemoryFileSystemLive } from "./fs/memory-file-system.js";
import { MemorySearchServiceLive } from "./search.js";
import { ZettelkastenServiceLive } from "./indexing/zettelkasten.js";
import { MemoryServiceLive } from "./services/memory-service.js";
import { MemoryDatabaseLive } from "./database.js";
import type { MemoryConfig } from "./types.js";
import { defaultMemoryConfig } from "./types.js";

/**
 * Create the complete memory layer.
 *
 * Tier 1 (zero deps): FTS5 full-text search only.
 * Tier 2 (sqlite-vec): FTS5 + KNN vector search.
 *
 * Usage:
 *   const MemoryLive = createMemoryLayer("1", { agentId: "my-agent" });
 *   myProgram.pipe(Effect.provide(MemoryLive));
 */
export const createMemoryLayer = (
  tier: "1" | "2",
  configOverrides?: Partial<MemoryConfig> & { agentId: string },
) => {
  const agentId = configOverrides?.agentId ?? "default";
  const config: MemoryConfig = {
    ...defaultMemoryConfig(agentId),
    ...configOverrides,
    tier,
  };

  // Database layer (foundation)
  const dbLayer = MemoryDatabaseLive(config);

  // Services that depend on DB
  const coreServices = Layer.mergeAll(
    SemanticMemoryServiceLive,
    EpisodicMemoryServiceLive,
    ProceduralMemoryServiceLive,
    MemorySearchServiceLive,
    ZettelkastenServiceLive,
  ).pipe(Layer.provide(dbLayer));

  // Working memory (in-process only, no DB)
  const workingLayer = WorkingMemoryServiceLive(
    config.working.capacity,
    config.working.evictionPolicy,
  );

  // File system layer (no deps)
  const fsLayer = MemoryFileSystemLive;

  // Orchestrator layer
  const memoryServiceLayer = MemoryServiceLive(config).pipe(
    Layer.provide(Layer.mergeAll(workingLayer, coreServices, fsLayer)),
  );

  return Layer.mergeAll(
    dbLayer,
    workingLayer,
    coreServices,
    fsLayer,
    memoryServiceLayer,
  );
};
```

---

## Public API

### File: `src/index.ts`

```typescript
// ─── Types ───
export type {
  MemoryId,
  MemoryType,
  MemoryEntry,
  MemorySource,
  SemanticEntry,
  DailyLogEntry,
  SessionSnapshot,
  ProceduralEntry,
  WorkingMemoryItem,
  ZettelLink,
  LinkType,
  CompactionStrategy,
  CompactionConfig,
  SearchOptions,
  MemoryBootstrapResult,
  EvictionPolicy,
  MemoryConfig,
} from "./types.js";

// ─── Schemas ───
export {
  MemoryEntrySchema,
  SemanticEntrySchema,
  DailyLogEntrySchema,
  SessionSnapshotSchema,
  ProceduralEntrySchema,
  WorkingMemoryItemSchema,
  ZettelLinkSchema,
  MemoryConfigSchema,
  MemoryBootstrapResultSchema,
  defaultMemoryConfig,
} from "./types.js";

// ─── Errors ───
export {
  MemoryError,
  MemoryNotFoundError,
  DatabaseError,
  CapacityExceededError,
  ContextError,
  CompactionError,
} from "./errors.js";

// ─── Database ───
export { MemoryDatabase, MemoryDatabaseLive } from "./database.js";

// ─── Search ───
export { MemorySearchService, MemorySearchServiceLive } from "./search.js";

// ─── Services ───
export { MemoryService, MemoryServiceLive } from "./services/memory-service.js";
export {
  WorkingMemoryService,
  WorkingMemoryServiceLive,
} from "./services/working-memory.js";
export {
  SemanticMemoryService,
  SemanticMemoryServiceLive,
} from "./services/semantic-memory.js";
export {
  EpisodicMemoryService,
  EpisodicMemoryServiceLive,
} from "./services/episodic-memory.js";
export {
  ProceduralMemoryService,
  ProceduralMemoryServiceLive,
} from "./services/procedural-memory.js";

// ─── File System ───
export {
  MemoryFileSystem,
  MemoryFileSystemLive,
} from "./fs/memory-file-system.js";

// ─── Indexing ───
export {
  ZettelkastenService,
  ZettelkastenServiceLive,
} from "./indexing/zettelkasten.js";

// ─── Runtime ───
export { createMemoryLayer } from "./runtime.js";
```

---

## Configuration

### File: `package.json`

```json
{
  "name": "@reactive-agents/memory",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "test:watch": "bun test --watch"
  },
  "dependencies": {
    "@reactive-agents/core": "workspace:*",
    "effect": "^3.10.0"
  },
  "optionalDependencies": {
    "@reactive-agents/llm-provider": "workspace:*",
    "sqlite-vec": "^0.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "bun-types": "latest"
  },
  "peerDependencies": {
    "bun": ">=1.0.0"
  }
}
```

**Notes:**

- `@lancedb/lancedb` is **removed**
- `bun:sqlite` is built into Bun — no package install needed
- `sqlite-vec` is **optional** (Tier 2 only)
- `@reactive-agents/llm-provider` is **optional** (MemoryExtractor/Consolidator only)

---

## Testing

### File: `tests/working-memory.test.ts`

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  WorkingMemoryService,
  WorkingMemoryServiceLive,
} from "../src/index.js";
import type { WorkingMemoryItem } from "../src/types.js";

const makeItem = (n: number): WorkingMemoryItem => ({
  id: `mem-${n}` as any,
  content: `item ${n}`,
  importance: 0.5,
  addedAt: new Date(),
  source: { type: "system", id: "test" },
});

describe("WorkingMemoryService", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, WorkingMemoryService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(WorkingMemoryServiceLive(7))));

  it("should enforce capacity of 7", async () => {
    const items = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        for (let i = 0; i < 10; i++) yield* svc.add(makeItem(i));
        return yield* svc.get();
      }),
    );
    expect(items.length).toBe(7);
  });

  it("should evict FIFO", async () => {
    const size = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        for (let i = 0; i < 8; i++) yield* svc.add(makeItem(i));
        return yield* svc.size();
      }),
    );
    expect(size).toBe(7);
  });

  it("should clear all items", async () => {
    const count = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        yield* svc.add(makeItem(1));
        yield* svc.clear();
        return yield* svc.size();
      }),
    );
    expect(count).toBe(0);
  });
});
```

### File: `tests/database.test.ts`

```typescript
import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { MemoryDatabase, MemoryDatabaseLive } from "../src/index.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";

const TEST_DB = "/tmp/test-memory.db";

describe("MemoryDatabase", () => {
  afterEach(() => {
    try {
      fs.unlinkSync(TEST_DB);
    } catch {
      /* ignore */
    }
  });

  it("should create schema and run queries", async () => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const layer = MemoryDatabaseLive(config);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* MemoryDatabase;
        const rows = yield* db.query(
          "SELECT name FROM sqlite_master WHERE type='table'",
        );
        return rows.map((r) => (r as any).name);
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toContain("semantic_memory");
    expect(result).toContain("episodic_log");
    expect(result).toContain("zettel_links");
  });
});
```

---

## Performance Targets

| Operation                    | Target | Notes                             |
| ---------------------------- | ------ | --------------------------------- |
| Working memory add           | < 1ms  | In-process Ref                    |
| Working memory get           | < 1ms  | Array read                        |
| Semantic store (SQLite)      | < 5ms  | Prepared statement + FTS5 trigger |
| FTS5 text search             | < 10ms | BM25 ranking, indexed             |
| Vector KNN search (Tier 2)   | < 20ms | sqlite-vec vec0 table             |
| Memory bootstrap (full)      | < 2ms  | SQLite read + file read           |
| Session snapshot write       | < 5ms  | SQLite INSERT                     |
| Memory.md generation + write | < 50ms | SQLite SELECT + fs.writeFile      |

---

## Success Criteria

- [ ] All types defined with Schema (not plain interfaces)
- [ ] All errors use Data.TaggedError
- [ ] All services use Context.Tag + Layer.effect
- [ ] `bun:sqlite` used as source of truth (no LanceDB, no Nomic)
- [ ] FTS5 virtual tables created and indexed for semantic + episodic
- [ ] Working memory enforces capacity of 7 with FIFO/LRU/importance eviction
- [ ] SemanticMemoryService reads/writes SQLite `semantic_memory` table
- [ ] EpisodicMemoryService writes daily log + session snapshots
- [ ] memory.md is a 200-line projection of SQLite (regenerated on flush)
- [ ] ZettelkastenService uses SQLite `zettel_links` table (no in-memory Ref)
- [ ] `createMemoryLayer("1")` works with zero external deps
- [ ] `createMemoryLayer("2")` works with sqlite-vec for KNN
- [ ] MemoryService.bootstrap() returns MemoryBootstrapResult in < 2ms
- [ ] All tests pass with bun test

---

## Dependencies

**Requires:**

- Layer 1 (Core): AgentId, TaskId types
- `bun:sqlite` (built-in, no install)

**Optionally uses:**

- Layer 1.5 (LLM Provider): `LLMService.embed()` for Tier 2 embeddings, MemoryExtractor
- `sqlite-vec`: Tier 2 KNN vector search

**Provides to:**

- `@reactive-agents/runtime` (Execution Engine): `MemoryService.bootstrap()`, `MemoryService.snapshot()`
- Layer 3 (Reasoning): MemoryBootstrapResult for strategy context
- Layer 4 (Verification): SemanticEntry for multi-source verification
- Layer 7 (Orchestration): Memory sharing between agents

**Status: Ready for AI agent implementation**
**Priority: Phase 1B (Weeks 2-3)**
