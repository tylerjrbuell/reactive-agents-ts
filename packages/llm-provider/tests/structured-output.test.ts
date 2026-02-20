import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import {
  ReActActionSchema,
  PlanSchema,
  ReflectionSchema,
  StrategySelectionSchema,
  makeCacheable,
  ModelPresets,
} from "../src/index.js";

describe("Structured Output Schemas", () => {
  it("should decode a valid ReAct action", () => {
    const raw = {
      thought: "I need to search for information.",
      action: { tool: "web-search", input: { query: "Effect-TS" } },
      isComplete: false,
    };

    const result = Schema.decodeUnknownSync(ReActActionSchema)(raw);
    expect(result.thought).toBe("I need to search for information.");
    expect(result.isComplete).toBe(false);
    expect(result.action?.tool).toBe("web-search");
  });

  it("should decode a complete ReAct action (no tool)", () => {
    const raw = {
      thought: "I have the answer.",
      finalAnswer: "The answer is 42.",
      isComplete: true,
    };

    const result = Schema.decodeUnknownSync(ReActActionSchema)(raw);
    expect(result.isComplete).toBe(true);
    expect(result.finalAnswer).toBe("The answer is 42.");
  });

  it("should decode a plan", () => {
    const raw = {
      goal: "Research quantum computing",
      steps: [
        { id: 1, description: "Search for papers", tool: "web-search" },
        { id: 2, description: "Summarize findings", dependsOn: [1] },
      ],
    };

    const result = Schema.decodeUnknownSync(PlanSchema)(raw);
    expect(result.steps.length).toBe(2);
    expect(result.steps[1]!.dependsOn).toEqual([1]);
  });

  it("should decode a reflection", () => {
    const raw = {
      taskAccomplished: true,
      confidence: 0.85,
      strengths: ["Clear reasoning"],
      weaknesses: ["Could use more sources"],
      needsRefinement: false,
    };

    const result = Schema.decodeUnknownSync(ReflectionSchema)(raw);
    expect(result.confidence).toBe(0.85);
    expect(result.taskAccomplished).toBe(true);
  });
});

describe("makeCacheable", () => {
  it("should create a cacheable content block", () => {
    const block = makeCacheable("Static context for the agent.");
    expect(block.type).toBe("text");
    expect(block.text).toBe("Static context for the agent.");
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("ModelPresets", () => {
  it("should have all expected presets", () => {
    expect(ModelPresets["claude-haiku"]).toBeDefined();
    expect(ModelPresets["claude-sonnet"]).toBeDefined();
    expect(ModelPresets["claude-opus"]).toBeDefined();
    expect(ModelPresets["gpt-4o"]).toBeDefined();
    expect(ModelPresets["gpt-4o-mini"]).toBeDefined();
  });

  it("should have correct cost structure", () => {
    const sonnet = ModelPresets["claude-sonnet"];
    expect(sonnet.costPer1MInput).toBe(3.0);
    expect(sonnet.costPer1MOutput).toBe(15.0);
    expect(sonnet.maxContext).toBe(200_000);
  });
});
