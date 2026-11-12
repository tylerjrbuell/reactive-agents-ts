import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { backfillRunEndings, deleteRun } from "./queries.js";

/**
 * Make the data directory and database file private to the current user. The database holds
 * MCP credentials, chat history and traces, and `secret.key` (which decrypts the provider keys)
 * lives beside it. A directory is tightened only when this call made it or it is named
 * `.cortex`; a database placed in a shared directory (the cwd, `/tmp`) leaves that directory alone.
 */
export function securePrivateStorage(dbPath: string, dirCreated: boolean): void {
  if (dbPath === ":memory:" || dbPath === "") return;
  const dir = path.dirname(dbPath);
  try {
    if (dirCreated || path.basename(dir) === ".cortex") chmodSync(dir, 0o700);
    chmodSync(dbPath, 0o600);
    for (const side of [`${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(side)) chmodSync(side, 0o600);
  } catch {
    /* a filesystem without POSIX modes (Windows, some mounts): nothing to tighten */
  }
}

export function openDatabase(dbPath: string): Database {
  const dir = path.dirname(dbPath);
  const dirCreated = dbPath !== ":memory:" && !existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(dbPath, { create: true });
  // Before WAL mode creates the -wal / -shm files: SQLite gives them the database file's mode.
  securePrivateStorage(dbPath, dirCreated);
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
      error_message   TEXT,
      display_name    TEXT,
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

    CREATE TABLE IF NOT EXISTS cortex_lab_custom_tools (
      tool_id         TEXT PRIMARY KEY,
      name            TEXT    NOT NULL UNIQUE,
      description     TEXT    NOT NULL,
      parameters_json TEXT    NOT NULL,
      disabled        INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL
    );

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
      incomplete   INTEGER NOT NULL DEFAULT 0,
      ts           INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_turns_session
      ON cortex_chat_turns(session_id, id ASC);

    CREATE TABLE IF NOT EXISTS chat_schedules (
      id           TEXT PRIMARY KEY,
      session_id   TEXT    NOT NULL REFERENCES cortex_chat_sessions(session_id) ON DELETE CASCADE,
      kind         TEXT    NOT NULL,
      spec         TEXT    NOT NULL,
      prompt       TEXT    NOT NULL,
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      max_cost_usd REAL    NOT NULL,
      runs         INTEGER NOT NULL DEFAULT 0,
      last_fired_at INTEGER,
      last_status  TEXT,
      enabled      INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_chat_schedules_session
      ON chat_schedules(session_id);

    CREATE TABLE IF NOT EXISTS chat_schedule_fires (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id  TEXT    NOT NULL REFERENCES chat_schedules(id) ON DELETE CASCADE,
      session_id   TEXT    NOT NULL,
      ts           INTEGER NOT NULL,
      status       TEXT    NOT NULL,
      cost_usd     REAL,
      detail       TEXT
    );

    -- One goal per chat session (design decision 1): a supervisor over ordinary turns.
    CREATE TABLE IF NOT EXISTS chat_goals (
      session_id    TEXT PRIMARY KEY REFERENCES cortex_chat_sessions(session_id) ON DELETE CASCADE,
      goal_json     TEXT    NOT NULL,
      goal_achieved INTEGER,
      reason        TEXT,
      updated_at    INTEGER NOT NULL
    );

    -- Agent-proposed session changes (session-control tool). The tool only ever INSERTs here;
    -- a human Apply is the sole path to a config / goal / schedule mutation.
    CREATE TABLE IF NOT EXISTS chat_proposals (
      id          TEXT PRIMARY KEY,
      session_id  TEXT    NOT NULL REFERENCES cortex_chat_sessions(session_id) ON DELETE CASCADE,
      action      TEXT    NOT NULL,
      args_json   TEXT    NOT NULL,
      summary     TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'proposed',
      created_at  INTEGER NOT NULL,
      error       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_chat_proposals_session
      ON chat_proposals(session_id, created_at ASC);

    -- A chat turn paused on a durable approval gate (chat-approvals.ts). The user message
    -- is held here (not in cortex_chat_turns) until Approve / Deny lands the reply, so
    -- history alternation stays intact. Survives restart: the run resumes from the
    -- durable store under the session's durableRuns dir.
    CREATE TABLE IF NOT EXISTS chat_pending_approvals (
      run_id       TEXT PRIMARY KEY,
      session_id   TEXT    NOT NULL REFERENCES cortex_chat_sessions(session_id) ON DELETE CASCADE,
      user_message TEXT    NOT NULL,
      gate_id      TEXT    NOT NULL,
      tool_name    TEXT    NOT NULL,
      args_json    TEXT    NOT NULL,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_pending_approvals_session
      ON chat_pending_approvals(session_id, created_at ASC);

    -- A chat turn paused on request_user_input (chat-approvals.ts). Same contract as
    -- chat_pending_approvals: the user message waits here until the user's answer
    -- resumes the run (respondToInteraction) and the exchange lands in the thread.
    CREATE TABLE IF NOT EXISTS chat_pending_interactions (
      run_id         TEXT PRIMARY KEY,
      session_id     TEXT    NOT NULL REFERENCES cortex_chat_sessions(session_id) ON DELETE CASCADE,
      user_message   TEXT    NOT NULL,
      interaction_id TEXT    NOT NULL,
      kind           TEXT    NOT NULL,
      prompt         TEXT    NOT NULL,
      schema_json    TEXT    NOT NULL,
      created_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_pending_interactions_session
      ON chat_pending_interactions(session_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS skills (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT,
      content     TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_skills_created
      ON skills(created_at DESC);

    CREATE TABLE IF NOT EXISTS cortex_prompts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL DEFAULT '',
      body        TEXT    NOT NULL,
      type        TEXT    NOT NULL DEFAULT 'snippet',
      tags        TEXT    NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_prompts_created
      ON cortex_prompts(created_at DESC);

    -- Channel hub (services/channel-hub.ts). Credentials are NOT here: they stay sealed in the key
    -- store under channel:<id>:<field>. migrated_from names the gateway agent whose per-agent
    -- config.channels produced the row (null = created in the hub).
    CREATE TABLE IF NOT EXISTS cortex_channels (
      id            TEXT    PRIMARY KEY,
      platform      TEXT    NOT NULL,
      label         TEXT,
      settings_json TEXT    NOT NULL DEFAULT '{}',
      enabled       INTEGER NOT NULL DEFAULT 1,
      migrated_from TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    -- One RouteSpec per row. target_kind/target_id: 'agent' = a saved agent id; 'session' is reserved
    -- for chat-session targets (next slice). spec_json holds match, session, allow, deny, owners, open,
    -- senderTools, deniedReply, groups and the limits.
    CREATE TABLE IF NOT EXISTS cortex_routes (
      id            TEXT    PRIMARY KEY,
      channel_id    TEXT    NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 1,
      priority      INTEGER NOT NULL DEFAULT 100,
      target_kind   TEXT    NOT NULL DEFAULT 'agent',
      target_id     TEXT    NOT NULL,
      spec_json     TEXT    NOT NULL DEFAULT '{}',
      migrated_from TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_routes_channel
      ON cortex_routes(channel_id);

    -- Durable RouterStore state: seen platform message ids (seq orders eviction), sliding-window
    -- turn counters, settled spend per route, and the per-account lease with a heartbeat.
    CREATE TABLE IF NOT EXISTS cortex_router_seen (
      seq     INTEGER PRIMARY KEY AUTOINCREMENT,
      key     TEXT    NOT NULL UNIQUE,
      seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cortex_router_turns (
      bucket TEXT    NOT NULL,
      at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_router_turns_bucket
      ON cortex_router_turns(bucket, at);

    CREATE TABLE IF NOT EXISTS cortex_router_spend (
      route_id TEXT NOT NULL,
      at       INTEGER NOT NULL,
      usd      REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_router_spend_route
      ON cortex_router_spend(route_id, at);

    CREATE TABLE IF NOT EXISTS cortex_router_leases (
      fingerprint TEXT    PRIMARY KEY,
      channel_id  TEXT    NOT NULL,
      pid         INTEGER NOT NULL,
      host        TEXT    NOT NULL,
      since       INTEGER NOT NULL,
      heartbeat   INTEGER NOT NULL
    );

    -- Who changed which route and when (owners added, open, AgentDefault). No message text, no secrets.
    CREATE TABLE IF NOT EXISTS cortex_channel_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      at          INTEGER NOT NULL,
      actor       TEXT    NOT NULL,
      action      TEXT    NOT NULL,
      subject     TEXT    NOT NULL,
      detail_json TEXT    NOT NULL DEFAULT '{}'
    );
  `);

  // Migrations — safe to run on existing DBs (ALTER TABLE IF NOT EXISTS column)
  const proposalCols = (db.prepare("PRAGMA table_info(chat_proposals)").all() as Array<{ name: string }>).map((c) => c.name);
  // Before -> after diff (JSON), tighten / loosen / neutral, an injection-risk flag, and who applied it.
  if (!proposalCols.includes("diff_json")) db.exec("ALTER TABLE chat_proposals ADD COLUMN diff_json TEXT");
  if (!proposalCols.includes("direction")) db.exec("ALTER TABLE chat_proposals ADD COLUMN direction TEXT");
  if (!proposalCols.includes("flag")) db.exec("ALTER TABLE chat_proposals ADD COLUMN flag TEXT");
  if (!proposalCols.includes("applied_by")) db.exec("ALTER TABLE chat_proposals ADD COLUMN applied_by TEXT");
  const runCols = (db.prepare("PRAGMA table_info(cortex_runs)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!runCols.includes("provider")) db.exec("ALTER TABLE cortex_runs ADD COLUMN provider TEXT");
  if (!runCols.includes("model"))    db.exec("ALTER TABLE cortex_runs ADD COLUMN model    TEXT");
  if (!runCols.includes("strategy")) db.exec("ALTER TABLE cortex_runs ADD COLUMN strategy TEXT");
  // How far `strategy` can be trusted (ui-core `strategyClaimsOf` rank): a stronger source replaces it.
  if (!runCols.includes("strategy_rank")) db.exec("ALTER TABLE cortex_runs ADD COLUMN strategy_rank INTEGER");
  if (!runCols.includes("error_message")) db.exec("ALTER TABLE cortex_runs ADD COLUMN error_message TEXT");
  if (!runCols.includes("display_name")) db.exec("ALTER TABLE cortex_runs ADD COLUMN display_name TEXT");
  if (!runCols.includes("parent_run_id")) db.exec("ALTER TABLE cortex_runs ADD COLUMN parent_run_id TEXT");
  if (!runCols.includes("root_run_id")) db.exec("ALTER TABLE cortex_runs ADD COLUMN root_run_id TEXT");
  // The run's OWN RunContext.runId (stamped on AgentStarted); legacy rows stay NULL and nest by name-shape.
  if (!runCols.includes("context_run_id")) db.exec("ALTER TABLE cortex_runs ADD COLUMN context_run_id TEXT");
  if (!runCols.includes("depth")) db.exec("ALTER TABLE cortex_runs ADD COLUMN depth INTEGER");
  if (!runCols.includes("launch_params_json")) db.exec("ALTER TABLE cortex_runs ADD COLUMN launch_params_json TEXT");
  // How a finished run ended (abstained / partial / failed / succeeded): an abstention
  // shares the `failed` status. Filled from each stored run's last AgentCompleted once.
  if (!runCols.includes("ending")) {
    db.exec("ALTER TABLE cortex_runs ADD COLUMN ending TEXT");
    backfillRunEndings(db);
  }

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
  if (!chatTurnCols.includes("trace_json")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN trace_json TEXT");
  }
  // Which provider/model produced an assistant turn (the session's model can change mid-chat).
  if (!chatTurnCols.includes("provider")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN provider TEXT");
  }
  if (!chatTurnCols.includes("model")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN model TEXT");
  }
  // Per-turn spend; `cost_known = 0` flags an unpriced turn or a lower bound (failed sub-agent).
  if (!chatTurnCols.includes("cost_usd")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0");
  }
  // Context-window reading at the end of the turn's run (JSON), so the usage ring survives reload.
  if (!chatTurnCols.includes("context_json")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN context_json TEXT");
  }
  // Provider-reported input/output split for this turn. NULL means "not reported"
  // (never derived server-side); the UI marks its own estimate when a half is absent.
  if (!chatTurnCols.includes("tokens_in")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN tokens_in INTEGER");
  }
  if (!chatTurnCols.includes("tokens_out")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN tokens_out INTEGER");
  }
  // Framework run id of an assistant turn (the tracer's `<run_id>.jsonl`); NULL for older turns or untraced runs.
  if (!chatTurnCols.includes("run_id")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN run_id TEXT");
  }
  if (!chatTurnCols.includes("cost_known")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 1");
  }
  // A turn the user cancelled (or that errored after spending): its spent tokens
  // and any partial reply are kept so session spend stays truthful.
  if (!chatTurnCols.includes("incomplete")) {
    db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN incomplete INTEGER NOT NULL DEFAULT 0");
  }

  const chatSessionCols = (db.prepare("PRAGMA table_info(cortex_chat_sessions)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!chatSessionCols.includes("stable_agent_id")) {
    db.exec("ALTER TABLE cortex_chat_sessions ADD COLUMN stable_agent_id TEXT");
  }
  if (!chatSessionCols.includes("todo_json")) {
    db.exec("ALTER TABLE cortex_chat_sessions ADD COLUMN todo_json TEXT");
  }

  const promptCols = (db.prepare("PRAGMA table_info(cortex_prompts)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  if (!promptCols.includes("type")) {
    db.exec("ALTER TABLE cortex_prompts ADD COLUMN type TEXT NOT NULL DEFAULT 'snippet'");
  }

  // Run -> chat session lookup (`chatSessionId` on run summaries): only chat-root events carry a session_id.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_events_chat_run ON cortex_events(run_id, session_id) WHERE session_id IS NOT NULL",
  );
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
