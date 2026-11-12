// Run: bun run repo test apps/cortex/server/tests/gateway-status.test.ts
//
// The event tracker behind the Gateway overview's activity feed: scripted framework events in, a
// bounded activity list and a refused-sender count out. Counters and queue depth are the
// framework's accessors (pinned in api-gateway.test.ts), not folded here. Message text is never kept.
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
  it("notes received, sent and failed lines with the channel they belong to", () => {
    const t = tracker();
    t.observe(received());
    t.observe({ _tag: "ChannelMessageSent", taskId: "t", platform: "telegram", messageId: "1:1", channelId: "42", timestamp: 30 });
    t.observe({ _tag: "ChannelDeliveryFailed", adapterId: "ch-tg", kind: "rate_limited", retryable: true });
    expect(t.snapshot().activity).toEqual([
      { at: 1_000, kind: "failed", channelId: "ch-tg", detail: "rate_limited, retryable" },
      { at: 30, kind: "sent", channelId: "ch-tg", detail: "reply delivered (telegram)" },
      { at: 10, kind: "received", channelId: "ch-tg", detail: "from telegram:42" },
    ]);
  });

  it("attributes a platform-only event through the lookup and leaves an unknown platform unattributed", () => {
    const t = tracker();
    t.observe({ _tag: "ChannelMessageSent", taskId: "t", platform: "signal", messageId: "1", channelId: "c", timestamp: 1 });
    t.observe({ _tag: "ChannelMessageSent", taskId: "t", platform: "telegram", messageId: "1", channelId: "c", timestamp: 2 });
    const [telegram, signal] = t.snapshot().activity;
    expect(telegram?.channelId).toBe("ch-tg");
    expect(signal && "channelId" in signal).toBe(false);
  });

  it("notes queue activity by policy without counting it (the framework reports depth)", () => {
    const t = tracker();
    t.observe(suppressed("inbound-queue:queued"));
    t.observe(suppressed("inbound-queue:deferred"));
    t.observe(suppressed("inbound-queue:dropped", "queue full"));
    expect(t.snapshot().activity.map((a) => a.kind)).toEqual(["dropped", "deferred", "queued"]);
    expect(t.snapshot().denied).toBe(0);
    expect(Object.keys(t.snapshot()).sort()).toEqual(["activity", "denied"]);
  });

  it("any other suppression policy is a denied sender, not queue traffic", () => {
    const t = tracker();
    t.observe(suppressed("access-control", "sender not allowed"));
    expect(t.snapshot().denied).toBe(1);
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
