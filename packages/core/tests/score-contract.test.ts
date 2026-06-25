import { describe, expect, it } from "bun:test";
import { CANONICAL_QUALITY_DIMENSIONS } from "../src/contracts/score-contract.js";
import type { DimensionScore, QualityDimension } from "../src/contracts/score-contract.js";

describe("canonical quality dimensions", () => {
  it("is exactly the 10 agentic dimensions, in order", () => {
    expect(CANONICAL_QUALITY_DIMENSIONS).toEqual([
      "accuracy",
      "reasoning",
      "tool-mastery",
      "memory-fidelity",
      "loop-intelligence",
      "resilience",
      "efficiency",
      "reliability",
      "scope-discipline",
      "honest-uncertainty",
    ]);
  });

  it("does NOT include the deferred eval dims (safety/relevance/completeness/cost-efficiency)", () => {
    const set = new Set<string>(CANONICAL_QUALITY_DIMENSIONS);
    for (const d of ["safety", "relevance", "completeness", "cost-efficiency"]) {
      expect(set.has(d)).toBe(false);
    }
  });

  it("DimensionScore is structurally usable with a canonical dimension", () => {
    const s: DimensionScore = { dimension: "accuracy", score: 0.9 };
    const d: QualityDimension = "reasoning";
    expect(s.score).toBe(0.9);
    expect(d).toBe("reasoning");
  });
});
