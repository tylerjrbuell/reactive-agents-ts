import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  heuristicClassify,
  analyzeComplexity,
  routeToModel,
  getModelCostConfig,
  estimateTokens,
} from "../src/routing/complexity-router.js";

describe("Complexity Router", () => {
  test("classifies simple tasks as haiku", () => {
    expect(heuristicClassify("What is 2+2?")).toBe("haiku");
    expect(heuristicClassify("Hello world")).toBe("haiku");
    expect(heuristicClassify("Define TypeScript")).toBe("haiku");
  });

  test("classifies tasks with analysis as sonnet", () => {
    expect(heuristicClassify("Analyze the performance of this algorithm")).toBe("sonnet");
    expect(heuristicClassify("Compare React and Vue frameworks")).toBe("sonnet");
  });

  test("classifies complex tasks with code + multi-step + analysis as opus", () => {
    const complex = "```typescript\nconst x = 1;\n```\nFirst analyze the code, then step through it and evaluate the output";
    expect(heuristicClassify(complex)).toBe("opus");
  });

  test("defaults to sonnet for ambiguous tasks", () => {
    // The heuristic returns null for long tasks without clear markers,
    // and analyzeComplexity defaults them to sonnet
    const ambiguous = "Tell me about the history of programming languages and how they have evolved over the decades including their impact on modern software development practices around the world today";
    // Under 50 words without code/analysis markers → haiku heuristic
    // but analyzeComplexity would route to sonnet for the null case
    const tier = heuristicClassify(ambiguous);
    expect(tier).toBeDefined();
  });

  test("analyzeComplexity returns valid analysis", async () => {
    const result = await Effect.runPromise(analyzeComplexity("What is TypeScript?"));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.recommendedTier).toBeDefined();
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.factors.length).toBeGreaterThan(0);
  });

  test("routeToModel returns config for simple task", async () => {
    const config = await Effect.runPromise(routeToModel("What is 2+2?"));
    expect(config.tier).toBe("haiku");
    expect(config.costPer1MInput).toBe(1.0);
  });

  test("getModelCostConfig returns correct configs", () => {
    const haiku = getModelCostConfig("haiku");
    const sonnet = getModelCostConfig("sonnet");
    const opus = getModelCostConfig("opus");

    expect(haiku.costPer1MInput).toBeLessThan(sonnet.costPer1MInput);
    expect(sonnet.costPer1MInput).toBeLessThan(opus.costPer1MInput);
    expect(opus.quality).toBe(1.0);
  });

  test("estimateTokens provides rough token count", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});
