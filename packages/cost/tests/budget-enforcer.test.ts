import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { makeBudgetEnforcer, type BudgetEnforcer } from "../src/budgets/budget-enforcer.js";
import { BudgetExceededError } from "../src/errors.js";
import type { BudgetLimits } from "../src/types.js";

const testLimits: BudgetLimits = {
  perRequest: 0.5,
  perSession: 2.0,
  daily: 10.0,
  monthly: 50.0,
};

const runWithBudget = <A>(effect: (budget: BudgetEnforcer) => Effect.Effect<A, any, never>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const budget = yield* makeBudgetEnforcer(testLimits);
      return yield* effect(budget);
    }),
  );

describe("Budget Enforcer", () => {
  test("allows requests within budget", async () => {
    await runWithBudget((budget) =>
      budget.check(0.1, "agent-1", "sess-1"),
    );
  });

  test("rejects requests exceeding per-request limit", async () => {
    const result = await runWithBudget((budget) =>
      budget.check(1.0, "agent-1", "sess-1").pipe(Effect.flip),
    );
    expect(result).toBeInstanceOf(BudgetExceededError);
    expect((result as BudgetExceededError).budgetType).toBe("perRequest");
  });

  test("rejects requests exceeding session limit", async () => {
    const result = await runWithBudget((budget) =>
      Effect.gen(function* () {
        yield* budget.record(1.5, "agent-1", "sess-1");
        return yield* budget.check(0.49, "agent-1", "sess-1").pipe(Effect.either);
      }),
    );
    expect(result._tag).toBe("Right");
  });

  test("tracks cumulative spending", async () => {
    const result = await runWithBudget((budget) =>
      Effect.gen(function* () {
        yield* budget.record(1.8, "agent-1", "sess-1");
        return yield* budget.check(0.3, "agent-1", "sess-1").pipe(Effect.flip);
      }),
    );
    expect(result).toBeInstanceOf(BudgetExceededError);
    expect((result as BudgetExceededError).budgetType).toBe("perSession");
  });

  test("provides budget status", async () => {
    const status = await runWithBudget((budget) =>
      Effect.gen(function* () {
        yield* budget.record(5.0, "agent-1", "sess-1");
        return yield* budget.getStatus("agent-1");
      }),
    );
    expect((status as any).currentDaily).toBe(5.0);
    expect((status as any).percentUsedDaily).toBe(50);
    expect((status as any).limits.daily).toBe(10.0);
  });
});
