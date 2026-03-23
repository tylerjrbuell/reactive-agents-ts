import { Effect } from "effect";
import { getPlatformSync } from "@reactive-agents/platform";

/**
 * Lightweight SQLite persistence for budget spend tracking.
 * Stores daily and monthly spend keyed by (agentId, period).
 * Period format: "2026-03-06" for daily, "2026-03" for monthly.
 */
export interface BudgetDb {
  /** Load spend for a given agent and period. Returns 0 if no record. */
  readonly loadSpend: (agentId: string, period: string) => Effect.Effect<number, never>;
  /** Atomically add cost to an agent's period spend. */
  readonly addSpend: (agentId: string, period: string, cost: number) => Effect.Effect<void, never>;
  /** Close the database. */
  readonly close: () => Effect.Effect<void, never>;
}

export const makeBudgetDb = (dbPath: string): Effect.Effect<BudgetDb, never> =>
  Effect.sync(() => {
    const db = getPlatformSync().database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS budget_spend (
        agent_id TEXT NOT NULL,
        period   TEXT NOT NULL,
        spend    REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (agent_id, period)
      )
    `);

    const loadStmt = db.prepare(
      "SELECT spend FROM budget_spend WHERE agent_id = ? AND period = ?",
    );
    const upsertStmt = db.prepare(
      `INSERT INTO budget_spend (agent_id, period, spend)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id, period) DO UPDATE SET spend = spend + excluded.spend`,
    );

    return {
      loadSpend: (agentId, period) =>
        Effect.sync(() => {
          const row = loadStmt.get(agentId, period) as { spend: number } | undefined;
          return row?.spend ?? 0;
        }),

      addSpend: (agentId, period, cost) =>
        Effect.sync(() => {
          upsertStmt.run(agentId, period, cost);
        }),

      close: () =>
        Effect.sync(() => {
          db.close();
        }),
    } satisfies BudgetDb;
  });

/** Today in YYYY-MM-DD format (UTC). */
export const todayKey = (): string => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

/** This month in YYYY-MM format (UTC). */
export const monthKey = (): string => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
