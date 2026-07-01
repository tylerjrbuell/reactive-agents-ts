// Run: bun test packages/runtime/src/builder/__tests__/derive-goal-achieved.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { deriveGoalAchieved } from "../helpers";

describe("deriveGoalAchieved — abstained", () => {
  it("returns false for the abstained terminal (honest non-achievement)", () => {
    expect(deriveGoalAchieved("abstained")).toBe(false);
  }, 15000);

  it("keeps existing mappings intact", () => {
    expect(deriveGoalAchieved("final_answer")).toBe(true);
    expect(deriveGoalAchieved("max_iterations")).toBe(false);
    expect(deriveGoalAchieved("end_turn")).toBe(null);
    expect(deriveGoalAchieved(undefined)).toBe(null);
  }, 15000);
});
