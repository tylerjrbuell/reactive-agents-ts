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
    ) => Effect.Effect<SemanticEntry, MemoryNotFoundError | DatabaseError>;

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
            const importanceBar = "\u2588".repeat(
              Math.round(entry.importance * 5),
            );
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
