import { describe, test, expect } from "bun:test";
import { computeStructuralEntropy } from "../../src/sensor/structural-entropy.js";

describe("structural entropy (1B)", () => {
  test("well-formed ReAct thought scores high", () => {
    const thought = "Thought: I need to search for the capital of France.\nAction: web-search({\"query\": \"capital of France\"})";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.formatCompliance).toBeGreaterThan(0.7);
    expect(result.orderIntegrity).toBe(1.0);
    expect(result.jsonParseScore).toBe(1.0);
  });

  test("hedging phrases reduce hedgeScore", () => {
    const thought = "I think maybe the answer is possibly Paris, but I'm not sure";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.hedgeScore).toBeLessThan(0.8);
  });

  test("no hedging gives hedgeScore 1.0", () => {
    const thought = "The capital of France is Paris. This is a well-established fact.";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.hedgeScore).toBe(1.0);
  });

  test("repetitive text has low thoughtDensity", () => {
    const thought = "search search search search search search search search search search";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.thoughtDensity).toBeLessThan(0.3);
  });

  test("diverse vocabulary gives high vocabularyDiversity", () => {
    const thought = "The capital city of France is Paris, located along the Seine river in northern Europe";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.vocabularyDiversity).toBeGreaterThan(0.7);
  });

  test("malformed JSON gets partial jsonParseScore", () => {
    const thought = 'Action: web-search({"query": "test"';  // missing closing brace
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.jsonParseScore).toBe(0.5);
  });

  test("no JSON gives jsonParseScore 1.0 (not a tool call)", () => {
    const thought = "Thought: I should analyze the data more carefully.";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.jsonParseScore).toBe(1.0);
  });

  test("wrong order (Action before Thought) reduces orderIntegrity", () => {
    const thought = "Action: web-search({\"query\": \"test\"})\nThought: I should search first";
    const result = computeStructuralEntropy(thought, "reactive");
    expect(result.orderIntegrity).toBeLessThan(1.0);
  });
});
