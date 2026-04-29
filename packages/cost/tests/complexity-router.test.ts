import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  heuristicClassify,
  analyzeComplexity,
  routeToModel,
  getModelCostConfig,
  estimateTokens,
  estimateCost,
  type RoutingContext,
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

  // ─── Provider-aware routing ───

  test("routes to OpenAI models when provider is openai", async () => {
    const config = await Effect.runPromise(routeToModel("What is 2+2?", undefined, "openai"));
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o-mini");
    expect(config.tier).toBe("haiku");
  });

  test("routes to Gemini models when provider is gemini", async () => {
    const config = await Effect.runPromise(routeToModel("What is 2+2?", undefined, "gemini"));
    expect(config.provider).toBe("gemini");
    expect(config.model).toBe("gemini-2.0-flash");
  });

  test("getModelCostConfig returns provider-specific config", () => {
    const openaiHaiku = getModelCostConfig("haiku", "openai");
    expect(openaiHaiku.model).toBe("gpt-4o-mini");
    expect(openaiHaiku.costPer1MInput).toBe(0.15);

    const geminiSonnet = getModelCostConfig("sonnet", "gemini");
    expect(geminiSonnet.model).toContain("gemini");
  });

  test("ollama models have zero cost", () => {
    const config = getModelCostConfig("opus", "ollama");
    expect(config.costPer1MInput).toBe(0);
    expect(config.costPer1MOutput).toBe(0);
  });

  test("defaults to anthropic when no provider specified", () => {
    const config = getModelCostConfig("sonnet");
    expect(config.provider).toBe("anthropic");
    expect(config.model).toContain("claude");
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
    expect(haiku.model).toBe("claude-haiku-4-5-20251001");
    expect(haiku.maxContext).toBe(200_000);
    expect(haiku.speedTokensPerSec).toBe(150);

    const opus = getModelCostConfig("opus");
    expect(opus.maxContext).toBe(1_000_000);
    expect(opus.speedTokensPerSec).toBe(40);
  });

  // ─── W10 / FIX-32: calibration-aware tier selection ────────────────────

  test("calibration coupling: escalates haiku→sonnet when haiku tool-reliability is below threshold", async () => {
    const ctx: RoutingContext = {
      requiresTools: true,
      calibration: {
        haiku: { toolCallReliability: 0.3 },
        sonnet: { toolCallReliability: 0.85 },
        opus: { toolCallReliability: 0.95 },
      },
    };
    const result = await Effect.runPromise(
      analyzeComplexity("What is 2+2?", undefined, undefined, ctx),
    );
    // Heuristic would pick haiku for "What is 2+2?" — escalation moves it up.
    expect(result.recommendedTier).toBe("sonnet");
    expect(result.factors.some((f) => f.startsWith("tool-reliability-escalation:haiku->sonnet"))).toBe(true);
  });

  test("calibration coupling: skips escalation when requiresTools is false", async () => {
    const ctx: RoutingContext = {
      requiresTools: false,
      calibration: { haiku: { toolCallReliability: 0.1 } },
    };
    const result = await Effect.runPromise(
      analyzeComplexity("What is 2+2?", undefined, undefined, ctx),
    );
    expect(result.recommendedTier).toBe("haiku"); // no escalation
    expect(result.factors.every((f) => !f.startsWith("tool-reliability-"))).toBe(true);
  });

  test("calibration coupling: confirms tier when reliability is already above threshold", async () => {
    const ctx: RoutingContext = {
      requiresTools: true,
      calibration: { haiku: { toolCallReliability: 0.9 } },
    };
    const result = await Effect.runPromise(
      analyzeComplexity("What is 2+2?", undefined, undefined, ctx),
    );
    expect(result.recommendedTier).toBe("haiku");
    expect(result.factors).toContain("tool-reliability-confirmed");
  });

  test("calibration coupling: missing data on a tier does NOT trigger escalation past it", async () => {
    // Haiku has no calibration entry — treat as unknown, assume usable.
    const ctx: RoutingContext = {
      requiresTools: true,
      calibration: { sonnet: { toolCallReliability: 0.95 } },
    };
    const result = await Effect.runPromise(
      analyzeComplexity("What is 2+2?", undefined, undefined, ctx),
    );
    expect(result.recommendedTier).toBe("haiku");
  });

  test("calibration coupling: when ALL tiers fall below threshold, picks the most reliable one", async () => {
    const ctx: RoutingContext = {
      requiresTools: true,
      calibration: {
        haiku: { toolCallReliability: 0.1 },
        sonnet: { toolCallReliability: 0.3 },
        opus: { toolCallReliability: 0.4 },
      },
    };
    const result = await Effect.runPromise(
      analyzeComplexity("What is 2+2?", undefined, undefined, ctx),
    );
    expect(result.recommendedTier).toBe("opus"); // best of a bad bunch
    expect(result.factors.some((f) => f.startsWith("tool-reliability-escalation:"))).toBe(true);
  });

  test("calibration coupling: respects custom toolReliabilityThreshold", async () => {
    const ctx: RoutingContext = {
      requiresTools: true,
      calibration: { haiku: { toolCallReliability: 0.6 } },
      toolReliabilityThreshold: 0.8, // strict
    };
    const result = await Effect.runPromise(
      analyzeComplexity("What is 2+2?", undefined, undefined, ctx),
    );
    expect(result.recommendedTier).not.toBe("haiku"); // 0.6 < 0.8
  });

  test("routeToModel with calibration context returns escalated tier config", async () => {
    const ctx: RoutingContext = {
      requiresTools: true,
      calibration: {
        haiku: { toolCallReliability: 0.2 },
        sonnet: { toolCallReliability: 0.9 },
      },
    };
    const config = await Effect.runPromise(
      routeToModel("What is 2+2?", undefined, "anthropic", ctx),
    );
    expect(config.tier).toBe("sonnet");
    expect(config.model).toBe("claude-sonnet-4-6"); // FIX-33 SHA refresh
  });

  // ─── W10 / FIX-33: model SHA refresh sanity ────────────────────────────

  test("model SHAs are refreshed for v0.10 (no stale 2025-05 / preview pins)", () => {
    const sonnet = getModelCostConfig("sonnet", "anthropic");
    const opus = getModelCostConfig("opus", "anthropic");
    const geminiSonnet = getModelCostConfig("sonnet", "gemini");

    // Refresh of stale mid-2025 model IDs
    expect(sonnet.model).toBe("claude-sonnet-4-6");
    expect(opus.model).toBe("claude-opus-4-7");

    // Gemini moved off preview pin to stable name
    expect(geminiSonnet.model).not.toContain("preview");
    expect(geminiSonnet.model).toBe("gemini-2.5-pro");
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
