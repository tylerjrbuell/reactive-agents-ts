import { describe, expect, test } from "bun:test";
import { runStatusAfter } from "./run-live-status.js";

describe("runStatusAfter (B3: stopped runs leave the live list)", () => {
  test("ExecutionCancelled ends a live run as stopped", () => {
    expect(runStatusAfter("live", "ExecutionCancelled", { taskId: "r" })).toBe("stopped");
  });

  test("the desk Stop (AgentStopped) and Terminate (AgentTerminated) stop the run", () => {
    expect(runStatusAfter("live", "AgentStopped", { reason: "stop() requested" })).toBe("stopped");
    expect(runStatusAfter("live", "AgentTerminated", {})).toBe("stopped");
  });

  test("a failure reported after a stop keeps it stopped; a success still completes it", () => {
    expect(runStatusAfter("stopped", "TaskFailed", {})).toBeUndefined();
    expect(runStatusAfter("stopped", "AgentCompleted", { success: false })).toBeUndefined();
    expect(runStatusAfter("stopped", "AgentCompleted", { success: true })).toBe("completed");
  });

  // Live repro (2026-11-11): an output guardrail block ended the run with AgentAborted only; it read Running forever.
  test("AgentAborted settles the run: failed, or stopped for a user stop / terminate", () => {
    expect(runStatusAfter("live", "AgentAborted", { causeClass: "failure" })).toBe("failed");
    expect(runStatusAfter("live", "AgentAborted", { causeClass: "interrupt", reason: "user-stop" })).toBe("stopped");
    expect(runStatusAfter("live", "AgentAborted", { causeClass: "interrupt", reason: "terminate" })).toBe("stopped");
    expect(runStatusAfter("stopped", "AgentAborted", { causeClass: "failure" })).toBeUndefined();
  });

  test("a guardrail AgentAborted is blocked, and a failure after it keeps it blocked", () => {
    expect(runStatusAfter("live", "AgentAborted", { causeClass: "failure", reason: "guardrail" })).toBe("blocked");
    expect(runStatusAfter("blocked", "AgentCompleted", { success: false })).toBeUndefined();
    expect(runStatusAfter("blocked", "TaskFailed", {})).toBeUndefined();
  });

  test("completion and failure behave as before", () => {
    expect(runStatusAfter("live", "AgentCompleted", { success: true })).toBe("completed");
    expect(runStatusAfter("live", "AgentCompleted", { success: false })).toBe("failed");
    expect(runStatusAfter("live", "TaskFailed", {})).toBe("failed");
    expect(runStatusAfter("completed", "AgentCompleted", {})).toBeUndefined();
    expect(runStatusAfter("live", "ReasoningStepCompleted", {})).toBeUndefined();
  });
});
