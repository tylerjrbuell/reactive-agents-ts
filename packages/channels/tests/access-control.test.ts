import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createAccessControlPolicy, evaluatePolicies } from "@reactive-agents/gateway";
import type { ChannelAccessConfig } from "@reactive-agents/gateway";
import { WebhookChannelAdapter } from "../src/adapters/webhook.js";
import { ChannelService } from "../src/services/channel-service.js";
import { SessionBridge } from "../src/services/session-bridge.js";
import { TriggerRegistry } from "../src/services/trigger-registry.js";
import type { InboundMessage } from "../src/types.js";

const msg = (o: Partial<InboundMessage> = {}): InboundMessage => ({
  id: "m1",
  platform: "signal",
  channelId: "c1",
  senderId: "12345",
  content: "hi",
  metadata: {},
  timestamp: new Date(),
  ...o,
});

const setup = (access: ChannelAccessConfig, replyToUnknown?: string) => {
  const sent: string[] = [];
  const ran: string[] = [];
  const adapter = new WebhookChannelAdapter({
    id: "wh",
    onResponse: async (_t, c) => {
      sent.push(c.text);
    },
  });
  const triggers = new TriggerRegistry();
  triggers.setDefaultAgent({});
  const sessions = new SessionBridge({
    agentFactory: async () => ({
      chat: async (m: string) => {
        ran.push(m);
        return { message: `BOT:${m}` };
      },
    }),
  });
  const policy = createAccessControlPolicy(access);
  const svc = new ChannelService({
    triggers,
    sessions,
    taskId: () => "t",
    replyToUnknown,
    evaluatePolicy: (event) =>
      evaluatePolicies([policy], event, {
        isRunning: true,
        lastExecutionAt: null,
        consecutiveHeartbeatSkips: 0,
        tokensUsedToday: 0,
        actionsThisHour: 0,
        hourWindowStart: new Date(),
        dayWindowStart: new Date(),
        pendingEvents: [],
      }),
  });
  return { svc, sent, ran, adapter };
};

describe("channel access control (G8)", () => {
  test("cross-platform id collision: telegram sender with a signal-allowlisted id is denied", async () => {
    const { svc, ran, adapter } = setup({ policy: "allowlist", allowedSenders: ["signal:12345"] });
    await Effect.runPromise(svc.registerAdapter(adapter));
    await Effect.runPromise(svc.handleInbound("wh", msg({ platform: "telegram" })));
    expect(ran).toEqual([]);
    await Effect.runPromise(svc.handleInbound("wh", msg({ platform: "signal" })));
    expect(ran).toEqual(["hi"]);
  });

  test("empty sender never reaches the agent, even under open policy", async () => {
    const { svc, ran, adapter } = setup({ policy: "open" });
    await Effect.runPromise(svc.registerAdapter(adapter));
    await Effect.runPromise(svc.handleInbound("wh", msg({ senderId: "" })));
    expect(ran).toEqual([]);
  });

  test("replyToUnknown is sent to an unlisted sender, agent not run", async () => {
    const { svc, ran, sent, adapter } = setup(
      { policy: "allowlist", allowedSenders: ["signal:1"] },
      "Not authorized.",
    );
    await Effect.runPromise(svc.registerAdapter(adapter));
    await Effect.runPromise(svc.handleInbound("wh", msg()));
    expect(ran).toEqual([]);
    expect(sent).toEqual(["Not authorized."]);
  });

  test("replyToUnknown is not sent to blocklisted or empty senders", async () => {
    const blocked = setup({ policy: "blocklist", blockedSenders: ["signal:12345"] }, "Nope");
    await Effect.runPromise(blocked.svc.registerAdapter(blocked.adapter));
    await Effect.runPromise(blocked.svc.handleInbound("wh", msg()));
    expect(blocked.sent).toEqual([]);

    const empty = setup({ policy: "allowlist", allowedSenders: [] }, "Nope");
    await Effect.runPromise(empty.svc.registerAdapter(empty.adapter));
    await Effect.runPromise(empty.svc.handleInbound("wh", msg({ senderId: "" })));
    expect(empty.sent).toEqual([]);
  });
});
