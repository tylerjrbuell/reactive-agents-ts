import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WebhookChannelAdapter } from "@reactive-agents/channels";
import { ReactiveAgents } from "../src/builder.js";

const waitFor = async (cond: () => boolean, ms = 5000) => {
  const t = Date.now();
  while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 5));
};

describe("agent.channelStatus() / gatewayStatus().inboundQueue", () => {
  test("channelStatus() is null before start, a snapshot after, and inboundQueue rides gatewayStatus", async () => {
    const webhook = new WebhookChannelAdapter({ id: "hook-status", platform: "telegram-bot", allowUnsigned: true });
    const agent = await ReactiveAgents.create()
      .withName("ch-status")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({
        heartbeat: { intervalMs: 999_999, policy: "adaptive" },
        queue: { capacity: 7, overflow: "drop-newest" },
      })
      .withChannels({ adapters: [webhook], defaultAgent: {} })
      .build();

    expect(agent.channelStatus()).toBeNull();
    expect((await agent.gatewayStatus())?.inboundQueue).toBeUndefined();

    const handle = agent.start();
    await waitFor(() => agent.channelStatus() !== null);
    const snap = agent.channelStatus();
    expect(snap).not.toBeNull();
    expect(snap!.adapters.map((a) => a.id)).toContain("hook-status");

    const status = await agent.gatewayStatus();
    expect(status?.inboundQueue).toEqual({
      ready: 0,
      deferred: 0,
      capacity: 7,
      overflow: "drop-newest",
      dropped: 0,
    });

    await handle.stop();
    await agent.dispose();
  }, 20000);

  test("a burst past capacity shows up as inboundQueue.dropped on the live agent", async () => {
    const webhook = new WebhookChannelAdapter({ id: "hook-burst", platform: "telegram-bot", allowUnsigned: true });
    const agent = await ReactiveAgents.create()
      .withName("ch-burst")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({
        heartbeat: { intervalMs: 999_999, policy: "adaptive" },
        accessControl: { accessPolicy: "open", mode: "task" },
        queue: { capacity: 1, overflow: "drop-newest" },
      })
      .withChannels({
        adapters: [webhook],
        triggers: [{ id: "t", name: "all", match: { type: "keyword", patterns: ["hi"] }, agent: {} }],
        defaultAgent: {},
      })
      .build();
    const handle = agent.start();
    await waitFor(() => webhook.isSubscribed);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        Effect.runPromise(
          webhook.handleRequest({
            body: JSON.stringify({ id: `m${i}`, content: "hi", channelId: `dm-${i}`, senderId: `u${i}` }),
            headers: {},
          }),
        ),
      ),
    );
    await waitFor(() => (agent.channelStatus()?.totalMessagesProcessed ?? 0) > 0);
    await new Promise((r) => setTimeout(r, 300));
    const q = (await agent.gatewayStatus())?.inboundQueue;
    expect(q?.capacity).toBe(1);
    expect(q?.dropped).toBeGreaterThan(0);
    expect(q?.ready).toBeLessThanOrEqual(1);
    await handle.stop();
    await agent.dispose();
  }, 30000);
});
