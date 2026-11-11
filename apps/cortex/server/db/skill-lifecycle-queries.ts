/**
 * Skill lifecycle events an agent's runs reported (`SkillActivated`, `SkillRefined`,
 * `SkillRolledBack`, `SkillPromoted`), read from the stored run events in cortex.db.
 * The skills themselves are read through the framework (services/agent-skills.ts).
 */
import type { Database } from "bun:sqlite";
import { SKILL_LIFECYCLE_TAGS } from "@reactive-agents/ui-core";

/** One stored lifecycle event. */
export interface SkillLifecycleRow {
  readonly id: number;
  readonly ts: number;
  /** The Cortex run to link: the event's `taskId` when Cortex has that run, else the run it was stored under. */
  readonly runId: string;
  /** The event as the run published it (`_tag`, `skillName`, versions, `taskId`, …). */
  readonly event: Record<string, unknown>;
}

interface RawRow {
  readonly id: number;
  readonly ts: number;
  readonly run_id: string;
  readonly task_run: string | null;
  readonly type: string;
  readonly payload: string;
}

const parseEvent = (type: string, payload: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(payload);
    if (v && typeof v === "object" && !Array.isArray(v)) return { _tag: type, ...(v as Record<string, unknown>) };
  } catch {
    // A row that is not JSON keeps only its type.
  }
  return { _tag: type };
};

/** The provider and model of the agent's latest run that recorded one, or `null`. */
export function lastRunModelOf(db: Database, agentId: string): { provider: string; model?: string } | null {
  const row = db
    .prepare(
      `SELECT provider, model FROM cortex_runs
        WHERE agent_id = ? AND provider IS NOT NULL AND provider != ''
        ORDER BY started_at DESC LIMIT 1`,
    )
    .get(agentId) as { provider: string; model: string | null } | null;
  if (!row) return null;
  return { provider: row.provider, ...(row.model ? { model: row.model } : {}) };
}

/** A Cortex library row (cortex.db `skills`, deprecated), or `null`. */
export function librarySkillRow(
  db: Database,
  id: string,
): { id: string; name: string; description: string; content: string } | null {
  const row = db.prepare("SELECT id, name, description, content FROM skills WHERE id = ?").get(id) as
    | { id: number | string; name: string | null; description: string | null; content: string | null }
    | null;
  if (!row) return null;
  return { id: String(row.id), name: row.name ?? "", description: row.description ?? "", content: row.content ?? "" };
}

/**
 * Newest first, at most `limit` (default 300, max 1000). `skillName` narrows to one
 * skill (matched in the stored payload).
 */
export function skillLifecycleRows(
  db: Database,
  agentId: string,
  opts: { readonly skillName?: string; readonly limit?: number } = {},
): SkillLifecycleRow[] {
  const limit = Math.min(1000, Math.max(1, opts.limit ?? 300));
  const tags = SKILL_LIFECYCLE_TAGS;
  const placeholders = tags.map(() => "?").join(", ");
  const bySkill = opts.skillName !== undefined ? "AND json_extract(e.payload, '$.skillName') = ?" : "";
  const rows = db
    .prepare(
      `SELECT e.id, e.ts, e.run_id, e.type, e.payload, r.run_id AS task_run
         FROM cortex_events e
         LEFT JOIN cortex_runs r ON r.run_id = json_extract(e.payload, '$.taskId')
        WHERE e.agent_id = ? AND e.type IN (${placeholders}) ${bySkill}
        ORDER BY e.ts DESC, e.id DESC
        LIMIT ?`,
    )
    .all(agentId, ...tags, ...(opts.skillName !== undefined ? [opts.skillName] : []), limit) as RawRow[];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    runId: r.task_run ?? r.run_id,
    event: parseEvent(r.type, r.payload),
  }));
}
