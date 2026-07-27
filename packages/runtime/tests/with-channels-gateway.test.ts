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
    // HS-27 (GH #83) originally polled for the gateway loop's first heartbeat
    // tick, believing adapters registered on it. That wait was BOTH wrong and
    // unsatisfiable: `heartbeat.intervalMs` is 999_999 here, so the first tick
    // lands ~17min out. Measured 2026-07-27 — the loop ran its full 15s budget,
    // exited on the deadline and never on the condition, with stats reading
    // {heartbeatsFired: 0, heartbeatsSkipped: 0}. It was ~15s of the runtime
    // suite's 47s (32%) spent waiting for an event that cannot occur.
    //
    // Registration IS async (a request sent immediately after start() is
    // dropped), so the wait could not simply be deleted — the assertions below
    // fail without one. It just has to be the RIGHT wait: `isSubscribed` is the
    // actual readiness signal, and it flips in ~16ms.
    const startedAt = Date.now();
    while (!webhook.isSubscribed && Date.now() - startedAt < 5000) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(webhook.isSubscribed).toBe(true);

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
  }, 20000);
});
