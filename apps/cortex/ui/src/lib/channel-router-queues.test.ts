import { describe, expect, it } from "bun:test";
import { parseOutboxCounts, parseTimerCounts, queueGroups } from "./channel-router-queues.js";

describe("router outbox and timers status", () => {
  const router = { outbox: { pending: 1, sent: 7, failed: 0 }, timers: { pending: 2, fired: 3, cancelled: 1 } };

  it("reads both from the router status", () => {
    expect(parseOutboxCounts(router)).toEqual({ pending: 1, sent: 7, failed: 0 });
    expect(parseTimerCounts(router)).toEqual({ pending: 2, fired: 3, cancelled: 1 });
  });

  it("is null, never zeros, when the router does not report them", () => {
    expect(parseOutboxCounts({})).toBeNull();
    expect(parseTimerCounts(null)).toBeNull();
    expect(parseOutboxCounts({ outbox: { pending: 1, sent: "x", failed: 0 } })).toBeNull();
    expect(parseTimerCounts({ timers: { pending: -1, fired: 0, cancelled: 0 } })).toBeNull();
  });

  it("draws only the groups the router reports", () => {
    expect(queueGroups(null, null)).toEqual([]);
    expect(queueGroups(parseOutboxCounts(router), null).map((g) => g.label)).toEqual(["Outbox"]);
    const both = queueGroups(parseOutboxCounts(router), parseTimerCounts(router));
    expect(both.map((g) => g.label)).toEqual(["Outbox", "Follow-up timers"]);
    expect(both[1]?.rows).toEqual([{ status: "pending", count: 2 }, { status: "fired", count: 3 }, { status: "cancelled", count: 1 }]);
  });
});
