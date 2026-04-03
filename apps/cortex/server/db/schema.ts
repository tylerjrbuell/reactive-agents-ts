import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deleteRun } from "./queries.js";

export function openDatabase(dbPath: string): Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  applySchema(db);
  return db;
}

export function applySchema(db: Database): void {
  /** Required for `REFERENCES … ON DELETE CASCADE` (e.g. chat turns → sessions). */
  db.exec("PRAGMA foreign_keys = ON");
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
      provider        TEXT,
      model           TEXT,
      strategy        TEXT,
      debrief         TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_agent
      ON cortex_runs(agent_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS cortex_agents (
      agent_id    TEXT PRIMARY KEY,
      name        TEXT    NOT NULL,
      config      TEXT    NOT NULL,
      agent_type  TEXT    NOT NULL DEFAULT 'gateway',
      status      TEXT    NOT NULL DEFAULT 'active',
      run_count   INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      schedule    TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE TABLE IF NOT EXISTS cortex_mcp_servers (
      server_id   TEXT PRIMARY KEY,
      name        TEXT    NOT NULL UNIQUE,
      config_json TEXT    NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE TABLE IF NOT EXISTS cortex_mcp_cached_tools (
      server_id   TEXT    NOT NULL,
      tool_name   TEXT    NOT NULL,
      description TEXT,
      PRIMARY KEY (server_id, tool_name),
      FOREIGN KEY (server_id) REFERENCES cortex_mcp_servers(server_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_cached_tools_server
      ON cortex_mcp_cached_tools(server_id);

    CREATE TABLE IF NOT EXISTS cortex_chat_sessions (
      session_id   TEXT PRIMARY KEY,
      name         TEXT    NOT NULL DEFAULT 'New Chat',
      agent_config TEXT    NOT NULL,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      last_used_at INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_used
      ON cortex_chat_sessions(last_used_at DESC);

    CREATE TABLE IF NOT EXISTS cortex_chat_turns (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT    NOT NULL REFERENCES cortex_chat_sessions(session_id) ON DELETE CASCADE,
      role         TEXT    NOT NULL,
      content      TEXT    NOT NULL,
      tokens_used  INTEGER NOT NULL DEFAULT 0,
      tools_json   TEXT,
      ts           INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_turns_session
      ON cortex_chat_turns(session_id, id ASC);
  `);

  // Migrations — safe to run on existing DBs (ALTER TABLE IF NOT EXISTS column)
  const runCols = (db.prepare("PRAGMA table_info(cortex_runs)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!runCols.includes("provider")) db.exec("ALTER TABLE cortex_runs ADD COLUMN provider TEXT");
  if (!runCols.includes("model"))    db.exec("ALTER TABLE cortex_runs ADD COLUMN model    TEXT");
  if (!runCols.includes("strategy")) db.exec("ALTER TABLE cortex_runs ADD COLUMN strategy TEXT");

  const agentCols = (db.prepare("PRAGMA table_info(cortex_agents)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!agentCols.includes("agent_type")) {
    db.exec("ALTER TABLE cortex_agents ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'gateway'");
  }

  const chatTurnCols = (db.prepare("PRAGMA table_info(cortex_chat_turns)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!chatTurnCols.includes("tools_json")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN tools_json TEXT");
  }

  const chatSessionCols = (db.prepare("PRAGMA table_info(cortex_chat_sessions)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!chatSessionCols.includes("stable_agent_id")) {
    db.exec("ALTER TABLE cortex_chat_sessions ADD COLUMN stable_agent_id TEXT");
  }
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

  for (const { run_id } of staleRunIds) {
    deleteRun(db, run_id);
  }
}
