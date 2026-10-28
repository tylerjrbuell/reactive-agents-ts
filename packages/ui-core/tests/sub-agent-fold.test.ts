import { describe, expect, test } from "bun:test";
import {
  finishTurnTrace,
  foldTurnTrace,
  initialRunState,
  initialTurnTrace,
  reduceRunState,
  type SubAgentRunInfoWire,
  type UiStreamEvent,
} from "../src/index.js";

const sub = (run: SubAgentRunInfoWire, event: UiStreamEvent): UiStreamEvent => ({ _tag: "SubAgentActivity", run, event });
const started = (run: SubAgentRunInfoWire, t = 1000): UiStreamEvent =>
  sub(run, { _tag: "PhaseStarted", phase: "sub-agent", timestamp: t });
const done = (run: SubAgentRunInfoWire, output: string, extra: Partial<{ success: boolean }> = {}): UiStreamEvent =>
  sub(run, { _tag: "StreamCompleted", output, ...extra, metadata: { duration: 500, cost: 0.004, tokensUsed: 120 } });
const tool = (run: SubAgentRunInfoWire, id: string, name: string): UiStreamEvent[] => [
  sub(run, { _tag: "ToolCallStarted", toolName: name, callId: id }),
  sub(run, { _tag: "ToolCallCompleted", toolName: name, callId: id, durationMs: 5, success: true, result: "ok" }),
];
const fold = (events: UiStreamEvent[]) => events.reduce(foldTurnTrace, initialTurnTrace());

const A: SubAgentRunInfoWire = { runId: "a1", parentRunId: "root", depth: 1, name: "alpha" };
const B: SubAgentRunInfoWire = { runId: "b1", parentRunId: "root", depth: 1, name: "beta" };

describe("sub-agent fold", () => {
  test("two parallel children fold into independent traces", () => {
    const s = fold([started(A), started(B), ...tool(A, "c1", "web-search"), ...tool(B, "c2", "file-read")]);
    expect(Object.keys(s.subAgents)).toEqual(["a1", "b1"]);
    expect(s.subAgents.a1!.trace.calls.map((c) => c.name)).toEqual(["web-search"]);
    expect(s.subAgents.b1!.trace.calls.map((c) => c.name)).toEqual(["file-read"]);
    expect(s.calls).toEqual([]);
    expect(s.subAgents.a1!.status).toBe("running");
    expect(s.subAgents.a1!.startedAt).toBe(1000);
  });

  test("grandchild nests under its parent", () => {
    const G: SubAgentRunInfoWire = { runId: "g1", parentRunId: "a1", depth: 2, name: "gamma" };
    const s = fold([started(A), started(G), ...tool(G, "c9", "http-get"), done(G, "g-out"), done(A, "a-out")]);
    expect(Object.keys(s.subAgents)).toEqual(["a1"]);
    const g = s.subAgents.a1!.trace.subAgents.g1!;
    expect(g.status).toBe("done");
    expect(g.trace.calls[0]!.name).toBe("http-get");
    expect(s.subAgents.a1!.output).toBe("a-out");
  });

  test("finished child is done with output, tokens, cost; failure marks failed", () => {
    const s = fold([started(A), started(B), done(A, "answer"), done(B, "boom", { success: false })]);
    expect(s.subAgents.a1).toMatchObject({ status: "done", output: "answer", tokens: 120, costUsd: 0.004, endedAt: 1500 });
    expect(s.subAgents.b1!.status).toBe("failed");
    expect(s.answer).toBeUndefined();
  });

  test("persisted trace round-trips, caps results and settles running children", () => {
    const G: SubAgentRunInfoWire = { runId: "g1", parentRunId: "a1", depth: 2, name: "gamma" };
    const s = fold([
      started(A),
      sub(A, { _tag: "ToolCallStarted", toolName: "t", callId: "c" }),
      sub(A, { _tag: "ToolCallCompleted", toolName: "t", callId: "c", durationMs: 1, success: true, result: "x".repeat(50) }),
      started(G),
      done(G, "y".repeat(50)),
    ]);
    const t = finishTurnTrace(s, { resultCap: 10 })!;
    expect(t.subAgents).toHaveLength(1);
    const a = t.subAgents![0]!;
    expect(a.status).toBe("done");
    expect(a.trace.toolCalls[0]).toMatchObject({ result: "x".repeat(10), resultTruncated: true });
    expect(a.trace.subAgents![0]!.output).toBe("y".repeat(10));
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });

  test("turns without sub-agents finish exactly as before", () => {
    const s = fold([{ _tag: "TextDelta", text: "hi" }]);
    expect(s.subAgents).toEqual({});
    expect(finishTurnTrace(s)).toBeUndefined();
    const t = finishTurnTrace(fold(tool(A, "c", "t").map((e) => (e as { event: UiStreamEvent }).event)))!;
    expect("subAgents" in t).toBe(false);
  });

  test("run state folds the same recursive tree", () => {
    const G: SubAgentRunInfoWire = { runId: "g1", parentRunId: "a1", depth: 2, name: "gamma" };
    const r = [started(A), started(G), ...tool(G, "c9", "http-get"), done(A, "out")].reduce(
      (st, e) => reduceRunState(st, e),
      initialRunState(),
    );
    expect(r.status).toBe("streaming");
    expect(r.text).toBe("");
    expect(r.subAgents!.a1!.status).toBe("done");
    expect(r.subAgents!.a1!.trace.subAgents.g1!.trace.calls).toHaveLength(1);
  });

  test("runId drift: early chunks carry taskId, later chunks the minted run id", () => {
    const early: SubAgentRunInfoWire = { runId: "task-A", parentRunId: "root", depth: 1, name: "alpha" };
    const late: SubAgentRunInfoWire = { runId: "run-A", parentRunId: "root", depth: 1, name: "alpha" };
    const G: SubAgentRunInfoWire = { runId: "g1", parentRunId: "run-A", depth: 2, name: "gamma" };
    const s = fold([started(early), ...tool(late, "c1", "web-search"), started(G), done(late, "out")]);
    expect(Object.keys(s.subAgents)).toEqual(["task-A"]);
    const a = s.subAgents["task-A"]!;
    expect(a.status).toBe("done");
    expect(a.trace.calls).toHaveLength(1);
    expect(Object.keys(a.trace.subAgents)).toEqual(["g1"]);
  });

  test("same-name parallel siblings stay separate when each announces itself", () => {
    const X1: SubAgentRunInfoWire = { runId: "x1", parentRunId: "root", depth: 1, name: "worker" };
    const X2: SubAgentRunInfoWire = { runId: "x2", parentRunId: "root", depth: 1, name: "worker" };
    const s = fold([started(X1), started(X2), ...tool(X2, "c", "t")]);
    expect(Object.keys(s.subAgents)).toEqual(["x1", "x2"]);
    expect(s.subAgents.x2!.trace.calls).toHaveLength(1);
    expect(s.subAgents.x1!.trace.calls).toHaveLength(0);
  });
});
