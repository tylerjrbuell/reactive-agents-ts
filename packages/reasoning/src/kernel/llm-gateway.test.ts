import { describe, expect, test } from "bun:test";
import { resolveOutputBudget } from "./llm-gateway.js";
import { THINKING_SAFE_MIN_TOKENS } from "./utils/stream-parser.js";

// Phase 1 gateway (2026-07-07). These pins encode the BEHAVIOR-IDENTICAL
// migration contract: every pre-gateway literal must resolve to the same
// number through the gateway. Change a pin only with bench evidence.

describe("resolveOutputBudget", () => {
  test("explicit budgetTokens wins over everything", () => {
    expect(
      resolveOutputBudget({ purpose: "think", budgetTokens: 2500, tier: "local", budgetClass: "generous" }),
    ).toBe(2500);
  });

  test("provider-default omits the budget entirely", () => {
    expect(resolveOutputBudget({ purpose: "synthesize", budgetClass: "provider-default" })).toBeUndefined();
  });

  test("think + tier reproduces the B2 tier table", () => {
    expect(resolveOutputBudget({ purpose: "think", tier: "local" })).toBe(1200);
    expect(resolveOutputBudget({ purpose: "think", tier: "mid" })).toBe(2000);
    expect(resolveOutputBudget({ purpose: "think", tier: "large" })).toBe(3000);
    expect(resolveOutputBudget({ purpose: "think", tier: "frontier" })).toBe(4000);
    expect(resolveOutputBudget({ purpose: "think", tier: "unknown-tier" })).toBe(1500);
  });

  test("think + thinking model adds the B2 allowance", () => {
    expect(resolveOutputBudget({ purpose: "think", tier: "local", thinkingModel: true })).toBe(7200);
    expect(resolveOutputBudget({ purpose: "think", tier: "mid", thinkingModel: true })).toBe(8000);
  });

  test("explicit budgetClass beats the tier-adaptive think path", () => {
    expect(resolveOutputBudget({ purpose: "think", tier: "local", budgetClass: "standard" })).toBe(4096);
  });

  test("purpose defaults: plan/synthesize/extract → 4096, classify/verify → 2048", () => {
    expect(resolveOutputBudget({ purpose: "plan" })).toBe(4096);
    expect(resolveOutputBudget({ purpose: "synthesize" })).toBe(4096);
    expect(resolveOutputBudget({ purpose: "extract" })).toBe(4096);
    expect(resolveOutputBudget({ purpose: "classify" })).toBe(THINKING_SAFE_MIN_TOKENS);
    expect(resolveOutputBudget({ purpose: "verify" })).toBe(THINKING_SAFE_MIN_TOKENS);
  });

  test("class table: terse=2048, standard=4096, generous=8192", () => {
    expect(resolveOutputBudget({ purpose: "synthesize", budgetClass: "terse" })).toBe(2048);
    expect(resolveOutputBudget({ purpose: "classify", budgetClass: "standard" })).toBe(4096);
    expect(resolveOutputBudget({ purpose: "synthesize", budgetClass: "generous" })).toBe(8192);
  });

  test("think without tier falls back to the standard class (no tier info = no adaptivity)", () => {
    expect(resolveOutputBudget({ purpose: "think" })).toBe(4096);
  });
});
