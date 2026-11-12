// Run: bun run repo test packages/channels/tests/security-hardening.test.ts
// Security audit M6/M7/M8: empty secrets fail closed, metadata cannot spoof the sender,
// the session map is bounded, attachments are policy-checked before download.
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Chunk, Effect, Exit, Fiber, Redacted, Stream, TestClock, TestContext } from "effect";
import type { GatewayEvent } from "@reactive-agents/gateway";
import { WebhookChannelAdapter } from "../src/adapters/webhook.js";
import { TelegramChannelAdapter } from "../src/adapters/telegram.js";
import { ChannelService } from "../src/services/channel-service.js";
import { SessionBridge } from "../src/services/session-bridge.js";
import { TriggerRegistry } from "../src/services/trigger-registry.js";
import type { InboundMessage } from "../src/types.js";
import { FAKE_TOKEN, makeFakeTelegram } from "./conformance/telegram.fake.js";

const nowSec = (): string => String(Math.floor(Date.now() / 1000));

describe("M6: empty secrets fail closed", () => {
  for (const secret of ["", "   ", Redacted.make("")]) {
    test(`webhook adapter rejects a request signed with an empty key (${typeof secret === "string" ? JSON.stringify(secret) : "Redacted('')"})`, async () => {
      const w = new WebhookChannelAdapter({ secret, platform: "p" });
      const received: string[] = [];
      await Effect.runPromise(w.onMessage((m) => Effect.sync(() => void received.push(m.content))));
      const body = JSON.stringify({ id: "1", content: "forged", channelId: "c", senderId: "u" });
      const ts = nowSec();
      const sig = createHmac("sha256", "").update(`${ts}.${body}`).digest("hex");
      const exit = await Effect.runPromiseExit(
        w.handleRequest({ body, headers: { "x-channels-signature": sig, "x-channels-timestamp": ts } }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(received).toEqual([]);
    });
  }

  test("telegram webhook with an empty secretToken rejects a header-less request", async () => {
    const fake = makeFakeTelegram();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_700_000_000_000);
        const adapter = new TelegramChannelAdapter({
          token: FAKE_TOKEN,
          fetch: fake.fetch,
          chatRateLimit: false,
          webhook: { secretToken: "" },
        });
        yield* adapter.start();
        return yield* adapter.handleWebhook({ body: JSON.stringify({ update_id: 1 }), headers: {} });
      }).pipe(Effect.scoped, Effect.provide(TestContext.TestContext)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("M8: channel metadata cannot override sender identity", () => {
  test("toGatewayEvent: identity fields win over msg.metadata", async () => {
    const seen: GatewayEvent[] = [];
    const svc = new ChannelService({
      triggers: new TriggerRegistry(),
      sessions: new SessionBridge({ agentFactory: async () => ({ chat: async () => ({ message: "" }) }) }),
      evaluatePolicy: (e) => {
        seen.push(e);
        return Effect.succeed({ action: "skip", reason: "test" });
      },
      taskId: () => "t",
    });
    const msg: InboundMessage = {
      id: "m",
      platform: "webhook",
      channelId: "c",
      senderId: "stranger",
      content: "hi",
      metadata: { sender: "allowlisted-admin", platform: "telegram", adapterId: "spoofed" },
      timestamp: new Date(),
    };
    await Effect.runPromise(svc.handleInbound("wh", msg));
    expect(seen[0]?.metadata["sender"]).toBe("stranger");
    expect(seen[0]?.metadata["platform"]).toBe("webhook");
    expect(seen[0]?.metadata["adapterId"]).toBe("wh");
  });
});

describe("M7: session map is bounded (LRU)", () => {
  test("evicts the least recently used session beyond maxSessions", async () => {
    const built: string[] = [];
    const bridge = new SessionBridge({
      maxSessions: 2,
      agentFactory: async (_cfg, sessionId) => {
        built.push(sessionId);
        return { chat: async (m: string) => ({ message: m }) };
      },
    });
    const turn = (user: string) =>
      Effect.runPromise(
        bridge.runChatTurn({ identity: { platform: "p", userId: user, metadata: {} }, channelId: "c", agentConfig: undefined }, "x"),
      );
    await turn("a");
    await turn("b");
    await turn("a"); // touch a: b is now least recent
    await turn("c");
    expect(bridge.size()).toBe(2);
    expect(built.length).toBe(3); // a, b, c built once each
    await turn("a"); // survived: no rebuild
    expect(built.length).toBe(3);
    await turn("b"); // was evicted: rebuilt
    expect(built.length).toBe(4);
    expect(bridge.size()).toBe(2);
  });
});

describe("M7: attachments are policy-checked before download", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, import("effect").Scope.Scope | import("effect").TestClock.TestClock>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_700_000_000_000);
        return yield* effect;
      }).pipe(Effect.scoped, Effect.provide(TestContext.TestContext)),
    );
  const tick = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
  const settle = Effect.repeatN(Effect.zipRight(Effect.yieldNow(), tick), 6);

  const attachmentUpdate = {
    message: {
      message_id: 7,
      date: 1_700_000_000,
      chat: { id: 1001, type: "private" },
      from: { id: 1001, is_bot: false, first_name: "Ann" },
      caption: "file",
      document: { file_id: "f1", file_size: 2 },
    },
  };

  test("denied sender: no getFile call, file counted unavailable", () =>
    run(
      Effect.gen(function* () {
        const fake = makeFakeTelegram();
        fake.addFile("f1", new Uint8Array([1, 2]));
        const adapter = new TelegramChannelAdapter({ token: FAKE_TOKEN, fetch: fake.fetch, chatRateLimit: false });
        const svc = new ChannelService({
          triggers: new TriggerRegistry(),
          sessions: new SessionBridge({ agentFactory: async () => ({ chat: async () => ({ message: "" }) }) }),
          evaluatePolicy: () => Effect.succeed({ action: "skip", reason: "unknown", code: "unknown-sender" }),
          taskId: () => "t",
        });
        yield* svc.registerAdapter(adapter);
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(1), Stream.runCollect));
        fake.push(attachmentUpdate);
        yield* settle;
        const [env] = Chunk.toReadonlyArray(yield* Fiber.join(fiber));
        expect(fake.methods).not.toContain("getFile");
        expect(env?.attachments).toEqual([]);
        expect(env?.metadata?.attachmentsUnavailable).toBe(1);
      }),
    ));

  test("allowed sender: file is downloaded", () =>
    run(
      Effect.gen(function* () {
        const fake = makeFakeTelegram();
        fake.addFile("f1", new Uint8Array([1, 2]));
        const adapter = new TelegramChannelAdapter({ token: FAKE_TOKEN, fetch: fake.fetch, chatRateLimit: false });
        const svc = new ChannelService({
          triggers: new TriggerRegistry(),
          sessions: new SessionBridge({ agentFactory: async () => ({ chat: async () => ({ message: "" }) }) }),
          evaluatePolicy: () => Effect.succeed({ action: "skip", reason: "x" }),
          allowSender: () => Effect.succeed(true),
          taskId: () => "t",
        });
        yield* svc.registerAdapter(adapter);
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(1), Stream.runCollect));
        fake.push(attachmentUpdate);
        yield* settle;
        const [env] = Chunk.toReadonlyArray(yield* Fiber.join(fiber));
        expect(env?.attachments.length).toBe(1);
      }),
    ));
});
