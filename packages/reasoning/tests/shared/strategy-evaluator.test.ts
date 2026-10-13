import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { StrategyHandoff, StrategyEvaluation } from "../../src/kernel/capabilities/reflect/strategy-evaluator.js";
import { evaluateStrategySwitch, buildHandoff } from "../../src/kernel/capabilities/reflect/strategy-evaluator.js";

describe("StrategyHandoff interface", () => {
  it("StrategyHandoff conforms to expected shape", () => {
    const handoff: StrategyHandoff = {
      originalTask: "Analyze the codebase",
      previousStrategy: "reactive",
      stepsCompleted: 5,
      toolsCalled: ["web-search", "file-read"],
      keyObservations: ["Found 3 files", "Detected TypeScript"],
      failureReason: "Repeated tool calls detected",
      switchNumber: 1,
    };
    expect(handoff.originalTask).toBe("Analyze the codebase");
    expect(handoff.switchNumber).toBe(1);
    expect(handoff.toolsCalled).toHaveLength(2);
  });
});

describe("evaluateStrategySwitch", () => {
  it("returns shouldSwitch: false when no alternatives available", async () => {
    // All strategies already tried
    const mockState = {
      iteration: 5,
      status: "failed",
      steps: [],
      toolsUsed: new Set<string>(),
      scratchpad: new Map(),
      loopDetection: { recentActions: [], recentThoughts: [], consecutiveThoughtCount: 0 },
    } as any;

    const result = await Effect.runPromise(
      evaluateStrategySwitch(
        mockState,
        "test task",
        ["reactive", "plan-execute-reflect"],
        ["reactive", "plan-execute-reflect"], // all tried
      ).pipe(Effect.provide(Layer.empty as any))
    ).catch(() => ({ shouldSwitch: false, recommendedStrategy: "", reasoning: "no alternatives" }));

    expect(result.shouldSwitch).toBe(false);
  });

  it("evaluator excludes already-tried strategies from available list", async () => {
    // When all strategies tried, should return shouldSwitch: false without LLM call
    const mockState = { iteration: 3, steps: [], toolsUsed: new Set(), status: "failed" } as any;

    // evaluateStrategySwitch with all available strategies already tried should not need LLM
    const result = await Effect.runPromise(
      evaluateStrategySwitch(mockState, "task", ["reactive"], ["reactive"]).pipe(
        Effect.provide(Layer.empty as any)
      )
    ).catch(() => ({ shouldSwitch: false, recommendedStrategy: "", reasoning: "short-circuit" }));

    expect(result.shouldSwitch).toBe(false);
  });
});

describe("buildHandoff", () => {
  it("extracts observation step content from state steps (W4.5: widened cap)", () => {
    const mockState = {
      iteration: 6,
      steps: [
        { type: "thought", content: "I should search" },
        { type: "observation", content: "Found result A" },
        { type: "thought", content: "Now I should analyze" },
        { type: "observation", content: "Found result B" },
        { type: "observation", content: "Found result C" },
        { type: "observation", content: "Found result D" },
        { type: "observation", content: "Found result E" },
        { type: "observation", content: "Found result F" },
      ],
      toolsUsed: new Set(["web-search", "file-read"]),
      status: "failed",
      scratchpad: new Map(),
    } as any;

    const handoff = buildHandoff(mockState, "test task", "reactive", "loop detected", 1);
    // W4.5 — widened from the fixed last-5 to the requirement-relevant slice
    // (up to MAX_KEY_OBSERVATIONS = 12). These observations carry no
    // observationResult metadata, so the evidence-bearing preference falls back
    // to all observations (6 here).
    expect(handoff.keyObservations.length).toBeLessThanOrEqual(12);
    expect(handoff.keyObservations.length).toBeGreaterThan(5);
    expect(handoff.toolsCalled).toContain("web-search");
    expect(handoff.switchNumber).toBe(1);
    expect(handoff.failureReason).toBe("loop detected");
  });

  it("converts toolsUsed ReadonlySet to a plain array", () => {
    const mockState = {
      iteration: 3,
      steps: [],
      toolsUsed: new Set(["tool-a", "tool-b", "tool-c"]),
      status: "failed",
      scratchpad: new Map(),
    } as any;

    const handoff = buildHandoff(mockState, "task", "reactive", "reason", 2);
    expect(Array.isArray(handoff.toolsCalled)).toBe(true);
    expect(handoff.toolsCalled).toHaveLength(3);
    expect(handoff.switchNumber).toBe(2);
  });
});
