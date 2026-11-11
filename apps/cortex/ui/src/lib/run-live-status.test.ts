import { describe, expect, test } from "bun:test";
import { runStatusAfter } from "./run-live-status.js";

describe("runStatusAfter (B3: stopped runs leave the live list)", () => {
  test("ExecutionCancelled ends a live run as stopped", () => {
    expect(runStatusAfter("live", "ExecutionCancelled", { taskId: "r" })).toBe("stopped");
  });

  test("a failure reported after a stop keeps it stopped; a success still completes it", () => {
    expect(runStatusAfter("stopped", "TaskFailed", {})).toBeUndefined();
    expect(runStatusAfter("stopped", "AgentCompleted", { success: false })).toBeUndefined();
    expect(runStatusAfter("stopped", "AgentCompleted", { success: true })).toBe("completed");
  });

  test("completion and failure behave as before", () => {
    expect(runStatusAfter("live", "AgentCompleted", { success: true })).toBe("completed");
    expect(runStatusAfter("live", "AgentCompleted", { success: false })).toBe("failed");
    expect(runStatusAfter("live", "TaskFailed", {})).toBe("failed");
    expect(runStatusAfter("completed", "AgentCompleted", {})).toBeUndefined();
    expect(runStatusAfter("live", "ReasoningStepCompleted", {})).toBeUndefined();
  });
});
