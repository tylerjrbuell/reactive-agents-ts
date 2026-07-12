import { describe, it, expect } from "bun:test";
import { deriveGoalAchieved } from "../src/builder.js";
import { resolveGoalAchieved } from "../src/builder/helpers.js";

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

// ── resolveGoalAchieved — deliverable evidence resolves end_turn's "maybe" ──
// 2026-07-11 probe p5: goalAchieved stayed null forever under .withLongHorizon()
// while the deterministic answer sat on receipt.deliverables one field away.
describe("resolveGoalAchieved", () => {
  const produced = [{ spec: "produce the file ./a.md", produced: true }];
  const missing = [{ spec: "produce the file ./a.md", produced: false }];

  it("upgrades end_turn null → true when every declared deliverable landed", () => {
    expect(resolveGoalAchieved("end_turn", produced)).toBe(true);
  });

  it("resolves to false when a declared deliverable is missing — even beside an explicit final answer", () => {
    expect(resolveGoalAchieved("end_turn", missing)).toBe(false);
    expect(resolveGoalAchieved("final_answer_tool", missing)).toBe(false);
  });

  it("does NOT upgrade an explicit false — produced files don't un-fail a capped run", () => {
    expect(resolveGoalAchieved("max_iterations", produced)).toBe(false);
  });

  it("falls back to the heuristic verbatim for pure Q&A (no declared deliverables)", () => {
    expect(resolveGoalAchieved("end_turn", undefined)).toBeNull();
    expect(resolveGoalAchieved("end_turn", [])).toBeNull();
    expect(resolveGoalAchieved("final_answer_tool", [])).toBe(true);
  });
});
