import { describe, expect, it } from "bun:test";
import {
  accessLine,
  activityLabel,
  connectionView,
  hostView,
  nextFireLabel,
  overviewTotals,
  queueLimit,
  queueSentence,
  runView,
  when,
  type GatewayAgentStatus,
  type ChannelStatusRow,
} from "./gateway-overview.js";

const row = (over: Partial<ChannelStatusRow> = {}): ChannelStatusRow => ({
  id: "ch-1", kind: "telegram", label: null, enabled: true, state: "connected", error: null, reason: null,
  received: 0, sent: 0, failed: 0, lastEventAt: null, lastFailure: null, ...over,
});

const agent = (channels: ChannelStatusRow[], phase: GatewayAgentStatus["gateway"]["phase"] = "running"): GatewayAgentStatus => ({
  agentId: "gateway-1", name: "Bot", status: "active", schedule: null, runCount: 0, lastRunAt: null, processRunning: false, lastFiredAt: null,
  access: { mode: "deny-all", allowed: 0, blocked: 0 },
  gateway: { phase, error: null, startedAt: null, channels, schedules: [], queue: { queued: 0, deferred: 0, dropped: 0, capacity: null, overflow: null }, denied: 0, activity: [], stats: null },
});

describe("connectionView", () => {
  it("labels every state in words, not only colour", () => {
    expect(connectionView(row({ state: "connected" }))).toEqual({ tone: "running", label: "Connected" });
    expect(connectionView(row({ state: "reconnecting" })).label).toBe("Reconnecting");
    expect(connectionView(row({ state: "failed" }))).toEqual({ tone: "failed", label: "Failed" });
    expect(connectionView(row({ state: "skipped" })).label).toBe("Not started");
    expect(connectionView(row({ state: "not-started" })).label).toBe("Not running");
  });
  it("a disabled channel reads Off whatever its state", () => {
    expect(connectionView(row({ enabled: false, state: "failed" }))).toEqual({ tone: "stopped", label: "Off" });
  });
});

describe("hostView / runView / activityLabel", () => {
  it("names the host phases", () => {
    expect(hostView("running").label).toBe("Listening");
    expect(hostView("idle").label).toBe("No channels running");
    expect(hostView("failed").tone).toBe("failed");
  });
  it("maps the framework's run statuses", () => {
    expect(runView("succeeded")).toEqual({ tone: "done", label: "Done" });
    expect(runView("failed").tone).toBe("failed");
    expect(runView("running").tone).toBe("running");
    expect(runView("weird")).toEqual({ tone: "idle", label: "weird" });
  });
  it("marks drops and send failures as bad", () => {
    expect(activityLabel("dropped").tone).toBe("bad");
    expect(activityLabel("failed").tone).toBe("bad");
    expect(activityLabel("sent").tone).toBe("ok");
  });
});

describe("nextFireLabel", () => {
  const now = 1_000_000;
  it("paused, none, due, minutes, hours, days", () => {
    expect(nextFireLabel({ enabled: false, nextFireAt: now + 1 }, now)).toBe("Paused");
    expect(nextFireLabel({ enabled: true, nextFireAt: null }, now)).toBe("No upcoming run");
    expect(nextFireLabel({ enabled: true, nextFireAt: now - 5 }, now)).toBe("Due now");
    expect(nextFireLabel({ enabled: true, nextFireAt: now + 30_000 }, now)).toBe("in under a minute");
    expect(nextFireLabel({ enabled: true, nextFireAt: now + 12 * 60_000 }, now)).toBe("in 12 minutes");
    expect(nextFireLabel({ enabled: true, nextFireAt: now + 3 * 3_600_000 }, now)).toBe("in 3 hours");
    expect(nextFireLabel({ enabled: true, nextFireAt: now + 5 * 86_400_000 }, now)).toBe("in 5 days");
  });
});

describe("queue text", () => {
  it("is null until something queued, and lists only non-zero counts", () => {
    const q = { queued: 0, deferred: 0, dropped: 0, capacity: null, overflow: null };
    expect(queueSentence(q)).toBeNull();
    expect(queueSentence({ ...q, queued: 3, dropped: 1 })).toBe("3 queued, 1 dropped");
  });
  it("states a configured limit, and nothing when Cortex set none", () => {
    expect(queueLimit({ queued: 0, deferred: 0, dropped: 0, capacity: null, overflow: null })).toBeNull();
    expect(queueLimit({ queued: 0, deferred: 0, dropped: 0, capacity: 7, overflow: "drop-newest" })).toBe("holds 7, drops the newest when full");
  });
});

describe("overviewTotals / accessLine / when", () => {
  it("counts listening agents, connected channels and problems; ignores disabled channels", () => {
    const t = overviewTotals([
      agent([row({ state: "connected" }), row({ id: "ch-2", state: "failed" }), row({ id: "ch-3", enabled: false, state: "failed" })]),
      agent([row({ id: "ch-4", state: "skipped" })], "failed"),
    ]);
    expect(t).toEqual({ agents: 2, listening: 1, connected: 1, problems: 3 });
  });
  it("accessLine states the fail-closed default", () => {
    expect(accessLine({ mode: "deny-all", allowed: 0, blocked: 0 })).toContain("Nobody can message");
  });
  it("when reads never for a missing time", () => {
    expect(when(null)).toBe("never");
    expect(when(undefined)).toBe("never");
  });
});
