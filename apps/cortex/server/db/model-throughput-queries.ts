import type { Database } from "bun:sqlite";

/** One stored `LLMRequestCompleted` payload of a recent run, with the run it belongs to. */
export interface StoredLlmCall {
  readonly runId: string;
  readonly payload: string;
}

/**
 * `LLMRequestCompleted` payloads of the `runLimit` most recent runs recorded on
 * `provider` / `model` (newest run first). The join goes through
 * `idx_events_agent_run`, so only those runs' events are read.
 */
export function getRecentLlmCalls(
  db: Database,
  provider: string,
  model: string,
  runLimit: number,
): StoredLlmCall[] {
  return db
    .prepare(
      `
    SELECT e.run_id AS runId, e.payload AS payload
    FROM (
      SELECT run_id, agent_id, started_at FROM cortex_runs
      WHERE provider = ? AND model = ?
      ORDER BY started_at DESC
      LIMIT ?
    ) r
    JOIN cortex_events e ON e.agent_id = r.agent_id AND e.run_id = r.run_id
    WHERE e.type = 'LLMRequestCompleted'
    ORDER BY r.started_at DESC, e.seq ASC
  `,
    )
    .all(provider, model, runLimit) as StoredLlmCall[];
}

/**
 * Outcome of the `runLimit` most recent runs recorded on `provider` / `model`
 * (newest first): the same window as {@link getRecentLlmCalls}. Live runs are
 * left out: they have not ended, so they neither succeeded nor failed yet.
 */
export function getRecentRunOutcomes(
  db: Database,
  provider: string,
  model: string,
  runLimit: number,
): { runId: string; status: string; ending: string | null }[] {
  return db
    .prepare(
      `SELECT run_id AS runId, status, ending FROM (
         SELECT run_id, status, ending, started_at FROM cortex_runs
         WHERE provider = ? AND model = ?
         ORDER BY started_at DESC
         LIMIT ?
       ) WHERE status != 'live'`,
    )
    .all(provider, model, runLimit) as { runId: string; status: string; ending: string | null }[];
}
