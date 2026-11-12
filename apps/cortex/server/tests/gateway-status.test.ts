// Run: bun run repo test apps/cortex/server/tests/gateway-status.test.ts
//
// The event tracker behind the Gateway overview: scripted framework events in, per-channel
// counters, queue counts and a bounded activity list out. Message text is never kept.
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { GatewayEventTracker } from "../services/gateway-status.js";

const tracker = () => new GatewayEventTracker((p) => (p === "telegram" ? "ch-tg" : undefined), () => 1_000);

const received = (over: Partial<Extract<AgentEvent, { _tag: "ChannelMessageReceived" }>> = {}): AgentEvent => ({
  _tag: "ChannelMessageReceived", sender: "42", platform: "telegram", message: "my password is hunter2", timestamp: 10, mcpServer: "", adapterId: "ch-tg", ...over,
});
const suppressed = (policy: string, reason = "queued"): AgentEvent => ({
  _tag: "ProactiveActionSuppressed", agentId: "a", source: "channel", reason, policy, eventId: "e1", timestamp: 20,
});

describe("GatewayEventTracker", () => {
  it("counts received, sent and failed per channel", () => {
    const t = tracker();
    t.observe(received());
    t.observe(received());
    t.observe({ _tag: "ChannelMessageSent", taskId: "t", platform: "telegram", messageId: "1:1", channelId: "42", timestamp: 30 });
    t.observe({ _tag: "ChannelDeliveryFailed", adapterId: "ch-tg", kind: "rate_limited", retryable: true });
    const snap = t.snapshot();
    expect(snap.channels["ch-tg"]).toEqual({ received: 2, sent: 1, failed: 1, lastEventAt: 1_000, lastFailure: "rate_limited" });
  });

  it("attributes a platform-only event through the lookup and ignores an unknown platform", () => {
    const t = tracker();
    t.observe({ _tag: "ChannelMessageSent", taskId: "t", platform: "signal", messageId: "1", channelId: "c", timestamp: 1 });
    expect(Object.keys(t.snapshot().channels)).toEqual([]);
    t.observe({ _tag: "ChannelMessageSent", taskId: "t", platform: "telegram", messageId: "1", channelId: "c", timestamp: 1 });
    expect(t.snapshot().channels["ch-tg"]?.sent).toBe(1);
  });

  it("counts queue activity from ProactiveActionSuppressed by policy", () => {
    const t = tracker();
    t.observe(suppressed("inbound-queue:queued"));
    t.observe(suppressed("inbound-queue:queued"));
    t.observe(suppressed("inbound-queue:deferred"));
    t.observe(suppressed("inbound-queue:dropped", "queue full"));
    expect(t.snapshot().queue).toEqual({ queued: 2, deferred: 1, dropped: 1 });
    expect(t.snapshot().denied).toBe(0);
  });

  it("any other suppression policy is a denied sender, not queue traffic", () => {
    const t = tracker();
    t.observe(suppressed("access-control", "sender not allowed"));
    expect(t.snapshot().denied).toBe(1);
    expect(t.snapshot().queue).toEqual({ queued: 0, deferred: 0, dropped: 0 });
    expect(t.snapshot().activity[0]).toMatchObject({ kind: "denied", detail: "channel: sender not allowed" });
  });

  it("never keeps message text", () => {
    const t = tracker();
    t.observe(received());
    expect(JSON.stringify(t.snapshot())).not.toContain("hunter2");
  });

  it("keeps the newest 50 activity lines, newest first", () => {
    const t = tracker();
    for (let i = 0; i < 60; i++) t.observe(received({ timestamp: i, sender: String(i) }));
    const a = t.snapshot().activity;
    expect(a).toHaveLength(50);
    expect(a[0]?.detail).toBe("from telegram:59");
    expect(a[49]?.detail).toBe("from telegram:10");
  });

  it("ignores events the gateway view does not use", () => {
    const t = tracker();
    t.observe({ _tag: "Custom", type: "x", payload: {} });
    expect(t.snapshot().activity).toEqual([]);
  });
});
