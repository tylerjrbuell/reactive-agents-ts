import { Context, Effect, Layer, Option } from "effect";
import type { Database } from "bun:sqlite";
import {
  deleteRun,
  getRecentRuns,
  getRunById,
  getRunDetail,
  getRunEvents,
  pruneRuns,
  recomputeRunStats,
  upsertRun,
} from "../db/queries.js";
import { CortexError } from "../errors.js";
import type { RunSummary } from "../types.js";

export class CortexStoreService extends Context.Tag("CortexStoreService")<
  CortexStoreService,
  {
    readonly getRecentRuns: (limit: number) => Effect.Effect<RunSummary[], CortexError>;
    readonly getRunEvents: (
      runId: string,
    ) => Effect.Effect<Array<{ ts: number; type: string; payload: string }>, CortexError>;
    readonly getRun: (runId: string) => Effect.Effect<Option.Option<RunSummary>, CortexError>;
    readonly getRunDetail: (runId: string) => Effect.Effect<Option.Option<RunSummary & { debrief: string | null }>, CortexError>;
    /** Insert run row before first ingest (matches framework task id used by CortexReporter). */
    readonly ensureRunRow: (agentId: string, runId: string) => Effect.Effect<void, CortexError>;
    readonly deleteRun: (runId: string) => Effect.Effect<boolean, CortexError>;
    readonly pruneRuns: (
      olderThanMs: number,
      includeLive?: boolean,
    ) => Effect.Effect<number, CortexError>;
    readonly recomputeRunStats: (runId: string) => Effect.Effect<boolean, CortexError>;
    readonly getSkills: () => Effect.Effect<unknown[], CortexError>;
    readonly getTools: () => Effect.Effect<unknown[], CortexError>;
  }
>() {}

export const CortexStoreServiceLive = (db: Database) =>
  Layer.succeed(CortexStoreService, {
    getRecentRuns: (limit) =>
      Effect.sync(() => getRecentRuns(db, limit)).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    getRunEvents: (runId) =>
      Effect.sync(() => getRunEvents(db, runId)).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    getRun: (runId) =>
      Effect.sync(() => {
        const row = getRunById(db, runId);
        return row ? Option.some(row) : Option.none();
      }).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    getRunDetail: (runId) =>
      Effect.sync(() => {
        const row = getRunDetail(db, runId);
        return row ? Option.some(row) : Option.none();
      }).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    ensureRunRow: (agentId, runId) =>
      Effect.sync(() => {
        upsertRun(db, agentId, runId);
      }).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    deleteRun: (runId) =>
      Effect.sync(() => deleteRun(db, runId)).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    pruneRuns: (olderThanMs, includeLive = false) =>
      Effect.sync(() => {
        const beforeTs = Date.now() - Math.max(0, olderThanMs);
        return pruneRuns(db, beforeTs, includeLive);
      }).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    recomputeRunStats: (runId) =>
      Effect.sync(() => recomputeRunStats(db, runId)).pipe(
        Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
      ),

    getSkills: () =>
      Effect.sync(() => {
        try {
          return db.prepare("SELECT * FROM skills ORDER BY created_at DESC LIMIT 100").all();
        } catch {
          return [];
        }
      }),

    getTools: () =>
      Effect.sync(() => {
        try {
          return db.prepare("SELECT * FROM tools ORDER BY name ASC").all();
        } catch {
          return [];
        }
      }),
  });
