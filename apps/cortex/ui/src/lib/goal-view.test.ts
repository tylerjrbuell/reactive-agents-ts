import { describe, expect, test } from "bun:test";
import { goalView, parseGoalArg, parseLoopArg, parseScheduleArg, scheduleLabel, shouldPoll, verdictText, type GoalWire } from "./goal-view.js";

const goal = (over: Partial<GoalWire> = {}): GoalWire => ({
  id: "g1",
  objective: "ship it",
  criteria: [{ id: "c1", text: "tests pass", check: { kind: "rubric" } }],
  budget: { maxSegments: 5, maxCostUsd: 1 },
  status: "active",
  segments: 2,
  spent: { costUsd: 0.25, tokens: 100, wallClockMs: 10 },
  verdictHistory: [],
  ...over,
});

describe("goal arg parsing", () => {
  test("control words only when whole argument", () => {
    expect(parseGoalArg("")).toEqual({ kind: "usage" });
    expect(parseGoalArg("Pause")).toEqual({ kind: "pause" });
    expect(parseGoalArg("status")).toEqual({ kind: "status" });
    expect(parseGoalArg("pause the build and ship")).toEqual({ kind: "propose", objective: "pause the build and ship" });
  });
  test("loop", () => {
    expect(parseLoopArg("5m check the deploy")).toEqual({ kind: "start", spec: "5m", prompt: "check the deploy" });
    expect(parseLoopArg("1H  go\nnow")).toEqual({ kind: "start", spec: "1h", prompt: "go\nnow" });
    expect(parseLoopArg("stop")).toEqual({ kind: "stop" });
    expect(parseLoopArg("5x nope")).toEqual({ kind: "usage" });
    expect(parseLoopArg("5m")).toEqual({ kind: "usage" });
  });
  test("schedule", () => {
    expect(parseScheduleArg('"0 9 * * 1-5" summarise news')).toEqual({ kind: "create", cron: "0 9 * * 1-5", prompt: "summarise news" });
    expect(parseScheduleArg("'*/5 * * * *' ping")).toMatchObject({ kind: "create", cron: "*/5 * * * *" });
    expect(parseScheduleArg('"0 9 * *" short')).toEqual({ kind: "usage" });
    expect(parseScheduleArg("0 9 * * * unquoted")).toEqual({ kind: "usage" });
    expect(parseScheduleArg("list")).toEqual({ kind: "list" });
    expect(parseScheduleArg("rm abc123")).toEqual({ kind: "remove", id: "abc123" });
  });
});

describe("goalView", () => {
  test("polls only while proposed/active", () => {
    expect(shouldPoll("proposed")).toBe(true);
    expect(shouldPoll("active")).toBe(true);
    for (const s of ["paused", "achieved", "stalled", "blocked", "budget-exhausted", "cancelled"] as const) expect(shouldPoll(s)).toBe(false);
    expect(shouldPoll(undefined)).toBe(false);
  });
  test("null verdict is 'not yet decided', checker 'achieved' is not the outcome", () => {
    expect(verdictText(goal())).toBe("No segment checked yet");
    expect(verdictText(goal({ verdictHistory: [null] }))).toContain("not yet decided");
    expect(verdictText(goal({ verdictHistory: ["achieved"] }))).not.toBe("Achieved");
    expect(verdictText(goal({ status: "achieved", verdictHistory: ["achieved"] }))).toBe("Achieved");
  });
  test("criteria are undecided unless the goal is achieved", () => {
    expect(goalView(goal()).criteria[0]).toMatchObject({ state: "undecided", stateText: "not yet decided" });
    expect(goalView(goal({ status: "achieved" })).criteria[0]?.state).toBe("met");
  });
  test("meters and actions", () => {
    const v = goalView(goal());
    expect(v.meters[0]).toEqual({ label: "Segments", text: "2/5", pct: 40 });
    expect(v.meters[1]).toEqual({ label: "Cost", text: "$0.25/$1.00", pct: 25 });
    expect(v.actions).toEqual(["pause", "cancel"]);
    expect(goalView(goal({ status: "proposed" })).actions).toEqual(["accept", "cancel"]);
    expect(goalView(goal({ status: "paused" })).actions).toEqual(["resume", "cancel"]);
    expect(goalView(goal({ status: "budget-exhausted" })).terminal).toBe(true);
    expect(goalView(goal({ budget: { maxSegments: 5 } })).meters[1]).toEqual({ label: "Cost", text: "$0.25", pct: null });
    expect(goalView(goal({ status: "stalled" })).actions).toEqual(["resume", "cancel"]);
    expect(goalView(goal({ status: "blocked" })).actions).toEqual(["resume", "cancel"]);
    expect(goalView(goal({ status: "stalled" })).terminal).toBe(false);
    expect(goalView(goal({ status: "budget-exhausted" })).actions).toEqual([]);
  });

  test("unknown cost says so instead of showing a misleading meter", () => {
    const v = goalView(goal({ costKnown: false, spent: { costUsd: 0, tokens: 1200, wallClockMs: 0 }, budget: { maxSegments: 5, maxCostUsd: 1, maxTokens: 200000 } }));
    expect(v.meters[1]).toEqual({ label: "Cost", text: "cost unknown", pct: null });
    expect(v.meters[2]).toEqual({ label: "Tokens", text: "1200/200000", pct: 1 });
    expect(goalView(goal({ costKnown: true })).meters[1]?.text).toBe("$0.25/$1.00");
    expect(goalView(goal()).meters[1]?.text).toBe("$0.25/$1.00"); // absent flag (older server) = known
  });
  test("schedule label", () => {
    expect(scheduleLabel({ id: "s", kind: "loop", spec: "5m", prompt: "hi", expiresAt: 0, runs: 0, lastStatus: null })).toBe("every 5m: hi");
  });
});
