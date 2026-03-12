import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  ExecutionError,
  MaxIterationsError,
  GuardrailViolationError,
  BudgetExceededError,
  KillSwitchTriggeredError,
  BehavioralContractViolationError,
  HookError,
  errorContext,
  unwrapError,
  unwrapErrorWithSuggestion,
} from "../src/errors";

describe("Error context and suggestions", () => {
  test("MaxIterationsError has context with suggestion", () => {
    const err = new MaxIterationsError({ message: "limit", taskId: "task-1", iterations: 10, maxIterations: 10 });
    const ctx = errorContext(err);
    expect(ctx.suggestion).toContain("maxIterations");
    expect(ctx.suggestion).toContain("adaptive");
  });

  test("BudgetExceededError has context with budget details", () => {
    const err = new BudgetExceededError({ message: "over", taskId: "task-1", budgetType: "perRequest", limit: 1.0, current: 1.5 });
    const ctx = errorContext(err);
    expect(ctx.suggestion).toContain("withCostTracking");
    expect(ctx.suggestion).toContain("perRequest");
  });

  test("GuardrailViolationError has context with guardrail type", () => {
    const err = new GuardrailViolationError({ message: "blocked", taskId: "task-1", violation: "injection" });
    const ctx = errorContext(err);
    expect(ctx.suggestion).toContain("injection");
  });

  test("KillSwitchTriggeredError has context", () => {
    const err = new KillSwitchTriggeredError({ message: "stopped", taskId: "task-1", agentId: "agent-1", reason: "manual" });
    const ctx = errorContext(err);
    expect(ctx.suggestion).toContain("kill switch");
  });

  test("BehavioralContractViolationError has context", () => {
    const err = new BehavioralContractViolationError({ message: "denied", taskId: "task-1", rule: "tool-deny", violation: "file-write" });
    const ctx = errorContext(err);
    expect(ctx.suggestion).toContain("withBehavioralContracts");
  });

  test("HookError has context with phase", () => {
    const err = new HookError({ message: "failed", phase: "think", timing: "before", cause: new Error("boom") });
    const ctx = errorContext(err);
    expect(ctx.suggestion).toContain("withHook");
    expect(ctx.suggestion).toContain("think");
  });

  test("ExecutionError has context", () => {
    const err = new ExecutionError({ message: "failed", taskId: "task-1", phase: "think", cause: new Error("LLM timeout") });
    const ctx = errorContext(err);
    expect(ctx.suggestion).toBeDefined();
  });

  test("errorContext returns generic message for unknown errors", () => {
    const ctx = errorContext(new Error("something broke"));
    expect(ctx.suggestion).toContain("withObservability");
  });
});

describe("unwrapError facade", () => {
  test("unwrapError preserves known tagged error types", () => {
    const original = new MaxIterationsError({ message: "limit", taskId: "task-1", iterations: 10, maxIterations: 10 });
    const unwrapped = unwrapError(original);
    expect(unwrapped).toBeDefined();
    expect(errorContext((unwrapped as Record<string, unknown>)._originalTaggedError).suggestion).toContain("maxIterations");
  });

  test("unwrapError extracts clean message from real FiberFailure", async () => {
    const failEffect = Effect.fail(
      new MaxIterationsError({ message: "hit limit", taskId: "t1", iterations: 10, maxIterations: 10 }),
    );
    try {
      await Effect.runPromise(failEffect);
      expect(true).toBe(false);
    } catch (e) {
      const unwrapped = unwrapError(e);
      expect(unwrapped.message).not.toContain("FiberFailure");
    }
  });

  test("unwrapErrorWithSuggestion includes remediation for known errors", () => {
    const err = new BudgetExceededError({ message: "over", taskId: "task-1", budgetType: "perRequest", limit: 1.0, current: 1.5 });
    const unwrapped = unwrapErrorWithSuggestion(err);
    expect(unwrapped.message).toContain("withCostTracking");
  });
});
