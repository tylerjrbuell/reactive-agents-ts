import { Effect, Context, Layer } from "effect";
import type { MemoryConfig } from "../types.js";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Service Tag ───

export class MemoryConsolidator extends Context.Tag("MemoryConsolidator")<
  MemoryConsolidator,
  {
    /**
     * Run a consolidation cycle: merge near-duplicates, decay old entries,
     * promote high-access entries.
     * Returns the number of entries affected.
     */
    readonly consolidate: (
      agentId: string,
    ) => Effect.Effect<number, DatabaseError>;

    /**
     * Decay importance of entries that haven't been accessed recently.
     */
    readonly decayUnused: (
      agentId: string,
      decayFactor: number,
    ) => Effect.Effect<number, DatabaseError>;

    /**
     * Promote entries that have high access counts.
     */
    readonly promoteActive: (
      agentId: string,
    ) => Effect.Effect<number, DatabaseError>;
  }
>() {}

// ─── Live Implementation ───

export const MemoryConsolidatorLive = (config: MemoryConfig) =>
  Layer.effect(
    MemoryConsolidator,
    Effect.gen(function* () {
      const db = yield* MemoryDatabase;
      const decayFactor = config.compaction.decayFactor ?? 0.05;

      return {
        consolidate: (agentId) =>
          Effect.gen(function* () {
            let affected = 0;

            // Step 1: Decay unused entries
            affected += yield* decayUnused(agentId, decayFactor);

            // Step 2: Promote active entries
            affected += yield* promoteActive(agentId);

            // Step 3: Remove entries with importance near zero
            const removed = yield* db.exec(
              `DELETE FROM semantic_memory
               WHERE agent_id = ? AND importance < 0.05 AND access_count < 2`,
              [agentId],
            );
            affected += removed;

            return affected;
          }),

        decayUnused: (agentId, factor) => decayUnused(agentId, factor),

        promoteActive: (agentId) => promoteActive(agentId),
      };

      function decayUnused(agentId: string, factor: number) {
        return Effect.gen(function* () {
          const cutoff = new Date(
            Date.now() - 7 * 86_400_000,
          ).toISOString();
          const result = yield* db.exec(
            `UPDATE semantic_memory
             SET importance = MAX(0, importance - ?)
             WHERE agent_id = ?
               AND last_accessed_at < ?
               AND importance > 0.1`,
            [factor, agentId, cutoff],
          );
          return result;
        });
      }

      function promoteActive(agentId: string) {
        return Effect.gen(function* () {
          const result = yield* db.exec(
            `UPDATE semantic_memory
             SET importance = MIN(1, importance + 0.05)
             WHERE agent_id = ?
               AND access_count >= 5
               AND importance < 0.95`,
            [agentId],
          );
          return result;
        });
      }
    }),
  );
