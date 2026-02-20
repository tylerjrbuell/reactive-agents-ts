import { Effect, Context, Layer } from "effect";
import type { CompactionConfig } from "../types.js";
import { CompactionError, DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Service Tag ───

export class CompactionService extends Context.Tag("CompactionService")<
  CompactionService,
  {
    /** Run compaction for an agent using the given strategy. */
    readonly compact: (
      agentId: string,
      config: CompactionConfig,
    ) => Effect.Effect<number, CompactionError | DatabaseError>;

    /** Count-based compaction: remove lowest-importance entries above threshold. */
    readonly compactByCount: (
      agentId: string,
      maxEntries: number,
    ) => Effect.Effect<number, DatabaseError>;

    /** Time-based compaction: remove entries older than interval. */
    readonly compactByTime: (
      agentId: string,
      intervalMs: number,
    ) => Effect.Effect<number, DatabaseError>;

    /** Semantic compaction: merge near-duplicate entries (by FTS5 similarity). */
    readonly compactBySimilarity: (
      agentId: string,
      threshold: number,
    ) => Effect.Effect<number, DatabaseError>;

    /** Progressive compaction: count -> time -> decay. */
    readonly compactProgressive: (
      agentId: string,
      config: CompactionConfig,
    ) => Effect.Effect<number, DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const CompactionServiceLive = Layer.effect(
  CompactionService,
  Effect.gen(function* () {
    const db = yield* MemoryDatabase;

    return {
      compact: (agentId, config) =>
        Effect.gen(function* () {
          switch (config.strategy) {
            case "count":
              return yield* compactByCount(agentId, config.maxEntries ?? 1000);
            case "time":
              return yield* compactByTime(
                agentId,
                config.intervalMs ?? 86_400_000,
              );
            case "semantic":
              return yield* compactBySimilarity(
                agentId,
                config.similarityThreshold ?? 0.92,
              );
            case "progressive":
              return yield* compactProgressive(agentId, config);
          }
        }),

      compactByCount: (agentId, maxEntries) =>
        compactByCount(agentId, maxEntries),

      compactByTime: (agentId, intervalMs) =>
        compactByTime(agentId, intervalMs),

      compactBySimilarity: (agentId, threshold) =>
        compactBySimilarity(agentId, threshold),

      compactProgressive: (agentId, config) =>
        compactProgressive(agentId, config),
    };

    function compactByCount(agentId: string, maxEntries: number) {
      return Effect.gen(function* () {
        // Count current entries
        const countRows = yield* db.query<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM semantic_memory WHERE agent_id = ?`,
          [agentId],
        );
        const count = countRows[0]?.cnt ?? 0;

        if (count <= maxEntries) return 0;

        const toRemove = count - maxEntries;
        // Delete lowest importance entries
        const deleted = yield* db.exec(
          `DELETE FROM semantic_memory WHERE id IN (
            SELECT id FROM semantic_memory
            WHERE agent_id = ?
            ORDER BY importance ASC, last_accessed_at ASC
            LIMIT ?
          )`,
          [agentId, toRemove],
        );
        return deleted;
      });
    }

    function compactByTime(agentId: string, intervalMs: number) {
      return Effect.gen(function* () {
        const cutoff = new Date(Date.now() - intervalMs).toISOString();
        const deleted = yield* db.exec(
          `DELETE FROM semantic_memory
           WHERE agent_id = ? AND updated_at < ? AND importance < 0.5`,
          [agentId, cutoff],
        );
        return deleted;
      });
    }

    function compactBySimilarity(agentId: string, _threshold: number) {
      return Effect.gen(function* () {
        // In Tier 1, we use a simplified approach:
        // Find entries with identical content and merge them
        const duplicates = yield* db.query<{ content: string; cnt: number }>(
          `SELECT content, COUNT(*) as cnt FROM semantic_memory
           WHERE agent_id = ? GROUP BY content HAVING cnt > 1`,
          [agentId],
        );

        let removed = 0;
        for (const dup of duplicates) {
          // Keep the highest importance one, delete the rest
          const deleted = yield* db.exec(
            `DELETE FROM semantic_memory WHERE id IN (
              SELECT id FROM semantic_memory
              WHERE agent_id = ? AND content = ?
              ORDER BY importance DESC
              LIMIT -1 OFFSET 1
            )`,
            [agentId, dup.content],
          );
          removed += deleted;
        }
        return removed;
      });
    }

    function compactProgressive(agentId: string, config: CompactionConfig) {
      return Effect.gen(function* () {
        let totalRemoved = 0;

        // Step 1: Count-based
        totalRemoved += yield* compactByCount(
          agentId,
          config.maxEntries ?? 1000,
        );

        // Step 2: Time-based
        totalRemoved += yield* compactByTime(
          agentId,
          config.intervalMs ?? 86_400_000,
        );

        // Step 3: Apply decay to low-access entries
        const decayFactor = config.decayFactor ?? 0.05;
        yield* db.exec(
          `UPDATE semantic_memory
           SET importance = MAX(0, importance - ?)
           WHERE agent_id = ? AND access_count < 3 AND importance > 0.1`,
          [decayFactor, agentId],
        );

        return totalRemoved;
      });
    }
  }),
);
