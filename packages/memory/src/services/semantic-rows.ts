// Shared semantic_memory row mapping and text search.
//
// One home for turning a `semantic_memory` row into a `SemanticEntry`
// (including provenance) and for the FTS5 / LIKE text search, so
// `SemanticMemoryService.search` and `MemorySearchService.searchSemantic`
// cannot drift apart.

import { Effect } from "effect";
import type { MemoryDatabaseService } from "../database.js";
import type { DatabaseError } from "../errors.js";
import type { MemoryId, SearchOptions, SemanticEntry } from "../types.js";
import { safeJsonParse } from "../json-utils.js";
import { toFts5Query } from "../fts5-query.js";
import { provenanceClause } from "../provenance-filter.js";
import { escapeLike } from "../path-safety.js";

const decodeEmbedding = (raw: unknown): number[] | undefined => {
  if (!raw) return undefined;
  const buffer =
    raw instanceof ArrayBuffer ? raw : ((raw as Uint8Array).buffer as ArrayBuffer);
  return Array.from(new Float32Array(buffer));
};

/** Map a `semantic_memory` row (SELECT *) to a `SemanticEntry`. */
export const rowToSemanticEntry = (r: Record<string, unknown>): SemanticEntry => {
  const embedding = decodeEmbedding(r.embedding);
  const taskId = typeof r.task_id === "string" ? r.task_id : undefined;
  const runId = typeof r.run_id === "string" ? r.run_id : undefined;
  return {
    id: r.id as MemoryId,
    agentId: r.agent_id as string,
    content: r.content as string,
    summary: r.summary as string,
    importance: r.importance as number,
    verified: Boolean(r.verified),
    tags: safeJsonParse<string[]>(r.tags as string | null, []),
    ...(embedding !== undefined ? { embedding } : {}),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    accessCount: r.access_count as number,
    lastAccessedAt: new Date(r.last_accessed_at as string),
    ...(taskId !== undefined ? { taskId } : {}),
    ...(runId !== undefined ? { runId } : {}),
  };
};

/**
 * Text search over one agent's semantic memory. FTS5 ranked when available,
 * LIKE on content otherwise (Node's built-in sqlite). `taskId` / `runId`
 * narrow results to entries a given task or run wrote.
 */
export const searchSemanticRows = (
  db: MemoryDatabaseService,
  options: SearchOptions,
): Effect.Effect<SemanticEntry[], DatabaseError> =>
  Effect.gen(function* () {
    const limit = options.limit ?? 10;
    const ftsQuery = toFts5Query(options.query);
    if (db.hasFTS5 && ftsQuery.length === 0) return [];

    const { sql: extra, params: filterParams } = provenanceClause(options, "sm.");

    const rows = db.hasFTS5
      ? yield* db.query(
          `SELECT sm.*
           FROM semantic_memory sm
           JOIN semantic_fts ON semantic_fts.id = sm.id
           WHERE semantic_fts MATCH ?
             AND sm.agent_id = ? ${extra}
           ORDER BY rank
           LIMIT ?`,
          [ftsQuery, options.agentId, ...filterParams, limit],
        )
      : yield* db.query(
          `SELECT sm.*
           FROM semantic_memory sm
           WHERE sm.content LIKE ? ESCAPE '\\'
             AND sm.agent_id = ? ${extra}
           ORDER BY sm.created_at DESC
           LIMIT ?`,
          [`%${escapeLike(options.query)}%`, options.agentId, ...filterParams, limit],
        );

    return rows.map(rowToSemanticEntry);
  });
