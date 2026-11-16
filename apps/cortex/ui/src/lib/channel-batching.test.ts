import { describe, expect, it } from "bun:test";
import { batchingDraftFromWire, batchingProblems, batchingWireFromDraft } from "./channel-batching.js";
import { draftFromRoute, draftProblems, newDraft, routeFromDraft, type HubRouteWire } from "./channel-hub.js";
import { routePatch } from "./channel-hub-api.js";
import { inboxRows, parseInboxCounts } from "./channel-inbox.js";

const SAVED: HubRouteWire = { id: "r", match: { channelId: "c" }, target: { agentId: "a" } };

describe("batch window and mid-run mode", () => {
  it("defaults write nothing (blank or 0 window, queue)", () => {
    expect(batchingWireFromDraft({ batchWindowMs: "", midRun: "queue" })).toEqual({});
    expect(batchingWireFromDraft({ batchWindowMs: "0", midRun: "queue" })).toEqual({});
  });
  it("writes a positive window and a non-default mode", () => {
    expect(batchingWireFromDraft({ batchWindowMs: "1500", midRun: "interrupt" })).toEqual({ batchWindowMs: 1500, midRun: "interrupt" });
  });
  it("reads a saved route back; absent = blank and queue", () => {
    expect(batchingDraftFromWire({ batchWindowMs: 800, midRun: "fold" })).toEqual({ batchWindowMs: "800", midRun: "fold" });
    expect(batchingDraftFromWire({})).toEqual({ batchWindowMs: "", midRun: "queue" });
  });
  it("accepts 0 to 30000 whole numbers, refuses the rest", () => {
    for (const ok of ["", "0", "30000", "250"]) expect(batchingProblems({ batchWindowMs: ok, midRun: "queue" })).toEqual([]);
    for (const bad of ["-1", "30001", "1.5", "abc"]) expect(batchingProblems({ batchWindowMs: bad, midRun: "queue" })).toHaveLength(1);
  });
});

describe("batching in the route draft", () => {
  it("round-trips saved values", () => {
    const saved = { ...SAVED, batchWindowMs: 2000, midRun: "fold" as const };
    const wire = routeFromDraft(draftFromRoute(saved), saved);
    expect(wire.batchWindowMs).toBe(2000);
    expect(wire.midRun).toBe("fold");
  });
  it("clearing sends null so the server drops them", () => {
    const saved = { ...SAVED, batchWindowMs: 2000, midRun: "fold" as const };
    const next = routeFromDraft({ ...draftFromRoute(saved), batchWindowMs: "", midRun: "queue" }, saved);
    const patch = routePatch(saved, next);
    expect(patch.batchWindowMs).toBeNull();
    expect(patch.midRun).toBeNull();
  });
  it("a webhook route never carries them", () => {
    const saved = { ...SAVED, batchWindowMs: 2000, midRun: "fold" as const };
    const wire = routeFromDraft(draftFromRoute(saved), saved, "webhook");
    expect("batchWindowMs" in wire).toBe(false);
    expect("midRun" in wire).toBe(false);
  });
  it("a bad window blocks the save", () => {
    const d = { ...newDraft("c", "a"), id: "r1", batchWindowMs: "99999" };
    expect(draftProblems(d, true).some((p) => p.startsWith("Batch window"))).toBe(true);
  });
});

describe("router inbox status", () => {
  const inbox = { received: 1, running: 2, done: 30, failed: 0, dropped: 4 };
  it("reads the five counts off router status", () => {
    expect(parseInboxCounts({ unrouted: 0, inbox })).toEqual(inbox);
    expect(inboxRows(parseInboxCounts({ inbox })).map((r) => r.status)).toEqual(["received", "running", "done", "failed", "dropped"]);
  });
  it("no inbox (or a malformed one) means the in-memory note", () => {
    expect(parseInboxCounts({ unrouted: 0 })).toBeNull();
    expect(parseInboxCounts(null)).toBeNull();
    expect(parseInboxCounts({ inbox: { received: 1 } })).toBeNull();
    expect(inboxRows(null)).toEqual([]);
  });
});
