// Run: bun test packages/runtime/tests/derive-outcome.test.ts
//
// FM-4 part 1 — deriveTaskOutcome is the single shared computation reactive-
// agent.ts's run() and execute-stream.ts's runStream() both call to derive
// deliverables/goalAchieved/receipt from a completed TaskResult. This pins
// it as a pure function: same TaskResult + ctx in, byte-identical
// TaskOutcome out (no Date.now() reads unless `now` is omitted from ctx).
import { describe, it, expect } from "bun:test";
import { deriveTaskOutcome } from "../src/engine/finalize/derive-outcome.js";
import type { TaskResult } from "@reactive-agents/core";

describe("deriveTaskOutcome", () => {
  it("is a pure function of TaskResult + ctx — same input, same output", () => {
    const taskResult = {
      terminatedBy: "final_answer",
      success: true,
      output: "4",
      metadata: { reasoningSteps: [], runLedger: undefined, cacheHit: false, verifierVerdict: "pass" },
    } as unknown as TaskResult;
    const ctx = { task: "What is 2 + 2?", now: 1_700_000_000_000 };

    const a = deriveTaskOutcome(taskResult, ctx);
    const b = deriveTaskOutcome(taskResult, ctx);
    expect(a).toEqual(b);
  });

  it("computes a tool-grounded receipt from a final-answer TaskResult with no tool calls (ungrounded, per the receipt's own rule)", () => {
    const taskResult = {
      terminatedBy: "final_answer",
      success: true,
      output: "4",
      metadata: { reasoningSteps: [], cacheHit: false },
    } as unknown as TaskResult;

    const outcome = deriveTaskOutcome(taskResult, { task: "What is 2 + 2?", now: 1_700_000_000_000 });

    expect(outcome.goalAchieved).toBe(true);
    expect(outcome.receipt.verdict).toBe("ungrounded");
    expect(outcome.receipt.computedAt).toBe(1_700_000_000_000);
  });
});
