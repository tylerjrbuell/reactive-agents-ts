import { Effect, Context, Layer, Ref } from "effect";
import { DatabaseError } from "../errors.js";
import { MemoryDatabase } from "../database.js";

// ─── Types ───

export interface ConsolidationResult {
  /** Episodic entries processed in the REPLAY phase. */
  replayed: number;
  /** Semantic entries merged/updated in the CONNECT phase. */
  connected: number;
  /** Entries whose importance was decayed in the COMPRESS phase. */
  compressed: number;
  /** Entries deleted because they fell below the prune threshold. */
  pruned: number;
}

export interface ConsolidatorConfig {
  /** Number of new episodic entries before a consolidation cycle is triggered. Default: 10. */
  threshold?: number;
  /** Importance decay multiplier applied each cycle. Default: 0.95. */
  decayFactor?: number;
  /** Minimum importance; entries below this are pruned. Default: 0.1. */
  pruneThreshold?: number;
}

// ─── Service Tag ───

export class MemoryConsolidatorService extends Context.Tag(
  "MemoryConsolidatorService",
)<
  MemoryConsolidatorService,
  {
    /** Run a full consolidation cycle: REPLAY → CONNECT → COMPRESS. */
    readonly consolidate: (
      agentId: string,
    ) => Effect.Effect<ConsolidationResult, DatabaseError>;

    /**
     * Notify that a new episodic entry was created.
     * Returns true if the pending count has reached the threshold.
     */
    readonly notifyEntry: () => Effect.Effect<boolean, never>;

    /** Get the current pending entry count. */
    readonly pendingCount: () => Effect.Effect<number, never>;
  }
>() {}

// ─── Live Implementation ───

export const MemoryConsolidatorServiceLive = (
  config?: ConsolidatorConfig,
  onConnect?: (agentId: string) => Effect.Effect<number, unknown>,
) =>
  Layer.effect(
    MemoryConsolidatorService,
    Effect.gen(function* () {
      const db = yield* MemoryDatabase;
      const pending = yield* Ref.make(0);

      const threshold = config?.threshold ?? 10;
      const decayFactor = config?.decayFactor ?? 0.95;
      const pruneThreshold = config?.pruneThreshold ?? 0.1;

      // Ensure the consolidation state table exists
      yield* db.exec(
        `CREATE TABLE IF NOT EXISTS consolidation_state (
          id        TEXT PRIMARY KEY DEFAULT 'singleton',
          last_run  TEXT,
          total_runs INTEGER DEFAULT 0
        )`,
        [],
      );

      // ─── REPLAY phase ─────────────────────────────────────────────────────
      // Count recent episodic entries since the last consolidation run.
      // Returns the count as the "replayed" value.
      const replay = (agentId: string): Effect.Effect<number, DatabaseError> =>
        Effect.gen(function* () {
          const stateRows = yield* db.query<{ last_run: string | null }>(
            `SELECT last_run FROM consolidation_state WHERE id = 'singleton'`,
            [],
          );
          const lastRun = stateRows[0]?.last_run ?? null;

          const countRows = yield* db.query<{ cnt: number }>(
            lastRun
              ? `SELECT COUNT(*) as cnt FROM episodic_log WHERE agent_id = ? AND created_at > ?`
              : `SELECT COUNT(*) as cnt FROM episodic_log WHERE agent_id = ?`,
            lastRun ? [agentId, lastRun] : [agentId],
          );
          return (countRows[0]?.cnt as number) ?? 0;
        });

      // ─── CONNECT phase ────────────────────────────────────────────────────
      // Calls the optional onConnect callback (e.g. SkillDistillerService.distill)
      // if provided; otherwise falls back to a no-op returning 0.
      const connect = (agentId: string): Effect.Effect<number, DatabaseError> =>
        onConnect
          ? Effect.catchAll(onConnect(agentId), () => Effect.succeed(0))
          : Effect.succeed(0);

      // ─── COMPRESS phase ───────────────────────────────────────────────────
      // Decay importance on all semantic entries for this agent that are still
      // above the prune threshold, then delete entries that fall below it.
      const compress = (
        agentId: string,
      ): Effect.Effect<{ compressed: number; pruned: number }, DatabaseError> =>
        Effect.gen(function* () {
          // Decay entries above prune threshold
          const compressed = yield* db.exec(
            `UPDATE semantic_memory
             SET importance = importance * ?
             WHERE agent_id = ? AND importance > ?`,
            [decayFactor, agentId, pruneThreshold],
          );

          // Count entries now below the prune threshold
          const pruneRows = yield* db.query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM semantic_memory WHERE agent_id = ? AND importance < ?`,
            [agentId, pruneThreshold],
          );
          const pruned = (pruneRows[0]?.cnt as number) ?? 0;

          // Delete them
          if (pruned > 0) {
            yield* db.exec(
              `DELETE FROM semantic_memory WHERE agent_id = ? AND importance < ?`,
              [agentId, pruneThreshold],
            );
          }

          return { compressed, pruned };
        });

      // ─── Update consolidation state ───────────────────────────────────────
      const recordRun = (): Effect.Effect<void, DatabaseError> =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
          yield* db.exec(
            `INSERT INTO consolidation_state (id, last_run, total_runs)
             VALUES ('singleton', ?, 1)
             ON CONFLICT(id) DO UPDATE SET
               last_run   = excluded.last_run,
               total_runs = total_runs + 1`,
            [now],
          );
        });

      return {
        consolidate: (agentId) =>
          Effect.gen(function* () {
            const replayed = yield* replay(agentId);
            const connected = yield* connect(agentId);
            const { compressed, pruned } = yield* compress(agentId);

            yield* recordRun();

            // Reset pending counter after a successful cycle
            yield* Ref.set(pending, 0);

            return { replayed, connected, compressed, pruned };
          }),

        notifyEntry: () =>
          Ref.updateAndGet(pending, (n) => n + 1).pipe(
            Effect.map((count) => count >= threshold),
          ),

        pendingCount: () => Ref.get(pending),
      };
    }),
  );
