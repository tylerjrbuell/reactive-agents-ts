import { describe, expect, it } from "bun:test";
import { duplicateAccounts, duplicateSentence, liveChannelView } from "./channel-hub-view.js";
import type { HubChannelLive } from "./channel-hub-api.js";

const live = (over: Partial<HubChannelLive> = {}): HubChannelLive => ({ id: "ch-a", state: "connected", error: null, reason: null, conflict: false, received: 0, sent: 0, failed: 0, ...over });

describe("liveChannelView", () => {
  it("off wins over everything", () => expect(liveChannelView("ch-a", live({ state: "failed" }), false, 1)).toMatchObject({ tone: "stopped", label: "Off" }));
  it("connected is the running tone", () => expect(liveChannelView("ch-a", live(), true, 1)).toMatchObject({ tone: "running", label: "Connected", problem: null }));
  it("a failure carries the sanitized message", () => {
    const v = liveChannelView("ch-a", live({ state: "failed", error: { kind: "auth", message: "bad token" } }), true, 1);
    expect(v).toMatchObject({ tone: "failed", problem: "bad token" });
  });
  it("a conflict says another program polls the account", () => {
    expect(liveChannelView("ch-a", live({ conflict: true }), true, 1).problem).toContain("Another program");
  });
  it("idle with no route says so", () => expect(liveChannelView("ch-a", live({ state: "idle" }), true, 0).label).toBe("No route yet"));
  it("shows who holds the account", () => {
    expect(liveChannelView("ch-a", live(), true, 1, [{ channelId: "ch-a", pid: 42 }]).lease.label).toContain("pid 42");
    expect(liveChannelView("ch-a", live(), true, 1, []).lease.label).toBe("No account lease");
  });
});

describe("duplicate accounts", () => {
  const err = "Another process (pid 7) already owns the account behind channel ch-b.";
  it("links the refused channel to the lease holder that is another channel", () => {
    const d = duplicateAccounts(err, [{ channelId: "ch-a", pid: 7 }]).get("ch-b");
    expect(d).toEqual({ ownerChannelId: "ch-a", ownerPid: 7 });
    expect(duplicateSentence(d!, "Support bot")).toContain("Support bot");
  });
  it("without a holder row it still says another process uses it", () => {
    const d = duplicateAccounts(err, []).get("ch-b");
    expect(d).toEqual({ ownerChannelId: null, ownerPid: null });
    expect(duplicateSentence(d!, null)).toContain("Another process");
  });
  it("another error is not a duplicate", () => expect(duplicateAccounts("channel_start_failed: x", []).size).toBe(0));
  it("no error, no duplicates", () => expect(duplicateAccounts(null, []).size).toBe(0));
});
