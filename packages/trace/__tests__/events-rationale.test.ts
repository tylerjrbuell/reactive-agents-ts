import { describe, it, expect } from "bun:test";
import type {
  ToolCallEvent,
  AssumptionRecordedEvent,
  CuratorDecisionEvent,
  AlternativesConsideredEvent,
  KernelStateSnapshotEvent,
  StrategySwitchedEvent,
  DecisionEvaluatedEvent,
  TraceEvent,
} from "../src/events.js";

describe("rationale-bearing events (structural)", () => {
  it("ToolCallEvent (start) carries optional rationale", () => {
    const e: ToolCallEvent = {
      kind: "tool-call-start",
      runId: "r1", iter: 0, seq: 1, timestamp: 0,
      toolName: "web_search",
      args: {},
      rationale: { why: "needs fresh data" },
    };
    expect(e.rationale?.why).toBe("needs fresh data");
  });

  it("ToolCallEvent compiles without rationale (backwards-compat)", () => {
    const e: ToolCallEvent = {
      kind: "tool-call-start",
      runId: "r1", iter: 0, seq: 1, timestamp: 0,
      toolName: "calc",
    };
    expect(e.rationale).toBeUndefined();
  });

  it("AssumptionRecordedEvent", () => {
    const e: AssumptionRecordedEvent = {
      kind: "assumption-recorded",
      runId: "r1", iter: 1, seq: 2, timestamp: 0,
      assumption: "user means USD",
      rationale: { why: "no currency specified", confidence: 0.6 },
    };
    expect(e.kind).toBe("assumption-recorded");
    expect(e.rationale.confidence).toBe(0.6);
  });

  it("AlternativesConsideredEvent", () => {
    const e: AlternativesConsideredEvent = {
      kind: "alternatives-considered",
      runId: "r1", iter: 2, seq: 3, timestamp: 0,
      chosen: "tool_a",
      alternatives: [{ option: "tool_b", rejectedBecause: "stale data" }],
    };
    expect(e.chosen).toBe("tool_a");
    expect(e.alternatives).toHaveLength(1);
  });

  it("CuratorDecisionEvent", () => {
    const e: CuratorDecisionEvent = {
      kind: "curator-decision",
      runId: "r1", iter: 2, seq: 4, timestamp: 0,
      action: "marked-untrusted",
      targetRef: "obs:scrape-1",
      rationale: { why: "no audit trail" },
    };
    expect(e.action).toBe("marked-untrusted");
    expect(e.targetRef).toBe("obs:scrape-1");
  });

  it("KernelStateSnapshotEvent carries terminationRationale when terminatedBy set", () => {
    const e: KernelStateSnapshotEvent = {
      kind: "kernel-state-snapshot",
      runId: "r1", iter: 3, seq: 9, timestamp: 0,
      status: "done",
      toolsUsed: [],
      scratchpadKeys: [],
      stepsCount: 0,
      stepsByType: {},
      outputPreview: null,
      outputLen: 0,
      messagesCount: 0,
      tokens: 0,
      cost: 0,
      llmCalls: 0,
      terminatedBy: "quality-threshold",
      pendingGuidance: undefined,
      terminationRationale: { why: "quality 0.92 ≥ threshold 0.90" },
    };
    expect(e.terminationRationale?.why).toContain("0.92");
  });

  it("StrategySwitchedEvent carries optional rationale alongside reason", () => {
    const e: StrategySwitchedEvent = {
      kind: "strategy-switched",
      runId: "r1", iter: 4, seq: 12, timestamp: 0,
      from: "react",
      to: "plan-execute",
      reason: "stalled",
      rationale: { why: "3 identical thoughts in a row" },
    };
    expect(e.rationale?.why).toContain("identical");
  });

  it("DecisionEvaluatedEvent carries optional rationale alongside reason", () => {
    const e: DecisionEvaluatedEvent = {
      kind: "decision-evaluated",
      runId: "r1", iter: 4, seq: 13, timestamp: 0,
      decisionType: "stall-detection",
      confidence: 0.8,
      reason: "stalled",
      rationale: { why: "no progress for 3 iterations", refs: ["scratch:goal"] },
    };
    expect(e.rationale?.refs).toEqual(["scratch:goal"]);
  });

  it("new event kinds are members of TraceEvent union", () => {
    const events: TraceEvent[] = [
      {
        kind: "assumption-recorded",
        runId: "r1", iter: 0, seq: 0, timestamp: 0,
        assumption: "x",
        rationale: { why: "y" },
      },
      {
        kind: "alternatives-considered",
        runId: "r1", iter: 0, seq: 0, timestamp: 0,
        chosen: "x",
        alternatives: [],
      },
      {
        kind: "curator-decision",
        runId: "r1", iter: 0, seq: 0, timestamp: 0,
        action: "kept",
        targetRef: "obs:1",
        rationale: { why: "high signal" },
      },
    ];
    expect(events).toHaveLength(3);
  });
});
