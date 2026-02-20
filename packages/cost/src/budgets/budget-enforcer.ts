import { Effect, Ref } from "effect";
import type { BudgetLimits, BudgetStatus } from "../types.js";
import { BudgetExceededError } from "../errors.js";

export interface BudgetState {
  readonly sessionSpend: Record<string, number>;  // sessionId -> total
  readonly dailySpend: Record<string, number>;    // agentId -> today's total
  readonly monthlySpend: Record<string, number>;  // agentId -> month's total
}

export interface BudgetEnforcer {
  readonly check: (estimatedCost: number, agentId: string, sessionId: string) => Effect.Effect<void, BudgetExceededError>;
  readonly record: (cost: number, agentId: string, sessionId: string) => Effect.Effect<void, never>;
  readonly getStatus: (agentId: string) => Effect.Effect<BudgetStatus, never>;
}

export const makeBudgetEnforcer = (limits: BudgetLimits) =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<BudgetState>({
      sessionSpend: {},
      dailySpend: {},
      monthlySpend: {},
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
      Ref.update(stateRef, (state) => ({
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

    const getStatus = (agentId: string): Effect.Effect<BudgetStatus, never> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const daily = state.dailySpend[agentId] ?? 0;
        const monthly = state.monthlySpend[agentId] ?? 0;

        return {
          currentSession: 0,
          currentDaily: daily,
          currentMonthly: monthly,
          limits,
          percentUsedDaily: (daily / limits.daily) * 100,
          percentUsedMonthly: (monthly / limits.monthly) * 100,
        };
      });

    return { check, record, getStatus } satisfies BudgetEnforcer;
  });
