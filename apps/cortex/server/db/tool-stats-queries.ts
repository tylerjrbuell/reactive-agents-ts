import type { Database } from "bun:sqlite";

export type ToolUsageRollup = {
  callCount: number;
  successCount: number;
  avgDurationMs: number | null;
  lastUsedAt: number | null;
};

/**
 * Aggregate ToolCallCompleted rows from persisted ingest (`cortex_events`).
 */
export function rollupToolUsageFromEvents(db: Database, toolName: string): ToolUsageRollup {
  const rows = db
    .prepare(
      `SELECT payload FROM cortex_events WHERE type = 'ToolCallCompleted' AND json_extract(payload, '$.toolName') = ?`,
    )
    .all(toolName) as Array<{ payload: string }>;

  if (rows.length === 0) {
    return { callCount: 0, successCount: 0, avgDurationMs: null, lastUsedAt: null };
  }

  let successCount = 0;
  let durSum = 0;
  let durN = 0;
  let lastTs = 0;

  for (const { payload } of rows) {
    try {
      const p = JSON.parse(payload) as {
        success?: boolean;
        durationMs?: number;
      };
      if (p.success === true) successCount++;
      if (typeof p.durationMs === "number" && Number.isFinite(p.durationMs)) {
        durSum += p.durationMs;
        durN++;
      }
    } catch {
      /* skip malformed */
    }
  }

  const evTs = db
    .prepare(
      `SELECT MAX(ts) AS m FROM cortex_events WHERE type = 'ToolCallCompleted' AND json_extract(payload, '$.toolName') = ?`,
    )
    .get(toolName) as { m: number | null } | undefined;

  return {
    callCount: rows.length,
    successCount,
    avgDurationMs: durN > 0 ? Math.round(durSum / durN) : null,
    lastUsedAt: evTs?.m ?? null,
  };
}
