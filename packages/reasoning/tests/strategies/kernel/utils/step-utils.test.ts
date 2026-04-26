import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeStep, buildStrategyResult } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { publishReasoningStep } from "../../../../src/strategies/kernel/utils/service-utils.js";

describe("makeStep", () => {
  it("creates step with correct type and content", () => {
    const step = makeStep("thought", "I should search for this");
    expect(step.type).toBe("thought");
    expect(step.content).toBe("I should search for this");
  });

  it("generates a valid non-empty id", () => {
    const step = makeStep("observation", "result here");
    expect(step.id).toBeTruthy();
    expect(typeof step.id).toBe("string");
  });

  it("sets timestamp to roughly now", () => {
    const before = Date.now();
    const step = makeStep("action", "ACTION: file-write(...)");
    const after = Date.now();
    expect(step.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(step.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it("includes metadata when provided", () => {
    const step = makeStep("action", "ACTION: file-write(...)", { toolUsed: "file-write" });
    expect(step.metadata?.toolUsed).toBe("file-write");
  });
});

describe("buildStrategyResult", () => {
  it("builds a valid ReasoningResult with completed status", () => {
    const result = buildStrategyResult({
      strategy: "reflexion",
      steps: [],
      output: "The answer",
      status: "completed",
      start: Date.now() - 1000,
      totalTokens: 500,
      totalCost: 0.001,
    });
    expect(result.strategy).toBe("reflexion");
    expect(result.status).toBe("completed");
    expect(result.metadata.tokensUsed).toBe(500);
    expect(result.metadata.cost).toBeCloseTo(0.001);
    expect(result.metadata.confidence).toBe(0.8);
    expect(result.metadata.duration).toBeGreaterThan(0);
  });

  it("uses 0.4 confidence for partial status", () => {
    const result = buildStrategyResult({
      strategy: "reflexion",
      steps: [],
      output: null,
      status: "partial",
      start: Date.now(),
      totalTokens: 100,
      totalCost: 0,
    });
    expect(result.metadata.confidence).toBe(0.4);
  });

  it("merges extraMetadata into result metadata", () => {
    const result = buildStrategyResult({
      strategy: "adaptive",
      steps: [],
      output: "done",
      status: "completed",
      start: Date.now(),
      totalTokens: 200,
      totalCost: 0,
      extraMetadata: { selectedStrategy: "reflexion", fallbackOccurred: false },
    });
    expect((result.metadata as any).selectedStrategy).toBe("reflexion");
    expect((result.metadata as any).fallbackOccurred).toBe(false);
  });

  it("sets stepsCount from steps array length", () => {
    const steps = [makeStep("thought", "a"), makeStep("observation", "b")];
    const result = buildStrategyResult({
      strategy: "reactive",
      steps,
      output: "x",
      status: "completed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    });
    expect(result.metadata.stepsCount).toBe(2);
  });

  it("sanitizes string output to strip internal metadata", () => {
    const result = buildStrategyResult({
      strategy: "plan-execute-reflect",
      steps: [],
      output: "FINAL ANSWER: Here is the clean answer",
      status: "completed",
      start: Date.now(),
      totalTokens: 100,
      totalCost: 0,
    });
    expect(result.output).toBe("Here is the clean answer");
    expect(result.output).not.toContain("FINAL ANSWER");
  });

  it("sanitizes tool call echoes from output", () => {
    const result = buildStrategyResult({
      strategy: "reactive",
      steps: [],
      output: 'signal/send_message_to_user: {"recipient": "+1234", "message": "hi"}\nMessage delivered.',
      status: "completed",
      start: Date.now(),
      totalTokens: 100,
      totalCost: 0,
    });
    expect(result.output).not.toContain("signal/send_message_to_user");
    expect(result.output).not.toContain("recipient");
    expect(result.output).toContain("Message delivered.");
  });

  it("does not sanitize non-string output", () => {
    const obj = { data: [1, 2, 3] };
    const result = buildStrategyResult({
      strategy: "reactive",
      steps: [],
      output: obj,
      status: "completed",
      start: Date.now(),
      totalTokens: 100,
      totalCost: 0,
    });
    expect(result.output).toEqual(obj);
  });
});

describe("publishReasoningStep", () => {
  it("completes without error when eventBus is None", async () => {
    const noneEventBus = { _tag: "None" as const };
    await Effect.runPromise(
      publishReasoningStep(noneEventBus as any, {
        _tag: "ReasoningStepCompleted",
        taskId: "test",
        strategy: "reactive",
        step: 1,
        totalSteps: 5,
        thought: "test thought",
      } as any),
    );
    // Should complete without throwing
  });
});
