import { describe, expect, test } from "bun:test";
import {
  compareCandidates,
  compareHref,
  comparePair,
  fetchRunCompare,
  loopRows,
  loopSpanLabel,
  noTraceNote,
  signedDelta,
  speedLabel,
  stepCallLabel,
  type CompareLoop,
  type CompareTrace,
} from "./run-compare.js";
import type { RunRow } from "./runs-table.js";

const row = (runId: string, over: Partial<RunRow> = {}): RunRow => ({
  runId,
  agentId: "agent",
  startedAt: 0,
  status: "completed",
  iterationCount: 1,
  tokensUsed: 0,
  cost: 0,
  hasDebrief: false,
  ...over,
});

const loop = (n: number, same: boolean, a: number[] = [], b: number[] = []): CompareLoop => ({ loop: n, a, b, same });

const trace = (loops: CompareLoop[], firstLoop: number | null): Extract<CompareTrace, { available: true }> => ({
  available: true,
  diff: { identical: false, iterationsDelta: 0, toolSequenceDiff: [], outputDiff: { equal: true }, tokensDelta: 0, costDelta: 0, durationDeltaMs: 0 },
  a: { task: "t", model: "m", iterations: 3, toolCalls: 0, totalTokens: 0, totalCostUsd: 0, durationMs: 0 },
  b: { task: "t", model: "m", iterations: 3, toolCalls: 0, totalTokens: 0, totalCostUsd: 0, durationMs: 0 },
  steps: [],
  loops,
  firstDivergence: firstLoop === null ? null : { step: 0, loopA: firstLoop, loopB: firstLoop },
});

describe("run compare view rules", () => {
  test("consecutive matching loops collapse into one span; the first diverging loop is marked", () => {
    const rows = loopRows(trace([loop(1, true, [0]), loop(2, true, [1, 2]), loop(3, false, [3], [3]), loop(4, false), loop(5, true)], 3));
    expect(rows).toEqual([
      { kind: "match", from: 1, to: 2, calls: 3 },
      { kind: "loop", loop: loop(3, false, [3], [3]), first: true },
      { kind: "loop", loop: loop(4, false), first: false },
      { kind: "match", from: 5, to: 5, calls: 0 },
    ]);
    expect(loopSpanLabel(1, 2)).toBe("Loops 1–2");
    expect(loopSpanLabel(5, 5)).toBe("Loop 5");
  });

  test("Compare needs exactly two selected runs, in selection order", () => {
    expect(comparePair(new Set(["x"]))).toBeNull();
    expect(comparePair(new Set(["b", "a"]))).toEqual(["b", "a"]);
    expect(comparePair(new Set(["a", "b", "c"]))).toBeNull();
    expect(compareHref("a 1", "b")).toBe("/runs/compare?a=a%201&b=b");
  });

  test("picker candidates: never the run itself or a live run; same name first, then newest", () => {
    const current = row("CUR", { displayName: "price check" });
    const runs = [
      current,
      row("OLD", { displayName: "price check", startedAt: 1 }),
      row("NEW", { displayName: "other", startedAt: 9 }),
      row("LIVE", { displayName: "price check", status: "live", startedAt: 5 }),
    ];
    expect(compareCandidates(runs, current.runId).map((r) => r.runId)).toEqual(["OLD", "NEW"]);
    expect(compareCandidates(runs, current.runId, "other").map((r) => r.runId)).toEqual(["NEW"]);
  });

  test("deltas, speed and step labels", () => {
    expect(signedDelta(0)).toBe("same");
    expect(signedDelta(-50)).toBe("−50");
    expect(signedDelta(12, (n) => `${n}s`)).toBe("+12s");
    expect(speedLabel({})).toBe("—");
    expect(speedLabel({ tokensPerSecond: { median: 42.4, lowerBound: true, calls: 2 } })).toBe("~42 tok/s");
    expect(stepCallLabel({ toolName: "web-search", argsHash: "h", ok: true, loop: 1, args: '{"q":"x"}' })).toBe('web-search {"q":"x"}');
    expect(stepCallLabel({ toolName: "list", argsHash: "h", ok: true, loop: 1, args: "{}" })).toBe("list");
    expect(noTraceNote(["b"])).toContain("Run B recorded");
    expect(noTraceNote(["a", "b"])).toContain("Neither run");
  });

  test("fetch surfaces the server's error message", async () => {
    const res = new Response(JSON.stringify({ error: "Run not found: GONE" }), { status: 404 });
    await expect(fetchRunCompare("a", "GONE", async () => res)).rejects.toThrow("Run not found: GONE");
  });
});
