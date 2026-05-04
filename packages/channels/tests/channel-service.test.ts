import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WebhookChannelAdapter } from "../src/adapters/webhook.js";
import { alwaysExecutePolicy, ChannelService } from "../src/services/channel-service.js";
import { SessionBridge } from "../src/services/session-bridge.js";
import { TriggerRegistry } from "../src/services/trigger-registry.js";
import type { InboundMessage, TriggerDefinition } from "../src/types.js";

const makeMsg = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  id: "m1",
  platform: "telegram-bot",
  channelId: "c1",
  senderId: "u1",
  content: "hello",
  metadata: {},
  timestamp: new Date(),
  ...overrides,
});

describe("ChannelService", () => {
  test("inbound message runs policy, trigger, session, and outbound send", async () => {
    const triggers = new TriggerRegistry();
    triggers.register({
      id: "t1",
      name: "kw",
      match: { type: "keyword", patterns: ["hello"] },
      agent: {},
    });
    triggers.setDefaultAgent({ systemPrompt: "fallback" });

    const sent: string[] = [];
    const webhook = new WebhookChannelAdapter({
      id: "wh1",
      platform: "telegram-bot",
      onResponse: async (_t, c) => {
        sent.push(c.text);
      },
    });

    const sessions = new SessionBridge({
      agentFactory: async () => ({
        chat: async (m: string) => ({ message: `BOT:${m}` }),
      }),
    });

    const svc = new ChannelService({
      triggers,
      sessions,
      evaluatePolicy: alwaysExecutePolicy,
      taskId: () => "task-1",
    });

    await Effect.runPromise(svc.registerAdapter(webhook));
    await Effect.runPromise(svc.handleInbound("wh1", makeMsg()));

    expect(sent).toEqual(["BOT:hello"]);
    expect(svc.status().totalMessagesProcessed).toBe(1);
  });

  test("policy skip prevents agent run", async () => {
    const triggers = new TriggerRegistry();
    triggers.setDefaultAgent({});
    const webhook = new WebhookChannelAdapter({
      id: "wh1",
      onResponse: async () => {
        throw new Error("should not send");
      },
    });
    const sessions = new SessionBridge({
      agentFactory: async () => ({
        chat: async () => ({ message: "no" }),
      }),
    });
    const svc = new ChannelService({
      triggers,
      sessions,
      evaluatePolicy: () => Effect.succeed({ action: "skip", reason: "test" }),
      taskId: () => "t",
    });
    await Effect.runPromise(svc.registerAdapter(webhook));
    await Effect.runPromise(svc.handleInbound("wh1", makeMsg({ content: "x" })));
    expect(svc.status().totalMessagesProcessed).toBe(0);
  });

  test("default agent used when no trigger matches", async () => {
    const triggers = new TriggerRegistry();
    triggers.setDefaultAgent({});
    const webhook = new WebhookChannelAdapter({
      id: "w",
      onResponse: async (_t, c) => {
        expect(c.text).toContain("solo");
      },
    });
    const sessions = new SessionBridge({
      agentFactory: async () => ({
        chat: async (m) => ({ message: `echo:${m}` }),
      }),
    });
    const svc = new ChannelService({
      triggers,
      sessions,
      evaluatePolicy: alwaysExecutePolicy,
      taskId: () => "t",
    });
    await Effect.runPromise(svc.registerAdapter(webhook));
    await Effect.runPromise(svc.handleInbound("w", makeMsg({ content: "solo" })));
  });

  test("derive merges into agent config", async () => {
    const triggers = new TriggerRegistry();
    const t: TriggerDefinition = {
      id: "d1",
      name: "d",
      match: { type: "keyword", patterns: ["run"] },
      agent: {
        systemPrompt: "base",
        derive: (m) => (m.content.includes("research") ? { systemPrompt: "researcher" } : {}),
      },
    };
    triggers.register(t);
    let saw = "";
    const webhook = new WebhookChannelAdapter({
      id: "w",
      onResponse: async () => {},
    });
    const sessions = new SessionBridge({
      agentFactory: async (cfg) => ({
        chat: async () => {
          saw = String(cfg?.systemPrompt ?? "");
          return { message: "ok" };
        },
      }),
    });
    const svc = new ChannelService({
      triggers,
      sessions,
      evaluatePolicy: alwaysExecutePolicy,
      taskId: () => "t",
    });
    await Effect.runPromise(svc.registerAdapter(webhook));
    await Effect.runPromise(svc.handleInbound("w", makeMsg({ content: "run research" })));
    expect(saw).toBe("researcher");
  });
});
