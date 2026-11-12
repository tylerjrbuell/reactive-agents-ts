import { describe, expect, it } from "bun:test";
import { addCron, cronProblem, removeCron, setCronEnabled, withQueue } from "./gateway-schedules.js";

describe("cronProblem", () => {
  it("accepts five-field expressions with numbers, lists, ranges, steps and names", () => {
    for (const ok of ["0 9 * * 1", "*/10 * * * *", "0 9-17 * * 1-5", "30 8 1,15 * *", "0 9 * * MON", "0 0 1 JAN *"]) expect(cronProblem(ok)).toBeNull();
  });
  it("refuses blank, wrong field counts and junk", () => {
    expect(cronProblem("")).toContain("Enter a cron expression");
    expect(cronProblem("0 9 * *")).toContain("five fields");
    expect(cronProblem("0 9 * * * *")).toContain("five fields");
    expect(cronProblem("every day * * x")).toContain("Each field");
  });
});

describe("cron list edits", () => {
  it("adds a normalised schedule and keeps the rest of the block", () => {
    const r = addCron({ queue: { capacity: 5 } }, { schedule: "  0   9 * * 1 ", instruction: " Weekly digest " });
    expect(r).toEqual({ gateway: { queue: { capacity: 5 }, crons: [{ schedule: "0 9 * * 1", instruction: "Weekly digest" }] } });
  });
  it("returns the problem for a bad expression or an empty instruction", () => {
    expect(addCron(undefined, { schedule: "nope", instruction: "x" })).toHaveProperty("problem");
    expect(addCron(undefined, { schedule: "0 9 * * 1", instruction: "  " })).toEqual({ problem: "Say what the agent should do when it fires." });
  });
  it("removing the last schedule drops crons and an empty block", () => {
    const g = { crons: [{ schedule: "0 9 * * 1", instruction: "a" }] };
    expect(removeCron(g, 0)).toBeUndefined();
    expect(removeCron({ ...g, queue: { capacity: 2 } }, 0)).toEqual({ queue: { capacity: 2 } });
  });
  it("pauses a schedule in place", () => {
    const g = { crons: [{ schedule: "0 9 * * 1", instruction: "a" }, { schedule: "0 10 * * 1", instruction: "b" }] };
    expect(setCronEnabled(g, 1, false)?.crons?.[1]).toEqual({ schedule: "0 10 * * 1", instruction: "b", enabled: false });
    expect(setCronEnabled(g, 1, false)?.crons?.[0]?.enabled).toBeUndefined();
  });
});

describe("withQueue", () => {
  it("sets a valid capacity and overflow; ignores a non-positive or fractional capacity", () => {
    expect(withQueue(undefined, { capacity: 20, overflow: "drop-newest" })).toEqual({ queue: { capacity: 20, overflow: "drop-newest" } });
    expect(withQueue(undefined, { capacity: 0 })).toBeUndefined();
    expect(withQueue(undefined, { capacity: 2.5 })).toBeUndefined();
  });
  it("clearing both drops the queue and keeps other keys", () => {
    expect(withQueue({ queue: { capacity: 5 }, crons: [{ schedule: "0 9 * * 1", instruction: "a" }] }, {})).toEqual({ crons: [{ schedule: "0 9 * * 1", instruction: "a" }] });
  });
});
