import { describe, test, expect } from "bun:test";
import { computeCompositeEntropy } from "../../src/sensor/composite.js";

describe("composite entropy scorer", () => {
  test("combines all sources with correct weights (logprobs available)", () => {
    const result = computeCompositeEntropy({
      token: 0.3,
      structural: 0.2,
      semantic: 0.4,
      behavioral: 0.5,
      contextPressure: 0.1,
      logprobsAvailable: true,
      iteration: 5,
      maxIterations: 10,
    });
    expect(result.composite).toBeGreaterThan(0);
    expect(result.composite).toBeLessThan(1);
    expect(result.sources.token).toBe(0.3);
    expect(result.confidence).toBe("high"); // all 4 core sources present
  });

  test("adjusts weights when logprobs unavailable", () => {
    const result = computeCompositeEntropy({
      token: null,
      structural: 0.2,
      semantic: 0.4,
      behavioral: 0.5,
      contextPressure: 0.1,
      logprobsAvailable: false,
      iteration: 5,
      maxIterations: 10,
    });
    expect(result.sources.token).toBeNull();
    // Weights redistribute: structural 0.40, semantic 0.25, behavioral 0.25, context 0.10
  });

  test("confidence is medium with 2-3 sources", () => {
    const result = computeCompositeEntropy({
      token: null,
      structural: 0.3,
      semantic: null,
      behavioral: 0.5,
      contextPressure: 0.1,
      logprobsAvailable: false,
      iteration: 3,
      maxIterations: 10,
    });
    expect(result.confidence).toBe("low"); // only structural + behavioral
  });

  test("iteration weight affects final composite", () => {
    const early = computeCompositeEntropy({
      token: null, structural: 0.8, semantic: null, behavioral: 0.8,
      contextPressure: 0.1, logprobsAvailable: false,
      iteration: 1, maxIterations: 10,
    });
    const late = computeCompositeEntropy({
      token: null, structural: 0.8, semantic: null, behavioral: 0.8,
      contextPressure: 0.1, logprobsAvailable: false,
      iteration: 9, maxIterations: 10,
    });
    // Same raw scores but late iteration has higher weight → higher effective composite
    expect(late.iterationWeight).toBeGreaterThan(early.iterationWeight);
  });

  describe("short-run bypass (≤2 iterations)", () => {
    test("returns low composite 0.15 for iteration 1", () => {
      const result = computeCompositeEntropy({
        token: null, structural: 0.9, semantic: null, behavioral: 0.9,
        contextPressure: 0.5, logprobsAvailable: false,
        iteration: 1, maxIterations: 10,
      });
      expect(result.composite).toBe(0.15);
      expect(result.confidence).toBe("high");
    });

    test("returns low composite 0.15 for iteration 2", () => {
      const result = computeCompositeEntropy({
        token: null, structural: 0.9, semantic: null, behavioral: 0.9,
        contextPressure: 0.5, logprobsAvailable: false,
        iteration: 2, maxIterations: 10,
      });
      expect(result.composite).toBe(0.15);
      expect(result.confidence).toBe("high");
    });

    test("does NOT bypass at iteration 3 — normal scoring applies", () => {
      const result = computeCompositeEntropy({
        token: null, structural: 0.9, semantic: null, behavioral: 0.9,
        contextPressure: 0.5, logprobsAvailable: false,
        iteration: 3, maxIterations: 10,
      });
      expect(result.composite).toBeGreaterThan(0.15);
    });

    test("preserves source values in bypass path", () => {
      const result = computeCompositeEntropy({
        token: 0.5, structural: 0.8, semantic: 0.7, behavioral: 0.6,
        contextPressure: 0.4, logprobsAvailable: true,
        iteration: 1, maxIterations: 10,
      });
      expect(result.sources.structural).toBe(0.8);
      expect(result.sources.semantic).toBe(0.7);
      expect(result.sources.token).toBe(0.5);
    });
  });
});
