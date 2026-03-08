import { Effect, Context, Layer } from "effect";
import { MemoryDatabase } from "./database.js";
import type { SearchOptions, SemanticEntry, DailyLogEntry } from "./types.js";
import type { MemoryId } from "./types.js";
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
     * Returns DatabaseError if vec0 extension not loaded.
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
            id: r.id as MemoryId,
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
            id: r.id as MemoryId,
            agentId: r.agent_id,
            date: r.date,
            content: r.content,
            taskId: r.task_id ?? undefined,
            eventType: r.event_type as DailyLogEntry["eventType"],
            cost: r.cost ?? undefined,
            duration: r.duration ?? undefined,
            metadata: JSON.parse(r.metadata),
            createdAt: new Date(r.created_at),
          })) satisfies DailyLogEntry[];
        }),

      // Tier 2 — cosine similarity KNN on embedding BLOBs
      searchVector: (queryEmbedding, agentId, limit) =>
        Effect.gen(function* () {
          // Fetch all entries with embeddings for this agent
          const rows = yield* db.query<{
            id: string;
            agent_id: string;
            content: string;
            summary: string;
            importance: number;
            verified: number;
            tags: string;
            embedding: ArrayBuffer | null;
            created_at: string;
            updated_at: string;
            access_count: number;
            last_accessed_at: string;
          }>(
            `SELECT * FROM semantic_memory
             WHERE agent_id = ? AND embedding IS NOT NULL`,
            [agentId],
          );

          if (rows.length === 0) return [];

          // Compute cosine similarity for each row
          const scored = rows
            .map((r) => {
              if (!r.embedding) return null;
              const buf = r.embedding instanceof ArrayBuffer
                ? r.embedding
                : (r.embedding as unknown as Uint8Array).buffer;
              const stored = Array.from(new Float32Array(buf));
              const sim = cosineSimilarity(queryEmbedding, stored);
              return { row: r, similarity: sim };
            })
            .filter(
              (x): x is { row: (typeof rows)[0]; similarity: number } =>
                x !== null,
            );

          // Sort by similarity descending, take top N
          scored.sort((a, b) => b.similarity - a.similarity);
          const topN = scored.slice(0, limit);

          return topN.map(({ row: r }) => ({
            id: r.id as MemoryId,
            agentId: r.agent_id,
            content: r.content,
            summary: r.summary,
            importance: r.importance,
            verified: Boolean(r.verified),
            tags: JSON.parse(r.tags),
            embedding: r.embedding
              ? Array.from(new Float32Array(r.embedding))
              : undefined,
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
            accessCount: r.access_count,
            lastAccessedAt: new Date(r.last_accessed_at),
          })) satisfies SemanticEntry[];
        }),
    };
  }),
);

/** Cosine similarity between two vectors. Returns 0 if either has zero magnitude. */
function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
