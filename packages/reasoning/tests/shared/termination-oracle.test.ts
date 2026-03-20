import { describe, test, expect } from "bun:test";
import {
  evaluateTermination,
  type TerminationContext,
  type TerminationSignalEvaluator,
} from "../../src/strategies/shared/termination-oracle.js";

// Helper to build minimal context with overrides
function makeCtx(overrides: Partial<TerminationContext> = {}): TerminationContext {
  return {
    thought: "The answer is 4.",
    stopReason: "end_turn",
    toolRequest: null,
    iteration: 1,
    steps: [],
    toolsUsed: new Set(),
    requiredTools: [],
    allToolSchemas: [],
    redirectCount: 0,
    priorFinalAnswerAttempts: 0,
    taskDescription: "What is 2+2?",
    ...overrides,
  };
}

// Stub evaluators for resolver logic testing
const exitHigh: TerminationSignalEvaluator = {
  name: "exit-high",
  evaluate: () => ({ action: "exit", confidence: "high", reason: "test", output: "done" }),
};
const exitMedium: TerminationSignalEvaluator = {
  name: "exit-medium",
  evaluate: () => ({ action: "exit", confidence: "medium", reason: "test", output: "done" }),
};
const continueHigh: TerminationSignalEvaluator = {
  name: "continue-high",
  evaluate: () => ({ action: "continue", confidence: "high", reason: "tool_pending" }),
};
const redirectMedium: TerminationSignalEvaluator = {
  name: "redirect-medium",
  evaluate: () => ({ action: "redirect", confidence: "medium", reason: "gap" }),
};
const noop: TerminationSignalEvaluator = {
  name: "noop",
  evaluate: () => null,
};

describe("evaluateTermination resolver", () => {
  test("high-confidence exit short-circuits", () => {
    const result = evaluateTermination(makeCtx(), [noop, exitHigh, exitMedium]);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("exit-high");
    expect(result.allVerdicts).toHaveLength(1); // short-circuited, noop returned null
  });

  test("high-confidence continue short-circuits", () => {
    const result = evaluateTermination(makeCtx(), [continueHigh, exitMedium]);
    expect(result.shouldExit).toBe(false);
    expect(result.evaluator).toBe("continue-high");
  });

  test("medium exit beats medium redirect", () => {
    const result = evaluateTermination(makeCtx(), [redirectMedium, exitMedium]);
    expect(result.shouldExit).toBe(true);
    expect(result.evaluator).toBe("exit-medium");
  });

  test("all null evaluators → no_exit_signal", () => {
    const result = evaluateTermination(makeCtx(), [noop, noop]);
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toBe("no_exit_signal");
  });

  test("empty evaluator list → no_exit_signal", () => {
    const result = evaluateTermination(makeCtx(), []);
    expect(result.shouldExit).toBe(false);
  });

  test("allVerdicts captures all non-null verdicts", () => {
    const result = evaluateTermination(makeCtx(), [noop, exitMedium, redirectMedium]);
    expect(result.allVerdicts).toHaveLength(2);
  });
});
