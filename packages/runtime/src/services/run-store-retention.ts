/**
 * run-store-retention.ts — Bounded growth for the durable RunStore.
 *
 * Durable runs persist a full kernel-state snapshot per iteration, so an
 * unbounded store grows ~hundreds of KB per tool-using turn. This module holds
 * the retention policy (type, schema, defaults) and the one deterministic
 * `pruneRunStoreDb` that applies it to an open database.
 *
 * Safety law: ONLY rows whose status is `completed` are ever touched. A run
 * that can be resumed (stopped, paused, failed, awaiting approval/interaction,
 * or still `running`, including a crashed run with a checkpoint) is never
 * compacted or deleted, regardless of age or count.
 */
import { Schema } from "effect";
import type { DatabaseLike } from "@reactive-agents/runtime-shim";

/**
 * Retention policy for finished (`completed`) durable runs. Resumable and
 * active runs are never pruned.
 */
export interface DurableRetention {
  /** Newest completed runs kept; older ones are deleted. Default 50. `0` = no count limit. */
  readonly keepCompleted?: number;
  /** Completed runs older than this many days are deleted. Default 30. `0` = no age limit. */
  readonly maxAgeDays?: number;
  /**
   * Keep only the final checkpoint (and drop tool-effect rows) of completed
   * runs. Default true. Set false to keep every iteration's checkpoint, which
   * `agent.fork()` can restart from.
   */
  readonly compactCheckpoints?: boolean;
}

/** Config-data schema of {@link DurableRetention} (round-trips in `toConfig()`). */
export const DurableRetentionSchema = Schema.Struct({
  keepCompleted: Schema.optional(Schema.Number),
  maxAgeDays: Schema.optional(Schema.Number),
  compactCheckpoints: Schema.optional(Schema.Boolean),
});

/** Bounded default: a long chat stays within ~50 finished runs / 30 days. */
export const DEFAULT_DURABLE_RETENTION: Required<DurableRetention> = {
  keepCompleted: 50,
  maxAgeDays: 30,
  compactCheckpoints: true,
};

const DAY_MS = 86_400_000;
/** Reclaim file space (VACUUM) once at least this many bytes sit on the freelist. */
const VACUUM_MIN_FREE_BYTES = 1_048_576;

/** What one prune pass did. */
export interface PruneResult {
  /** Completed runs deleted outright (all their rows). */
  readonly runsDeleted: number;
  /** Completed runs whose older checkpoints / effects were dropped. */
  readonly runsCompacted: number;
}

/** Resolve a user policy (or `undefined`) against the defaults. */
export const resolveRetention = (r: DurableRetention | undefined): Required<DurableRetention> => ({
  keepCompleted: nonNegative(r?.keepCompleted, DEFAULT_DURABLE_RETENTION.keepCompleted),
  maxAgeDays: nonNegative(r?.maxAgeDays, DEFAULT_DURABLE_RETENTION.maxAgeDays),
  compactCheckpoints: r?.compactCheckpoints ?? DEFAULT_DURABLE_RETENTION.compactCheckpoints,
});

const nonNegative = (v: number | undefined, fallback: number): number =>
  v !== undefined && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

/** Run tables keyed by `run_id`, deleted together when a run is pruned. */
const RUN_TABLES = ["run_checkpoints", "run_events", "run_approvals", "run_interactions", "run_effects"] as const;

/**
 * Apply `policy` to the store behind `db`. Synchronous and transactional; the
 * caller wraps it fail-soft (a prune failure must never fail a run).
 *
 * @param db - Open RunStore database.
 * @param policy - Retention policy (defaults applied to absent fields).
 * @param now - Clock (ms), injectable for tests.
 */
export function pruneRunStoreDb(
  db: DatabaseLike,
  policy: DurableRetention | undefined,
  now: number = Date.now(),
): PruneResult {
  const p = resolveRetention(policy);
  const completed = db
    .query(`SELECT run_id, updated_at FROM runs WHERE status = 'completed' ORDER BY updated_at DESC, run_id ASC`)
    .all() as { run_id: string; updated_at: number }[];
  const cutoff = p.maxAgeDays > 0 ? now - p.maxAgeDays * DAY_MS : undefined;
  const doomed: string[] = [];
  const kept: string[] = [];
  completed.forEach((r, i) => {
    const overCount = p.keepCompleted > 0 && i >= p.keepCompleted;
    const tooOld = cutoff !== undefined && r.updated_at < cutoff;
    (overCount || tooOld ? doomed : kept).push(r.run_id);
  });

  db.exec("BEGIN");
  try {
    for (const id of doomed) {
      for (const table of RUN_TABLES) db.query(`DELETE FROM ${table} WHERE run_id = ?`).run(id);
      db.query(`DELETE FROM runs WHERE run_id = ? AND status = 'completed'`).run(id);
    }
    let compacted = 0;
    if (p.compactCheckpoints) {
      for (const id of kept) {
        const dropped = db
          .query(
            `DELETE FROM run_checkpoints
              WHERE run_id = ? AND iteration < (SELECT MAX(iteration) FROM run_checkpoints WHERE run_id = ?)`,
          )
          .run(id, id).changes;
        const effects = db.query(`DELETE FROM run_effects WHERE run_id = ?`).run(id).changes;
        if (dropped > 0 || effects > 0) compacted++;
      }
    }
    db.exec("COMMIT");
    if (doomed.length > 0 || compacted > 0) reclaimSpace(db);
    return { runsDeleted: doomed.length, runsCompacted: compacted };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // the failed statement may already have rolled back the transaction
    }
    throw e;
  }
}

/** VACUUM when enough freed pages sit idle; deletes alone never shrink the file. */
function reclaimSpace(db: DatabaseLike): void {
  const num = (sql: string): number => Object.values((db.query(sql).get() ?? {}) as Record<string, number>)[0] ?? 0;
  if (num("PRAGMA freelist_count") * num("PRAGMA page_size") >= VACUUM_MIN_FREE_BYTES) db.exec("VACUUM");
}
