# Memory Technology Stack Analysis: The Streamlined Path

## Status: Technology Exploration (Companion to `EXPLORATION-memory-paradigm.md`)

This document analyzes specific technologies that could bring the markdown-native memory paradigm to the next level for **efficiency, performance, accuracy, and reliability**. The goal: find the most streamlined path with the fewest moving parts.

---

## 1. The Key Insight: Bun's Built-In SQLite as the Unified Engine

The single most impactful technology decision for the memory layer is replacing LanceDB with **Bun's built-in `bun:sqlite`** combined with the **sqlite-vec** extension. This eliminates every external dependency while *gaining* capabilities.

### Why This Changes Everything

```
CURRENT SPEC (3 external dependencies):
  @lancedb/lancedb          → Vector storage + search
  nomic-embed               → Embedding generation
  In-memory Ref             → Working/episodic (volatile)

PROPOSED (0 external packages for Tier 1, 1 for Tier 2):
  bun:sqlite (built-in)     → ALL structured storage + FTS5 full-text search
  sqlite-vec (Tier 2 only)  → Vector search extension loaded into bun:sqlite
  LLMService embeddings     → Use the agent's own LLM provider (no separate model)
```

### What Bun's SQLite Gives Us for Free

| Capability | How | Performance |
|---|---|---|
| ACID transactions | `db.transaction()` | Atomic memory writes — never corrupt state |
| WAL mode | `PRAGMA journal_mode = WAL` | Concurrent reads during writes |
| Full-text search (FTS5) | Built into SQLite | Sub-millisecond keyword search across all memory |
| JSON support | `json_extract()`, `json_each()` | Query structured metadata without parsing |
| Prepared statements | `db.query()` cached compilation | Repeated queries are near-zero cost |
| Serialization | `db.serialize()` → `Uint8Array` | Snapshot/backup entire memory to a single blob |
| 3-6x faster than better-sqlite3 | Bun's native C implementation | Benchmark-proven advantage |
| Extension loading | `db.loadExtension()` | Load sqlite-vec for vector search |
| No npm install needed | `import { Database } from "bun:sqlite"` | Zero dependency for Tier 1 |

### The Three-Layer Retrieval Stack (All In One DB)

```
┌──────────────────────────────────────────────────┐
│ Layer 3: Vector Search (sqlite-vec, Tier 2 only) │
│   KNN similarity search across embeddings         │
│   float[768] columns in vec0 virtual tables       │
├──────────────────────────────────────────────────┤
│ Layer 2: Full-Text Search (FTS5, built-in)       │
│   Natural language keyword search                 │
│   BM25 ranking, tokenization, stemming           │
├──────────────────────────────────────────────────┤
│ Layer 1: Structured Queries (SQL, built-in)      │
│   Exact lookup by ID, date range, category       │
│   JSON metadata queries                           │
└──────────────────────────────────────────────────┘

All three layers share the SAME database file.
```

This means:
- **Tier 1** (zero-dep) gets layers 1 + 2 for FREE
- **Tier 2** adds layer 3 with one `npm install sqlite-vec`
- No LanceDB. No separate vector DB process. No additional runtime.

---

## 2. Technology-by-Technology Analysis

### 2a. `bun:sqlite` — The Foundation

**What**: Bun's built-in high-performance SQLite3 driver.
**Why**: It's already in our runtime. Zero install. Fastest SQLite driver in the JS ecosystem.

**How It Fits the Memory Paradigm**:

```typescript
import { Database } from "bun:sqlite";

// Single database file per agent
const db = new Database(`.reactive-agents/memory/${agentId}/memory.db`, {
  create: true,
  strict: true,
});

// Enable WAL mode for concurrent read/write performance
db.run("PRAGMA journal_mode = WAL;");

// Schema for semantic memory
db.run(`
  CREATE TABLE IF NOT EXISTS semantic_memory (
    id TEXT PRIMARY KEY,
    section TEXT NOT NULL,
    content TEXT NOT NULL,
    importance REAL DEFAULT 0.5,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    access_count INTEGER DEFAULT 0,
    metadata TEXT  -- JSON blob
  )
`);

// Schema for episodic memory
db.run(`
  CREATE TABLE IF NOT EXISTS episodic_memory (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('daily_log', 'session_snapshot')),
    date TEXT NOT NULL,
    session_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    metadata TEXT
  )
`);

// Schema for procedural memory
db.run(`
  CREATE TABLE IF NOT EXISTS procedural_memory (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('workflow', 'pattern')),
    name TEXT NOT NULL,
    steps TEXT NOT NULL,      -- JSON array of steps
    learned_from TEXT,         -- JSON array of session refs
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    last_used TEXT,
    confidence REAL DEFAULT 0.5,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// FTS5 virtual table for full-text search across ALL memory
db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    content,
    source_table,
    source_id,
    tokenize='porter unicode61'
  )
`);
```

**Key Advantages for Our Paradigm**:
1. **ACID transactions** mean memory writes never half-complete (reliability)
2. **WAL mode** means reads never block on writes (performance)
3. **FTS5** gives Tier 1 powerful search without ANY embeddings (efficiency)
4. **Single file** per agent — backup is `cp memory.db memory.db.bak` (simplicity)
5. **`db.serialize()`** enables snapshotting to a `Uint8Array` (portability)

### 2b. SQLite FTS5 — Full-Text Search Without Embeddings

**What**: SQLite's built-in full-text search engine. Ships with every SQLite build.
**Why**: Gives Tier 1 users powerful search without requiring embeddings or a vector DB.

**How It Fits**:

```sql
-- Search across all memory content
SELECT 
  source_table,
  source_id,
  snippet(memory_fts, 0, '<b>', '</b>', '...', 32) as snippet,
  bm25(memory_fts) as relevance
FROM memory_fts 
WHERE memory_fts MATCH 'typescript AND preferences'
ORDER BY relevance
LIMIT 10;

-- Proximity search (words near each other)
SELECT * FROM memory_fts 
WHERE memory_fts MATCH 'NEAR(memory paradigm, 5)';

-- Prefix search
SELECT * FROM memory_fts 
WHERE memory_fts MATCH 'react*';
```

**BM25 ranking** provides relevance scoring that's surprisingly good for agent memory retrieval. Combined with the fact that all memory content is already well-structured markdown, FTS5 handles the "search old memories" use case effectively for corpora under ~100K entries.

**Performance**: FTS5 queries on corpora of 10K-50K entries return in < 1ms. This is faster than embedding + similarity search for most agent memory sizes.

### 2c. `sqlite-vec` — Vector Search as a Drop-In Extension

**What**: A lightweight SQLite extension that adds vector similarity search. 6.9K GitHub stars, actively maintained, Mozilla-sponsored.
**Why**: Replaces LanceDB entirely while keeping everything in one database file.

**How It Fits**:

```typescript
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const db = new Database(`.reactive-agents/memory/${agentId}/memory.db`);
sqliteVec.load(db);

// Create vector table alongside regular tables
db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
    embedding float[768],
    +source_table TEXT,
    +source_id TEXT
  )
`);

// Insert embedding (from any embedding provider)
const embedding = new Float32Array(768); // from LLMService.embed()
db.prepare(`
  INSERT INTO memory_vectors(rowid, embedding, source_table, source_id)
  VALUES (?, ?, ?, ?)
`).run(rowId, embedding, "semantic_memory", entryId);

// KNN search
const queryEmbedding = new Float32Array(768);
db.prepare(`
  SELECT 
    source_table,
    source_id,
    distance
  FROM memory_vectors
  WHERE embedding MATCH ?
  ORDER BY distance
  LIMIT 10
`).all(queryEmbedding);
```

**Advantages over LanceDB**:
| Aspect | LanceDB | sqlite-vec |
|---|---|---|
| Install | `npm install @lancedb/lancedb` (heavy native dep) | `npm install sqlite-vec` (lightweight) |
| Runtime | Separate process/API | Same bun:sqlite process |
| Data co-location | Separate .lance directory | SAME .db file as all other memory |
| Transactions | Separate from main data | ACID-consistent with all memory |
| Backup | Separate backup needed | Single file backup |
| Rebuilding | Separate rebuild mechanism | `DROP TABLE + re-create` from source data |
| Metadata queries | Separate query language | Standard SQL joins with all tables |
| Bun compatibility | Requires special build flags | Explicitly supports bun:sqlite |

**sqlite-vec API supports**:
- `float[N]` vectors (any dimension — works with nomic-768, ada-1536, etc.)
- `int8[N]` quantized vectors (4x smaller, ~95% accuracy)
- Binary vectors (32x smaller, for coarse filtering)
- L2 distance, cosine distance, hamming distance
- Matryoshka embedding slicing (`vec_slice` + `vec_normalize`)
- Metadata columns alongside vectors
- KNN queries with `WHERE ... MATCH` syntax

### 2d. `unified` / `remark` — Structured Markdown Processing

**What**: The unified ecosystem (500+ packages) for parsing, transforming, and serializing structured content. `remark` is the markdown-specific ecosystem.
**Why**: Enables structured read/write of markdown memory files without fragile regex parsing.

**How It Fits**:

```typescript
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { visit } from "unist-util-visit";

// Parse memory.md into an AST
const tree = unified()
  .use(remarkParse)
  .parse(memoryFileContent);

// Walk the AST to extract sections
const sections: Map<string, string[]> = new Map();
visit(tree, "heading", (node, index, parent) => {
  if (node.depth === 2) {
    const sectionName = node.children
      .filter(c => c.type === "text")
      .map(c => c.value)
      .join("");
    // Collect list items under this heading
    // ...
  }
});

// Programmatically modify a section and re-serialize
// → Update "User Preferences" section
// → Re-stringify to clean markdown
const output = unified()
  .use(remarkParse)
  .use(remarkStringify)
  .processSync(modifiedTree);
```

**Why this matters for reliability**:

| Problem | Regex Approach | AST Approach (unified/remark) |
|---|---|---|
| Find section "User Preferences" | Fragile: `/^## User Preferences\n([\s\S]*?)(?=^##|\Z)/m` | Robust: `visit(tree, "heading", ...)` |
| Append item to section | String manipulation, error-prone | Insert node into parent's children array |
| Enforce 200-line cap | Count `\n` characters | Count AST nodes by type |
| Handle edge cases (nested lists, code blocks) | Breaks on complex markdown | Correct by construction |
| Validate memory format | Custom parser needed | Validate AST structure |

**However — this is an OPTIONAL optimization**. For v1, simple string splitting on `## ` headers + line-based operations is sufficient and avoids adding a dependency. The unified ecosystem is a **Phase 2 upgrade** for when memory format complexity increases.

**Recommendation**: Start WITHOUT unified/remark. Use simple string operations for v1. Add unified/remark as an optional enhancement when memory format needs become complex.

### 2e. `gray-matter` — Frontmatter Parsing

**What**: Parses YAML/TOML frontmatter from markdown files. Used by Jekyll, Hugo, Gatsby, etc.
**Why**: Could add structured metadata to memory files.

```markdown
---
agent_id: agent-001
last_consolidated: 2026-02-17T15:30:00Z
entry_count: 42
version: 2
---

# Agent Memory: agent-001

## User Preferences
...
```

**Verdict**: **SKIP for now**. The metadata we need (agent_id, timestamps) is better stored in SQLite columns alongside the content. Frontmatter adds complexity without clear benefit when we have a proper database.

### 2f. Anthropic Prompt Caching — Bootstrap Loading Optimization

**What**: Anthropic's prompt caching feature allows marking portions of the system prompt as cacheable. Cached content is served from memory on subsequent requests at reduced cost and latency.
**Why**: The memory bootstrap (semantic memory + recent episodes) is injected into EVERY prompt. Caching this portion saves 90% of the tokens for that section on subsequent turns.

**How It Fits**:

```typescript
// In MemoryService.bootstrap():
const semanticMemory = await SemanticMemoryService.loadAll(agentId);
const recentEpisodes = await EpisodicMemoryService.loadRecent(agentId, 3);

// Mark memory sections as cacheable in the system prompt
const systemPrompt = [
  {
    type: "text",
    text: baseInstructions,
  },
  {
    type: "text",
    text: `=== SEMANTIC MEMORY ===\n${semanticMemory}`,
    cache_control: { type: "ephemeral" },  // Cache this!
  },
  {
    type: "text",
    text: `=== RECENT CONTEXT ===\n${recentEpisodes}`,
    cache_control: { type: "ephemeral" },  // Cache this too!
  },
];
```

**Impact on costsper session**:

| Without Caching | With Caching |
|---|---|
| 2000 token semantic memory × 30 turns = 60,000 input tokens | 2000 tokens cached × $0.30/MTok (vs $3/MTok) = **90% savings** |
| ~$0.18 per session (Claude Sonnet) | ~$0.02 per session |

**Implementation note**: This is LLM-provider-specific. Should be implemented in `@reactive-agents/llm-provider` (L1.5) as an optional optimization, not in the memory layer itself. The memory layer just provides the content; the LLM layer handles caching mechanics.

**Recommendation**: Design the bootstrap API so the LLM provider CAN cache memory sections, but don't require it. L1.5 spec should add support for cache-able system prompt sections.

---

## 3. The Streamlined Architecture

Putting it all together, here's the technology stack for each tier:

### Tier 1: Zero External Dependencies

```
Runtime:     bun (already required)
Storage:     bun:sqlite (built-in)
Search:      FTS5 (built-in to SQLite)
File I/O:    node:fs (built-in)
Markdown:    String operations (no library)
```

**Capabilities at Tier 1**:
- ✅ All 4 memory types (semantic, episodic, procedural, working)
- ✅ All 6 persistence mechanisms
- ✅ Full-text search with BM25 ranking
- ✅ SQL queries (date range, category, importance, etc.)
- ✅ Markdown export/import for human readability
- ✅ ACID transactions for reliability
- ✅ Backup/restore via file copy
- ❌ No vector similarity search
- ❌ No embedding-based retrieval

### Tier 2: One Additional Package

```
Additional:  sqlite-vec (npm install sqlite-vec)
             Embedding via LLMService (already in L1.5)
```

**Additional capabilities at Tier 2**:
- ✅ Everything from Tier 1
- ✅ Vector similarity search (KNN)
- ✅ Semantic retrieval across all memory
- ✅ Cosine distance, L2 distance, hamming distance
- ✅ Quantized vectors (int8) for 4x storage reduction
- ✅ All in the SAME database file as Tier 1 data

### Dependency Comparison

```
BEFORE (Current L2 Spec):
  @lancedb/lancedb     →  Heavy native dependency, separate data files
  nomic-embed model    →  Requires download/API access
  In-memory only       →  Episodic memory lost on restart

AFTER (Proposed):
  Tier 1: ZERO npm packages (bun:sqlite + node:fs are built-in)
  Tier 2: ONE npm package (sqlite-vec)
  Embeddings: LLMService from L1.5 (already required for the agent)
```

---

## 4. Revised Data Flow Architecture

### Memory Write Flow

```
Conversation Turn
       │
       ▼
┌─────────────────────────┐
│  MemoryExtractor (LLM)  │  "Is this worth remembering?"
│  [Optional in Tier 1]   │
└─────────┬───────────────┘
          │ { category, content, importance }
          ▼
┌─────────────────────────┐
│  Category Router         │  Semantic? Episodic? Procedural?
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│  SQLite Transaction      │
│  ┌───────────────────┐  │
│  │ INSERT into table  │  │  ← structured data
│  │ INSERT into FTS5   │  │  ← full-text index
│  │ INSERT into vec0   │  │  ← vector index (Tier 2)
│  └───────────────────┘  │
│  COMMIT                  │  ← All-or-nothing, ACID
└─────────────────────────┘
          │
          ▼
┌─────────────────────────┐
│  Markdown Export         │  Write .md file for human readability
│  [Async, non-blocking]  │  (derived from SQLite, not source of truth)
└─────────────────────────┘
```

### Memory Read Flow (Bootstrap)

```
Session Start
       │
       ▼
┌─────────────────────────────────────────┐
│  SQLite: Load semantic memory           │  SELECT * FROM semantic_memory
│  SQLite: Load recent daily logs         │  WHERE date >= date('now', '-3 days')
│  SQLite: Load relevant procedures       │  WHERE name MATCH task_keywords
│                                          │
│  All queries: < 1ms each                │
└─────────────────────┬───────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────┐
│  Format as Markdown for Context Window  │
│  (LLMs read markdown natively)          │
└─────────────────────┬───────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────┐
│  Inject into System Prompt              │
│  [With cache_control if LLM supports]   │
└─────────────────────────────────────────┘
```

### Memory Search Flow

```
Query: "What did we discuss about TypeScript preferences?"
       │
       ├──────── Tier 1 ──────────────────────────┐
       │                                           │
       │  FTS5: WHERE memory_fts MATCH             │
       │        'typescript preferences'            │
       │  Result: BM25-ranked content matches      │
       │  Latency: < 1ms                           │
       │                                           │
       ├──────── Tier 2 (additional) ──────────────┤
       │                                           │
       │  sqlite-vec: WHERE embedding MATCH        │
       │              embed('typescript prefs')     │
       │  Result: Top-K semantically similar        │
       │  Latency: ~10-50ms (embedding + search)   │
       │                                           │
       └──────── Merge & Rank ────────────────────┘
                      │
                      ▼
              Deduplicated, ranked results
```

---

## 5. Paradigm Refinement: SQLite as Source of Truth, Markdown as Projection

After analyzing the technologies, the optimal architecture **refines** the original exploration:

### Original Paradigm
```
Markdown files = Source of truth
Vector index = Derived view (rebuildable)
```

### Refined Paradigm
```
SQLite database = Operational source of truth (ACID, searchable, fast)
Markdown files = Human-readable projection (always derivable from SQLite)
Vector index = Derived view within the same SQLite DB (Tier 2)
```

### Why This Refinement Is Better

| Concern | Markdown-as-Truth | SQLite-as-Truth + MD Projection |
|---|---|---|
| ACID writes | ❌ No (fs.writeFile can corrupt) | ✅ Yes (SQLite transactions) |
| Concurrent access | ❌ Race conditions on file write | ✅ WAL mode handles it |
| Search performance | ❌ Requires reading all files | ✅ FTS5 index, sub-ms |
| Structured queries | ❌ Regex/string parsing | ✅ SQL WHERE clauses |
| Human readable | ✅ Direct file edit | ✅ Markdown export (auto-generated) |
| Git-friendly | ✅ Native | ✅ Export .md files, gitignore .db |
| Backup | ✅ cp -r | ✅ cp memory.db (single file, or serialize()) |
| Import from files | N/A | ✅ Import markdown → parse → INSERT |
| Data integrity | ❌ Partial writes, no constraints | ✅ CHECK constraints, NOT NULL, etc. |

### How Human-Readability Is Preserved

The `MemoryFileSystem` service operates in TWO modes:

```
Mode A: "Export on write" (default)
  Every SQLite write ALSO writes the corresponding .md file
  .md files are always up-to-date projections
  Humans can read/edit .md files
  On next load, agent checks if .md was modified externally
    → If yes: import changes back into SQLite
    → If no: .md file is just a view

Mode B: "Export on demand"
  .md files are generated only when explicitly requested
  Lighter I/O footprint
  For production/headless agents
```

This gives us the **best of both worlds**: ACID reliability under the hood, human-readable markdown on the surface.

---

## 6. Effect-TS Service Architecture with SQLite

```typescript
// === Service Tags ===

// The SQLite database connection for memory
const MemoryDatabase = Context.Tag<MemoryDatabase, Database>("MemoryDatabase");

// Memory File System (markdown import/export)
const MemoryFileSystem = Context.Tag<MemoryFileSystem, {
  readonly exportMarkdown: (agentId: string) => Effect.Effect<void, MemoryError>;
  readonly importMarkdown: (agentId: string) => Effect.Effect<void, MemoryError>;
  readonly watchForExternalEdits: (agentId: string) => Effect.Effect<void, MemoryError>;
}>("MemoryFileSystem");

// Core memory services read/write SQLite
const SemanticMemoryService = Context.Tag<SemanticMemoryService, {
  readonly load: (agentId: string) => Effect.Effect<string, MemoryError>;
  readonly update: (agentId: string, section: string, content: string) => Effect.Effect<void, MemoryError>;
  readonly consolidate: (agentId: string) => Effect.Effect<void, MemoryError>;
}>("SemanticMemoryService");

// Search service unifies FTS5 + optional vector search
const MemorySearchService = Context.Tag<MemorySearchService, {
  readonly search: (query: string, options: SearchOptions) => Effect.Effect<SearchResults, MemoryError>;
  readonly searchSemantic: (embedding: Float32Array, k: number) => Effect.Effect<SearchResults, MemoryError>;
}>("MemorySearchService");
```

### Revised Build Order (Preview)

```
 1. src/types.ts           → Schema types
 2. src/errors.ts          → TaggedErrors
 3. src/database.ts        → MemoryDatabase Layer (bun:sqlite setup, migrations)
 4. src/search.ts          → MemorySearchService (FTS5 + optional sqlite-vec)
 5. src/services/working.ts    → WorkingMemoryService (Ref, in-memory)
 6. src/services/semantic.ts   → SemanticMemoryService (SQLite read/write)
 7. src/services/episodic.ts   → EpisodicMemoryService (daily logs + snapshots)
 8. src/services/procedural.ts → ProceduralMemoryService (workflows + patterns)
 9. src/fs/export.ts       → MemoryFileSystem (markdown export/import)
10. src/compaction.ts      → CompactionService (4 strategies)
11. src/extraction.ts      → MemoryExtractor (LLM-driven, optional)
12. src/consolidation.ts   → MemoryConsolidator (LLM-driven, optional)
13. src/zettelkasten.ts    → ZettelkastenService (link graph in SQLite)
14. src/memory-service.ts  → MemoryService orchestrator
15. src/runtime.ts         → createMemoryLayer factory (Tier 1 / Tier 2)
16. src/index.ts           → Public re-exports
17. Tests for each module
```

---

## 7. Performance Projections

### Read Performance (Bootstrap Loading)

| Operation | Markdown Files | SQLite (Tier 1) | SQLite + vec (Tier 2) |
|---|---|---|---|
| Load semantic memory | 1-5ms (fs.readFile) | < 0.5ms (prepared query) | < 0.5ms |
| Load last 3 daily logs | 3-15ms (3× fs.readFile) | < 0.5ms (single query) | < 0.5ms |
| Search all memory (keyword) | 50-200ms (read all files + regex) | < 1ms (FTS5) | < 1ms (FTS5) |
| Search all memory (semantic) | N/A | N/A | 10-50ms (embed + KNN) |
| Total bootstrap time | 10-30ms | < 2ms | < 2ms |

### Write Performance

| Operation | Markdown Files | SQLite |
|---|---|---|
| Write 1 memory entry | 2-5ms (fs.writeFile) | < 0.1ms (INSERT) |
| Write 1 entry + FTS index | N/A | < 0.2ms (INSERT × 2) |
| Write 1 entry + FTS + vector | N/A | < 0.5ms (INSERT × 3) |
| Batch write 100 entries | 200-500ms (100× fs.writeFile) | < 5ms (transaction) |
| Export to markdown | N/A (it IS the markdown) | 5-20ms (query + format + write) |

### Storage Efficiency

| Corpus Size | Markdown Files | SQLite | SQLite + Vectors |
|---|---|---|---|
| 1K memories | ~500KB (many small files) | ~200KB (single file) | ~3.2MB (+3MB vectors) |
| 10K memories | ~5MB (many files, slow dir listing) | ~2MB (single file) | ~32MB |
| 100K memories | ~50MB (filesystem starts to struggle) | ~20MB (still fast) | ~320MB |

---

## 8. Migration from Current Spec

### Dependencies Removed
```diff
- "@lancedb/lancedb": "^0.x"        # Heavy native dependency
- nomic-embed model download/access  # Separate embedding infrastructure
```

### Dependencies Added (Tier 2 only)
```diff
+ "sqlite-vec": "^0.1.x"            # Lightweight SQLite extension (~2MB)
```

### Dependencies Unchanged
```
bun:sqlite   (built-in, was not previously used — now replaces LanceDB)
node:fs      (built-in, still needed for markdown export)
effect       (already required)
```

### What This Means for Other Layers

| Layer | Impact |
|---|---|
| L1 Core | None |
| L1.5 LLM Provider | Add optional `embed()` method to LLMService for Tier 2 |
| L3 Reasoning | Procedural memory integration (consult learned procedures) |
| L5 Cost | Embedding calls tracked through existing cost infrastructure |
| L7 Orchestration | Multi-agent memory via shared SQLite DB or separate DBs |
| L9 Observability | Memory operations emit spans/metrics (query times, write counts) |

---

## 9. Technologies Evaluated and Rejected

| Technology | What It Does | Why Rejected |
|---|---|---|
| **LanceDB** | Vector DB | Replaced by sqlite-vec — same capability, fewer deps, co-located data |
| **Turso/libSQL** | Distributed SQLite | Over-engineered for local agent memory; adds complexity |
| **Vectra** | Local vector index (JSON files) | sqlite-vec is more capable and integrates with our SQLite |
| **Chromadb** | Vector store | Requires separate server process; sqlite-vec is embedded |
| **gray-matter** | Frontmatter parsing | Metadata belongs in SQLite columns, not file frontmatter |
| **unified/remark** | Markdown AST | Overkill for v1; simple string ops suffice. Revisit in Phase 2 |
| **CRDT libraries** | Conflict resolution | Premature for v1 multi-agent; git-like merge is simpler |
| **Drizzle/Prisma** | SQL ORM | Too heavy for our single-table-per-type schema; raw bun:sqlite is cleaner with Effect-TS |
| **better-sqlite3** | Node SQLite driver | bun:sqlite is 3-6x faster and built-in |
| **nomic-embed** | Dedicated embedding model | Use the agent's own LLMService.embed() instead — one less model to manage |

---

## 10. Summary: The Streamlined Path

### Before (Current Spec)
```
3 external deps (LanceDB + nomic + separate embedding infra)
Volatile episodic memory (in-memory only)
No full-text search
No ACID guarantees
Complex setup
```

### After (Proposed)
```
0 external deps for Tier 1 (bun:sqlite is built-in)
1 external dep for Tier 2 (sqlite-vec, ~2MB)
Persistent everything (ACID transactions)
3-layer search (SQL + FTS5 + optional vectors)
Single database file per agent
Human-readable markdown export
Dramatically simpler setup
```

### The Stack in One Line

> **`bun:sqlite` (ACID storage + FTS5 search) + `sqlite-vec` (optional vector search) + markdown export (human readability) = everything we need.**

### Recommended Next Steps

1. **Accept this technology stack** → updates the paradigm exploration doc
2. **Rewrite L2 spec** with SQLite-as-truth + markdown-as-projection architecture
3. **Update L1.5 spec** to add optional `embed()` method on LLMService
4. **Update master-architecture** and reference docs with new dependency tree

---

*This document is a technology analysis companion to `EXPLORATION-memory-paradigm.md`. Together they define the complete paradigm + technology stack for the memory layer rewrite.*
