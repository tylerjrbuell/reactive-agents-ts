import { describe, expect, it } from "bun:test";
import { turnLimitDraftFromWire, turnLimitProblems, turnLimitWireFromDraft } from "./channel-turn-limits.js";
import { draftFromRoute, draftProblems, newDraft, routeFromDraft, simulateView, type HubRouteWire } from "./channel-hub.js";
import { routePatch } from "./channel-hub-api.js";

const SAVED: HubRouteWire = { id: "r", match: { channelId: "c" }, target: { agentId: "a" } };

describe("turn limit and failure notice", () => {
  it("blank limit and notice on write nothing (framework defaults)", () => {
    expect(turnLimitWireFromDraft({ turnTimeoutSec: "", failureNotice: true })).toEqual({});
  });
  it("writes seconds as milliseconds and only an opt-out of the notice", () => {
    expect(turnLimitWireFromDraft({ turnTimeoutSec: "90", failureNotice: false })).toEqual({ turnTimeoutMs: 90_000, failureNotice: false });
  });
  it("reads a saved route back to seconds; absent notice = on", () => {
    expect(turnLimitDraftFromWire({ turnTimeoutMs: 45_000 })).toEqual({ turnTimeoutSec: "45", failureNotice: true });
    expect(turnLimitDraftFromWire({ failureNotice: false }).failureNotice).toBe(false);
  });
  it("rejects a limit under one second or not a number", () => {
    expect(turnLimitProblems({ turnTimeoutSec: "0", failureNotice: true })).toHaveLength(1);
    expect(turnLimitProblems({ turnTimeoutSec: "abc", failureNotice: true })).toHaveLength(1);
    expect(turnLimitProblems({ turnTimeoutSec: "", failureNotice: true })).toEqual([]);
    expect(turnLimitProblems({ turnTimeoutSec: "30", failureNotice: true })).toEqual([]);
  });
});

describe("turn limit in the route draft", () => {
  it("round-trips a saved limit and the opt-out", () => {
    const saved = { ...SAVED, turnTimeoutMs: 60_000, failureNotice: false };
    const d = draftFromRoute(saved);
    expect(d.turnTimeoutSec).toBe("60");
    expect(d.failureNotice).toBe(false);
    const wire = routeFromDraft(d, saved);
    expect(wire.turnTimeoutMs).toBe(60_000);
    expect(wire.failureNotice).toBe(false);
  });
  it("clearing the limit sends null so the server drops it", () => {
    const saved = { ...SAVED, turnTimeoutMs: 60_000 };
    const d = { ...draftFromRoute(saved), turnTimeoutSec: "" };
    const next = routeFromDraft(d, saved);
    expect("turnTimeoutMs" in next).toBe(false);
    expect(routePatch(saved, next).turnTimeoutMs).toBeNull();
  });
  it("turning the notice back on clears the saved opt-out", () => {
    const saved = { ...SAVED, failureNotice: false };
    const next = routeFromDraft({ ...draftFromRoute(saved), failureNotice: true }, saved);
    expect(routePatch(saved, next).failureNotice).toBeNull();
  });
  it("a bad limit blocks the save", () => {
    const d = { ...newDraft("c", "a"), id: "r1", turnTimeoutSec: "0" };
    expect(draftProblems(d, true)).toContain("Turn limit must be 1 second or more.");
  });
});

describe("simulate failure wording", () => {
  it("explains turn_timeout in words", () => {
    const v = simulateView({ outcome: "failed", reason: "turn_timeout" });
    expect(v.lines[0]).toContain("turn limit");
  });
});
