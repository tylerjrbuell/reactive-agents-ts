import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { CortexIngestMessage, RunSummary } from "../types.js";
import { deleteChatSessionsForRun } from "./chat-queries.js";
import { completedStatusOf, runEndingOf } from "../services/run-ending.js";

export function insertEvent(
  db: Database,
  msg: CortexIngestMessage,
  seq: number,
): void {
  const payload = msg.event as unknown as Record<string, unknown>;
  db.prepare(
    `
    INSERT INTO cortex_events (agent_id, run_id, session_id, seq, ts, type, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    msg.agentId,
    msg.runId,
    msg.sessionId ?? null,
    seq,
    Date.now(),
    msg.event._tag,
    JSON.stringify(payload),
  );
}

export function upsertRun(
  db: Database,
  agentId: string,
  runId: string,
  displayName?: string | null,
  launchParamsJson?: string | null,
): void {
  const dn = typeof displayName === "string" && displayName.trim() ? displayName.trim() : null;
  const lp = typeof launchParamsJson === "string" && launchParamsJson.trim() ? launchParamsJson : null;
  db.prepare(
    `
    INSERT INTO cortex_runs (run_id, agent_id, started_at, display_name, launch_params_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      agent_id = CASE
        WHEN cortex_runs.agent_id = cortex_runs.run_id OR cortex_runs.agent_id = 'unknown'
          THEN excluded.agent_id
        ELSE cortex_runs.agent_id
      END,
      display_name = COALESCE(cortex_runs.display_name, excluded.display_name),
      -- Snapshot is written once at launch; a later re-ingest must not clobber it.
      launch_params_json = COALESCE(cortex_runs.launch_params_json, excluded.launch_params_json)
  `,
  ).run(runId, agentId, Date.now(), dn, lp);
}

/** Raw stored launch snapshot for a run (used by rerun). null if absent/malformed. */
export function getLaunchParams(db: Database, runId: string): Record<string, unknown> | null {
  const row = db
    .prepare(
      `SELECT r.launch_params_json AS launch_params_json, a.config AS agent_config
         FROM cortex_runs r LEFT JOIN cortex_agents a ON a.agent_id = r.agent_id
        WHERE r.run_id = ?`,
    )
    .get(runId) as { launch_params_json: string | null; agent_config: string | null } | null;
  return parseLaunchParams(row?.launch_params_json ?? null) ?? launchParamsFromAgentConfig(row?.agent_config) ?? null;
}

export function updateRunStats(
  db: Database,
  runId: string,
  patch: {
    iterationCount?: number;
    /** Additive: added to accumulated per-call total */
    tokensUsed?: number;
    /** Override: sets tokens_used to MAX(existing, this) — for AgentCompleted.totalTokens */
    tokensUsedTotal?: number;
    cost?: number;
    status?: string;
    /** How the run ended (`runEndingOf` over AgentCompleted): `abstained`, `partial`, `failed`, `succeeded`. */
    ending?: string;
    debrief?: string;
    completedAt?: number;
    /** SET only when not already stored (first-seen wins) */
    provider?: string;
    model?: string;
    /** The run's started strategy; kept per `strategyRank` (ui-core `strategyClaimsOf`), not first-seen. */
    strategy?: string;
    /** Rank of `strategy`'s source; a stored strategy is replaced only by a higher rank. */
    strategyRank?: number;
    errorMessage?: string;
    /** Delegation context from AgentStarted; first-seen wins. */
    parentRunId?: string;
    rootRunId?: string;
    depth?: number;
    /** This run's own RunContext.runId from AgentStarted; first-seen wins. */
    contextRunId?: string;
    /** The run this one continues (a Continue's new run); first-seen wins. */
    continuedFrom?: string;
  },
): void {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.iterationCount !== undefined) {
    sets.push("iteration_count = MAX(iteration_count, ?)");
    values.push(patch.iterationCount);
  }
  if (patch.tokensUsed !== undefined) {
    sets.push("tokens_used = tokens_used + ?");
    values.push(patch.tokensUsed);
  }
  if (patch.tokensUsedTotal !== undefined) {
    // AgentCompleted.totalTokens: take the MAX so it corrects runs where per-call was 0
    sets.push("tokens_used = MAX(tokens_used, ?)");
    values.push(patch.tokensUsedTotal);
  }
  if (patch.cost !== undefined) {
    sets.push("cost_usd = cost_usd + ?");
    values.push(patch.cost);
  }
  if (patch.status !== undefined) {
    // A stopped (or guardrail-blocked) run that then reports a failure failed because of
    // that: it keeps its status. A run that reports success after all is `completed`.
    sets.push(patch.status === "failed" ? "status = CASE WHEN status IN ('stopped', 'blocked') THEN status ELSE ? END" : "status = ?");
    values.push(patch.status);
  }
  if (patch.ending !== undefined) {
    sets.push("ending = ?");
    values.push(patch.ending);
  }
  if (patch.debrief !== undefined) {
    sets.push("debrief = ?");
    values.push(patch.debrief);
  }
  if (patch.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(patch.completedAt);
  }
  // First-seen-wins: only store when the column is still NULL
  if (patch.provider !== undefined) {
    sets.push("provider = COALESCE(provider, ?)");
    values.push(patch.provider);
  }
  if (patch.model !== undefined) {
    sets.push("model = COALESCE(model, ?)");
    values.push(patch.model);
  }
  if (patch.strategy !== undefined) {
    // ui-core `foldRunStrategy`: a claim replaces the stored strategy only when it
    // outranks it (first-seen within a rank). SET expressions read the old row.
    const rank = patch.strategyRank ?? 0;
    sets.push(
      "strategy = CASE WHEN strategy IS NULL OR COALESCE(strategy_rank, 0) < ? THEN ? ELSE strategy END",
      "strategy_rank = MAX(COALESCE(strategy_rank, 0), ?)",
    );
    values.push(rank, patch.strategy, rank);
  }
  if (patch.errorMessage !== undefined) {
    sets.push("error_message = ?");
    values.push(patch.errorMessage);
  }
  if (patch.parentRunId !== undefined) {
    sets.push("parent_run_id = COALESCE(parent_run_id, ?)");
    values.push(patch.parentRunId);
  }
  if (patch.rootRunId !== undefined) {
    sets.push("root_run_id = COALESCE(root_run_id, ?)");
    values.push(patch.rootRunId);
  }
  if (patch.contextRunId !== undefined) {
    sets.push("context_run_id = COALESCE(context_run_id, ?)");
    values.push(patch.contextRunId);
  }
  if (patch.continuedFrom !== undefined) {
    sets.push("continued_from = COALESCE(continued_from, ?)");
    values.push(patch.continuedFrom);
  }
  if (patch.depth !== undefined) {
    sets.push("depth = COALESCE(depth, ?)");
    values.push(patch.depth);
  }

  if (sets.length === 0) return;
  values.push(runId);
  db.prepare(`UPDATE cortex_runs SET ${sets.join(", ")} WHERE run_id = ?`).run(
    ...(values as [string | number, ...(string | number)[]]),
  );
}

export function updateRunLabel(db: Database, runId: string, label: string): boolean {
  const result = db.prepare("UPDATE cortex_runs SET display_name = ? WHERE run_id = ?")
    .run(label.trim().slice(0, 200), runId);
  return (result.changes as number) > 0;
}

type RunRow = {
  run_id: string;
  agent_id: string;
  started_at: number;
  completed_at: number | null;
  status: string;
  iteration_count: number;
  tokens_used: number;
  cost_usd: number;
  has_debrief: number;
  provider: string | null;
  model: string | null;
  strategy: string | null;
  error_message: string | null;
  ending: string | null;
  display_name: string | null;
  launch_params_json: string | null;
  parent_run_id: string | null;
  root_run_id: string | null;
  context_run_id: string | null;
  continued_from: string | null;
  depth: number | null;
  /** From LEFT JOIN cortex_agents — only present on joined selects */
  agent_table_name?: string | null;
  /** From LEFT JOIN cortex_agents — the saved agent's config, used when a run has no launch snapshot. */
  agent_table_config?: string | null;
  /** From LEFT JOIN cortex_chat_sessions: the chat that started the run (or its root run). */
  chat_session_id?: string | null;
  chat_session_name?: string | null;
};

/** Parse a stored launch_params_json blob; null on absence or malformed JSON. */
function parseLaunchParams(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Launch params for a run that has no stored snapshot (runs fired by a saved
 * Lab / gateway agent before snapshots were written): the saved agent's current
 * config, when it carries a prompt. `{{variables}}` stay in the payload so a
 * rerun resolves them from their defaults like a scheduled fire does.
 */
function launchParamsFromAgentConfig(rawConfig: string | null | undefined): Record<string, unknown> | undefined {
  const cfg = parseLaunchParams(rawConfig ?? null);
  return cfg && typeof cfg.prompt === "string" && cfg.prompt.trim() !== "" ? cfg : undefined;
}

function resolvedRunDisplayName(row: RunRow): string | undefined {
  const fromRun = row.display_name?.trim();
  if (fromRun) return fromRun;
  const fromAgent = row.agent_table_name?.trim();
  if (fromAgent) return fromAgent;
  return undefined;
}

function rowToRunSummary(row: RunRow): RunSummary {
  const displayName = resolvedRunDisplayName(row);
  const agentRecordName = row.agent_table_name?.trim() || undefined;
  const base: RunSummary = {
    runId: row.run_id,
    agentId: row.agent_id,
    startedAt: row.started_at,
    status: row.status as RunSummary["status"],
    iterationCount: row.iteration_count,
    tokensUsed: row.tokens_used,
    cost: row.cost_usd,
    hasDebrief: row.has_debrief === 1,
    ...(displayName ? { displayName } : {}),
    ...(agentRecordName ? { agentRecordName } : {}),
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.model    ? { model:    row.model    } : {}),
    ...(row.strategy ? { strategy: row.strategy } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.ending ? { ending: row.ending } : {}),
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.root_run_id ? { rootRunId: row.root_run_id } : {}),
    ...(row.context_run_id ? { contextRunId: row.context_run_id } : {}),
    ...(row.continued_from ? { continuedFrom: row.continued_from } : {}),
    ...(row.depth != null ? { depth: row.depth } : {}),
    ...(row.chat_session_id ? { chatSessionId: row.chat_session_id } : {}),
    ...(row.chat_session_id && row.chat_session_name ? { chatSessionName: row.chat_session_name } : {}),
    ...((): { launchParams?: Record<string, unknown> } => {
      const lp = parseLaunchParams(row.launch_params_json) ?? launchParamsFromAgentConfig(row.agent_table_config);
      return lp ? { launchParams: lp } : {};
    })(),
  };
  return base;
}

const runSelectBase = `
    r.run_id, r.agent_id, r.started_at, r.completed_at, r.status,
    r.iteration_count, r.tokens_used, r.cost_usd,
    (r.debrief IS NOT NULL) AS has_debrief,
    r.provider, r.model, r.strategy, r.error_message, r.ending,
    r.display_name, r.launch_params_json,
    r.parent_run_id, r.root_run_id, r.context_run_id, r.continued_from, r.depth,
    a.name AS agent_table_name, a.config AS agent_table_config,
    cs.session_id AS chat_session_id, cs.name AS chat_session_name`;

/**
 * Runs joined with their saved agent and with the chat session that started
 * them: a chat root run's events carry the session id; a sub-agent run finds it
 * through its root run. A deleted session joins to nothing.
 */
const runFrom = `
    FROM cortex_runs r
    LEFT JOIN cortex_agents a ON a.agent_id = r.agent_id
    LEFT JOIN cortex_chat_sessions cs ON cs.session_id = (
      SELECT e.session_id FROM cortex_events e
      WHERE e.run_id IN (r.run_id, r.root_run_id) AND e.session_id IS NOT NULL
      LIMIT 1
    )`;

export function getRecentRuns(db: Database, limit = 50): RunSummary[] {
  const rows = db
    .prepare(
      `
    SELECT ${runSelectBase}
    ${runFrom}
    ORDER BY r.started_at DESC
    LIMIT ?
  `,
    )
    .all(limit) as RunRow[];
  return rows.map(rowToRunSummary);
}

export function getRunById(db: Database, runId: string): RunSummary | null {
  const row = db
    .prepare(
      `
    SELECT ${runSelectBase}
    ${runFrom}
    WHERE r.run_id = ?
  `,
    )
    .get(runId) as RunRow | null;
  return row ? rowToRunSummary(row) : null;
}

export function getRunDebrief(db: Database, runId: string): string | null {
  const row = db
    .prepare("SELECT debrief FROM cortex_runs WHERE run_id = ?")
    .get(runId) as { debrief: string | null } | null;
  return row?.debrief ?? null;
}

/** Full run row including raw debrief JSON for the single-run detail endpoint. */
export function getRunDetail(
  db: Database,
  runId: string,
): (RunSummary & { debrief: string | null }) | null {
  const row = db
    .prepare(
      `
    SELECT ${runSelectBase},
           r.debrief
    ${runFrom}
    WHERE r.run_id = ?
  `,
    )
    .get(runId) as (RunRow & { debrief: string | null }) | null;
  if (!row) return null;
  return { ...rowToRunSummary(row), debrief: row.debrief ?? null };
}

export function getRunAgentId(db: Database, runId: string): string | null {
  const row = db
    .prepare(
      `
    SELECT agent_id
    FROM cortex_runs
    WHERE run_id = ?
  `,
    )
    .get(runId) as { agent_id: string } | null;
  return row?.agent_id ?? null;
}

export function getRunEvents(
  db: Database,
  runId: string,
): Array<{ ts: number; type: string; payload: string }> {
  return db
    .prepare(
      `
    SELECT ts, type, payload
    FROM cortex_events
    WHERE run_id = ?
    ORDER BY seq ASC
  `,
    )
    .all(runId) as Array<{ ts: number; type: string; payload: string }>;
}

export function getNextSeq(db: Database, runId: string): number {
  const row = db
    .prepare(
      `
    SELECT COALESCE(MAX(seq), -1) + 1 as next_seq
    FROM cortex_events WHERE run_id = ?
  `,
    )
    .get(runId) as { next_seq: number } | null;
  return row?.next_seq ?? 0;
}

export function deleteRun(db: Database, runId: string): boolean {
  deleteChatSessionsForRun(db, runId);
  db.prepare(`DELETE FROM cortex_events WHERE run_id = ?`).run(runId);
  const result = db.prepare(`DELETE FROM cortex_runs WHERE run_id = ?`).run(runId) as {
    changes?: number;
  };
  return (result.changes ?? 0) > 0;
}

/**
 * Remove stale runs older than `beforeTs`.
 *
 * By default this preserves rows currently marked `live` to avoid deleting
 * active runs. Set `includeLive=true` to force-delete even stale live rows.
 */
export function pruneRuns(
  db: Database,
  beforeTs: number,
  includeLive = false,
): number {
  const staleRows = includeLive
    ? (db
        .prepare(
          `
          SELECT run_id
          FROM cortex_runs
          WHERE started_at < ?
        `,
        )
        .all(beforeTs) as Array<{ run_id: string }>)
    : (db
        .prepare(
          `
          SELECT run_id
          FROM cortex_runs
          WHERE started_at < ? AND status != 'live'
        `,
        )
        .all(beforeTs) as Array<{ run_id: string }>);

  let deleted = 0;
  for (const row of staleRows) {
    if (deleteRun(db, row.run_id)) deleted++;
  }
  return deleted;
}

/**
 * Close chat runs a restart left `live`. A chat run runs inside this process, so
 * after a restart nothing can end it: its root (the run whose events carry a
 * chat `session_id`) and the sub-agent runs under it become `stopped`. Runs of a
 * session holding a paused turn (approval or question, resumable after restart)
 * and runs from other agents (which may still be alive) are left alone. Call once
 * at boot. A closed run ends at its last event (`now` when it has none). Returns
 * the number of runs closed.
 */
export function closeOrphanedChatRuns(db: Database, now: number): number {
  const result = db
    .prepare(
      `
      WITH chat_roots AS (
        SELECT DISTINCT e.run_id FROM cortex_events e
        WHERE e.session_id IN (SELECT session_id FROM cortex_chat_sessions)
          AND e.session_id NOT IN (SELECT session_id FROM chat_pending_approvals)
          AND e.session_id NOT IN (SELECT session_id FROM chat_pending_interactions)
      )
      UPDATE cortex_runs
      -- Ended when it last reported, not at this boot (else its duration spans the downtime).
      SET status = 'stopped',
          completed_at = COALESCE((SELECT MAX(ts) FROM cortex_events WHERE cortex_events.run_id = cortex_runs.run_id), ?)
      WHERE status = 'live'
        AND (run_id IN (SELECT run_id FROM chat_roots) OR root_run_id IN (SELECT run_id FROM chat_roots))
    `,
    )
    .run(now);
  return result.changes as number;
}

type EventRow = { ts: number; type: string; payload: string };

function toObjectPayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type DerivedRunStatus = "live" | "completed" | "failed" | "stopped" | "blocked";

/** A run ended from outside (stopped) or by a guardrail (blocked) keeps that status when a failure follows. */
const keepsEnding = (s: DerivedRunStatus): s is "stopped" | "blocked" => s === "stopped" || s === "blocked";

/**
 * Recompute rollup stats in `cortex_runs` from persisted `cortex_events`.
 * Useful for repairing rows that were created before stat mapping fixes.
 */
export function recomputeRunStats(db: Database, runId: string): boolean {
  const events = db
    .prepare(
      `
      SELECT ts, type, payload
      FROM cortex_events
      WHERE run_id = ?
      ORDER BY seq ASC
    `,
    )
    .all(runId) as EventRow[];

  if (events.length === 0) return false;

  let iterationCount = 0;
  let tokensUsed = 0;
  let cost = 0;
  let status = "live" as DerivedRunStatus;
  let completedAt: number | null = null;
  let debrief: string | null = null;
  let ending: string | null = null;

  for (const row of events) {
    const p = toObjectPayload(row.payload);
    switch (row.type) {
      case "LLMRequestCompleted":
        tokensUsed += typeof p.tokensUsed === "number" ? p.tokensUsed : 0;
        cost += typeof p.estimatedCost === "number" ? p.estimatedCost : 0;
        break;
      case "ReasoningStepCompleted":
        iterationCount = Math.max(
          iterationCount,
          typeof p.totalSteps === "number"
            ? p.totalSteps
            : typeof p.step === "number"
              ? p.step
              : 0,
        );
        break;
      case "ReasoningIterationProgress":
        iterationCount = Math.max(
          iterationCount,
          typeof p.iteration === "number" ? p.iteration : 0,
        );
        break;
      case "AgentCompleted":
        // A user stop is `stopped`; a failure keeps an earlier stop/block.
        status = completedStatusOf(p) === "failed" && keepsEnding(status) ? status : completedStatusOf(p);
        ending = runEndingOf(p);
        completedAt = row.ts;
        break;
      case "TaskFailed":
        status = keepsEnding(status) ? status : "failed";
        completedAt = row.ts;
        break;
      case "AgentAborted":
        // Same rule as ingest and the UI's `abortStatusOf`; a failure keeps an earlier stop/block.
        status =
          p.reason === "user-stop" || p.reason === "terminate"
            ? "stopped"
            : p.reason === "guardrail"
              ? "blocked"
              : keepsEnding(status)
                ? status
                : "failed";
        completedAt = row.ts;
        break;
      case "ExecutionCancelled":
      case "AgentStopped":
      case "AgentTerminated":
        status = "stopped";
        completedAt = row.ts;
        break;
      case "DebriefCompleted":
        debrief = row.payload;
        break;
    }
  }

  db.prepare(
    `
      UPDATE cortex_runs
      SET iteration_count = ?,
          tokens_used = ?,
          cost_usd = ?,
          status = ?,
          completed_at = ?,
          debrief = ?,
          ending = ?
      WHERE run_id = ?
    `,
  ).run(iterationCount, tokensUsed, cost, status, completedAt, debrief, ending, runId);

  return true;
}

/**
 * Fill `cortex_runs.ending` for finished runs stored before the column existed,
 * from each run's last `AgentCompleted` event. Runs with no such event stay NULL.
 * Returns how many rows it set. Called once, when the migration adds the column.
 */
export function backfillRunEndings(db: Database): number {
  const rows = db
    .prepare(
      `
      SELECT e.run_id AS run_id, e.payload AS payload
      FROM cortex_events e
      JOIN cortex_runs r ON r.run_id = e.run_id
      WHERE r.ending IS NULL AND e.type = 'AgentCompleted'
        AND e.id = (SELECT MAX(e2.id) FROM cortex_events e2 WHERE e2.run_id = e.run_id AND e2.type = 'AgentCompleted')
    `,
    )
    .all() as Array<{ run_id: string; payload: string }>;
  const set = db.prepare("UPDATE cortex_runs SET ending = ? WHERE run_id = ?");
  for (const row of rows) set.run(runEndingOf(toObjectPayload(row.payload)), row.run_id);
  return rows.length;
}

// ─── Gateway Agent CRUD ──────────────────────────────────────────────────────

export interface GatewayAgentRow {
  readonly agent_id: string;
  readonly name: string;
  readonly config: string;
  readonly agent_type: "gateway" | "ad-hoc";
  readonly status: string;
  readonly run_count: number;
  readonly last_run_at: number | null;
  readonly schedule: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

const AGENT_SELECT = `
  SELECT agent_id, name, config, agent_type, status, run_count, last_run_at, schedule, created_at, updated_at
  FROM cortex_agents
`;

export function getGatewayAgents(db: Database): GatewayAgentRow[] {
  return db.prepare(`${AGENT_SELECT} ORDER BY created_at DESC`).all() as GatewayAgentRow[];
}

export function getGatewayAgent(db: Database, agentId: string): GatewayAgentRow | null {
  return db.prepare(`${AGENT_SELECT} WHERE agent_id = ?`).get(agentId) as GatewayAgentRow | null;
}

export function createGatewayAgent(
  db: Database,
  agentId: string,
  name: string,
  config: string,
  schedule: string | null,
  agentType: "gateway" | "ad-hoc" = "gateway",
): void {
  db.prepare(`
    INSERT OR REPLACE INTO cortex_agents
      (agent_id, name, config, agent_type, status, run_count, schedule, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', 0, ?, unixepoch('now','subsec')*1000, unixepoch('now','subsec')*1000)
  `).run(agentId, name, config, agentType, schedule);
}

export function updateGatewayAgent(
  db: Database,
  agentId: string,
  patch: { name?: string; config?: string; type?: "gateway" | "ad-hoc"; status?: string; schedule?: string | null },
): void {
  const sets: string[] = ["updated_at = unixepoch('now','subsec')*1000"];
  const values: SQLQueryBindings[] = [];
  if (patch.name !== undefined)   { sets.push("name = ?");     values.push(patch.name); }
  if (patch.config !== undefined) { sets.push("config = ?");   values.push(patch.config); }
  if (patch.type !== undefined)   { sets.push("agent_type = ?"); values.push(patch.type); }
  if (patch.status !== undefined) { sets.push("status = ?");   values.push(patch.status); }
  if ("schedule" in patch)        { sets.push("schedule = ?"); values.push(patch.schedule ?? null); }
  if (sets.length === 1) return;
  values.push(agentId);
  db.prepare(`UPDATE cortex_agents SET ${sets.join(", ")} WHERE agent_id = ?`).run(...values);
}

export function deleteGatewayAgent(db: Database, agentId: string): boolean {
  const info = db.prepare("DELETE FROM cortex_agents WHERE agent_id = ?").run(agentId) as { changes?: number };
  return (info.changes ?? 0) > 0;
}

export interface AgentStats {
  runCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  avgTokens: number;
  totalCostUsd: number;
  avgDurationMs: number;
}

export function getAgentStats(db: Database, agentId: string): AgentStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS run_count,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS success_count,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
         AVG(CAST(tokens_used AS REAL)) AS avg_tokens,
         SUM(cost_usd) AS total_cost,
         AVG(CASE WHEN completed_at IS NOT NULL THEN completed_at - started_at ELSE NULL END) AS avg_duration_ms
       FROM cortex_runs
       WHERE agent_id = ?`,
    )
    .get(agentId) as {
    run_count: number;
    success_count: number;
    failed_count: number;
    avg_tokens: number | null;
    total_cost: number | null;
    avg_duration_ms: number | null;
  } | null;

  if (!row || row.run_count === 0) {
    return { runCount: 0, successCount: 0, failedCount: 0, successRate: 0, avgTokens: 0, totalCostUsd: 0, avgDurationMs: 0 };
  }
  return {
    runCount: row.run_count,
    successCount: row.success_count,
    failedCount: row.failed_count,
    successRate: row.run_count > 0 ? row.success_count / row.run_count : 0,
    avgTokens: row.avg_tokens ?? 0,
    totalCostUsd: row.total_cost ?? 0,
    avgDurationMs: row.avg_duration_ms ?? 0,
  };
}
