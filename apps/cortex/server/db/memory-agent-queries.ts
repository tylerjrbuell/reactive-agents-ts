/**
 * Labels for the Memory studio's agent picker: which Cortex object an agent id
 * belongs to (a saved agent, a chat session, or desk runs). Reads cortex.db only;
 * memory itself is read through `agent.memory()` (services/memory-inspector.ts).
 */
import type { Database } from "bun:sqlite";

/** One agent in the Memory studio picker. */
export interface MemoryAgentRow {
  readonly agentId: string;
  /** Saved agent name, else chat session name, else the latest run's name, else the id. */
  readonly label: string;
  readonly kind: "saved-agent" | "chat" | "runs" | "other";
  readonly runCount: number;
  readonly lastRunAt: number | null;
}

interface RunAgg {
  readonly agent_id: string;
  readonly run_count: number;
  readonly last_run_at: number | null;
  readonly display_name: string | null;
}

/** Label and run stats for each agent id (order kept). */
export function memoryAgentRows(db: Database, agentIds: readonly string[]): MemoryAgentRow[] {
  if (agentIds.length === 0) return [];
  const saved = new Map<string, string>();
  for (const r of db.prepare("SELECT agent_id, name FROM cortex_agents").all() as { agent_id: string; name: string }[]) {
    saved.set(r.agent_id, r.name);
  }
  const chats = new Map<string, string>();
  for (const r of db
    .prepare("SELECT stable_agent_id, name FROM cortex_chat_sessions WHERE stable_agent_id IS NOT NULL")
    .all() as { stable_agent_id: string; name: string }[]) {
    chats.set(r.stable_agent_id, r.name);
  }
  const runs = new Map<string, RunAgg>();
  for (const r of db
    .prepare(
      `SELECT agent_id, COUNT(*) AS run_count, MAX(started_at) AS last_run_at,
              (SELECT display_name FROM cortex_runs r2 WHERE r2.agent_id = r1.agent_id AND r2.display_name IS NOT NULL
                ORDER BY r2.started_at DESC LIMIT 1) AS display_name
       FROM cortex_runs r1 GROUP BY agent_id`,
    )
    .all() as RunAgg[]) {
    runs.set(r.agent_id, r);
  }
  return agentIds.map((agentId) => {
    const run = runs.get(agentId);
    const savedName = saved.get(agentId);
    const chatName = chats.get(agentId);
    const kind: MemoryAgentRow["kind"] = savedName ? "saved-agent" : chatName ? "chat" : run ? "runs" : "other";
    return {
      agentId,
      label: savedName ?? chatName ?? run?.display_name ?? agentId,
      kind,
      runCount: run?.run_count ?? 0,
      lastRunAt: run?.last_run_at ?? null,
    };
  });
}
