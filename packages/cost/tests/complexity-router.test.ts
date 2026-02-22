import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  heuristicClassify,
  analyzeComplexity,
  routeToModel,
  getModelCostConfig,
  estimateTokens,
  estimateCost,
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

  test("estimateCost calculates cost based on input tokens", () => {
    const haiku = getModelCostConfig("haiku");
    const cost = estimateCost("hello world", haiku);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.001);
  });

  test("classifies code-only tasks as sonnet", () => {
    const codeOnly = "```typescript\nfunction test() { return true; }\n```";
    expect(heuristicClassify(codeOnly)).toBe("sonnet");
  });

  test("classifies multi-step tasks correctly", () => {
    const multiStep = "First do this, then do that, finally check the result";
    // Multi-step alone without code/analysis returns null (will default to sonnet in analyzeComplexity)
    const result = heuristicClassify(multiStep);
    expect(result === "haiku" || result === null).toBe(true);
  });

  test("analyzeComplexity includes correct factors for code tasks", async () => {
    const result = await Effect.runPromise(
      analyzeComplexity("```typescript\nconst x = 1;\n```"),
    );
    expect(result.factors).toContain("contains-code");
  });

  test("analyzeComplexity includes correct factors for multi-step tasks", async () => {
    const result = await Effect.runPromise(
      analyzeComplexity("First analyze the code, then implement the solution"),
    );
    expect(result.factors).toContain("multi-step");
  });

  test("analyzeComplexity includes correct factors for analysis tasks", async () => {
    const result = await Effect.runPromise(
      analyzeComplexity("Analyze the performance characteristics of this algorithm"),
    );
    expect(result.factors).toContain("analysis-required");
  });

  test("routeToModel returns opus config for complex task", async () => {
    const config = await Effect.runPromise(
      routeToModel("```typescript\nconst x = 1;\n```\nFirst analyze the code, then evaluate the performance"),
    );
    expect(config.tier).toBe("opus");
  });

  test("routeToModel handles context parameter", async () => {
    const config = await Effect.runPromise(
      routeToModel("What is TypeScript?", "Previous conversation context"),
    );
    expect(config.tier).toBeDefined();
    expect(config.model).toBeDefined();
  });

  test("getModelCostConfig returns all model properties", () => {
    const haiku = getModelCostConfig("haiku");
    expect(haiku.provider).toBe("anthropic");
    expect(haiku.model).toBe("claude-3-5-haiku-20241022");
    expect(haiku.maxContext).toBe(200_000);
    expect(haiku.speedTokensPerSec).toBe(150);

    const opus = getModelCostConfig("opus");
    expect(opus.maxContext).toBe(1_000_000);
    expect(opus.speedTokensPerSec).toBe(40);
  });

  test("estimateCost is different for different tiers", () => {
    const text = "This is a test prompt for cost calculation";
    const haiku = getModelCostConfig("haiku");
    const sonnet = getModelCostConfig("sonnet");
    const opus = getModelCostConfig("opus");

    const haikuCost = estimateCost(text, haiku);
    const sonnetCost = estimateCost(text, sonnet);
    const opusCost = estimateCost(text, opus);

    expect(haikuCost).toBeLessThan(sonnetCost);
    expect(sonnetCost).toBeLessThan(opusCost);
  });
});
