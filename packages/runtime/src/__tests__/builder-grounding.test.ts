import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../builder.js";
import { asBuilderState } from "./_helpers.js";

/**
 * `.withGrounding()` builder wiring tests.
 *
 * Validates:
 *  (a) calling withGrounding({ mode: "warn" }) lands on `_groundingConfig`.
 *  (b) calling withGrounding({ mode: "block" }) stores block mode.
 *  (c) optional fields (tolerance, maxRetries) are preserved.
 *  (d) without withGrounding(), `_groundingConfig` stays undefined (off by default).
 *  (e) chains with other builder methods.
 *
 * Builder-state assertions use the same `BuilderState` view that production
 * wither bodies access — so a passing test guarantees the field lands in the
 * RuntimeOptions flow (same as _budgetLimits / _leanHarness).
 *
 * End-to-end grounding behavior (terminal verify, block-mode retry) is covered
 * in packages/reasoning tests. This file only validates the builder API.
 */
describe(".withGrounding() builder", () => {
  it("stores warn-mode grounding config on the builder's internal state", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withGrounding({ mode: "warn" });
    const state = asBuilderState(builder);
    expect(state._groundingConfig).toBeDefined();
    expect(state._groundingConfig?.mode).toBe("warn");
  });

  it("stores block-mode grounding config", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withGrounding({ mode: "block" });
    const state = asBuilderState(builder);
    expect(state._groundingConfig?.mode).toBe("block");
  });

  it("preserves optional tolerance and maxRetries", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withGrounding({ mode: "block", tolerance: 0.02, maxRetries: 2 });
    const state = asBuilderState(builder);
    expect(state._groundingConfig?.tolerance).toBe(0.02);
    expect(state._groundingConfig?.maxRetries).toBe(2);
  });

  it("leaves _groundingConfig undefined when withGrounding() is not called (off by default)", () => {
    const builder = ReactiveAgents.create().withProvider("test").withReasoning();
    const state = asBuilderState(builder);
    expect(state._groundingConfig).toBeUndefined();
  });

  it("returns `this` for chaining and composes with other builder methods", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withAgentId("grounding-chain-test")
      .withGrounding({ mode: "warn", tolerance: 0.01 })
      .withReasoning();
    const state = asBuilderState(builder);
    expect(state._groundingConfig?.mode).toBe("warn");
    expect(state._groundingConfig?.tolerance).toBe(0.01);
    expect(state._enableReasoning).toBe(true);
  });

  it("builds successfully with warn grounding (no runtime error)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("g")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGrounding({ mode: "warn" })
      .build();
    expect(agent).toBeDefined();
  });

  it("builds successfully without grounding (no withGrounding call)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("g2")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .build();
    expect(agent).toBeDefined();
  });
});
