import { describe, expect, it } from "bun:test";
import { deriveStatus, isRunSettled, runStatusOfSummary, type CortexLiveMsg } from "./run-store.js";

const msg = (type: string, payload: Record<string, unknown> = {}): CortexLiveMsg => ({ ts: 1, agentId: "a", runId: "r", type, payload });

describe("run view status (B3)", () => {
  it("a stopped run row reads stopped, not completed", () => {
    expect(runStatusOfSummary("stopped")).toBe("stopped");
    expect(runStatusOfSummary("live")).toBe("live");
    expect(runStatusOfSummary("completed")).toBe("completed");
    expect(runStatusOfSummary("failed")).toBe("failed");
  });

  it("ExecutionCancelled, the desk Stop (AgentStopped) and Terminate (AgentTerminated) stop a live run", () => {
    expect(deriveStatus("live", msg("ExecutionCancelled"))).toBe("stopped");
    expect(deriveStatus("live", msg("AgentStopped", { reason: "stop() requested" }))).toBe("stopped");
    expect(deriveStatus("live", msg("AgentTerminated"))).toBe("stopped");
  });

  it("a stopped run that then reports a failure or a debrief stays stopped", () => {
    expect(deriveStatus("stopped", msg("TaskFailed"))).toBe("stopped");
    expect(deriveStatus("stopped", msg("AgentCompleted", { success: false }))).toBe("stopped");
    expect(deriveStatus("stopped", msg("DebriefCompleted"))).toBe("stopped");
    expect(deriveStatus("stopped", msg("AgentResumed"))).toBe("stopped");
  });

  it("keeps the existing transitions", () => {
    expect(deriveStatus("live", msg("AgentCompleted", { success: false }))).toBe("failed");
    expect(deriveStatus("live", msg("AgentCompleted", {}))).toBe("completed");
    expect(deriveStatus("failed", msg("DebriefCompleted"))).toBe("failed");
    expect(deriveStatus("loading", msg("ReasoningIterationProgress"))).toBe("live");
  });

  it("stopped is settled", () => {
    expect(isRunSettled("stopped")).toBe(true);
    expect(isRunSettled("paused")).toBe(false);
  });
});
