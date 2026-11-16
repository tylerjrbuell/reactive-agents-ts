import { describe, expect, it } from "bun:test";
import { effectiveBound, planBudgetEffective, planBudgetTitle } from "./plan-budget.js";

const raised = { guard: "plan_budget_raised", metadata: { configured: 10, steps: 22, effective: 23, hardCap: 30 } };

describe("planBudgetEffective", () => {
  it("reads the raised bound from the plan_budget_raised guard event", () => {
    expect(planBudgetEffective("GuardFiredEmitted", raised)).toBe(23);
  });
  it("ignores other guards, other events and malformed metadata", () => {
    expect(planBudgetEffective("GuardFiredEmitted", { guard: "exit_gate", metadata: { effective: 9 } })).toBeUndefined();
    expect(planBudgetEffective("ReasoningIterationProgress", raised)).toBeUndefined();
    expect(planBudgetEffective("GuardFiredEmitted", { guard: "plan_budget_raised" })).toBeUndefined();
    expect(planBudgetEffective("GuardFiredEmitted", { guard: "plan_budget_raised", metadata: { effective: "23" } })).toBeUndefined();
  });
});

describe("effectiveBound", () => {
  it("takes the larger of the reported and raised bound", () => {
    expect(effectiveBound(10, 23)).toBe(23);
    expect(effectiveBound(10, undefined)).toBe(10);
    expect(effectiveBound(undefined, undefined)).toBe(0);
  });
});

describe("planBudgetTitle", () => {
  it("titles only the budget guard, by its reason", () => {
    expect(planBudgetTitle({ guard: "plan_budget_raised", reason: "iteration budget raised to 23 for a 22-step plan" })).toBe("iteration budget raised to 23 for a 22-step plan");
    expect(planBudgetTitle({ guard: "exit_gate", reason: "x" })).toBeUndefined();
  });
});
