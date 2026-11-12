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
  received: 0, sent: 0, failed: 0, lastInboundAt: null, lastSentAt: null, lastFailure: null, ...over,
});

const agent = (channels: ChannelStatusRow[], phase: GatewayAgentStatus["gateway"]["phase"] = "running"): GatewayAgentStatus => ({
  agentId: "gateway-1", name: "Bot", status: "active", schedule: null, runCount: 0, lastRunAt: null, processRunning: false, lastFiredAt: null,
  access: { mode: "deny-all", allowed: 0, blocked: 0 },
  gateway: { phase, error: null, startedAt: null, channels, schedules: [], queue: { ready: 0, deferred: 0, dropped: 0, capacity: null, overflow: null }, denied: 0, activity: [], stats: null },
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
  const q = { ready: 0, deferred: 0, dropped: 0, capacity: null, overflow: null };
  it("is null while the gateway is not running", () => {
    expect(queueSentence({ ...q, ready: 2 }, false)).toBeNull();
  });
  it("shows live depth (ready + deferred) against capacity, and drops only when there are some", () => {
    expect(queueSentence({ ...q, capacity: 7 }, true)).toBe("0 of 7 waiting");
    expect(queueSentence({ ...q, ready: 1, deferred: 1, capacity: 7, dropped: 3 }, true)).toBe("2 of 7 waiting (1 ready, 1 deferred), 3 dropped");
    expect(queueSentence({ ...q, deferred: 4 }, true)).toBe("4 waiting (4 deferred)");
  });
  it("states a known limit, and nothing when none is known", () => {
    expect(queueLimit(q)).toBeNull();
    expect(queueLimit({ ...q, capacity: 7, overflow: "drop-newest" })).toBe("holds 7, drops the newest when full");
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
