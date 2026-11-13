import { describe, expect, it } from "bun:test";
import { RESET_MAX_COMMANDS, resetDraftFromWire, resetProblems, resetSummary, resetWireFromDraft } from "./channel-reset-commands.js";
import { draftFromRoute, draftProblems, newDraft, routeFromDraft, type HubRouteWire } from "./channel-hub.js";
import { routePatch } from "./channel-hub-api.js";

describe("reset commands: three states", () => {
  it("absent = default (blank, not off), [] = off, a list = those commands", () => {
    expect(resetDraftFromWire(undefined)).toEqual({ resetCommands: "", resetOff: false });
    expect(resetDraftFromWire([])).toEqual({ resetCommands: "", resetOff: true });
    expect(resetDraftFromWire(["/fresh", "/clear"])).toEqual({ resetCommands: "/fresh\n/clear", resetOff: false });
    expect(resetWireFromDraft({ resetCommands: "", resetOff: false })).toBeUndefined();
    expect(resetWireFromDraft({ resetCommands: "/x", resetOff: true })).toEqual([]);
    expect(resetWireFromDraft({ resetCommands: "/fresh\n /clear , /x", resetOff: false })).toEqual(["/fresh", "/clear", "/x"]);
  });
  it("mirrors the framework limits in words", () => {
    expect(resetProblems({ resetCommands: "/new", resetOff: false })).toEqual([]);
    expect(resetProblems({ resetCommands: "new", resetOff: false })[0]).toContain("Start with a slash");
    expect(resetProblems({ resetCommands: "/has space", resetOff: false }).length).toBeGreaterThan(0);
    expect(resetProblems({ resetCommands: "/a\n/b\n/c\n/d\n/e\n/f", resetOff: false })[0]).toContain(`${RESET_MAX_COMMANDS}`);
    expect(resetProblems({ resetCommands: "bad", resetOff: true })).toEqual([]);
  });
  it("says what resets the route", () => {
    expect(resetSummary(undefined)).toBe("Owners reset with /new or /reset.");
    expect(resetSummary([])).toContain("cannot");
  });
});

describe("reset commands in the route draft", () => {
  const saved: HubRouteWire = { id: "r1", match: { channelId: "ch-1" }, target: { agentId: "gw-1" }, owners: ["telegram:1"] };

  it("a route without them stays without them (the default is not written)", () => {
    expect("resetCommands" in routeFromDraft(draftFromRoute(saved), saved)).toBe(false);
  });
  it("a saved list round-trips, and an off route writes []", () => {
    const withList: HubRouteWire = { ...saved, resetCommands: ["/fresh"] };
    expect(routeFromDraft(draftFromRoute(withList), withList).resetCommands).toEqual(["/fresh"]);
    const d = draftFromRoute(saved);
    d.resetOff = true;
    expect(routeFromDraft(d, saved).resetCommands).toEqual([]);
  });
  it("clearing the field on a saved route sends null so the server drops it", () => {
    const withList: HubRouteWire = { ...saved, resetCommands: ["/fresh"] };
    const d = draftFromRoute(withList);
    d.resetCommands = "";
    const next = routeFromDraft(d, withList);
    expect("resetCommands" in next).toBe(false);
    expect(routePatch(withList, next).resetCommands).toBeNull();
  });
  it("a bad command blocks the save", () => {
    const d = newDraft("ch-1", "gw-1");
    d.id = "r2";
    d.resetCommands = "new";
    expect(draftProblems(d, true).some((p) => p.includes("slash"))).toBe(true);
  });
});
