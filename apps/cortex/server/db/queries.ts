import type { Database } from "bun:sqlite";
import type { CortexIngestMessage, RunSummary } from "../types.js";

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

export function upsertRun(db: Database, agentId: string, runId: string): void {
  db.prepare(
    `
    INSERT INTO cortex_runs (run_id, agent_id, started_at)
    VALUES (?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      agent_id = CASE
        WHEN cortex_runs.agent_id = cortex_runs.run_id OR cortex_runs.agent_id = 'unknown'
          THEN excluded.agent_id
        ELSE cortex_runs.agent_id
      END
  `,
  ).run(runId, agentId, Date.now());
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
    debrief?: string;
    completedAt?: number;
    /** SET only when not already stored (first-seen wins) */
    provider?: string;
    model?: string;
    strategy?: string;
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
    sets.push("status = ?");
    values.push(patch.status);
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
    sets.push("strategy = COALESCE(strategy, ?)");
    values.push(patch.strategy);
  }

  if (sets.length === 0) return;
  values.push(runId);
  db.prepare(`UPDATE cortex_runs SET ${sets.join(", ")} WHERE run_id = ?`).run(
    ...(values as [string | number, ...(string | number)[]]),
  );
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
};

function rowToRunSummary(row: RunRow): RunSummary {
  const base: RunSummary = {
    runId: row.run_id,
    agentId: row.agent_id,
    startedAt: row.started_at,
    status: row.status as RunSummary["status"],
    iterationCount: row.iteration_count,
    tokensUsed: row.tokens_used,
    cost: row.cost_usd,
    hasDebrief: row.has_debrief === 1,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.model    ? { model:    row.model    } : {}),
    ...(row.strategy ? { strategy: row.strategy } : {}),
    ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
  };
  return base;
}

export function getRecentRuns(db: Database, limit = 50): RunSummary[] {
  const rows = db
    .prepare(
      `
    SELECT run_id, agent_id, started_at, completed_at, status,
           iteration_count, tokens_used, cost_usd,
           (debrief IS NOT NULL) AS has_debrief,
           provider, model, strategy
    FROM cortex_runs
    ORDER BY started_at DESC
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
    SELECT run_id, agent_id, started_at, completed_at, status,
           iteration_count, tokens_used, cost_usd,
           (debrief IS NOT NULL) AS has_debrief,
           provider, model, strategy
    FROM cortex_runs
    WHERE run_id = ?
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
    SELECT run_id, agent_id, started_at, completed_at, status,
           iteration_count, tokens_used, cost_usd,
           (debrief IS NOT NULL) AS has_debrief,
           provider, model, strategy,
           debrief
    FROM cortex_runs WHERE run_id = ?
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

type EventRow = { ts: number; type: string; payload: string };

function toObjectPayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

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
  let status: "live" | "completed" | "failed" = "live";
  let completedAt: number | null = null;
  let debrief: string | null = null;

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
        status = p.success === true ? "completed" : "failed";
        completedAt = row.ts;
        break;
      case "TaskFailed":
        status = "failed";
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
          debrief = ?
      WHERE run_id = ?
    `,
  ).run(iterationCount, tokensUsed, cost, status, completedAt, debrief, runId);

  return true;
}

// ─── Gateway Agent CRUD ──────────────────────────────────────────────────────

export interface GatewayAgentRow {
  readonly agent_id: string;
  readonly name: string;
  readonly config: string;
  readonly status: string;
  readonly run_count: number;
  readonly last_run_at: number | null;
  readonly schedule: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

const AGENT_SELECT = `
  SELECT agent_id, name, config, status, run_count, last_run_at, schedule, created_at, updated_at
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
): void {
  db.prepare(`
    INSERT OR REPLACE INTO cortex_agents
      (agent_id, name, config, status, run_count, schedule, created_at, updated_at)
    VALUES (?, ?, ?, 'active', 0, ?, unixepoch('now','subsec')*1000, unixepoch('now','subsec')*1000)
  `).run(agentId, name, config, schedule);
}

export function updateGatewayAgent(
  db: Database,
  agentId: string,
  patch: { name?: string; config?: string; status?: string; schedule?: string | null },
): void {
  const sets: string[] = ["updated_at = unixepoch('now','subsec')*1000"];
  const values: unknown[] = [];
  if (patch.name !== undefined)   { sets.push("name = ?");     values.push(patch.name); }
  if (patch.config !== undefined) { sets.push("config = ?");   values.push(patch.config); }
  if (patch.status !== undefined) { sets.push("status = ?");   values.push(patch.status); }
  if ("schedule" in patch)        { sets.push("schedule = ?"); values.push(patch.schedule ?? null); }
  if (sets.length === 1) return;
  values.push(agentId);
  // bun:sqlite run() accepts SQLQueryBindings spread
  (db.prepare(`UPDATE cortex_agents SET ${sets.join(", ")} WHERE agent_id = ?`) as any).run(...values);
}

export function deleteGatewayAgent(db: Database, agentId: string): boolean {
  const info = db.prepare("DELETE FROM cortex_agents WHERE agent_id = ?").run(agentId) as { changes?: number };
  return (info.changes ?? 0) > 0;
}
