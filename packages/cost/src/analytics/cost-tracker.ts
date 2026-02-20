import { Effect, Ref } from "effect";
import type { CostEntry, CostReport } from "../types.js";
import { CostTrackingError } from "../errors.js";

export interface CostTracker {
  readonly record: (entry: Omit<CostEntry, "id" | "timestamp">) => Effect.Effect<void, CostTrackingError>;
  readonly getReport: (period: "session" | "daily" | "weekly" | "monthly", agentId?: string) => Effect.Effect<CostReport, CostTrackingError>;
}

export const makeCostTracker = Effect.gen(function* () {
  const entriesRef = yield* Ref.make<CostEntry[]>([]);

  const record = (
    entry: Omit<CostEntry, "id" | "timestamp">,
  ): Effect.Effect<void, CostTrackingError> =>
    Ref.update(entriesRef, (entries) => [
      ...entries,
      {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: new Date(),
      },
    ]).pipe(
      Effect.mapError(
        (e) => new CostTrackingError({ message: "Failed to record cost entry", cause: e }),
      ),
    );

  const getReport = (
    period: "session" | "daily" | "weekly" | "monthly",
    agentId?: string,
  ): Effect.Effect<CostReport, CostTrackingError> =>
    Effect.gen(function* () {
      const allEntries = yield* Ref.get(entriesRef);
      const now = Date.now();

      const periodMs: Record<string, number> = {
        session: 0,
        daily: 86_400_000,
        weekly: 604_800_000,
        monthly: 2_592_000_000,
      };

      let entries =
        period === "session"
          ? allEntries
          : allEntries.filter(
              (e) => now - e.timestamp.getTime() < periodMs[period]!,
            );

      if (agentId) {
        entries = entries.filter((e) => e.agentId === agentId);
      }

      const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
      const cacheHits = entries.filter((e) => e.cachedHit).length;
      const cacheMisses = entries.filter((e) => !e.cachedHit).length;

      const costByTier: Record<string, number> = {};
      for (const entry of entries) {
        costByTier[entry.tier] = (costByTier[entry.tier] ?? 0) + entry.cost;
      }

      const costByAgent: Record<string, number> = {};
      for (const entry of entries) {
        costByAgent[entry.agentId] = (costByAgent[entry.agentId] ?? 0) + entry.cost;
      }

      return {
        period,
        totalCost,
        totalRequests: entries.length,
        cacheHits,
        cacheMisses,
        cacheHitRate: entries.length > 0 ? cacheHits / entries.length : 0,
        savings: 0,
        costByTier,
        costByAgent,
        avgCostPerRequest: entries.length > 0 ? totalCost / entries.length : 0,
        avgLatencyMs:
          entries.length > 0
            ? entries.reduce((sum, e) => sum + e.latencyMs, 0) / entries.length
            : 0,
      };
    }).pipe(
      Effect.mapError(
        (e) => new CostTrackingError({ message: "Failed to generate report", cause: e }),
      ),
    );

  return { record, getReport } satisfies CostTracker;
});
