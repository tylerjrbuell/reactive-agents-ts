import { describe, expect, it } from "bun:test";
import { hubAccessFor, hubActivityFor, hubChannelState, hubHostPhase, mergeActivity } from "../services/gateway-hub-overlay.js";
import type { HubChannelView, HubRouteView, HubStatus } from "../services/channel-hub.js";
import type { CortexChannelEntry } from "../services/channel-config.js";

const entry: CortexChannelEntry = { id: "ch-1", kind: "telegram", label: "CortexBot", enabled: true, settings: {} };

const view = (over: Partial<HubChannelView> = {}): HubChannelView => ({
  id: "ch-1", platform: "telegram", label: "CortexBot", enabled: true, state: "connected", error: null, reason: null, conflict: false,
  received: 4, sent: 3, failed: 1, countsFrom: "restart", lastInboundAt: 1000, lastSentAt: 2000, migratedFrom: null, ...over,
});

const route = (over: Partial<HubRouteView> = {}): HubRouteView => ({
  id: "r1", channelId: "ch-1", enabled: true, active: true, reason: null, target: { kind: "agent", id: "gw", name: "Bot" },
  access: { open: false, allow: 0, deny: 0, owners: 1 }, senderTools: "ReadOnly", session: "per-conversation", roleNote: null,
  counters: { matched: 2, denied: 1, answered: 2, failed: 0, dropped: 0, costUsd: 0 }, migratedFrom: null, ...over,
});

const hub = (over: Partial<HubStatus> = {}): HubStatus => ({
  enabled: true, phase: "running", error: null, startedAt: 500, durableStore: true, activityFrom: "stored", channels: [view()], routes: [route()], rejected: [], leases: [],
  router: null, activity: [], migration: { warnings: [], legacy: [] }, ...over,
});

describe("hub-hosted channel on the Gateway overview", () => {
  it("a connected hub channel reads connected with the hub's counters, not 'Not started' and zeros", () => {
    expect(hubChannelState(entry, view())).toMatchObject({
      state: "connected", received: 4, sent: 3, failed: 1, lastInboundAt: 1000, lastSentAt: 2000, error: null, reason: expect.stringContaining("channel hub"),
    });
  });

  it("a failing hub channel carries its error; an enabled channel with no route is 'not-started' with the hub's reason", () => {
    const failed = hubChannelState(entry, view({ state: "failed", error: { kind: "auth", message: "bad token" } }));
    expect(failed).toMatchObject({ state: "failed", error: { kind: "auth" }, lastFailure: "auth" });
    expect(hubChannelState(entry, view({ state: "idle", reason: "No enabled route points at this channel." }))).toMatchObject({ state: "not-started", reason: "No enabled route points at this channel." });
  });

  it("a channel the hub has no view of yet says where its state lives instead of failing", () => {
    expect(hubChannelState(entry, undefined)).toMatchObject({ state: "not-started", reason: expect.stringContaining("channel hub"), received: 0 });
  });

  it("an agent with only hub channels listens when the hub runs; its own running host is left alone", () => {
    const idle = { phase: "idle", error: null, startedAt: null } as const;
    expect(hubHostPhase(idle, 1, hub())).toEqual({ phase: "running", error: null, startedAt: 500 });
    expect(hubHostPhase(idle, 1, hub({ phase: "failed", error: "boom" }))).toMatchObject({ phase: "failed", error: "boom" });
    expect(hubHostPhase(idle, 0, hub())).toEqual(idle);
    expect(hubHostPhase({ phase: "running", error: null, startedAt: 9 }, 1, hub())).toEqual({ phase: "running", error: null, startedAt: 9 });
  });

  it("the feed shows the hub's real traffic for the agent's channels, newest first, never a simulated message", () => {
    const status = hub({
      activity: [
        { at: 30, kind: "answered", routeId: "r1", detail: "turn completed (owner)", simulated: false },
        { at: 20, kind: "matched", channelId: "ch-1", routeId: "r1", detail: "sender is owner", simulated: false },
        { at: 10, kind: "matched", channelId: "ch-1", routeId: "r1", detail: "sender is owner", simulated: true },
        { at: 5, kind: "answered", routeId: "other", detail: "turn completed (owner)", simulated: false },
      ],
    });
    const lines = hubActivityFor(status, new Set(["ch-1"]));
    expect(lines.map((l) => [l.at, l.kind])).toEqual([[30, "sent"], [20, "received"]]);
    expect(mergeActivity([{ at: 25, kind: "queued", detail: "x" }], lines).map((l) => l.at)).toEqual([30, 25, 20]);
  });

  it("access comes from the routes that target the agent, not its stale own allowlist; webhook routes say nothing", () => {
    const own = { mode: "deny-all", allowed: 0, blocked: 0 } as const;
    expect(hubAccessFor("gw", hub(), own)).toEqual({ mode: "allowlist", allowed: 1, blocked: 0 });
    expect(hubAccessFor("gw", hub({ routes: [route({ access: { open: true, allow: 0, deny: 0, owners: 0 } })] }), own).mode).toBe("open");
    expect(hubAccessFor("gw", hub({ routes: [route({ access: { open: false, allow: 0, deny: 0, owners: 0 } })] }), own).mode).toBe("deny-all");
    expect(hubAccessFor("gw", hub({ channels: [view({ platform: "webhook" })] }), { mode: "allowlist", allowed: 2, blocked: 0 })).toEqual({ mode: "allowlist", allowed: 2, blocked: 0 });
    expect(hubAccessFor("someone-else", hub(), own)).toEqual(own);
  });
});
