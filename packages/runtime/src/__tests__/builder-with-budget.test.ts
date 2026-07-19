import { describe, it, expect } from "bun:test";
import { ReactiveAgents, type BudgetLimits } from "../builder.js";
import { asBuilderState } from "./_helpers.js";

/**
 * `.withBudget()` wiring tests.
 *
 * Validates:
 *  (a) calling withBudget() without any cap (spend: tokenLimit/costLimit;
 *      execution: maxIterations/minIterations/timeout/llmTimeout) throws.
 *  (b) costLimit-only call lands on `_budgetLimits.costLimit`.
 *  (c) tokenLimit + warningRatio combination is preserved.
 *  (d) without withBudget(), `_budgetLimits` stays undefined (backward compat).
 *  (e) chains with other builder methods.
 *
 * Builder-state assertions use the same `BuilderRuntimeStateView` view that
 * `buildBaseRuntimeAndEngine` reads — so a passing test guarantees the field
 * lands in the RuntimeOptions flow at the same site `_maxIterations` /
 * `_leanHarness` do.
 *
 * End-to-end Arbitrator firing on `terminatedBy="budget_exceeded"` is covered
 * separately in `packages/reasoning/src/kernel/capabilities/decide/arbitrator.budget.test.ts`.
 * The runtime → reasoning leg in `reasoning-think.ts` forwards the field via
 * `executeRequest.budgetLimits`; full propagation into `KernelInput.budgetLimits`
 * additionally requires `ReactiveInput.budgetLimits` + a one-line wire in
 * `strategies/reactive.ts` (kernel-warden follow-up).
 */
describe(".withBudget() builder", () => {
  it("throws when neither tokenLimit nor costLimit is supplied", () => {
    const builder = ReactiveAgents.create().withProvider("test");
    expect(() => builder.withBudget({} as BudgetLimits)).toThrow(
      /withBudget\(\) requires at least one of `tokenLimit`, `costLimit`, `maxIterations`, `minIterations`, `timeout`, or `llmTimeout`/,
    );
  });

  it("throws when both tokenLimit and costLimit are explicit undefined", () => {
    const builder = ReactiveAgents.create().withProvider("test");
    expect(() =>
      builder.withBudget({
        tokenLimit: undefined,
        costLimit: undefined,
        warningRatio: 0.5,
      } as BudgetLimits),
    ).toThrow(
      /withBudget\(\) requires at least one of `tokenLimit`, `costLimit`, `maxIterations`, `minIterations`, `timeout`, or `llmTimeout`/,
    );
  });

  it("stores costLimit on the builder's internal state", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withBudget({ costLimit: 0.01 });
    const state = asBuilderState(builder);
    expect(state._budgetLimits).toBeDefined();
    expect(state._budgetLimits?.costLimit).toBe(0.01);
    expect(state._budgetLimits?.tokenLimit).toBeUndefined();
  });

  it("preserves tokenLimit + warningRatio together", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withBudget({ tokenLimit: 5000, warningRatio: 0.75 });
    const state = asBuilderState(builder);
    expect(state._budgetLimits?.tokenLimit).toBe(5000);
    expect(state._budgetLimits?.warningRatio).toBe(0.75);
    expect(state._budgetLimits?.costLimit).toBeUndefined();
  });

  it("leaves _budgetLimits undefined when withBudget() is not called (backward compat)", () => {
    const builder = ReactiveAgents.create().withProvider("test").withReasoning();
    const state = asBuilderState(builder);
    expect(state._budgetLimits).toBeUndefined();
  });

  it("returns `this` for chaining and composes with other builder methods", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withAgentId("budget-chain-test")
      .withBudget({ costLimit: 0.5, tokenLimit: 10000 })
      .withReasoning();
    const state = asBuilderState(builder);
    expect(state._budgetLimits?.costLimit).toBe(0.5);
    expect(state._budgetLimits?.tokenLimit).toBe(10000);
    expect(state._enableReasoning).toBe(true);
  });
});
