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

  // Task review fix (2026-08-14) — see pause-goal-achieved.test.ts for the
  // full end-to-end regression via agent.run(). This pins the same fix at
  // the deriveTaskOutcome level: a paused run (no terminatedBy yet) with a
  // declared-but-not-yet-produced deliverable must resolve to `null`
  // (ambiguous), not `false` ("goal not achieved") — a paused run is
  // unfinished, not failed.
  it("ctx.isPausedRun forces deliverables undefined, so goalAchieved falls back to the terminatedBy heuristic (null) instead of reading an unproduced deliverable as a definitive false", () => {
    const taskResult = {
      // No terminatedBy yet — the run is still paused, not terminal.
      success: true,
      output: "",
      metadata: { reasoningSteps: [] },
    } as unknown as TaskResult;
    // A file-path deliverable literal in the task text (deriveDeliverablePaths,
    // reasoning/src/kernel/capabilities/verify/derive-conditions.ts) compiles
    // into a RunContract deliverable that the artifact scan can mark
    // produced/missing — unlike a bare requiredTools declaration, which only
    // feeds the RunContract's `requirements` list, not its `deliverables[]`.
    const ctx = {
      task: "Write the results to ./report.md",
      now: 1_700_000_000_000,
    };

    // WITHOUT isPausedRun: ./report.md was declared but the output/steps show
    // no evidence it was produced (the write tool never ran — gated), so
    // resolveGoalAchieved reads it as a definitive false — this is the
    // regression this test guards against.
    const withoutFlag = deriveTaskOutcome(taskResult, ctx);
    expect(withoutFlag.deliverables).toBeDefined();
    expect(withoutFlag.goalAchieved).toBe(false);

    // WITH isPausedRun: deliverables is suppressed entirely, so goalAchieved
    // falls back to deriveGoalAchieved(undefined) === null.
    const withFlag = deriveTaskOutcome(taskResult, { ...ctx, isPausedRun: true });
    expect(withFlag.deliverables).toBeUndefined();
    expect(withFlag.goalAchieved).toBeNull();
  });
});
