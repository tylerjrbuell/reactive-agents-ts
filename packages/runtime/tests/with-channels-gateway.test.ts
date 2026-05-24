import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WebhookChannelAdapter } from "@reactive-agents/channels";
import { ReactiveAgents } from "../src/builder.js";

describe("ReactiveAgent .withChannels() + gateway start", () => {
  test("build accepts withChannels alongside withGateway", async () => {
    const webhook = new WebhookChannelAdapter({
      id: "hook-build",
      platform: "telegram-bot",
    });
    const agent = await ReactiveAgents.create()
      .withName("ch-build")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withGateway({
        heartbeat: { intervalMs: 999_999, policy: "adaptive" },
      })
      .withChannels({
        adapters: [webhook],
        defaultAgent: { systemPrompt: "You are a test bot." },
      })
      .build();
    expect(agent).toBeDefined();
  });

  test("start wires webhook → session.chat → onResponse (policy execute)", async () => {
    const replies: string[] = [];
    const webhook = new WebhookChannelAdapter({
      id: "hook-e2e",
      platform: "telegram-bot",
      onResponse: async (_t, c) => {
        replies.push(c.text);
      },
    });

    const agent = await ReactiveAgents.create()
      .withName("ch-e2e")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: pong" }])
      .withGateway({
        heartbeat: { intervalMs: 999_999, policy: "adaptive" },
        accessControl: { accessPolicy: "open" },
      })
      .withChannels({
        adapters: [webhook],
        triggers: [
          {
            id: "t-all",
            name: "catch",
            match: { type: "keyword", patterns: ["hi"] },
            agent: {},
          },
        ],
        defaultAgent: {},
      })
      .build();

    const handle = agent.start();
    // HS-27 (GH #83): channel adapters register on the gateway loop's first
    // tick. Poll for that tick rather than sleeping a fixed 150ms.
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const status = await agent.gatewayStatus();
      if (status && status.stats.heartbeatsFired + status.stats.heartbeatsSkipped >= 1) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    await Effect.runPromise(
      webhook.handleRequest({
        body: JSON.stringify({
          id: "m-e2e",
          content: "hi",
          channelId: "dm-1",
          senderId: "user-9",
        }),
        headers: {},
      }),
    );
    await handle.stop();
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("pong");
  });
});
