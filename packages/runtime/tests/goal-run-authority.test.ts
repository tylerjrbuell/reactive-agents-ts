// Run: bun test packages/runtime/tests/goal-run-authority.test.ts --timeout 15000
//
// Plan 9 item 2e: one "done" and one "progress" vocabulary. The goal supervisor
// reads the run's own verdict (exit gate + RunContract requirements, and
// RunAssessment.evidenceDelta) instead of keeping private done/progress logic.
import { describe, it, expect } from "bun:test";
import type { GoalState } from "@reactive-agents/core";
import { evaluateGoal, goalRunOf, pursueGoal } from "../src/goal/index.js";
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

describe("goal supervisor: done authority is the run's exit gate", () => {
  it("never calls a goal achieved when the run's exit gate denied completion", () => {
    const denied: GoalSegmentResult = { output: "all DONE", run: { goalAchieved: false } };
    const ev = evaluateGoal(mk(), denied);
    expect(ev.goalAchieved).toBe(false);
    expect(ev.verdict).toBe("progressing");
    expect(ev.state.status).toBe("active");
    expect(ev.reason).toBe("the run's exit gate did not accept completion");
  }, 15000);

  it("never calls a goal achieved while RunContract requirements stay outstanding", () => {
    const open: GoalSegmentResult = { output: "all DONE", run: { goalAchieved: null, outstanding: ["req-1"] } };
    expect(evaluateGoal(mk(), open).state.status).toBe("active");
  }, 15000);

  it("an exit-gate denial also vetoes a tier-2 rubric 'achieved'", () => {
    const s = mk({ criteria: [{ id: "r", text: "good", check: { kind: "rubric" } }] });
    const ev = evaluateGoal(s, { output: "x", run: { goalAchieved: false } }, { rubricVerdict: "achieved" });
    expect(ev.state.status).toBe("active");
  }, 15000);

  it("criteria still decide when the run accepts (or is undecided with nothing outstanding)", () => {
    expect(evaluateGoal(mk(), { output: "all DONE", run: { goalAchieved: true } }).state.status).toBe("achieved");
    expect(evaluateGoal(mk(), { output: "all DONE", run: { goalAchieved: null, outstanding: [] } }).state.status).toBe(
      "achieved",
    );
  }, 15000);
});

describe("goal supervisor: progress authority is RunAssessment.evidenceDelta", () => {
  it("a meta-only turn (evidenceDelta 0) is not progress, whatever the caller's flag says", () => {
    let s = mk();
    const metaOnly: GoalSegmentResult = { output: "no", progressed: true, run: { goalAchieved: null, evidenceDelta: 0 } };
    s = evaluateGoal(s, metaOnly).state;
    expect(s.noDeltaStreak).toBe(1);
    s = evaluateGoal(s, metaOnly).state;
    expect(s.status).toBe("stalled");
  }, 15000);

  it("new evidence resets the no-delta streak even when the caller flag is false", () => {
    const s = evaluateGoal(mk({ noDeltaStreak: 1 }), {
      output: "no",
      progressed: false,
      run: { goalAchieved: null, evidenceDelta: 2 },
    }).state;
    expect(s.noDeltaStreak).toBe(0);
  }, 15000);

  it("pursueGoal stalls a run of meta-only turns", async () => {
    const r = await pursueGoal({
      state: mk(),
      runSegment: async () => ({ output: "no", progressed: true, run: { goalAchieved: null, evidenceDelta: 0 } }),
    });
    expect(r.state.status).toBe("stalled");
  }, 15000);
});

describe("goalRunOf", () => {
  it("maps an AgentResult slice and sums AssessmentEmitted evidenceDelta", () => {
    const run = goalRunOf({ goalAchieved: false, metadata: { outstandingCriteria: ["a"] } }, [
      { _tag: "AssessmentEmitted", evidenceDelta: 1 },
      { _tag: "ToolCallCompleted" },
      { _tag: "AssessmentEmitted", evidenceDelta: 2 },
    ]);
    expect(run).toEqual({ goalAchieved: false, outstanding: ["a"], evidenceDelta: 3 });
  }, 15000);

  it("leaves progress undecided without events and treats a missing goalAchieved as null", () => {
    expect(goalRunOf({})).toEqual({ goalAchieved: null });
    expect(goalRunOf({}, [])).toEqual({ goalAchieved: null, evidenceDelta: 0 });
  }, 15000);
});
