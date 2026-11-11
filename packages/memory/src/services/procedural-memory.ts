import { Effect, Context, Layer } from "effect";
import type { ProceduralEntry, MemoryId, MemoryProvenance } from "../types.js";
import { provenanceClause } from "../provenance-filter.js";
import { DatabaseError, MemoryNotFoundError } from "../errors.js";
import { MemoryDatabase } from "../database.js";
import { safeJsonParse } from "../json-utils.js";

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
    ) => Effect.Effect<ProceduralEntry, MemoryNotFoundError | DatabaseError>;

    /** Update success rate and use count after execution. */
    readonly recordOutcome: (
      id: MemoryId,
      success: boolean,
    ) => Effect.Effect<void, DatabaseError>;

    /** Delete a workflow. Deleting an unknown id is a no-op. */
    readonly delete: (id: MemoryId) => Effect.Effect<void, DatabaseError>;

    /**
     * List active workflows for an agent (sorted by success rate). `filter`
     * narrows to workflows a given task and/or run wrote (provenance).
     */
    readonly listActive: (
      agentId: string,
      filter?: MemoryProvenance,
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
      tags: safeJsonParse<string[]>(r.tags as string | null, []),
      createdAt: new Date(r.created_at as string),
      updatedAt: new Date(r.updated_at as string),
      ...(typeof r.task_id === "string" ? { taskId: r.task_id } : {}),
      ...(typeof r.run_id === "string" ? { runId: r.run_id } : {}),
    });

    return {
      store: (entry) =>
        Effect.gen(function* () {
          yield* db.exec(
            `INSERT OR REPLACE INTO procedural_memory
             (id, agent_id, name, description, pattern, success_rate, use_count, tags, created_at, updated_at, task_id, run_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              entry.taskId ?? null,
              entry.runId ?? null,
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
          const newRate = success_rate * 0.9 + (success ? 1 : 0) * 0.1;
          yield* db.exec(
            `UPDATE procedural_memory SET success_rate = ?, use_count = ?, updated_at = ? WHERE id = ?`,
            [newRate, newCount, new Date().toISOString(), id],
          );
        }),

      delete: (id) =>
        db
          .exec(`DELETE FROM procedural_memory WHERE id = ?`, [id])
          .pipe(Effect.asVoid),

      listActive: (agentId, filter) => {
        const prov = provenanceClause(filter);
        return db
          .query(
            `SELECT * FROM procedural_memory WHERE agent_id = ? ${prov.sql} ORDER BY success_rate DESC, use_count DESC`,
            [agentId, ...prov.params],
          )
          .pipe(Effect.map((rows) => rows.map(rowToEntry)));
      },

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
