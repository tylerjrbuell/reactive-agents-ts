import { describe, expect, spyOn, test } from "bun:test";
import { Chunk, Effect, Fiber, Queue, Stream, TestClock, TestContext, type Scope } from "effect";
import { SignalChannelAdapter } from "../src/adapters/signal.js";
import {
  failureFromSendResult,
  isDirectAddress,
  mapSignalFailure,
  parseReplyRef,
  parseSignalNotification,
} from "../src/adapters/signal-protocol.js";
import {
  makeJsonRpcConnection,
  SignalRpcError,
  type SignalConnection,
  type SignalNotification,
} from "../src/adapters/signal-transport.js";
import { channelError, type ChannelError } from "../src/errors.js";

const ACCOUNT = "+15559990000";
const SELF = { account: ACCOUNT };

const receive = (envelope: Record<string, unknown>): SignalNotification => ({ method: "receive", params: { envelope } });

const dataMsg = (over: Record<string, unknown> = {}) =>
  receive({
    source: "+15551110000",
    sourceNumber: "+15551110000",
    sourceName: "Ann",
    timestamp: 1000,
    dataMessage: { timestamp: 1000, message: "hi", ...over },
  });

describe("parseSignalNotification", () => {
  test("a group message keeps the group as conversation and the individual sender", () => {
    const ev = parseSignalNotification(dataMsg({ groupInfo: { groupId: "grp==" } }), SELF, () => false);
    expect(ev).toMatchObject({ kind: "message", channelId: "grp==", isGroup: true, userId: "+15551110000", mentionsSelf: false });
  });

  test("a DM addresses the bot, a group needs a mention or a reply to the bot", () => {
    expect(parseSignalNotification(dataMsg(), SELF, () => false)).toMatchObject({ isGroup: false, mentionsSelf: true });
    const mention = dataMsg({ groupInfo: { groupId: "g" }, mentions: [{ number: ACCOUNT }] });
    expect(parseSignalNotification(mention, SELF, () => false)).toMatchObject({ mentionsSelf: true });
    const reply = dataMsg({ groupInfo: { groupId: "g" }, quote: { id: 5, authorNumber: ACCOUNT } });
    expect(parseSignalNotification(reply, SELF, () => false)).toMatchObject({ mentionsSelf: true, replyTo: `${ACCOUNT}:5` });
  });

  test("uuid-only senders keep a uuid identity", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const ev = parseSignalNotification(receive({ sourceUuid: uuid, timestamp: 1, dataMessage: { timestamp: 1, message: "x" } }), SELF, () => false);
    expect(ev).toMatchObject({ userId: uuid, channelId: uuid });
  });

  test("a sync message is an echo only when its timestamp is one the adapter sent", () => {
    const sync = receive({
      source: ACCOUNT,
      timestamp: 77,
      syncMessage: { sentMessage: { timestamp: 77, message: "same words", destinationNumber: "+15551110000" } },
    });
    expect(parseSignalNotification(sync, SELF, (ts) => ts === "77")).toMatchObject({ isEcho: true });
    // Same text, different id: not an echo. Echo detection must never look at text.
    expect(parseSignalNotification(sync, SELF, () => false)).toMatchObject({ isEcho: false });
  });

  test("receipts, typing and empty messages", () => {
    const delivered = receive({ timestamp: 1, receiptMessage: { when: 5, isDelivery: true, timestamps: [10, 11] } });
    expect(parseSignalNotification(delivered, SELF, () => false)).toEqual({
      kind: "receipt",
      status: "delivered",
      messageTimestamps: [10, 11],
      at: 5,
    });
    expect(parseSignalNotification(receive({ typingMessage: { action: "STARTED" } }), SELF, () => false).kind).toBe("ignore");
    expect(parseSignalNotification(dataMsg({ message: "" }), SELF, () => false).kind).toBe("ignore");
    expect(parseSignalNotification({ method: "other", params: {} }, SELF, () => false).kind).toBe("ignore");
  });

  test("helpers", () => {
    expect(parseReplyRef("+1555:123")).toEqual({ author: "+1555", timestamp: 123 });
    expect(parseReplyRef("nope")).toBeUndefined();
    expect(isDirectAddress("+15551234567")).toBe(true);
    expect(isDirectAddress("Z3JvdXA=")).toBe(false);
  });
});

describe("mapSignalFailure (typed error mapping)", () => {
  const rpc = (message: string, data?: unknown) => new SignalRpcError({ code: -1, message, ...(data !== undefined ? { data } : {}) });
  const kindOf = (f: unknown) => mapSignalFailure("signal", f).kind;

  test("maps signal-cli errors to channel error kinds", () => {
    expect(kindOf(rpc("Failed: UnregisteredUserException"))).toBe("not_found");
    expect(kindOf(rpc("Authorization failed"))).toBe("auth");
    expect(kindOf(rpc("Account +1555 is not registered"))).toBe("auth");
    expect(kindOf(rpc("Rate limit exceeded"))).toBe("rate_limited");
    expect(kindOf(rpc("Untrusted identity"))).toBe("forbidden");
    expect(kindOf(rpc("Message size exceeds limit"))).toBe("too_large");
    expect(kindOf(rpc("Connection timed out"))).toBe("network");
    expect(kindOf(new SignalRpcError({ code: -32601, message: "Method not found" }))).toBe("unsupported");
    expect(kindOf(rpc("???"))).toBe("unknown");
  });

  test("rate limits carry retryAfterMs and retry flags follow kind", () => {
    const e = mapSignalFailure("signal", rpc("Rate limit", { retryAfterSeconds: 2.5 }));
    expect(e.retryAfterMs).toBe(2500);
    expect(e.retryable).toBe(true);
    expect(mapSignalFailure("signal", rpc("Authorization failed")).retryable).toBe(false);
  });

  test("the raw failure text (which can hold the account) stays in cause, not message", () => {
    const e = mapSignalFailure("signal", rpc(`Authorization failed for ${ACCOUNT}`));
    expect(e.message.includes(ACCOUNT)).toBe(false);
    expect(String(e).includes(ACCOUNT)).toBe(false);
  });

  test("per-recipient send results", () => {
    expect(failureFromSendResult("s", { timestamp: 1, results: [{ type: "SUCCESS" }] })).toBeUndefined();
    expect(failureFromSendResult("s", { timestamp: 1 })).toBeUndefined();
    expect(failureFromSendResult("s", { results: [{ type: "UNREGISTERED_FAILURE" }] })?.kind).toBe("not_found");
    expect(failureFromSendResult("s", { results: [{ type: "RATE_LIMIT_FAILURE", retryAfterSeconds: 3 }] })?.retryAfterMs).toBe(3000);
  });
});

// ── Adapter behaviour against a scripted fake ──────────────────────────────

const makeFake = () =>
  Effect.gen(function* () {
    const notifications = yield* Queue.unbounded<SignalNotification>();
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    let nextTimestamp = 5000;
    let opens = 0;
    let sendFailure: SignalRpcError | undefined;
    let openFailure: ChannelError | undefined;
    const connection: SignalConnection = {
      notifications: Stream.fromQueue(notifications),
      request: (method, params = {}) =>
        Effect.suspend(() => {
          requests.push({ method, params });
          if (sendFailure) return Effect.fail(sendFailure);
          return Effect.succeed({ timestamp: nextTimestamp++, results: [{ type: "SUCCESS" }] });
        }),
    };
    return {
      transport: {
        open: Effect.suspend(() => {
          opens++;
          return openFailure ? Effect.fail(openFailure) : Effect.succeed(connection);
        }),
      },
      emit: (n: SignalNotification) => Queue.offer(notifications, n),
      requests,
      opens: () => opens,
      failSends: (e: SignalRpcError | undefined) => void (sendFailure = e),
      failOpen: (e: ChannelError | undefined) => void (openFailure = e),
    };
  });

const run = <A>(eff: Effect.Effect<A, unknown, Scope.Scope>) =>
  Effect.runPromise(eff.pipe(Effect.scoped, Effect.provide(TestContext.TestContext)));

const settle = Effect.repeatN(Effect.yieldNow(), 50);

describe("SignalChannelAdapter", () => {
  test("concurrent senders in one group are not cross-wired", () =>
    run(
      Effect.gen(function* () {
        const fake = yield* makeFake();
        const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
        yield* adapter.start();
        const fiber = yield* Effect.fork(
          adapter.inbound.pipe(Stream.take(2), Stream.runCollect, Effect.map(Chunk.toReadonlyArray)),
        );
        for (const [src, ts] of [["+1555000001", 1], ["+1555000002", 2]] as const) {
          yield* fake.emit(receive({ source: src, sourceNumber: src, timestamp: ts, dataMessage: { timestamp: ts, message: `from ${src}`, groupInfo: { groupId: "G" } } }));
        }
        const [a, b] = yield* Fiber.join(fiber);
        expect([a?.sender.userId, a?.conversation.channelId, a?.text]).toEqual(["+1555000001", "G", "from +1555000001"]);
        expect([b?.sender.userId, b?.conversation.channelId, b?.text]).toEqual(["+1555000002", "G", "from +1555000002"]);
        // The reply goes to the conversation it was asked for, not to whoever spoke last.
        yield* adapter.send({ conversation: { channelId: "G" }, text: "reply", replyTo: "+1555000001:1" });
        expect(fake.requests[0]).toEqual({
          method: "send",
          params: { groupId: "G", message: "reply", quoteTimestamp: 1, quoteAuthor: "+1555000001" },
        });
      }),
    ));

  test("echo is decided by message id: the user repeating the bot's words is still a user", () =>
    run(
      Effect.gen(function* () {
        const fake = yield* makeFake();
        const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
        yield* adapter.start();
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(2), Stream.runCollect, Effect.map(Chunk.toReadonlyArray)));
        const receipt = yield* adapter.send({ conversation: { channelId: "+15551110000" }, text: "the same words" });
        yield* fake.emit(
          receive({ source: ACCOUNT, timestamp: Number(receipt.messageId), syncMessage: { sentMessage: { timestamp: Number(receipt.messageId), message: "different text entirely", destinationNumber: "+15551110000" } } }),
        );
        yield* fake.emit(dataMsg({ message: "the same words", timestamp: 9 }));
        const [echo, user] = yield* Fiber.join(fiber);
        expect(echo?.isEcho).toBe(true);
        expect(user?.isEcho).toBe(false);
        expect(user?.text).toBe("the same words");
      }),
    ));

  test("send uses the timestamp as the real message id; no timestamp is a typed failure", () =>
    run(
      Effect.gen(function* () {
        const fake = yield* makeFake();
        const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
        yield* adapter.start();
        const a = yield* adapter.send({ conversation: { channelId: "+15551110000" }, text: "1" });
        const b = yield* adapter.send({ conversation: { channelId: "+15551110000" }, text: "2" });
        expect([a.messageId, b.messageId]).toEqual(["5000", "5001"]);
        expect(fake.requests[0]?.params).toEqual({ recipient: ["+15551110000"], message: "1" });
      }),
    ));

  test("binary attachments go out as data URIs; url attachments are unsupported", () =>
    run(
      Effect.gen(function* () {
        const fake = yield* makeFake();
        const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
        yield* adapter.start();
        yield* adapter.send({
          conversation: { channelId: "+15551110000" },
          text: "pic",
          attachments: [{ type: "binary", filename: "a.bin", contentType: "image/png", data: new Uint8Array([1, 2]) }],
        });
        expect(fake.requests[0]?.params.attachments).toEqual(["data:image/png;filename=a.bin;base64,AQI="]);
        const error = yield* Effect.flip(
          adapter.send({ conversation: { channelId: "G" }, text: "x", attachments: [{ type: "url", filename: "a", contentType: "t", url: "https://x.test" }] }),
        );
        expect(error.kind).toBe("unsupported");
      }),
    ));

  test("delivery and read receipts stream with the sent message id", () =>
    run(
      Effect.gen(function* () {
        const fake = yield* makeFake();
        const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
        yield* adapter.start();
        const fiber = yield* Effect.fork(adapter.deliveryUpdates.pipe(Stream.take(2), Stream.runCollect, Effect.map(Chunk.toReadonlyArray)));
        const sent = yield* adapter.send({ conversation: { channelId: "+15551110000" }, text: "hello" });
        const ts = Number(sent.messageId);
        yield* fake.emit(receive({ timestamp: 1, receiptMessage: { when: 11, isDelivery: true, timestamps: [ts] } }));
        yield* fake.emit(receive({ timestamp: 2, receiptMessage: { when: 12, isRead: true, timestamps: [ts] } }));
        const updates = yield* Fiber.join(fiber);
        expect(updates.map((u) => [u.messageId, u.status, u.at])).toEqual([[sent.messageId, "delivered", 11], [sent.messageId, "read", 12]]);
      }),
    ));

  test("a bad credential ends the stream as failed and does not retry", () =>
    run(
      Effect.gen(function* () {
        const fake = yield* makeFake();
        fake.failOpen(channelError("signal", "auth"));
        const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
        const error = yield* Effect.flip(adapter.start());
        expect(error.kind).toBe("auth");
        yield* TestClock.adjust("5 minutes");
        yield* settle;
        expect(fake.opens()).toBe(1);
        expect((yield* adapter.currentState).status).toBe("failed");
      }),
    ));

  test("a transient open failure keeps retrying with backoff and recovers", () =>
    run(
      Effect.gen(function* () {
        const fake = yield* makeFake();
        fake.failOpen(channelError("signal", "network"));
        const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
        yield* adapter.start();
        expect((yield* adapter.currentState).status).toBe("reconnecting");
        fake.failOpen(undefined);
        yield* TestClock.adjust("2 minutes");
        yield* settle;
        expect((yield* adapter.currentState).status).toBe("connected");
      }),
    ));

  test("sending while disconnected is a typed network error", () =>
    run(
      Effect.gen(function* () {
        const fake = yield* makeFake();
        fake.failOpen(channelError("signal", "network"));
        const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
        yield* adapter.start();
        const error = yield* Effect.flip(adapter.send({ conversation: { channelId: "G" }, text: "x" }));
        expect([error.kind, error.retryable]).toEqual(["network", true]);
      }),
    ));

  test("the account number is never logged, even on failure", async () => {
    const spies = [spyOn(console, "log"), spyOn(console, "error"), spyOn(console, "warn"), spyOn(console, "info"), spyOn(console, "debug")];
    const stderr = spyOn(process.stderr, "write");
    const stdout = spyOn(process.stdout, "write");
    try {
      await run(
        Effect.gen(function* () {
          const fake = yield* makeFake();
          fake.failSends(new SignalRpcError({ code: -1, message: `Authorization failed for ${ACCOUNT}` }));
          const adapter = new SignalChannelAdapter({ account: ACCOUNT, transport: fake.transport });
          yield* adapter.start();
          yield* Effect.flip(adapter.send({ conversation: { channelId: "G" }, text: "x" }));
        }),
      );
      const written = [...spies, stderr, stdout].flatMap((s) => s.mock.calls.map((c) => String(c[0])));
      expect(written.some((w) => w.includes(ACCOUNT))).toBe(false);
    } finally {
      for (const s of [...spies, stderr, stdout]) s.mockRestore();
    }
  });
});

describe("makeJsonRpcConnection", () => {
  const harness = Effect.gen(function* () {
    const lines = yield* Queue.unbounded<string | ChannelError>();
    const written: string[] = [];
    const connection = yield* makeJsonRpcConnection("signal", {
      lines: Stream.fromQueue(lines).pipe(Stream.mapEffect((l) => (typeof l === "string" ? Effect.succeed(l) : Effect.fail(l)))),
      write: (line) => Effect.sync(() => void written.push(line)),
      requestTimeout: "1 second",
    });
    return { connection, lines, written };
  });

  test("correlates responses by id, surfaces rpc errors, queues notifications, skips log noise", () =>
    run(
      Effect.gen(function* () {
        const { connection, lines, written } = yield* harness;
        const ok = yield* Effect.fork(connection.request("send", { message: "a" }));
        const bad = yield* Effect.fork(Effect.flip(connection.request("send", { message: "b" })));
        yield* settle;
        expect(written.map((w) => (JSON.parse(w) as { id: number }).id)).toEqual([1, 2]);
        yield* Queue.offer(lines, "INFO signal-cli starting");
        yield* Queue.offer(lines, JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -1, message: "Rate limit" } }));
        yield* Queue.offer(lines, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { timestamp: 9 } }));
        yield* Queue.offer(lines, JSON.stringify({ jsonrpc: "2.0", method: "receive", params: { envelope: {} } }));
        expect(yield* Fiber.join(ok)).toEqual({ timestamp: 9 });
        const err = yield* Fiber.join(bad);
        expect(err).toBeInstanceOf(SignalRpcError);
        const [n] = yield* connection.notifications.pipe(Stream.take(1), Stream.runCollect, Effect.map(Chunk.toReadonlyArray));
        expect(n?.method).toBe("receive");
      }),
    ));

  test("a closed line source fails pending requests and the notification stream with network", () =>
    run(
      Effect.gen(function* () {
        const { connection, lines } = yield* harness;
        const pending = yield* Effect.fork(Effect.flip(connection.request("send")));
        yield* settle;
        yield* Queue.offer(lines, channelError("signal", "network"));
        const err = yield* Fiber.join(pending);
        expect((err as ChannelError).kind).toBe("network");
        const streamErr = yield* Effect.flip(Stream.runCollect(connection.notifications));
        expect(streamErr.kind).toBe("network");
        const after = yield* Effect.flip(connection.request("send"));
        expect((after as ChannelError).kind).toBe("network");
      }),
    ));

  test("a request with no response times out as a network error", () =>
    run(
      Effect.gen(function* () {
        const { connection } = yield* harness;
        const fiber = yield* Effect.fork(Effect.flip(connection.request("send")));
        yield* settle;
        yield* TestClock.adjust("2 seconds");
        expect(((yield* Fiber.join(fiber)) as ChannelError).kind).toBe("network");
      }),
    ));
});
