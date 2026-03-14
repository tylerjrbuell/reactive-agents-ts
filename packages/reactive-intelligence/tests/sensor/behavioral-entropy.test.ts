import { describe, test, expect } from "bun:test";
import { computeBehavioralEntropy } from "../../src/sensor/behavioral-entropy.js";

describe("behavioral entropy (1D)", () => {
  test("perfect tool success rate", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", metadata: { toolUsed: "web-search", success: true } },
        { type: "observation", metadata: { success: true } },
        { type: "action", metadata: { toolUsed: "file-read", success: true } },
        { type: "observation", metadata: { success: true } },
      ],
      iteration: 2,
    });
    expect(result.toolSuccessRate).toBe(1.0);
  });

  test("action diversity detects stuck patterns", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", metadata: { toolUsed: "web-search" } },
        { type: "action", metadata: { toolUsed: "web-search" } },
        { type: "action", metadata: { toolUsed: "web-search" } },
      ],
      iteration: 3,
    });
    expect(result.actionDiversity).toBeCloseTo(1 / 3, 1); // 1 unique / 3 iterations
  });

  test("action diversity clamped to 1.0", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", metadata: { toolUsed: "a" } },
        { type: "action", metadata: { toolUsed: "b" } },
        { type: "action", metadata: { toolUsed: "c" } },
      ],
      iteration: 2, // 3 unique tools in 2 iterations
    });
    expect(result.actionDiversity).toBe(1.0);
  });

  test("loop detection from repeated identical actions", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "action", content: "web-search({\"q\":\"test\"})", metadata: { toolUsed: "web-search" } },
        { type: "action", content: "web-search({\"q\":\"test\"})", metadata: { toolUsed: "web-search" } },
        { type: "action", content: "web-search({\"q\":\"test\"})", metadata: { toolUsed: "web-search" } },
      ],
      iteration: 3,
    });
    expect(result.loopDetectionScore).toBeGreaterThan(0.5);
  });

  test("completion approach detects final answer markers", () => {
    const result = computeBehavioralEntropy({
      steps: [
        { type: "thought", content: "Therefore, the answer is Paris." },
      ],
      iteration: 5,
      maxIterations: 10,
    });
    expect(result.completionApproach).toBeGreaterThan(0.3);
  });

  test("empty steps returns baseline values", () => {
    const result = computeBehavioralEntropy({ steps: [], iteration: 1 });
    expect(result.toolSuccessRate).toBe(1.0); // no failures
    expect(result.actionDiversity).toBe(0);
    expect(result.loopDetectionScore).toBe(0);
    expect(result.completionApproach).toBe(0);
  });
});
