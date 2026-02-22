/**
 * SQLite-backed persistent eval history.
 *
 * Uses bun:sqlite for zero-dependency persistence (same pattern as memory package).
 */
import { Effect } from "effect";
import type { EvalRun, EvalResult, EvalRunSummary, DimensionScore } from "../types/eval-result.js";

export interface EvalStore {
  readonly saveRun: (run: EvalRun) => Effect.Effect<void>;
  readonly loadHistory: (
    suiteId: string,
    options?: { limit?: number },
  ) => Effect.Effect<readonly EvalRun[]>;
  readonly loadRun: (runId: string) => Effect.Effect<EvalRun | null>;
  readonly compareRuns: (
    runId1: string,
    runId2: string,
  ) => Effect.Effect<{
    improved: string[];
    regressed: string[];
    unchanged: string[];
  } | null>;
}

/**
 * Create a SQLite-backed eval store.
 *
 * @param dbPath - Path to the SQLite database file (default: "eval-history.db")
 */
export const createEvalStore = (dbPath: string = "eval-history.db"): EvalStore => {
  // Lazy-initialize the database
  let db: any = null;

  const getDb = () => {
    if (db) return db;
    // Dynamic import to work in environments without bun:sqlite
    const { Database } = require("bun:sqlite");
    db = new Database(dbPath);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        suite_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        agent_config TEXT NOT NULL,
        results_json TEXT NOT NULL,
        summary_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_eval_runs_suite ON eval_runs(suite_id);
    `);
    return db;
  };

  return {
    saveRun: (run) =>
      Effect.sync(() => {
        const d = getDb();
        d.prepare(
          `INSERT OR REPLACE INTO eval_runs (id, suite_id, timestamp, agent_config, results_json, summary_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          run.id,
          run.suiteId,
          run.timestamp.toISOString(),
          run.agentConfig,
          JSON.stringify(run.results, dateReplacer),
          JSON.stringify(run.summary),
        );
      }),

    loadHistory: (suiteId, options) =>
      Effect.sync(() => {
        const d = getDb();
        const limit = options?.limit ?? 100;
        const rows = d
          .prepare(
            `SELECT * FROM eval_runs WHERE suite_id = ? ORDER BY timestamp DESC LIMIT ?`,
          )
          .all(suiteId, limit) as DbRow[];

        return rows.map(rowToEvalRun);
      }),

    loadRun: (runId) =>
      Effect.sync(() => {
        const d = getDb();
        const row = d
          .prepare(`SELECT * FROM eval_runs WHERE id = ?`)
          .get(runId) as DbRow | null;
        return row ? rowToEvalRun(row) : null;
      }),

    compareRuns: (runId1, runId2) =>
      Effect.sync(() => {
        const d = getDb();
        const row1 = d
          .prepare(`SELECT summary_json FROM eval_runs WHERE id = ?`)
          .get(runId1) as { summary_json: string } | null;
        const row2 = d
          .prepare(`SELECT summary_json FROM eval_runs WHERE id = ?`)
          .get(runId2) as { summary_json: string } | null;

        if (!row1 || !row2) return null;

        const summary1 = JSON.parse(row1.summary_json) as EvalRunSummary;
        const summary2 = JSON.parse(row2.summary_json) as EvalRunSummary;

        const improved: string[] = [];
        const regressed: string[] = [];
        const unchanged: string[] = [];

        const allDims = new Set([
          ...Object.keys(summary1.dimensionAverages),
          ...Object.keys(summary2.dimensionAverages),
        ]);

        for (const dim of allDims) {
          const a = summary1.dimensionAverages[dim] ?? 0;
          const b = summary2.dimensionAverages[dim] ?? 0;
          const delta = b - a;
          if (delta > 0.02) improved.push(dim);
          else if (delta < -0.02) regressed.push(dim);
          else unchanged.push(dim);
        }

        return { improved, regressed, unchanged };
      }),
  };
};

// ─── Internal helpers ───

interface DbRow {
  id: string;
  suite_id: string;
  timestamp: string;
  agent_config: string;
  results_json: string;
  summary_json: string;
}

function dateReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function rowToEvalRun(row: DbRow): EvalRun {
  const results = JSON.parse(row.results_json) as Array<EvalResult & { timestamp: string }>;
  const summary = JSON.parse(row.summary_json) as EvalRunSummary;

  return {
    id: row.id,
    suiteId: row.suite_id,
    timestamp: new Date(row.timestamp),
    agentConfig: row.agent_config,
    results: results.map((r) => ({
      ...r,
      timestamp: new Date(r.timestamp as unknown as string),
    })),
    summary,
  };
}
