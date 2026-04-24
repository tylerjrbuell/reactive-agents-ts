import { describe, it, expect } from "bun:test";
import { deriveGoalAchieved } from "../src/builder.js";

describe("deriveGoalAchieved", () => {
  it("returns true when agent produced a final answer via the tool", () => {
    expect(deriveGoalAchieved("final_answer_tool")).toBe(true);
  });

  it("returns true when agent produced a final answer inline", () => {
    expect(deriveGoalAchieved("final_answer")).toBe(true);
  });

  it("returns false when the loop exhausted its iteration budget", () => {
    expect(deriveGoalAchieved("max_iterations")).toBe(false);
  });

  it("returns false when an LLM error killed the run", () => {
    expect(deriveGoalAchieved("llm_error")).toBe(false);
  });

  it("returns null for end_turn — the model finished its turn without explicit completion signal", () => {
    expect(deriveGoalAchieved("end_turn")).toBeNull();
  });

  it("returns null when terminatedBy is undefined (unknown goal state)", () => {
    expect(deriveGoalAchieved(undefined)).toBeNull();
  });
});
