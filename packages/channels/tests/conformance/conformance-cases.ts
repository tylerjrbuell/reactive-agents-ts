import { expect } from "bun:test";
import { Chunk, Effect, Exit, Fiber, Option, Scope, Stream, TestClock } from "effect";
import { channelSenderKey } from "@reactive-agents/gateway";
import type { InboundEnvelope, OutboundMessage } from "../../src/adapter.js";
import { ChannelError, type ChannelErrorKind } from "../../src/errors.js";
import type { AdapterHarness, MakeHarness, PlatformInbound } from "./harness.js";

/** Everything a case may use. `make` builds a fresh started harness inside the case's scope. */
export interface CaseContext {
  readonly make: MakeHarness;
}

export type ConformanceCase = (ctx: CaseContext) => Effect.Effect<void, unknown, Scope.Scope | TestClock.TestClock>;

const settle = Effect.repeatN(Effect.yieldNow(), 50);

const msg = (over: Partial<PlatformInbound> & Pick<PlatformInbound, "id">): PlatformInbound => ({
  text: `text-${over.id}`,
  senderId: "user-1",
  channelId: "chan-1",
  ...over,
});

const out = (text: string, over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  conversation: { channelId: "chan-1" },
  text,
  ...over,
});

/** Start collecting inbound envelopes until the one with `lastId` arrives (inclusive). */
const collectThrough = (h: AdapterHarness, lastId: string) =>
  Effect.fork(
    h.adapter.inbound.pipe(
      Stream.takeUntil((e: InboundEnvelope) => e.id === lastId),
      Stream.runCollect,
      Effect.map(Chunk.toReadonlyArray),
    ),
  );

const sendFailure = (h: AdapterHarness, kind: ChannelErrorKind, retryAfterMs?: number) =>
  Effect.gen(function* () {
    yield* h.failNextSend({ kind, retryAfterMs });
    return yield* Effect.flip(h.adapter.send(out("will fail")));
  });

const ERROR_KINDS: ReadonlyArray<{ kind: ChannelErrorKind; retryable: boolean }> = [
  { kind: "auth", retryable: false },
  { kind: "forbidden", retryable: false },
  { kind: "not_found", retryable: false },
  { kind: "too_large", retryable: false },
  { kind: "rate_limited", retryable: true },
  { kind: "network", retryable: true },
];

export const conformanceCases: Readonly<Record<string, ConformanceCase>> = {
  "inbound is normalized into an InboundEnvelope": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const fiber = yield* collectThrough(h, "m1");
      yield* h.pushInbound(msg({ id: "m1", text: "hello", displayName: "Ann" }));
      const [env] = yield* Fiber.join(fiber);
      expect(env?.id).toBe("m1");
      expect(env?.text).toBe("hello");
      expect(env?.sender.userId).toBe("user-1");
      expect(env?.sender.displayName).toBe("Ann");
      expect(env?.conversation.channelId).toBe("chan-1");
      expect(env?.conversation.isGroup).toBe(false);
      expect(env?.attachments).toEqual([]);
      expect(typeof env?.receivedAt).toBe("number");
      expect(typeof env?.mentionsSelf).toBe("boolean");
      expect(env?.isEcho).toBe(false);
    }),

  "a platform message id is delivered at most once (idempotency)": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const fiber = yield* collectThrough(h, "last");
      yield* h.pushInbound(msg({ id: "dup" }));
      yield* h.pushInbound(msg({ id: "dup" }));
      yield* h.pushInbound(msg({ id: "last" }));
      const ids = (yield* Fiber.join(fiber)).map((e) => e.id);
      expect(ids).toEqual(["dup", "last"]);
    }),

  "echoes of the bot's own messages are never presented as user input": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const fiber = yield* collectThrough(h, "real");
      yield* h.pushInbound(msg({ id: "echo-1", echo: true }));
      yield* h.pushInbound(msg({ id: "real" }));
      const envs = yield* Fiber.join(fiber);
      for (const e of envs) {
        if (e.id === "echo-1") expect(e.isEcho).toBe(true);
        else expect(e.isEcho).toBe(false);
      }
      expect(envs.some((e) => e.id === "real")).toBe(true);
    }),

  "group messages keep the individual sender and thread (group vs DM)": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const fiber = yield* collectThrough(h, "g2");
      yield* h.pushInbound(msg({ id: "g1", channelId: "group-9", isGroup: true, threadId: "t-3", senderId: "alice", mentionsSelf: true }));
      yield* h.pushInbound(msg({ id: "g2", channelId: "dm-alice", senderId: "alice" }));
      const [group, dm] = yield* Fiber.join(fiber);
      expect(group?.conversation).toEqual({ channelId: "group-9", threadId: "t-3", isGroup: true });
      expect(group?.sender.userId).toBe("alice");
      expect(group?.mentionsSelf).toBe(true);
      expect(dm?.conversation.isGroup).toBe(false);
      expect(dm?.conversation.threadId).toBeUndefined();
    }),

  "attachments are normalized (Uint8Array bytes, urls) and replyTo is kept": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const fiber = yield* collectThrough(h, "a1");
      yield* h.pushInbound(
        msg({
          id: "a1",
          replyTo: "m-prev",
          attachments: [
            { type: "url", filename: "a.png", contentType: "image/png", url: "https://example.test/a.png" },
            { type: "binary", filename: "b.bin", contentType: "application/octet-stream", data: new Uint8Array([1, 2, 3]) },
          ],
        }),
      );
      const [env] = yield* Fiber.join(fiber);
      expect(env?.replyTo).toBe("m-prev");
      expect(env?.attachments[0]).toEqual({ type: "url", filename: "a.png", contentType: "image/png", url: "https://example.test/a.png" });
      const bin = env?.attachments[1];
      expect(bin?.type).toBe("binary");
      if (bin?.type === "binary") {
        expect(bin.data instanceof Uint8Array).toBe(true);
        expect([...bin.data]).toEqual([1, 2, 3]);
      }
    }),

  "send returns a real DeliveryReceipt and the platform got the message": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const receipt = yield* h.adapter.send(
        out("hi there", { conversation: { channelId: "chan-1", threadId: "t-1" }, replyTo: "m-0" }),
      );
      expect(receipt.messageId.length).toBeGreaterThan(0);
      expect(receipt.adapterId).toBe(h.adapter.id);
      expect(receipt.platform).toBe(h.adapter.platform);
      expect(["sent", "queued", "delivered"]).toContain(receipt.status);
      const sent = yield* h.platformSent;
      expect(sent).toEqual([{ channelId: "chan-1", threadId: "t-1", text: "hi there", replyTo: "m-0" }]);
    }),

  "receipts are unique and their timestamps never go backwards": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const receipts = [];
      for (const text of ["one", "two", "three"]) {
        receipts.push(yield* h.adapter.send(out(text)));
        yield* TestClock.adjust("10 millis");
      }
      expect(new Set(receipts.map((r) => r.messageId)).size).toBe(3);
      for (let i = 1; i < receipts.length; i++) {
        expect(receipts[i]!.sentAt).toBeGreaterThanOrEqual(receipts[i - 1]!.sentAt);
      }
    }),

  "platform failures become typed ChannelErrors with the right kind": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      for (const { kind, retryable } of ERROR_KINDS) {
        const error = yield* sendFailure(h, kind, kind === "rate_limited" ? 1500 : undefined);
        expect(error instanceof ChannelError).toBe(true);
        expect(error.kind).toBe(kind);
        expect(error.retryable).toBe(retryable);
        expect(error.adapter).toBe(h.adapter.id);
        if (kind === "rate_limited") expect(error.retryAfterMs).toBe(1500);
      }
      // A failed send is not a sent message.
      expect(yield* h.platformSent).toEqual([]);
      // And the adapter recovers.
      yield* h.adapter.send(out("after failures"));
      expect((yield* h.platformSent).length).toBe(1);
    }),

  "credentials never appear in errors, receipts, state or envelopes": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const secret = h.secret;
      if (!secret) return;
      const fiber = yield* collectThrough(h, "s1");
      yield* h.pushInbound(msg({ id: "s1" }));
      const envs = yield* Fiber.join(fiber);
      const error = yield* sendFailure(h, "auth");
      const receipt = yield* h.adapter.send(out("ok"));
      const state = yield* h.adapter.currentState;
      const surface = [
        error.message,
        String(error),
        JSON.stringify(receipt),
        JSON.stringify(state),
        JSON.stringify(envs),
      ].join("\n");
      expect(surface.includes(secret)).toBe(false);
    }),

  "sender identity namespaces as platform:userId for access control": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const fiber = yield* collectThrough(h, "n1");
      yield* h.pushInbound(msg({ id: "n1", senderId: "12345" }));
      const [env] = yield* Fiber.join(fiber);
      expect(env?.sender.platform).toBe(h.adapter.platform);
      expect(env?.sender.userId.length).toBeGreaterThan(0);
      expect(channelSenderKey(env?.sender.platform, env?.sender.userId ?? "")).toBe(`${h.adapter.platform}:12345`);
    }),

  "state is honest: connected while started, disconnected after the scope closes": ({ make }) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const h = yield* Scope.extend(make(), scope);
      expect((yield* h.adapter.currentState).status).toBe("connected");
      yield* Scope.close(scope, Exit.void);
      expect((yield* h.adapter.currentState).status).toBe("disconnected");
    }),

  "a full inbound buffer applies backpressure instead of dropping": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make({ inboundCapacity: 2 });
      const pushes = yield* Effect.forEach(["b1", "b2", "b3"], (id) => Effect.fork(h.pushInbound(msg({ id }))));
      yield* settle;
      const states = yield* Effect.forEach(pushes, (f) => Fiber.poll(f));
      expect(states.filter(Option.isSome).length).toBe(2);
      const fiber = yield* collectThrough(h, "b3");
      yield* settle;
      expect((yield* Fiber.join(fiber)).map((e) => e.id)).toEqual(["b1", "b2", "b3"]);
    }),

  "outbound sends respect the rate limit (delayed, not dropped)": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make({ rateLimit: { max: 2, window: "1 second" } });
      const sends = yield* Effect.forEach(["r1", "r2", "r3"], (t) => Effect.fork(h.adapter.send(out(t))));
      yield* settle;
      expect((yield* h.platformSent).length).toBe(2);
      yield* TestClock.adjust("1 second");
      yield* settle;
      yield* Effect.forEach(sends, Fiber.join);
      expect((yield* h.platformSent).map((s) => s.text)).toEqual(["r1", "r2", "r3"]);
    }),

  "a dropped connection reconnects without losing or repeating messages": ({ make }) =>
    Effect.gen(function* () {
      const h = yield* make();
      const drop = h.dropConnection;
      if (!drop) return;
      const fiber = yield* collectThrough(h, "after");
      yield* h.pushInbound(msg({ id: "before" }));
      yield* drop;
      yield* TestClock.adjust("2 minutes");
      yield* settle;
      expect((yield* h.adapter.currentState).status).toBe("connected");
      yield* h.pushInbound(msg({ id: "after" }));
      expect((yield* Fiber.join(fiber)).map((e) => e.id)).toEqual(["before", "after"]);
    }),
};
