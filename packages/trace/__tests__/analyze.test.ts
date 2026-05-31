import { describe, it, expect } from "bun:test";
import { analyzeInterventions, renderInterventionReport } from "../src/analyze.js";
import type { Trace } from "../src/replay.js";
import type { TraceEvent } from "../src/events.js";

// Fixture mirrors the real JSONL shape proven by apps/examples/trace-guard-synthetic.ts:
// an overlap-storm iter (3 deciders) + a terminal max_iterations decision, plus
// snapshots (token growth) and a recall-loop, so every detector has a target.
function fixture(): Trace {
  let seq = 0;
  const g = (iter: number, guard: string, outcome: string, reason: string): TraceEvent =>
    ({ kind: "guard-fired", runId: "r1", timestamp: 0, iter, seq: seq++, guard, outcome, reason } as TraceEvent);
  const snap = (iter: number, tokens: number, terminatedBy?: string): TraceEvent =>
    ({
      kind: "kernel-state-snapshot", runId: "r1", timestamp: 0, iter, seq: seq++,
      status: terminatedBy ? "done" : "thinking", toolsUsed: [], scratchpadKeys: [],
      stepsCount: 0, stepsByType: {}, outputPreview: null, outputLen: 0, messagesCount: 0,
      tokens, cost: 0, llmCalls: iter, terminatedBy, pendingGuidance: undefined,
    } as TraceEvent);
  const tool = (iter: number, toolName: string): TraceEvent =>
    ({ kind: "tool-call-start", runId: "r1", timestamp: 0, iter, seq: seq++, toolName } as TraceEvent);
  const done = (): TraceEvent =>
    ({ kind: "run-completed", runId: "r1", timestamp: 0, iter: -1, seq: seq++, status: "failure", totalTokens: 84000, totalCostUsd: 0, durationMs: 1000 } as TraceEvent);

  return {
    runId: "r1",
    events: [
      snap(0, 0), tool(1, "recall"), snap(1, 2000),
      tool(2, "recall"), snap(2, 4000),
      // overlap storm at iter 3
      g(3, "low_delta_guard", "warn", "low delta"),
      g(3, "stall_deliverable", "warn", "stalled"),
      g(3, "oracle_gate", "redirect", "nudge 1"),
      tool(3, "recall"), snap(3, 40000),
      g(4, "terminal_decision", "terminate", "max_iterations reached"),
      snap(4, 84000, "max_iterations"),
      done(),
    ],
  };
}

describe("analyzeInterventions", () => {
  const a = analyzeInterventions(fixture());

  it("counts guards and groups by name with outcomes", () => {
    expect(a.guardsFired).toBe(4);
    const oracle = a.byGuard.find((g) => g.guard === "oracle_gate");
    expect(oracle?.outcomes["redirect"]).toBe(1);
  });

  it("detects the overlap storm (≥2 distinct deciders in one iter)", () => {
    expect(a.overlapStorms).toHaveLength(1);
    expect(a.overlapStorms[0]?.iter).toBe(3);
    expect(a.overlapStorms[0]?.guards.length).toBe(3);
  });

  it("recovers the terminal decision + terminatedBy", () => {
    expect(a.terminalDecision?.guard).toBe("terminal_decision");
    expect(a.terminatedBy).toBe("max_iterations");
  });

  it("flags trace-detectable failure modes (overlap, recall-loop, runaway, max-iter)", () => {
    const modes = a.failureModes.map((f) => f.mode);
    expect(modes).toContain("overlap-storm");
    expect(modes).toContain("recall-loop"); // recall ×3
    expect(modes).toContain("runaway-tokens"); // 4000→40000 delta 36000 ≥ 30000
    expect(modes).toContain("max-iter-no-progress");
  });

  it("reports dishonest-success as a non-trace-detectable gap (no over-claim)", () => {
    expect(a.notDetectable.join(" ")).toContain("dishonest-success");
  });

  it("renders a readable per-run report", () => {
    const report = renderInterventionReport(a);
    expect(report).toContain("Overlap storms");
    expect(report).toContain("oracle_gate");
    expect(report).toContain("Failure modes");
  });
});
