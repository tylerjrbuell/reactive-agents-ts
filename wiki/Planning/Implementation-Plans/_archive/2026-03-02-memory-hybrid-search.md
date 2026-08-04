# Memory Layer: Hybrid Search & Advanced Retrieval

**Date**: 2026-03-02
**Package**: `@reactive-agents/memory`
**Status**: Design — pending approval

---

## Motivation

The current memory layer has solid FTS5 keyword search and a well-designed schema, but vector search is stubbed, embeddings are never generated, and there's no way to combine search modes. This plan addresses the full gap between what exists and production-grade agent memory retrieval.

**Source**: Analysis of advanced agent memory patterns (hybrid search, fusion, re-ranking, two-step retrieval, embedding caching).

---

## Current State

| Feature | Status |
|---------|--------|
| FTS5 keyword search (BM25 ranking) | ✅ Full |
| FTS5 incremental sync (triggers) | ✅ Full |
| SQLite WAL + foreign keys | ✅ Full |
| `embedding BLOB` column on `semantic_memory` | ✅ Schema exists |
| `searchVector()` | ❌ Stubbed — returns error |
| Embedding generation (`LLMService.embed()`) | ❌ Never called |
| Embedding cache (content hashing) | ❌ Missing |
| sqlite-vec KNN index | ❌ Not created |
| Hybrid search (keyword + vector) | ❌ Missing |
| Score fusion (weighted / RRF) | ❌ Missing |
| Re-ranking (LLM second pass) | ❌ Missing |
| Two-step search-then-get | ❌ Missing |
| Performance indexes (agent_id, etc.) | ❌ Missing |

---

## Implementation Plan

### Phase 1: Embedding Generation & Caching

**Goal**: Populate the `embedding` column and avoid redundant embed calls.

#### 1.1 — Content Hash Column

Add `content_hash TEXT` column to `semantic_memory`. SHA-256 of `content` field. Used to skip re-embedding unchanged content.

```sql
ALTER TABLE semantic_memory ADD COLUMN content_hash TEXT;
```

On insert/update: compute hash, check if existing row has same hash → skip embed call.

#### 1.2 — EmbedOnWrite Hook

When `SemanticMemoryService.store()` or `.update()` is called:

1. Compute `content_hash = SHA-256(content)`
2. If existing row has same `content_hash` → keep existing embedding
3. Else → call `LLMService.embed(content)` → store Float32Array in `embedding` column + update `content_hash`

**Dependency**: `LLMService` must be available in the memory layer. Use `Effect.serviceOption(LLMService)` — if no LLM configured, skip embedding (graceful degradation).

#### 1.3 — Batch Backfill Utility

`MemoryService.backfillEmbeddings()` — iterates all rows where `embedding IS NULL`, generates embeddings in batches. Respects rate limits. Used for migration of existing data.

---

### Phase 2: sqlite-vec Integration & Vector Search

**Goal**: Enable KNN queries over embeddings.

#### 2.1 — vec0 Virtual Table

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS semantic_vec USING vec0(
  embedding float[1536]
);
```

Dimension configurable (1536 for OpenAI `text-embedding-3-small`, 768 for others). Resolved from `EmbeddingConfig`.

#### 2.2 — vec0 Sync Triggers

Mirror the FTS5 trigger pattern:

```sql
CREATE TRIGGER semantic_vec_insert AFTER INSERT ON semantic_memory
WHEN NEW.embedding IS NOT NULL
BEGIN
  INSERT INTO semantic_vec(rowid, embedding) VALUES (NEW.rowid, NEW.embedding);
END;

CREATE TRIGGER semantic_vec_update AFTER UPDATE OF embedding ON semantic_memory
WHEN NEW.embedding IS NOT NULL
BEGIN
  DELETE FROM semantic_vec WHERE rowid = OLD.rowid;
  INSERT INTO semantic_vec(rowid, embedding) VALUES (NEW.rowid, NEW.embedding);
END;

CREATE TRIGGER semantic_vec_delete AFTER DELETE ON semantic_memory
BEGIN
  DELETE FROM semantic_vec WHERE rowid = OLD.rowid;
END;
```

#### 2.3 — `searchVector()` Implementation

Replace the stub with actual KNN query:

```sql
SELECT sm.*, distance
FROM semantic_vec sv
JOIN semantic_memory sm ON sm.rowid = sv.rowid
WHERE sv.embedding MATCH ?  -- query embedding
  AND k = ?                 -- limit
  AND sm.agent_id = ?
ORDER BY distance ASC;
```

Input: query string → `LLMService.embed(query)` → KNN search.
Output: `SemanticEntry[]` with `distance` score.

---

### Phase 3: Hybrid Search & Fusion

**Goal**: Combine keyword + vector search into a single entrypoint with configurable fusion.

#### 3.1 — `searchHybrid()` Method

```typescript
interface HybridSearchOptions {
  query: string;
  agentId: string;
  limit?: number;            // default 10
  vectorWeight?: number;     // default 0.7 (70% vector, 30% keyword)
  fusionMethod?: "weighted" | "rrf";  // default "weighted"
}
```

Runs `searchSemantic()` and `searchVector()` in parallel, then fuses results.

#### 3.2 — Weighted Score Fusion

1. Normalize FTS5 BM25 ranks to 0–1 range: `score = 1 / (1 + Math.abs(rank))`
2. Normalize vector distances to 0–1 range: `score = 1 / (1 + distance)`
3. Combined: `finalScore = vectorWeight * vectorScore + (1 - vectorWeight) * keywordScore`
4. Deduplicate by `id`, keep highest combined score
5. Sort descending, take `limit`

#### 3.3 — Reciprocal Rank Fusion (RRF)

Alternative fusion when scores aren't directly comparable:

```
RRF_score(d) = Σ 1 / (k + rank_i(d))
```

Where `k = 60` (standard constant), `rank_i(d)` is the rank of document `d` in result list `i`.

- Union all result IDs across both lists
- For each ID, compute RRF score from its rank in each list (use `Infinity` rank if absent)
- Sort by RRF score descending

---

### Phase 4: Re-ranking

**Goal**: Optional LLM-based re-ranking pass for highest-accuracy retrieval.

#### 4.1 — `RerankService`

```typescript
interface RerankOptions {
  query: string;
  results: SemanticEntry[];
  topK?: number;           // default 5
  model?: string;          // optional, uses default LLM
}
```

Implementation:
1. Format results as numbered list with content snippets (first 200 chars)
2. Prompt LLM: "Rank these results by relevance to the query. Return ordered list of IDs."
3. Parse response → reorder results
4. Return top `topK`

**Opt-in only** — adds latency. Configured via `HybridSearchOptions.rerank?: boolean`.

#### 4.2 — Graceful Fallback

If LLM unavailable or rerank fails → return fusion results unchanged. Log warning.

---

### Phase 5: Two-Step Search Pattern

**Goal**: Keep context windows lean by separating search from retrieval.

#### 5.1 — `searchIds()` Lightweight Method

Returns `{ id: string; score: number; snippet: string }[]` — no full content, no embeddings.

```sql
SELECT sm.id, sm.content AS snippet, sv.distance AS score
FROM semantic_vec sv
JOIN semantic_memory sm ON sm.rowid = sv.rowid
WHERE ...
```

`snippet` is first 150 chars of content. Score is the fusion/rerank score.

#### 5.2 — `getByIds()` Batch Retrieval

```typescript
getByIds(ids: string[]): Effect<SemanticEntry[]>
```

Fetches full entries for selected IDs only. Uses `WHERE id IN (?, ?, ...)`.

#### 5.3 — Agent Tool: `memory-search` / `memory-get`

Expose two-step pattern as built-in tools:

- **`memory-search`**: `{ query: string, limit?: number }` → returns ID + snippet + score list
- **`memory-get`**: `{ ids: string[] }` → returns full entries

Agents can search broadly, then selectively retrieve what they need.

---

### Phase 6: Performance Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_semantic_agent ON semantic_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_semantic_importance ON semantic_memory(importance DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_created ON semantic_memory(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_episodic_date ON episodic_log(date DESC);
CREATE INDEX IF NOT EXISTS idx_episodic_event_type ON episodic_log(event_type);
```

Add to `initializeDatabase()` in `database.ts`.

---

## Implementation Order

```
Phase 6 (indexes)           — quick win, no dependencies
Phase 1 (embeddings)        — unblocks everything else
Phase 2 (sqlite-vec)        — unblocks vector search
Phase 3 (hybrid + fusion)   — the main feature
Phase 5 (two-step pattern)  — lean retrieval for agents
Phase 4 (re-ranking)        — accuracy polish, opt-in
```

## Files Affected

| File | Changes |
|------|---------|
| `packages/memory/src/database.ts` | Indexes, `content_hash` column, vec0 table, vec0 triggers |
| `packages/memory/src/search.ts` | `searchVector()` real impl, `searchHybrid()`, `searchIds()`, fusion logic |
| `packages/memory/src/services/semantic-memory.ts` | Embed-on-write hook, `getByIds()`, `backfillEmbeddings()` |
| `packages/memory/src/services/memory-service.ts` | Expose hybrid search in public API |
| `packages/memory/src/types.ts` | `HybridSearchOptions`, `RerankOptions`, `SearchResult` types |
| `packages/memory/src/compaction/compaction-service.ts` | Update similarity compaction to use vector distance |
| `packages/memory/src/indexing/zettelkasten.ts` | Upgrade auto-linking to use vector similarity |
| `packages/tools/src/builtin-tools.ts` | `memory-search` and `memory-get` tool definitions |
| New: `packages/memory/src/search/fusion.ts` | Weighted score + RRF fusion implementations |
| New: `packages/memory/src/search/rerank.ts` | LLM-based re-ranking service |
| New: `packages/memory/tests/hybrid-search.test.ts` | Hybrid search + fusion tests |
| New: `packages/memory/tests/embedding-cache.test.ts` | Embed-on-write + content hash tests |
| New: `packages/memory/tests/rerank.test.ts` | Re-ranking tests |

## Configuration

```typescript
// Builder API
const agent = await ReactiveAgents.create()
  .withMemory({
    hybrid: true,                    // enable hybrid search (default: false)
    vectorWeight: 0.7,               // 70% vector, 30% keyword
    fusionMethod: "weighted",        // "weighted" | "rrf"
    rerank: false,                   // LLM re-ranking (default: false)
    embeddingModel: "text-embedding-3-small",
    embeddingDimension: 1536,
  })
  .build();
```

## Open Questions

1. **sqlite-vec as optional dependency?** — Not all deployments need vector search. Could make it a peer dep that's checked at runtime.
2. **Embedding dimension config** — Should we auto-detect from the model or require explicit config?
3. **Rerank cost** — Each rerank call costs an LLM request. Should there be a budget cap or only trigger above N results?
4. **Zettelkasten upgrade** — Should auto-linking switch from FTS5 keyword match to vector cosine similarity? Or keep both?
