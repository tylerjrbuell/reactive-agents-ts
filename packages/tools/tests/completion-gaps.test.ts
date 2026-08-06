// Run: bun test packages/tools/tests/completion-gaps.test.ts --timeout 15000
//
// detectCompletionGaps must only flag a verb→tool gap for a tool the agent
// ACTUALLY HAS. Root fix 2026-08-06: a task saying "look up" on an agent with no
// web-search tool used to block final-answer forever on an unsatisfiable phantom
// requirement — the model finishes, the gate refuses, it stalls, and the harness
// ships a fabricated deliverable (observed on Gemini native-FC).
import { describe, it, expect } from "bun:test";
import { detectCompletionGaps } from "../src/skills/completion-gaps.js";

const TASK = "Use get_fact to look up the sky, then tell me the fact.";

describe("detectCompletionGaps — verb→tool gaps only for AVAILABLE tools", () => {
  it("does NOT flag web-search when the agent has no such tool (phantom requirement)", () => {
    const gaps = detectCompletionGaps(
      TASK,
      new Set(["get_fact"]),
      [{ name: "get_fact" }], // web-search NOT available
    );
    expect(gaps).toEqual([]);
  });

  it("DOES flag web-search when it IS available but was not called", () => {
    const gaps = detectCompletionGaps(
      TASK,
      new Set(["get_fact"]),
      [{ name: "get_fact" }, { name: "web-search" }], // available, unused
    );
    expect(gaps.length).toBe(1);
    expect(gaps[0]).toContain("web-search");
  });

  it("does NOT flag web-search when it IS available AND was called", () => {
    const gaps = detectCompletionGaps(
      TASK,
      new Set(["get_fact", "web-search"]),
      [{ name: "get_fact" }, { name: "web-search" }],
    );
    expect(gaps).toEqual([]);
  });
});
