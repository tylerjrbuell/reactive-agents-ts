import { describe, test, expect } from "bun:test";
import { parseCron, shouldFireAt } from "../../src/services/cron-parser.js";

describe("cron-parser", () => {
  test("parses '0 9 * * MON' and fires at Monday 9:00 UTC", () => {
    const cron = parseCron("0 9 * * MON");
    expect(cron).not.toBeNull();
    expect(cron!.minutes).toEqual([0]);
    expect(cron!.hours).toEqual([9]);
    expect(cron!.daysOfWeek).toEqual([1]);

    // Monday 2026-03-02 09:00 UTC (Monday = day 1)
    const monday9am = new Date("2026-03-02T09:00:00Z");
    expect(shouldFireAt(cron!, monday9am)).toBe(true);

    // Tuesday 2026-03-03 09:00 UTC — should NOT fire
    const tuesday9am = new Date("2026-03-03T09:00:00Z");
    expect(shouldFireAt(cron!, tuesday9am)).toBe(false);
  });

  test("rejects invalid expression", () => {
    expect(parseCron("invalid")).toBeNull();
    expect(parseCron("* * *")).toBeNull(); // too few fields
    expect(parseCron("60 * * * *")).toBeNull(); // minute 60 out of range
    expect(parseCron("* 25 * * *")).toBeNull(); // hour 25 out of range
  });

  test("matches every-5-minutes '*/5 * * * *'", () => {
    const cron = parseCron("*/5 * * * *");
    expect(cron).not.toBeNull();
    expect(cron!.minutes).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);

    // 14:35 UTC — minute 35 is in the list
    const match = new Date("2026-03-01T14:35:00Z");
    expect(shouldFireAt(cron!, match)).toBe(true);

    // 14:37 UTC — minute 37 is NOT in the list
    const noMatch = new Date("2026-03-01T14:37:00Z");
    expect(shouldFireAt(cron!, noMatch)).toBe(false);
  });

  test("matches day-of-month '0 0 1 * *' (midnight on the 1st)", () => {
    const cron = parseCron("0 0 1 * *");
    expect(cron).not.toBeNull();
    expect(cron!.daysOfMonth).toEqual([1]);
    expect(cron!.minutes).toEqual([0]);
    expect(cron!.hours).toEqual([0]);

    // 2026-03-01 00:00 UTC (the 1st, midnight)
    const first = new Date("2026-03-01T00:00:00Z");
    expect(shouldFireAt(cron!, first)).toBe(true);

    // 2026-03-15 00:00 UTC (the 15th) — should NOT fire
    const fifteenth = new Date("2026-03-15T00:00:00Z");
    expect(shouldFireAt(cron!, fifteenth)).toBe(false);
  });
});
