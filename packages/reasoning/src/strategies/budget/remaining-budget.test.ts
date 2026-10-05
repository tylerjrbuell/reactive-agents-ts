// Run: bun test packages/reasoning/src/strategies/budget/remaining-budget.test.ts --timeout 15000
//
// Unit pins for the shared cumulative-budget helper. This is the arithmetic
// half of the plan-execute cumulative-budget fix: each step kernel receives
// the REMAINING budget (tokenLimit minus cumulative run spend so far), not a
// fresh full pool, and the strategy layer stops launching new work once the
// spend crosses the limit. The behavioral half is pinned by
// ../plan-execute-cumulative-budget.integration.test.ts.

import { describe, expect, it } from "bun:test";
import {
  budgetStopReason,
  isBudgetExhausted,
  withSpentBudget,
} from "./remaining-budget.js";

describe("withSpentBudget - remaining-budget threading", () => {
  it("reduces tokenLimit by cumulative spend so far", () => {
    const remaining = withSpentBudget({ tokenLimit: 1000 }, { tokens: 400, cost: 0 });
    expect(remaining).toEqual({ tokenLimit: 600 });
  });

  it("reduces costLimit by cumulative cost and preserves warningRatio", () => {
    const remaining = withSpentBudget(
      { tokenLimit: 1000, costLimit: 2, warningRatio: 0.5 },
      { tokens: 250, cost: 0.5 },
    );
    expect(remaining).toEqual({ tokenLimit: 750, costLimit: 1.5, warningRatio: 0.5 });
  });

  it("floors a crossed limit at 0 (never negative - a 0 limit means nothing left to spend)", () => {
    const remaining = withSpentBudget({ tokenLimit: 1000 }, { tokens: 1500, cost: 0 });
    expect(remaining).toEqual({ tokenLimit: 0 });
  });

  it("passes through undefined limits unchanged (no budget declared → no gating)", () => {
    expect(withSpentBudget(undefined, { tokens: 10, cost: 1 })).toBeUndefined();
    const empty = withSpentBudget({}, { tokens: 10, cost: 1 });
    expect(empty).toEqual({});
  });

  it("leaves an undeclared tokenLimit undeclared (does not invent a 0 cap)", () => {
    const remaining = withSpentBudget({ costLimit: 5 }, { tokens: 9999, cost: 1 });
    expect(remaining).toEqual({ costLimit: 4 });
  });
});

describe("isBudgetExhausted - strategy-level stop predicate", () => {
  it("tokens at or over the limit → true; below → false", () => {
    expect(isBudgetExhausted({ tokenLimit: 1000 }, { tokens: 1000, cost: 0 })).toBe(true);
    expect(isBudgetExhausted({ tokenLimit: 1000 }, { tokens: 999, cost: 0 })).toBe(false);
  });

  it("cost at or over the limit → true", () => {
    expect(isBudgetExhausted({ costLimit: 1 }, { tokens: 0, cost: 1.2 })).toBe(true);
  });

  it("no limits declared → never exhausted", () => {
    expect(isBudgetExhausted(undefined, { tokens: 1_000_000, cost: 100 })).toBe(false);
    expect(isBudgetExhausted({}, { tokens: 1_000_000, cost: 100 })).toBe(false);
  });
});

describe("budgetStopReason - raw open-string channel (kernel parity)", () => {
  it("formats the tokens leg like the kernel killswitch: budget-limit:tokens:<spent>/<limit>", () => {
    expect(budgetStopReason({ tokenLimit: 40000 }, { tokens: 41234, cost: 0 })).toBe(
      "budget-limit:tokens:41234/40000",
    );
  });

  it("formats the cost leg when cost is the exhausted dimension", () => {
    expect(budgetStopReason({ costLimit: 2 }, { tokens: 0, cost: 2.5 })).toBe(
      "budget-limit:cost:2.5/2",
    );
  });

  it("undefined when not exhausted", () => {
    expect(budgetStopReason({ tokenLimit: 40000 }, { tokens: 100, cost: 0 })).toBeUndefined();
    expect(budgetStopReason(undefined, { tokens: 100, cost: 0 })).toBeUndefined();
  });
});
