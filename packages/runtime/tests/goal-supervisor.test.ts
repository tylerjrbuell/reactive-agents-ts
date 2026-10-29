import { describe, it, expect } from "bun:test";
import type { GoalState, GoalCriterion } from "@reactive-agents/core";
import { evaluateGoal, pursueGoal } from "../src/goal/index.js";
import type { GoalSegmentResult } from "../src/goal/index.js";

const mk = (over: Partial<GoalState> = {}): GoalState => ({
  id: "g1",
  objective: "obj",
  criteria: [{ id: "c1", text: "has DONE", check: { kind: "regex", pattern: "DONE" } }],
  budget: { maxSegments: 5 },
  status: "active",
  segments: 0,
  spent: { costUsd: 0, tokens: 0, wallClockMs: 0 },
  verdictHistory: [],
  noDeltaStreak: 0,
  ...over,
});
const seg = (output: string, over: Partial<GoalSegmentResult> = {}): GoalSegmentResult => ({
  output,
  progressed: true,
  ...over,
});
/**
 * Wraps a segment runner so a supervisor that fails to cut the budget fails the test fast
 * (a thrown error ends the goal blocked) instead of looping until the test times out.
 */
const guarded = (
  run: (s: GoalState, i: number) => Promise<GoalSegmentResult>,
  max = 20,
): ((s: GoalState, i: number) => Promise<GoalSegmentResult>) => {
  let calls = 0;
  return async (s, i) => {
    calls += 1;
    if (calls > max) throw new Error(`runaway: budget was not cut after ${max} segments`);
    return run(s, i);
  };
};
const rubric: GoalCriterion = { id: "r", text: "good", check: { kind: "rubric" } };

describe("evaluateGoal", () => {
  it("achieved by regex", () => {
    const ev = evaluateGoal(mk(), seg("all DONE"));
    expect(ev.state.status).toBe("achieved");
    expect(ev.goalAchieved).toBe(true);
  });
  it("must-include matches deliverables", () => {
    const s = mk({ criteria: [{ id: "m", text: "file", check: { kind: "must-include", value: "out.md" } }] });
    expect(evaluateGoal(s, seg("x", { deliverables: ["dir/out.md"] })).state.status).toBe("achieved");
    expect(evaluateGoal(s, seg("x")).state.status).toBe("active");
  });
  it("stalls after N no-delta segments", () => {
    let s = mk();
    s = evaluateGoal(s, seg("no", { progressed: false })).state;
    expect(s.status).toBe("active");
    s = evaluateGoal(s, seg("no", { progressed: false })).state;
    expect(s.status).toBe("stalled");
  });
  it("progress resets the stall streak", () => {
    let s = mk();
    s = evaluateGoal(s, seg("no", { progressed: false })).state;
    s = evaluateGoal(s, seg("no")).state;
    expect(s.noDeltaStreak).toBe(0);
    expect(s.status).toBe("active");
  });
  it.each([
    ["maxSegments", { maxSegments: 1 }, seg("no")],
    ["maxCostUsd", { maxSegments: 9, maxCostUsd: 1 }, seg("no", { costUsd: 1 })],
    ["maxTokens", { maxSegments: 9, maxTokens: 10 }, seg("no", { tokens: 10 })],
    ["maxWallClockMs", { maxSegments: 9, maxWallClockMs: 50 }, seg("no", { durationMs: 60 })],
  ])("budget exhausted on %s", (axis, budget, r) => {
    const ev = evaluateGoal(mk({ budget }), r);
    expect(ev.state.status).toBe("budget-exhausted");
    expect(ev.reason).toContain(axis);
  });
  it("achieved wins over exhausted budget", () => {
    expect(evaluateGoal(mk({ budget: { maxSegments: 1 } }), seg("DONE")).state.status).toBe("achieved");
  });
  it("null when rubric undecided (no model)", () => {
    const ev = evaluateGoal(mk({ criteria: [rubric] }), seg("anything"));
    expect(ev.verdict).toBeNull();
    expect(ev.goalAchieved).toBeNull();
    expect(ev.state.status).toBe("active");
  });
  it("null when no criteria", () => {
    expect(evaluateGoal(mk({ criteria: [] }), seg("x")).goalAchieved).toBeNull();
  });
  it("rubric achieved still needs deterministic criteria", () => {
    const s = mk({ criteria: [...mk().criteria, rubric] });
    expect(evaluateGoal(s, seg("nope"), { rubricVerdict: "achieved" }).state.status).toBe("active");
    expect(evaluateGoal(s, seg("DONE"), { rubricVerdict: "achieved" }).state.status).toBe("achieved");
  });
  it("rubric blocked/stalled map to status", () => {
    const s = mk({ criteria: [rubric] });
    expect(evaluateGoal(s, seg("x"), { rubricVerdict: "blocked" }).state.status).toBe("blocked");
    expect(evaluateGoal(s, seg("x"), { rubricVerdict: "stalled" }).state.status).toBe("stalled");
  });
});

describe("pursueGoal", () => {
  it("runs until achieved and reports updates", async () => {
    const outs = ["a", "b", "DONE"];
    const updates: string[] = [];
    const r = await pursueGoal({
      state: mk(),
      runSegment: async (_s, i) => seg(outs[i]!),
      onUpdate: (e) => updates.push(e.state.status),
    });
    expect(r.state.status).toBe("achieved");
    expect(r.goalAchieved).toBe(true);
    expect(r.state.segments).toBe(3);
    expect(updates).toEqual(["active", "active", "achieved"]);
  });
  it("stalls", async () => {
    const r = await pursueGoal({ state: mk(), runSegment: async () => seg("no", { progressed: false }) });
    expect(r.state.status).toBe("stalled");
    expect(r.state.segments).toBe(2);
  });
  it("budget-exhausted", async () => {
    const r = await pursueGoal({
      state: mk({ budget: { maxSegments: 2 } }),
      runSegment: guarded(async () => seg("no")),
    });
    expect(r.state.status).toBe("budget-exhausted");
    expect(r.state.segments).toBe(2); // red-on-cut: a runaway shows blocked/segments>2, not a hang
    expect(r.goalAchieved).toBe(false);
  });
  it("a runaway runner fails fast and clean when the budget is never cut", async () => {
    const r = await pursueGoal({
      state: mk({ budget: { maxSegments: 1_000_000 } }),
      runSegment: guarded(async () => seg("no"), 3),
    });
    expect(r.state.status).toBe("blocked");
    expect(r.reason).toContain("runaway");
  });
  it("null undecided without check: ends by budget with goalAchieved null", async () => {
    const r = await pursueGoal({
      state: mk({ criteria: [rubric], budget: { maxSegments: 2 } }),
      runSegment: guarded(async () => seg("x")),
    });
    expect(r.state.status).toBe("budget-exhausted");
    expect(r.goalAchieved).toBeNull();
  });
  it("uses check for rubric", async () => {
    const r = await pursueGoal({
      state: mk({ criteria: [rubric] }),
      runSegment: async () => seg("x"),
      check: async () => "achieved",
    });
    expect(r.state.status).toBe("achieved");
  });
  it("cancel between segments, not mid-segment", async () => {
    let cancelled = false;
    let ran = 0;
    const r = await pursueGoal({
      state: mk(),
      runSegment: async () => {
        ran++;
        cancelled = true; // flips during segment 1; segment must still finish
        return seg("no");
      },
      isCancelled: () => cancelled,
    });
    expect(ran).toBe(1);
    expect(r.state.status).toBe("cancelled");
    expect(r.state.segments).toBe(1);
  });
  it("segment throw ends blocked", async () => {
    const r = await pursueGoal({
      state: mk(),
      runSegment: async () => {
        throw new Error("boom");
      },
    });
    expect(r.state.status).toBe("blocked");
    expect(r.reason).toContain("boom");
  });
});
