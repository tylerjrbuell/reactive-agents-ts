/**
 * Pins the bus -> public-stream projection of `ThinkingEmitted`
 * (engine/thinking-stream.ts, wired in engine/execute-stream.ts, density "full").
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { toThinkingStreamEvent } from "../src/engine/thinking-stream.js";
import { toThoughtStreamEvent, toExitGateStreamEvent } from "../src/engine/strategy-neutral-stream.js";

describe("toThinkingStreamEvent", () => {
  test("matching taskId projects content/iteration/truncated", () => {
    expect(
      toThinkingStreamEvent(
        { _tag: "ThinkingEmitted", taskId: "t1", iteration: 3, content: "hmm", truncated: true },
        "t1",
      ),
    ).toEqual({ _tag: "ThinkingEmitted", content: "hmm", iteration: 3, truncated: true });
  });
  test("omits truncated when absent", () => {
    const out = toThinkingStreamEvent({ taskId: "t1", iteration: 1, content: "x" }, "t1");
    expect(out).toEqual({ _tag: "ThinkingEmitted", content: "x", iteration: 1 });
  });
  test("other taskId or empty content yields nothing", () => {
    expect(toThinkingStreamEvent({ taskId: "t2", iteration: 1, content: "x" }, "t1")).toBeUndefined();
    expect(toThinkingStreamEvent({ taskId: "t1", iteration: 1, content: "" }, "t1")).toBeUndefined();
  });
  test("execute-stream subscribes only under density full", () => {
    const src = readFileSync(new URL("../src/engine/execute-stream.ts", import.meta.url), "utf8");
    // subscription sits inside an open `if (eb && density === "full") {` block (no 6-space block close between)
    const at = src.indexOf('yield* subscribe("ThinkingEmitted"');
    expect(at).toBeGreaterThan(-1);
    const before = src.slice(0, at);
    expect(before.lastIndexOf('if (eb && density === "full") {')).toBeGreaterThan(before.lastIndexOf("\n      }\n"));
  });
});

// Strategy-neutral stream (engine/strategy-neutral-stream.ts): thoughts are kernel
// turns only; both exit gates project onto one ExitGateDecision shape.
describe("toThoughtStreamEvent", () => {
  test("a strategy step (no producedBy) is never a thought", () => {
    expect(toThoughtStreamEvent({ step: 2, thought: "[PLAN 2] Generated 6 steps" })).toBeUndefined();
  });
  test("a kernel step with a thought projects ThoughtEmitted", () => {
    expect(toThoughtStreamEvent({ step: 3, thought: "  check the file  ", producedBy: "kernel" })).toEqual({
      _tag: "ThoughtEmitted",
      content: "check the file",
      iteration: 3,
    });
  });
  test("a kernel step with an empty thought yields nothing", () => {
    expect(toThoughtStreamEvent({ step: 1, thought: "   ", producedBy: "kernel" })).toBeUndefined();
  });
});

describe("toExitGateStreamEvent", () => {
  test("exit_gate deny-once maps to repair with outstanding", () => {
    expect(
      toExitGateStreamEvent({
        guard: "exit_gate",
        iteration: 4,
        metadata: { proposedBy: "stall_guard", gateDecision: "deny-once", outstanding: ["write report.md"] },
      }),
    ).toEqual({ _tag: "ExitGateDecision", decision: "repair", outstanding: ["write report.md"], iteration: 4 });
  });
  test("exit_gate deny (repeated model denial) maps to repair, same as deny-once", () => {
    expect(
      toExitGateStreamEvent({
        guard: "exit_gate",
        iteration: 6,
        metadata: { proposedBy: "model", gateDecision: "deny", outstanding: ["write report.md"] },
      }),
    ).toEqual({ _tag: "ExitGateDecision", decision: "repair", outstanding: ["write report.md"], iteration: 6 });
  });
  test("strategy_delivery_gate handoff maps to handoff (same shape as the kernel gate)", () => {
    expect(
      toExitGateStreamEvent({
        guard: "strategy_delivery_gate",
        iteration: 2,
        metadata: { strategy: "plan-execute-reflect", gateDecision: "handoff", outstanding: ["a", "b"] },
      }),
    ).toEqual({ _tag: "ExitGateDecision", decision: "handoff", outstanding: ["a", "b"], iteration: 2 });
  });
  test("accept with outstanding items maps to accept-unfinished", () => {
    expect(
      toExitGateStreamEvent({
        guard: "strategy_delivery_gate",
        iteration: 1,
        metadata: { strategy: "reflexion", gateDecision: "accept", outstanding: ["x"] },
      }),
    ).toEqual({ _tag: "ExitGateDecision", decision: "accept-unfinished", outstanding: ["x"], iteration: 1 });
  });
  test("a clean accept and other guards yield nothing", () => {
    expect(
      toExitGateStreamEvent({ guard: "exit_gate", iteration: 5, metadata: { gateDecision: "accept", outstanding: [] } }),
    ).toBeUndefined();
    expect(
      toExitGateStreamEvent({ guard: "loop_detector", iteration: 5, metadata: { gateDecision: "deny-once", outstanding: ["x"] } }),
    ).toBeUndefined();
  });
});
