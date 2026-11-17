/**
 * Run count and last run time per saved agent, from `cortex_runs`: the same table the agent card's
 * ok%, average tokens and cost (`getAgentStats`) read. `cortex_agents.run_count` is only bumped by the
 * cron-fire launcher, so a run the agent answers through a channel (channel hub routes) never moved it
 * and the card said "0 runs" next to real stats.
 */

/** The one database call this module makes (a `bun:sqlite` Database satisfies it; no driver import here). */
export interface RunsDb {
  prepare(sql: string): { all(): unknown[] };
}

/** One agent's totals. */
export interface AgentRunTotals {
  readonly runCount: number;
  readonly lastRunAt: number | null;
}

/** Totals for every agent that has runs; an agent with none is absent (count 0). */
export function runTotalsByAgent(db: RunsDb): Map<string, AgentRunTotals> {
  const rows = db.prepare("SELECT agent_id, COUNT(*) AS n, MAX(started_at) AS last FROM cortex_runs GROUP BY agent_id").all() as { agent_id: string; n: number; last: number | null }[];
  return new Map(rows.map((r) => [r.agent_id, { runCount: r.n, lastRunAt: r.last }] as const));
}

/** The count and last-run time to show: the runs table, never less than the stored counter (kept as a floor). */
export function shownRunTotals(stored: { run_count: number; last_run_at: number | null }, totals: AgentRunTotals | undefined): AgentRunTotals {
  return {
    runCount: Math.max(stored.run_count, totals?.runCount ?? 0),
    lastRunAt: Math.max(stored.last_run_at ?? 0, totals?.lastRunAt ?? 0) || null,
  };
}
