// Quality program Task 5 (seam seeds, GH #260): direct-import behavioral pin
// for the builder withers family (#218). The class methods are delegates; the
// withers modules are the seam future behavior changes land in — this test
// proves the module is real, callable in isolation, and owns the documented
// slot routing (incl. the #9 audit invariant: execution-only budgets must NOT
// create an empty spend-limits object). Zero casts.

import { describe, it, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder.js";
import { applyWithBudget } from "../src/builder/withers/model-budget.js";
import { asBuilderState } from "../src/builder/withers/_state.js";

describe("withers seam — applyWithBudget (direct module call)", () => {
  it("writes the spend-cap slot from a token limit", () => {
    const builder = new ReactiveAgentBuilder();
    applyWithBudget(builder, { tokenLimit: 1000 });
    const s = asBuilderState(builder);
    expect(s._budgetLimits?.tokenLimit).toBe(1000);
  });

  it("routes execution caps to the SAME slots the standalone withers set, and creates NO spend-limits object when no spend cap is present (#9 audit invariant)", () => {
    const builder = new ReactiveAgentBuilder();
    applyWithBudget(builder, {
      maxIterations: 4,
      minIterations: 2,
      timeout: 5000,
      llmTimeout: 7000,
    });
    const s = asBuilderState(builder);
    expect(s._maxIterations).toBe(4);
    expect(s._minIterations).toBe(2);
    expect(s._executionTimeoutMs).toBe(5000);
    expect(s._ollamaTimeoutMs).toBe(7000);
    expect(s._budgetLimits).toBeUndefined();
  });

  it("rejects an empty budget with the documented message", () => {
    const builder = new ReactiveAgentBuilder();
    expect(() => applyWithBudget(builder, {})).toThrow(/at least one of/);
  });

  it("the class delegate keeps chain semantics and lands on the same slots", () => {
    const builder = new ReactiveAgentBuilder();
    const returned = builder.withBudget({ costLimit: 0.25 });
    expect(returned).toBe(builder);
    expect(asBuilderState(builder)._budgetLimits?.costLimit).toBe(0.25);
  });
});
