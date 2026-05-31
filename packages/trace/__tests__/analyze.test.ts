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

import { analyzeRun, renderRunReport } from "../src/analyze.js";

function richFixture(opts: { substantive: boolean }): Trace {
  let seq = 0;
  const base = (kind: string, iter: number, extra: Record<string, unknown>): TraceEvent =>
    ({ kind, runId: "r2", timestamp: 0, iter, seq: seq++, ...extra } as unknown as TraceEvent);
  const events: TraceEvent[] = [
    base("kernel-state-snapshot", 0, { status: "thinking", toolsUsed: [], scratchpadKeys: [], stepsCount: 0, stepsByType: {}, outputPreview: null, outputLen: 0, messagesCount: 1, tokens: 0, cost: 0, llmCalls: 0, terminatedBy: undefined, pendingGuidance: undefined }),
    base("entropy-scored", 0, { composite: 0.8, sources: { token: 0.5, structural: 0.5, semantic: 0.5, behavioral: 0.5, contextPressure: 0.1 } }),
    base("intervention-suppressed", 1, { decisionType: "compress", reason: "below-entropy-threshold" }),
    base("decision-evaluated", 1, { decisionType: "continue", confidence: 0.7, reason: "progressing" }),
  ];
  if (opts.substantive) {
    // real read (truncated) + deliverable write
    events.push(base("tool-call-start", 1, { toolName: "file-read" }));
    events.push(base("tool-call-end", 1, { toolName: "file-read", ok: true, resultTruncated: true }));
    events.push(base("tool-call-start", 2, { toolName: "file-write" }));
    events.push(base("tool-call-end", 2, { toolName: "file-write", ok: true }));
  } else {
    // claimed success but ONLY introspection — the prose-lie class
    events.push(base("tool-call-start", 2, { toolName: "pulse" }));
    events.push(base("tool-call-end", 2, { toolName: "pulse", ok: true }));
  }
  events.push(base("entropy-scored", 2, { composite: 0.3, sources: { token: 0.2, structural: 0.2, semantic: 0.2, behavioral: 0.2, contextPressure: 0.1 } }));
  events.push(base("kernel-state-snapshot", 2, { status: "done", toolsUsed: ["file-read"], scratchpadKeys: [], stepsCount: 6, stepsByType: { thought: 3, action: 2, observation: 1 }, outputPreview: "x", outputLen: 1, messagesCount: 6, tokens: 5000, cost: 0, llmCalls: 3, terminatedBy: "final_answer_tool", pendingGuidance: undefined }));
  events.push(base("guard-fired", 2, { guard: "terminal_decision", outcome: "terminate", reason: "final_answer_tool" }));
  events.push(base("run-completed", -1, { status: "success", totalTokens: 5000, totalCostUsd: 0, durationMs: 100 }));
  return { runId: "r2", events };
}

describe("analyzeRun — full decision-grade signal", () => {
  it("labels claimed-success+deliverable as UNVERIFIED, never bare success", () => {
    const a = analyzeRun(richFixture({ substantive: true }));
    expect(a.honesty.label).toBe("claimed-success (unverified)");
    expect(a.honesty.deliverableProduced).toBe(true);
  });

  it("flags dishonest-success-suspected when claimed done but no substantive tool work", () => {
    const a = analyzeRun(richFixture({ substantive: false }));
    expect(a.honesty.label).toBe("dishonest-success-suspected");
  });

  it("captures cost (trajectory, intervention estimate) and marks in/out split BLIND", () => {
    const a = analyzeRun(richFixture({ substantive: true }));
    expect(a.cost.totalTokens).toBe(5000);
    expect(a.cost.tokenTrajectory).toEqual([0, 5000]);
    expect(a.cost.inOutSplitAvailable).toBe(false);
  });

  it("captures reasoning trajectory (entropy converging) + tool outcomes (truncation)", () => {
    const a = analyzeRun(richFixture({ substantive: true }));
    expect(a.reasoning.entropyShape).toBe("converging");
    const fr = a.tools.find((t) => t.tool === "file-read");
    expect(fr?.truncated).toBe(1);
  });

  it("coverage centerpiece: marks blind spots for missing emitters (NOT real zeros)", () => {
    const a = analyzeRun(richFixture({ substantive: true }));
    const blind = a.coverage.blindSpots.map((b) => b.metric).join(" | ");
    expect(blind).toContain("cache"); // llm-exchange missing
    expect(a.coverage.knownDeadEmitters.join(" ")).toContain("emitCuratorDecision");
    // guard-fired terminal-only → overlap visibility flagged blind
    expect(blind.toLowerCase()).toContain("overlap");
  });

  it("renders a full forensic report", () => {
    const r = renderRunReport(analyzeRun(richFixture({ substantive: true })));
    expect(r).toContain("OUTCOME:");
    expect(r).toContain("COVERAGE:");
    expect(r).toContain("BLIND");
  });
});
