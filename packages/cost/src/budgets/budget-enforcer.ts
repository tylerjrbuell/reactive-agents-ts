import { Effect, Ref } from "effect";
import type { BudgetLimits, BudgetStatus } from "../types.js";
import { BudgetExceededError } from "../errors.js";
import type { BudgetDb } from "./budget-db.js";
import { todayKey, monthKey } from "./budget-db.js";

export interface BudgetState {
  readonly sessionSpend: Record<string, number>;  // sessionId -> total
  readonly dailySpend: Record<string, number>;    // agentId -> today's total
  readonly monthlySpend: Record<string, number>;  // agentId -> month's total
}

export interface BudgetEnforcer {
  readonly check: (estimatedCost: number, agentId: string, sessionId: string) => Effect.Effect<void, BudgetExceededError>;
  readonly record: (cost: number, agentId: string, sessionId: string) => Effect.Effect<void, never>;
  readonly getStatus: (agentId: string, sessionId?: string) => Effect.Effect<BudgetStatus, never>;
  /** Load persisted daily/monthly spend from SQLite for an agent. No-op without db. */
  readonly hydrate: (agentId: string) => Effect.Effect<void, never>;
}

export const makeBudgetEnforcer = (limits: BudgetLimits, db?: BudgetDb) =>
  Effect.gen(function* () {
    // Hydrate daily/monthly spend from SQLite if persistence is enabled
    const initialDaily: Record<string, number> = {};
    const initialMonthly: Record<string, number> = {};

    const stateRef = yield* Ref.make<BudgetState>({
      sessionSpend: {},
      dailySpend: initialDaily,
      monthlySpend: initialMonthly,
    });

    const check = (
      estimatedCost: number,
      agentId: string,
      sessionId: string,
    ): Effect.Effect<void, BudgetExceededError> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);

        const sessionCurrent = state.sessionSpend[sessionId] ?? 0;
        const dailyCurrent = state.dailySpend[agentId] ?? 0;
        const monthlyCurrent = state.monthlySpend[agentId] ?? 0;

        if (estimatedCost > limits.perRequest) {
          return yield* Effect.fail(
            new BudgetExceededError({
              message: `Request cost $${estimatedCost.toFixed(4)} exceeds per-request limit $${limits.perRequest}`,
              budgetType: "perRequest",
              limit: limits.perRequest,
              current: 0,
              requested: estimatedCost,
            }),
          );
        }

        if (sessionCurrent + estimatedCost > limits.perSession) {
          return yield* Effect.fail(
            new BudgetExceededError({
              message: `Session spend $${(sessionCurrent + estimatedCost).toFixed(4)} exceeds limit $${limits.perSession}`,
              budgetType: "perSession",
              limit: limits.perSession,
              current: sessionCurrent,
              requested: estimatedCost,
            }),
          );
        }

        if (dailyCurrent + estimatedCost > limits.daily) {
          return yield* Effect.fail(
            new BudgetExceededError({
              message: `Daily spend $${(dailyCurrent + estimatedCost).toFixed(4)} exceeds limit $${limits.daily}`,
              budgetType: "daily",
              limit: limits.daily,
              current: dailyCurrent,
              requested: estimatedCost,
            }),
          );
        }

        if (monthlyCurrent + estimatedCost > limits.monthly) {
          return yield* Effect.fail(
            new BudgetExceededError({
              message: `Monthly spend $${(monthlyCurrent + estimatedCost).toFixed(4)} exceeds limit $${limits.monthly}`,
              budgetType: "monthly",
              limit: limits.monthly,
              current: monthlyCurrent,
              requested: estimatedCost,
            }),
          );
        }
      });

    const record = (
      cost: number,
      agentId: string,
      sessionId: string,
    ): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        yield* Ref.update(stateRef, (state) => ({
          sessionSpend: {
            ...state.sessionSpend,
            [sessionId]: (state.sessionSpend[sessionId] ?? 0) + cost,
          },
          dailySpend: {
            ...state.dailySpend,
            [agentId]: (state.dailySpend[agentId] ?? 0) + cost,
          },
          monthlySpend: {
            ...state.monthlySpend,
            [agentId]: (state.monthlySpend[agentId] ?? 0) + cost,
          },
        }));

        // Write-through to SQLite if persistence is enabled
        if (db) {
          yield* db.addSpend(agentId, `daily:${todayKey()}`, cost);
          yield* db.addSpend(agentId, `monthly:${monthKey()}`, cost);
        }
      });

    const getStatus = (agentId: string, sessionId?: string): Effect.Effect<BudgetStatus, never> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const daily = state.dailySpend[agentId] ?? 0;
        const monthly = state.monthlySpend[agentId] ?? 0;
        const session = sessionId ? (state.sessionSpend[sessionId] ?? 0) : 0;

        return {
          currentSession: session,
          currentDaily: daily,
          currentMonthly: monthly,
          limits,
          percentUsedDaily: (daily / limits.daily) * 100,
          percentUsedMonthly: (monthly / limits.monthly) * 100,
        };
      });

    const hydrate = (agentId: string): Effect.Effect<void, never> => {
      if (!db) return Effect.void;
      return Effect.gen(function* () {
        const dailySpend = yield* db.loadSpend(agentId, `daily:${todayKey()}`);
        const monthlySpend = yield* db.loadSpend(agentId, `monthly:${monthKey()}`);
        yield* Ref.update(stateRef, (state) => ({
          ...state,
          dailySpend: { ...state.dailySpend, [agentId]: dailySpend },
          monthlySpend: { ...state.monthlySpend, [agentId]: monthlySpend },
        }));
      });
    };

    return { check, record, getStatus, hydrate } satisfies BudgetEnforcer;
  });
