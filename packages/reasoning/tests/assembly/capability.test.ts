import { describe, it, expect } from "bun:test";
import { resolveCapability } from "../../src/assembly/capability.js";

describe("resolveCapability — single source; budgets derived", () => {
  it("derives recency/aged budgets from the window", () => {
    const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    expect(cap.recencyBudgetChars).toBe(Math.floor(15360 * 0.35 * 4));
    expect(cap.agedBudgetChars).toBeLessThan(cap.recencyBudgetChars);
  });
  it("RA_RECENCY_BUDGET_CHARS overrides the derived recency budget (test knob)", () => {
    process.env.RA_RECENCY_BUDGET_CHARS = "2000";
    try {
      const cap = resolveCapability({ window: 32768, outputBudget: 2000, dialect: "native-fc", tier: "mid" });
      expect(cap.recencyBudgetChars).toBe(2000);
    } finally {
      delete process.env.RA_RECENCY_BUDGET_CHARS;
    }
  });
  it("predicts num_ctx as smallest bucket ≥ assembled+output+headroom", () => {
    const cap = resolveCapability({ window: 131072, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    expect(cap.predictNumCtx(6000)).toBe(16384); // 6000 + 2000 + 1024 → 16k bucket
    expect(cap.predictNumCtx(20000)).toBe(32768);
  });
});
