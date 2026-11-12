import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { ChannelError } from "../src/index.js";
import { WebhookChannelAdapter } from "../src/adapters/webhook.js";
import { alwaysExecutePolicy, ChannelService } from "../src/services/channel-service.js";
import { SessionBridge } from "../src/services/session-bridge.js";
import { TriggerRegistry } from "../src/services/trigger-registry.js";

const waitFor = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

const setup = (onResponse: () => Promise<void> = async () => {}) => {
  const adapter = new WebhookChannelAdapter({ id: "wh", platform: "signal", allowUnsigned: true, onResponse });
  const triggers = new TriggerRegistry();
  triggers.setDefaultAgent({});
  const sessions = new SessionBridge({
    agentFactory: async () => ({ chat: async (m: string) => ({ message: `BOT:${m}` }) }),
  });
  const svc = new ChannelService({ triggers, sessions, taskId: () => "t", evaluatePolicy: alwaysExecutePolicy });
  const post = (id: string) =>
    Effect.runPromise(
      adapter.handleRequest({ body: JSON.stringify({ id, content: "hi", channelId: "c", senderId: "u" }), headers: {} }),
    );
  return { adapter, svc, post };
};

describe("ChannelService.status() per-adapter counters", () => {
  test("reports platform, messagesReceived, messagesSent and timestamps", async () => {
    const s = setup();
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    const before = s.svc.status().adapters[0]!;
    expect(before.platform).toBe("signal");
    expect(before.messagesReceived).toBe(0);
    expect(before.messagesSent).toBe(0);
    expect(before.lastInboundAt).toBeUndefined();

    await s.post("m1");
    await waitFor(() => s.svc.status().adapters[0]!.messagesSent === 1);
    const info = s.svc.status().adapters[0]!;
    expect(info.messagesReceived).toBe(1);
    expect(info.messagesSent).toBe(1);
    expect(info.lastInboundAt).toBeGreaterThan(0);
    expect(info.lastSentAt).toBeGreaterThan(0);
    expect(info.connected).toBe(true);
    expect(s.svc.status().activeSessions).toBe(1);
    await Effect.runPromise(s.svc.shutdown());
  });

  test("a failed send counts as a failure, not as sent", async () => {
    const s = setup(async () => {
      throw Object.assign(new Error("boom"), { status: 429 });
    });
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    await s.post("m1");
    await waitFor(() => s.svc.status().adapters[0]!.deliveryFailures > 0);
    const info = s.svc.status().adapters[0]!;
    expect(info.messagesReceived).toBe(1);
    expect(info.messagesSent).toBe(0);
    expect(info.deliveryFailures).toBe(1);
    await Effect.runPromise(s.svc.shutdown());
  });
});

describe("WebhookChannelAdapter.handleWebhook (ingress route handler)", () => {
  test("accepts a valid request like handleRequest", async () => {
    const s = setup();
    await Effect.runPromise(s.svc.registerAdapter(s.adapter));
    await Effect.runPromise(
      s.adapter.handleWebhook({ body: JSON.stringify({ id: "w1", content: "hi", channelId: "c", senderId: "u" }), headers: {} }),
    );
    await waitFor(() => s.svc.status().adapters[0]!.messagesReceived === 1);
    expect(s.svc.status().adapters[0]!.messagesReceived).toBe(1);
    await Effect.runPromise(s.svc.shutdown());
  });

  test("fails with a typed ChannelError carrying kind, fitting IngressChannelRoute", async () => {
    const w = new WebhookChannelAdapter({ id: "wh2", platform: "x" });
    const exit = await Effect.runPromiseExit(w.handleWebhook({ body: "{}", headers: {} }));
    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail").toBe(true);
    const err = Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error : undefined;
    expect(err).toBeInstanceOf(ChannelError);
    expect(err?.kind).toBe("auth");
    expect(err?.message).toContain("missing_secret");
  });

  test("malformed JSON is unsupported, not auth", async () => {
    const w = new WebhookChannelAdapter({ id: "wh3", platform: "x", allowUnsigned: true });
    const exit = await Effect.runPromiseExit(w.handleWebhook({ body: "not json", headers: {} }));
    const err = Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error : undefined;
    expect(err?.kind).toBe("unsupported");
  });
});
