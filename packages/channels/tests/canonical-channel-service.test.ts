import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { createAccessControlPolicy, evaluatePolicies } from "@reactive-agents/gateway";
import type { ChannelAccessConfig } from "@reactive-agents/gateway";
import { ChannelError, ChannelSendError, type OutboundMessage } from "../src/index.js";
import { WebhookChannelAdapter } from "../src/adapters/webhook.js";
import { alwaysExecutePolicy, ChannelService } from "../src/services/channel-service.js";
import { SessionBridge } from "../src/services/session-bridge.js";
import { TriggerRegistry } from "../src/services/trigger-registry.js";
import type { MessageChannel } from "../src/types.js";

const SECRET = "tok_SUPERSECRET";

const waitFor = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

const setup = (opts: { onResponse?: (text: string) => Promise<void>; access?: ChannelAccessConfig; platform?: string } = {}) => {
  const events: AgentEvent[] = [];
  const ran: string[] = [];
  const adapter = new WebhookChannelAdapter({
    id: "wh",
    platform: opts.platform ?? "signal",
    allowUnsigned: true,
    onResponse: async (_t, c) => {
      await (opts.onResponse ?? (async () => {}))(c.text);
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
  const policy = opts.access ? createAccessControlPolicy(opts.access) : undefined;
  const svc = new ChannelService({
    triggers,
    sessions,
    taskId: () => "task-1",
    evaluatePolicy: policy
      ? (event) =>
          evaluatePolicies([policy], event, {
            isRunning: true,
            lastExecutionAt: null,
            consecutiveHeartbeatSkips: 0,
            tokensUsedToday: 0,
            actionsThisHour: 0,
            hourWindowStart: new Date(),
            dayWindowStart: new Date(),
            pendingEvents: [],
          })
      : alwaysExecutePolicy,
    eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
  });
  const post = (body: Record<string, unknown>) =>
    Effect.runPromise(adapter.handleRequest({ body: JSON.stringify(body), headers: {} }));
  return { svc, adapter, events, ran, post };
};

describe("ChannelService with canonical adapters", () => {
  test("reply goes through adapter.send; ChannelMessageSent carries the receipt's real id", async () => {
    const s = setup();
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    await s.post({ id: "m1", content: "hello", channelId: "c1", senderId: "u1" });
    await waitFor(() => s.events.some((e) => e._tag === "ChannelMessageSent"));
    const sent = s.events.find((e) => e._tag === "ChannelMessageSent");
    expect(sent?._tag === "ChannelMessageSent" && sent.messageId.startsWith("wh-")).toBe(true);
    expect(sent?._tag === "ChannelMessageSent" && sent.messageId.startsWith("local-")).toBe(false);
    await Effect.runPromise(s.svc.shutdown());
  });

  test("failed send: typed failure recorded, no ChannelMessageSent, secret not published", async () => {
    const s = setup({
      onResponse: async () => {
        throw Object.assign(new Error(`POST https://x/${SECRET} failed`), { status: 429, retryAfterMs: 900 });
      },
    });
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    await s.post({ id: "m1", content: "hello", channelId: "c1", senderId: "u1" });
    await waitFor(() => s.svc.status().adapters[0]!.deliveryFailures > 0);

    expect(s.events.some((e) => e._tag === "ChannelMessageSent")).toBe(false);
    const failed = s.events.find((e) => e._tag === "ChannelDeliveryFailed");
    expect(failed).toBeDefined();
    expect(JSON.stringify(s.events).includes(SECRET)).toBe(false);
    expect(failed?._tag === "ChannelDeliveryFailed" && failed.kind).toBe("rate_limited");
    expect(failed?._tag === "ChannelDeliveryFailed" && failed.retryAfterMs).toBe(900);
    expect(failed?._tag === "ChannelDeliveryFailed" && failed.conversationId).toBe("c1");

    const info = s.svc.status().adapters[0]!;
    expect(info.deliveryFailures).toBe(1);
    expect(info.lastError?.kind).toBe("rate_limited");
    expect(info.lastError?.retryAfterMs).toBe(900);
    await Effect.runPromise(s.svc.shutdown());
  });

  test("inbound publishes ChannelMessageReceived with adapterId and conversation", async () => {
    const s = setup();
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    await s.post({ id: "m1", content: "hi", channelId: "g1", senderId: "u1", isGroup: true, threadId: "t1" });
    await waitFor(() => s.events.some((e) => e._tag === "ChannelMessageReceived"));
    const rx = s.events.find((e) => e._tag === "ChannelMessageReceived");
    expect(rx?._tag === "ChannelMessageReceived" && rx.adapterId).toBe("wh");
    expect(rx?._tag === "ChannelMessageReceived" && rx.conversation).toEqual({
      channelId: "g1",
      threadId: "t1",
      isGroup: true,
    });
    await Effect.runPromise(s.svc.shutdown());
  });

  test("deliver fails with a typed ChannelError (not swallowed) and unknown adapters are not_found", async () => {
    const s = setup({
      onResponse: async () => {
        throw Object.assign(new Error("nope"), { status: 401 });
      },
    });
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    const msg: OutboundMessage = { conversation: { channelId: "c1" }, text: "x" };
    const exit = await Effect.runPromiseExit(s.svc.deliver("wh", msg));
    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" && exit.cause.error instanceof ChannelError).toBe(true);
    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error.kind : "").toBe("auth");

    const missing = await Effect.runPromiseExit(s.svc.deliver("nope", msg));
    expect(Exit.isFailure(missing) && missing.cause._tag === "Fail" ? missing.cause.error.kind : "").toBe("not_found");
    await Effect.runPromise(s.svc.shutdown());
  });

  test("echoes are dropped before policy and agent", async () => {
    const s = setup();
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    await s.post({ id: "e1", content: "my own reply", channelId: "c1", senderId: "bot", isEcho: true });
    await s.post({ id: "m2", content: "real", channelId: "c1", senderId: "u1" });
    await waitFor(() => s.ran.length > 0);
    expect(s.ran).toEqual(["real"]);
    await Effect.runPromise(s.svc.shutdown());
  });

  test("access control keys on platform:userId for canonical envelopes", async () => {
    const s = setup({ access: { policy: "allowlist", allowedSenders: ["signal:42"] }, platform: "signal" });
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    await s.post({ id: "a1", content: "denied", channelId: "c1", senderId: "43" });
    await s.post({ id: "a2", content: "allowed", channelId: "c1", senderId: "42" });
    await waitFor(() => s.ran.length > 0);
    expect(s.ran).toEqual(["allowed"]);
    await Effect.runPromise(s.svc.shutdown());
  });

  test("status() is honest: connected while running, disconnected after shutdown", async () => {
    const s = setup();
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    expect(s.svc.status().adapters[0]!.connected).toBe(true);
    await s.post({ id: "m1", content: "hi", channelId: "c1", senderId: "u1" });
    await waitFor(() => s.svc.status().activeSessions > 0);
    expect(s.svc.status().activeSessions).toBe(1);
    await Effect.runPromise(s.svc.shutdown());
    const info = s.svc.status().adapters[0]!;
    expect(info.connected).toBe(false);
    expect(info.state.status).toBe("disconnected");
  });
});

describe("ChannelService with a legacy MessageChannel", () => {
  test("still delivers replies, and a failing send is typed and counted", async () => {
    const sent: string[] = [];
    let fail = false;
    const legacy: MessageChannel = {
      id: "legacy",
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      onMessage: (handler) => {
        captured = handler;
        return Effect.succeed({ unsubscribe: () => Effect.void });
      },
      sendMessage: (target, content) =>
        fail
          ? Effect.fail(new ChannelSendError({ adapter: "legacy", target, reason: "unauthorized" }))
          : Effect.sync(() => {
              sent.push(content.text);
              return { messageId: "real-1", timestamp: new Date() };
            }),
    };
    let captured: ((m: import("../src/types.js").InboundMessage) => Effect.Effect<void>) | undefined;
    const events: AgentEvent[] = [];
    const svc = new ChannelService({
      triggers: (() => {
        const t = new TriggerRegistry();
        t.setDefaultAgent({});
        return t;
      })(),
      sessions: new SessionBridge({ agentFactory: async () => ({ chat: async (m) => ({ message: `R:${m}` }) }) }),
      evaluatePolicy: alwaysExecutePolicy,
      taskId: () => "t",
      eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
    });
    await Effect.runPromise(svc.registerAdapter(legacy));
    const inbound = (id: string) => ({
      id,
      platform: "p",
      channelId: "c",
      senderId: "u",
      content: id,
      metadata: {},
      timestamp: new Date(),
    });
    await Effect.runPromise(captured!(inbound("one")));
    expect(sent).toEqual(["R:one"]);
    const ok = events.find((e) => e._tag === "ChannelMessageSent");
    expect(ok?._tag === "ChannelMessageSent" && ok.messageId).toBe("real-1");

    fail = true;
    await Effect.runPromise(captured!(inbound("two")));
    expect(svc.status().adapters[0]!.deliveryFailures).toBe(1);
    expect(events.filter((e) => e._tag === "ChannelMessageSent").length).toBe(1);
  });
});
