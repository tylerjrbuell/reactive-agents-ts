import { describe, test, expect } from "bun:test";
import {
  parseCron,
  shouldFireAt,
  getDateInTimezone,
} from "../../src/services/cron-parser.js";

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
    expect(cron!.minutes).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);

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

  describe("timezone-aware evaluation", () => {
    test("getDateInTimezone converts UTC to America/New_York correctly", () => {
      // 2026-03-02T14:00:00Z = 9:00 AM EST (UTC-5) on Monday
      const utcDate = new Date("2026-03-02T14:00:00Z");
      const estDate = getDateInTimezone(utcDate, "America/New_York");

      expect(estDate.hour).toBe(9); // 9:00 AM
      expect(estDate.minute).toBe(0);
      expect(estDate.day).toBe(2); // March 2
      expect(estDate.month).toBe(3); // March
      expect(estDate.dayOfWeek).toBe(1); // Monday
    });

    test("shouldFireAt with timezone: 9:00 AM EST Mon-Fri in UTC time", () => {
      const cron = parseCron("0 9 * * 1-5");
      expect(cron).not.toBeNull();

      // 2026-03-02T14:00:00Z = Monday 9:00 AM EST (UTC-5)
      const mondayMorning = new Date("2026-03-02T14:00:00Z");
      expect(shouldFireAt(cron!, mondayMorning, "America/New_York")).toBe(true);

      // 2026-03-02T14:01:00Z = Monday 9:01 AM EST (should NOT fire, minute is 1)
      const mondayMorningPlus1 = new Date("2026-03-02T14:01:00Z");
      expect(shouldFireAt(cron!, mondayMorningPlus1, "America/New_York")).toBe(
        false,
      );

      // 2026-03-02T13:00:00Z = Monday 8:00 AM EST (should NOT fire, hour is 8)
      const mondayEarlier = new Date("2026-03-02T13:00:00Z");
      expect(shouldFireAt(cron!, mondayEarlier, "America/New_York")).toBe(
        false,
      );
    });

    test("shouldFireAt respects day-of-week in timezone", () => {
      const cron = parseCron("0 14 * * 1"); // 2:00 PM Monday
      expect(cron).not.toBeNull();

      // 2026-03-02T14:00:00Z = Monday 9:00 AM EST
      // Hour in EST is 9, not 14, so should NOT fire
      const mondayMorning = new Date("2026-03-02T14:00:00Z");
      expect(shouldFireAt(cron!, mondayMorning, "America/New_York")).toBe(
        false,
      );

      // 2026-03-02T19:00:00Z = Monday 2:00 PM EST (19:00 UTC = 14:00 EST)
      // Hour in EST is 14, day is Monday
      const mondayAfternoon = new Date("2026-03-02T19:00:00Z");
      expect(shouldFireAt(cron!, mondayAfternoon, "America/New_York")).toBe(
        true,
      );
    });

    test("shouldFireAt skips Saturday when specifying Mon-Fri (1-5)", () => {
      const cron = parseCron("0 9 * * 1-5"); // 9:00 AM Mon-Fri
      expect(cron).not.toBeNull();

      // 2026-03-07T14:00:00Z = Saturday 9:00 AM EST
      const saturdayMorning = new Date("2026-03-07T14:00:00Z");
      expect(shouldFireAt(cron!, saturdayMorning, "America/New_York")).toBe(
        false,
      );

      // 2026-03-06T14:00:00Z = Friday 9:00 AM EST
      const fridayMorning = new Date("2026-03-06T14:00:00Z");
      expect(shouldFireAt(cron!, fridayMorning, "America/New_York")).toBe(true);
    });

    test("shouldFireAt fires on Saturday with dayOfWeek=6", () => {
      const cron = parseCron("0 10 * * 6"); // 10:00 AM Saturday
      expect(cron).not.toBeNull();

      // 2026-03-07T14:00:00Z = Saturday 9:00 AM EST (hour 9, not 10)
      const saturdayEarly = new Date("2026-03-07T14:00:00Z");
      expect(shouldFireAt(cron!, saturdayEarly, "America/New_York")).toBe(
        false,
      );

      // 2026-03-07T15:00:00Z = Saturday 10:00 AM EST
      const saturdayMorning = new Date("2026-03-07T15:00:00Z");
      expect(shouldFireAt(cron!, saturdayMorning, "America/New_York")).toBe(
        true,
      );

      // 2026-03-02T14:00:00Z = Monday (not Saturday)
      const monday = new Date("2026-03-02T14:00:00Z");
      expect(shouldFireAt(cron!, monday, "America/New_York")).toBe(false);
    });

    test("shouldFireAt with UTC returns same result as no timezone", () => {
      const cron = parseCron("0 9 * * 1");
      expect(cron).not.toBeNull();

      // 2026-03-02T09:00:00Z = Monday 9:00 AM UTC
      const mondayUtc = new Date("2026-03-02T09:00:00Z");

      const withoutTz = shouldFireAt(cron!, mondayUtc);
      const withUtcTz = shouldFireAt(cron!, mondayUtc, "UTC");

      expect(withoutTz).toBe(withUtcTz);
      expect(withoutTz).toBe(true);
    });

    test("shouldFireAt with invalid timezone falls back to UTC", () => {
      const cron = parseCron("0 9 * * 1");
      expect(cron).not.toBeNull();

      // 2026-03-02T09:00:00Z = Monday 9:00 AM UTC
      const mondayUtc = new Date("2026-03-02T09:00:00Z");

      const withInvalidTz = shouldFireAt(cron!, mondayUtc, "Invalid/Timezone");
      const withoutTz = shouldFireAt(cron!, mondayUtc);

      expect(withInvalidTz).toBe(withoutTz);
      expect(withInvalidTz).toBe(true);
    });

    test("11:30 AM cron fires at correct time in America/New_York", () => {
      const cron = parseCron("30 11 * * 1-5"); // 11:30 AM Mon-Fri
      expect(cron).not.toBeNull();

      // 2026-03-02T16:30:00Z = Monday 11:30 AM EST (16:30 UTC = 11:30 EST)
      const mondayMid = new Date("2026-03-02T16:30:00Z");
      expect(shouldFireAt(cron!, mondayMid, "America/New_York")).toBe(true);

      // One minute earlier should NOT fire
      const mondayMidMinus1 = new Date("2026-03-02T16:29:00Z");
      expect(shouldFireAt(cron!, mondayMidMinus1, "America/New_York")).toBe(
        false,
      );
    });

    test("5:00 PM cron fires at correct time in America/New_York", () => {
      const cron = parseCron("0 17 * * 1-5"); // 5:00 PM Mon-Fri
      expect(cron).not.toBeNull();

      // 2026-03-02T22:00:00Z = Monday 5:00 PM EST (22:00 UTC = 17:00 EST)
      const mondayEvening = new Date("2026-03-02T22:00:00Z");
      expect(shouldFireAt(cron!, mondayEvening, "America/New_York")).toBe(true);

      // Wrong hour should NOT fire
      const mondayLater = new Date("2026-03-02T23:00:00Z");
      expect(shouldFireAt(cron!, mondayLater, "America/New_York")).toBe(false);
    });

    test("9:30 AM Monday cron fires correctly", () => {
      const cron = parseCron("30 9 * * 1"); // 9:30 AM Monday
      expect(cron).not.toBeNull();

      // 2026-03-02T14:30:00Z = Monday 9:30 AM EST
      const mondayMorning = new Date("2026-03-02T14:30:00Z");
      expect(shouldFireAt(cron!, mondayMorning, "America/New_York")).toBe(true);

      // Tuesday at same time should NOT fire
      const tuesdayMorning = new Date("2026-03-03T14:30:00Z");
      expect(shouldFireAt(cron!, tuesdayMorning, "America/New_York")).toBe(
        false,
      );
    });

    test("DST transition: EST to EDT (March 2026)", () => {
      // 2026-03-08 02:00:00 EST becomes 2026-03-08 03:00:00 EDT
      // Before DST (March 2): America/New_York is UTC-5 (EST)
      // After DST (March 9): America/New_York is UTC-4 (EDT)

      const cron = parseCron("0 9 * * 0-6"); // 9:00 AM every day
      expect(cron).not.toBeNull();

      // During EST (March 2): 9:00 AM EST = 14:00 UTC
      const estDate = new Date("2026-03-02T14:00:00Z");
      const estResult = getDateInTimezone(estDate, "America/New_York");
      expect(estResult.hour).toBe(9);

      // During EDT (March 15): 9:00 AM EDT = 13:00 UTC
      const edtDate = new Date("2026-03-15T13:00:00Z");
      const edtResult = getDateInTimezone(edtDate, "America/New_York");
      expect(edtResult.hour).toBe(9);

      // Both should fire the 9:00 AM cron
      expect(shouldFireAt(cron!, estDate, "America/New_York")).toBe(true);
      expect(shouldFireAt(cron!, edtDate, "America/New_York")).toBe(true);
    });
  });
});
