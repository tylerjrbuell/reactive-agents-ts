import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openDatabase(dbPath: string): Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  applySchema(db);
  return db;
}

export function applySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT    NOT NULL,
      run_id      TEXT    NOT NULL,
      session_id  TEXT,
      seq         INTEGER NOT NULL DEFAULT 0,
      ts          INTEGER NOT NULL,
      source      TEXT    NOT NULL DEFAULT 'eventbus',
      type        TEXT    NOT NULL,
      payload     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_events_agent_run
      ON cortex_events(agent_id, run_id, seq);

    CREATE TABLE IF NOT EXISTS cortex_runs (
      run_id          TEXT PRIMARY KEY,
      agent_id        TEXT    NOT NULL,
      started_at      INTEGER NOT NULL,
      completed_at    INTEGER,
      status          TEXT    NOT NULL DEFAULT 'live',
      iteration_count INTEGER NOT NULL DEFAULT 0,
      tokens_used     INTEGER NOT NULL DEFAULT 0,
      cost_usd        REAL    NOT NULL DEFAULT 0,
      debrief         TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_agent
      ON cortex_runs(agent_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS cortex_agents (
      agent_id    TEXT PRIMARY KEY,
      name        TEXT    NOT NULL,
      config      TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'active',
      run_count   INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      schedule    TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );
  `);
}

/** Enforce retention: keep only the 50 most recent runs per agent. */
export function enforceRetention(db: Database, agentId: string): void {
  const staleRunIds = db
    .prepare(
      `
    SELECT run_id FROM cortex_runs
    WHERE agent_id = ?
    ORDER BY started_at DESC
    LIMIT -1 OFFSET 50
  `,
    )
    .all(agentId) as Array<{ run_id: string }>;

  if (staleRunIds.length === 0) return;

  const deleteEvents = db.prepare(`DELETE FROM cortex_events WHERE run_id = ?`);
  const deleteRun = db.prepare(`DELETE FROM cortex_runs WHERE run_id = ?`);
  for (const { run_id } of staleRunIds) {
    deleteEvents.run(run_id);
    deleteRun.run(run_id);
  }
}
