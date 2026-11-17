import { describe, expect, it } from "bun:test";
import { runStatusChip, stopFacts, stopHeadline, stopKindChip, type DurableRunStatus, type RunStopKind, type StopWire } from "./run-stop.js";

const stop = (over: Partial<StopWire> = {}): StopWire => ({
  reason: "loop_detected:repeat",
  repeatedTool: "web-search",
  toolsDone: [{ tool: "web-search", calls: 3 }, { tool: "file-read", calls: 1 }],
  unfinished: ["write report", "send summary"],
  iteration: 7,
  ...over,
});

const KINDS: readonly RunStopKind[] = ["user-paused", "user-stopped", "error", "crash", "loop", "budget", "timeout"];

describe("stop kind chips", () => {
  it("label every kind from the stop's kind, never from its reason text", () => {
    expect(stopKindChip("user-paused").label).toBe("Paused by you");
    expect(stopKindChip("user-stopped").label).toBe("Stopped by you");
    expect(stopKindChip("loop").label).toBe("Stopped by a loop guard");
    expect(stopKindChip("budget").label).toBe("Ran out of budget");
    expect(stopKindChip("timeout").label).toBe("Timed out");
    expect(stopKindChip("error")).toEqual({ label: "Stopped by an error", tone: "failed" });
    expect(new Set(KINDS.map((k) => stopKindChip(k).label)).size).toBe(KINDS.length);
  });

});

describe("run status chips", () => {
  it("say the state for running, paused, stopped, failed and both waits", () => {
    const labels: Record<DurableRunStatus, string> = {
      running: "Running",
      paused: "Paused",
      stopped: "Stopped",
      failed: "Failed",
      completed: "Completed",
      "awaiting-approval": "Waiting for approval",
      "awaiting-interaction": "Waiting for your answer",
    };
    for (const [status, label] of Object.entries(labels)) expect(runStatusChip(status as DurableRunStatus).label).toBe(label);
    expect(runStatusChip("running").tone).toBe("running");
    expect(runStatusChip("failed").tone).toBe("failed");
  });
});

describe("stop headline", () => {
  it("says what the loop guard saw in plain words", () => {
    expect(stopHeadline("loop", { reason: "loop_detected:repeat" })).toContain("repeating the same step");
    expect(stopHeadline("loop", { reason: "loop_graceful" })).toContain("going in circles");
    expect(stopHeadline("loop", { reason: "dispatcher-early-stop" })).toContain("not making progress");
    expect(stopHeadline("loop", { reason: "weird" })).toBe("The run was stopped (weird).");
  });

  it("words the other kinds without blaming the agent for a person's stop", () => {
    expect(stopHeadline("user-stopped")).toContain("You stopped this run");
    expect(stopHeadline("user-paused")).toContain("You paused this run");
    expect(stopHeadline("budget")).toBe("The run reached a limit before it finished.");
    expect(stopHeadline("budget", { reason: "max_iterations" })).toBe("The run reached its iteration limit before it finished. Continue gives it more.");
    expect(stopHeadline("budget", { reason: "Reached max iterations (10)" })).toContain("iteration limit");
    expect(stopHeadline("budget", { reason: "cost_limit" })).toContain("spending (or token) limit");
    expect(stopHeadline("budget", { reason: "token budget exceeded" })).toContain("spending (or token) limit");
    expect(stopHeadline("budget", { reason: "something odd" })).toBe("The run reached a limit before it finished.");
    expect(stopHeadline("timeout")).toContain("out of time");
    expect(stopHeadline("error", { reason: "rate limited" })).toBe("The run hit an error (rate limited).");
    expect(stopHeadline("crash")).toContain("interrupted");
  });
});

describe("stop facts", () => {
  it("lists the repeated tool, the tools done with counts, and what is left", () => {
    expect(stopFacts(stop())).toEqual([
      { label: "Kept repeating", items: ["web-search"], mono: true },
      { label: "Already done", items: ["web-search x3", "file-read"], mono: true },
      { label: "Left to do", items: ["write report", "send summary"], mono: false, list: true },
    ]);
  });

  it("strips trailing periods from the rows left, so a list never reads 'x)., y'", () => {
    const left = stopFacts(stop({ unfinished: ["Check pager settings (on-call).", "Retrieve the rota..", "  "] })).find((f) => f.label === "Left to do")!;
    expect(left.items).toEqual(["Check pager settings (on-call)", "Retrieve the rota"]);
    expect(left.list).toBe(true);
  });

  it("leaves empty groups out, caps long lists, and lists nothing for a crash (no stop record)", () => {
    expect(stopFacts(stop({ repeatedTool: undefined, toolsDone: [], unfinished: [] }))).toEqual([]);
    expect(stopFacts(undefined)).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => `row ${i}`);
    const left = stopFacts(stop({ unfinished: many })).find((f) => f.label === "Left to do")!;
    expect(left.items).toEqual([...many.slice(0, 5), "and 4 more"]);
  });
});
