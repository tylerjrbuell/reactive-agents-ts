// Run: bun test packages/reasoning/tests/kernel/abstain-gate.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { shouldOfferAbstain } from "../../src/kernel/capabilities/reason/abstain-gate";

describe("shouldOfferAbstain", () => {
  const base = { enabled: true, iteration: 0, requiredToolUnavailable: false, toolsAttempted: 0 };

  it("never offers on iteration 0 of a solvable task", () => {
    expect(shouldOfferAbstain(base)).toBe(false);
  }, 15000);

  it("offers after the model has worked (iteration >= 1)", () => {
    expect(shouldOfferAbstain({ ...base, iteration: 1 })).toBe(true);
  }, 15000);

  it("offers immediately when a required tool is unavailable", () => {
    expect(shouldOfferAbstain({ ...base, iteration: 0, requiredToolUnavailable: true })).toBe(true);
  }, 15000);

  it("never offers when disabled", () => {
    expect(shouldOfferAbstain({ ...base, iteration: 5, enabled: false })).toBe(false);
  }, 15000);
});
