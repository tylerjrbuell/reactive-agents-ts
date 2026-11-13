import { describe, expect, test } from "bun:test";
import { Chunk, Effect, Fiber, Stream, TestClock, TestContext } from "effect";
import { TelegramChannelAdapter, type TelegramChannelAdapterConfig } from "../src/adapters/telegram.js";
import type { FetchLike } from "../src/adapters/telegram-api.js";
import type { InboundEnvelope, OutboundMessage } from "../src/adapter.js";
import { BOT_ID, FAKE_TOKEN, makeFakeTelegram, type FakeTelegram } from "./conformance/telegram.fake.js";

const START_MS = 1_700_000_000_000;

/** Run under a virtual clock; the fake Bot API settles on real microtasks, hence the real tick. */
const run = <A, E>(effect: Effect.Effect<A, E, import("effect").Scope.Scope | import("effect").TestClock.TestClock>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(START_MS);
      return yield* effect;
    }).pipe(Effect.scoped, Effect.provide(TestContext.TestContext)),
  );

const tick = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const settle = Effect.repeatN(Effect.zipRight(Effect.yieldNow(), tick), 6);

const texts = (envelopes: Chunk.Chunk<InboundEnvelope>): string[] => Chunk.toReadonlyArray(envelopes).map((e) => e.text);

let nextMessage = 1;
const message = (over: Record<string, unknown> = {}, from: Record<string, unknown> = {}) => ({
  message: {
    message_id: nextMessage++,
    date: 1_700_000_000,
    chat: { id: 1001, type: "private" },
    from: { id: 1001, is_bot: false, first_name: "Ann", username: "ann", ...from },
    text: "hi",
    ...over,
  },
});

const make = (
  config: Partial<TelegramChannelAdapterConfig> = {},
  fake: FakeTelegram = makeFakeTelegram(),
) => {
  const adapter = new TelegramChannelAdapter({ token: FAKE_TOKEN, fetch: fake.fetch, chatRateLimit: false, ...config });
  return { fake, adapter };
};

const started = (config: Partial<TelegramChannelAdapterConfig> = {}, fake?: FakeTelegram) =>
  Effect.gen(function* () {
    const made = make(config, fake);
    yield* made.adapter.start();
    return made;
  });

const out = (text: string, over: Partial<OutboundMessage> = {}): OutboundMessage => ({
  conversation: { channelId: "1001" },
  text,
  ...over,
});

describe("TelegramChannelAdapter inbound", () => {
  test("offset advances only after the update was handed to the inbound queue", () =>
    run(
      Effect.gen(function* () {
        const offsets: number[] = [];
        const { fake, adapter } = yield* started({ inboundCapacity: 1, onOffset: (o) => Effect.sync(() => void offsets.push(o)) });
        const a = fake.push(message({ text: "a" }));
        const b = fake.push(message({ text: "b" }));
        yield* settle;
        // `a` sits in the full buffer (handed off); `b` is blocked on the full queue (not handed off).
        expect(offsets).toEqual([a.updateId + 1]);
        expect(Math.max(...fake.pollOffsets)).toBe(a.updateId + 1);
        const got = yield* adapter.inbound.pipe(Stream.take(2), Stream.runCollect);
        yield* settle;
        expect(got.length).toBe(2);
        expect(offsets).toEqual([a.updateId + 1, b.updateId + 1]);
      }),
    ));

  test("a persisted offset resumes where the last run left off", () =>
    run(
      Effect.gen(function* () {
        const { fake } = yield* started({ initialOffset: 4242 });
        yield* settle;
        expect(fake.pollOffsets[0]).toBe(4242);
      }),
    ));

  test("a replayed update (same update_id and message) is delivered once", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        const m = message({ text: "once" });
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(2), Stream.runCollect));
        fake.push(m);
        fake.push(m);
        fake.push(message({ text: "second" }));
        yield* settle;
        expect(texts(yield* Fiber.join(fiber))).toEqual(["once", "second"]);
      }),
    ));

  test("a message the adapter sent is an echo by id, even from another sender", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        const receipt = yield* adapter.send(out("bot says hi"));
        const [chat, id] = receipt.messageId.split(":");
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(1), Stream.runCollect));
        fake.push(message({ message_id: Number(id), chat: { id: Number(chat), type: "private" }, text: "bot says hi" }));
        yield* settle;
        const [env] = yield* Fiber.join(fiber);
        expect(env?.isEcho).toBe(true);
      }),
    ));

  test("a failed attachment download is counted, not dropped silently", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        fake.addFile("ok-file", new Uint8Array([9, 9]));
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(1), Stream.runCollect));
        fake.push(
          message({
            text: undefined,
            caption: "two files",
            document: { file_id: "ok-file", file_name: "a.bin", mime_type: "application/octet-stream" },
            photo: [{ file_id: "missing", file_size: 5, width: 1, height: 1 }],
          }),
        );
        yield* settle;
        const [env] = yield* Fiber.join(fiber);
        expect(env?.attachments.map((a) => a.type === "binary" && [...a.data])).toEqual([[9, 9]]);
        expect(env?.metadata?.attachmentsUnavailable).toBe(1);
      }),
    ));

  test("an oversized file is not downloaded", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started({ maxInboundAttachmentBytes: 10 });
        fake.addFile("big", new Uint8Array(100));
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(1), Stream.runCollect));
        fake.push(message({ text: "x", document: { file_id: "big", file_size: 100 } }));
        yield* settle;
        const [env] = yield* Fiber.join(fiber);
        expect(env?.attachments).toEqual([]);
        expect(fake.methods).not.toContain("getFile");
      }),
    ));
});

describe("TelegramChannelAdapter polling failures", () => {
  test("409 conflict is a typed non-retryable error with a clear message and is not retried", () =>
    run(
      Effect.gen(function* () {
        const fake = makeFakeTelegram();
        fake.failNextPoll({ status: 409, body: { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" } });
        const { adapter } = make({}, fake);
        yield* adapter.start();
        const error = yield* Effect.flip(Stream.runDrain(adapter.inbound));
        expect(error.retryable).toBe(false);
        expect(error.message).toContain("409");
        expect((yield* adapter.currentState).status).toBe("failed");
        yield* TestClock.adjust("5 minutes");
        yield* settle;
        expect(fake.methods.filter((m) => m === "getUpdates").length).toBe(1);
      }),
    ));

  test("a bad token (401) stops with an auth error instead of retrying", () =>
    run(
      Effect.gen(function* () {
        const fake = makeFakeTelegram();
        const adapter = new TelegramChannelAdapter({ token: "999:wrong", fetch: fake.fetch });
        const error = yield* Effect.flip(adapter.start());
        expect(error.kind).toBe("auth");
        expect(error.retryable).toBe(false);
      }),
    ));

  test("429 on getUpdates backs off and then resumes without losing messages", () =>
    run(
      Effect.gen(function* () {
        const fake = makeFakeTelegram();
        fake.failNextPoll({ status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 1 } } });
        const { adapter } = make({}, fake);
        yield* adapter.start();
        yield* settle;
        expect((yield* adapter.currentState).status).toBe("reconnecting");
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(1), Stream.runCollect));
        fake.push(message({ text: "after the limit" }));
        yield* TestClock.adjust("2 seconds");
        yield* settle;
        expect(texts(yield* Fiber.join(fiber))).toEqual(["after the limit"]);
        expect((yield* adapter.currentState).status).toBe("connected");
      }),
    ));
});

describe("TelegramChannelAdapter outbound", () => {
  test("429 on send surfaces retryAfterMs from retry_after", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        fake.failNextSend({ status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } } });
        const error = yield* Effect.flip(adapter.send(out("x")));
        expect(error).toMatchObject({ kind: "rate_limited", retryable: true, retryAfterMs: 3000 });
      }),
    ));

  test("long text is split at 4096, only the first part replies, the receipt is the last part", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        const receipt = yield* adapter.send(out(`${"a".repeat(4000)}\n\n${"b".repeat(4000)}`, { replyTo: "7" }));
        const texts = fake.sends.filter((s) => s.method === "sendMessage");
        expect(texts.map((s) => String(s.params.text).length)).toEqual([4000, 4000]);
        expect(texts[0]?.params.reply_parameters).toEqual({ message_id: 7, allow_sending_without_reply: true });
        expect(texts[1]?.params.reply_parameters).toBeUndefined();
        expect(receipt.messageId).toBe("1001:5001");
      }),
    ));

  test("markdown is converted to MarkdownV2; plain text is sent untouched", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        yield* adapter.send(out("**hi** snake_case.", { format: "markdown" }));
        yield* adapter.send(out("**hi** snake_case."));
        const [md, plain] = fake.sends;
        expect(md?.params).toMatchObject({ text: "*hi* snake\\_case\\.", parse_mode: "MarkdownV2" });
        expect(plain?.params.text).toBe("**hi** snake_case.");
        expect(plain?.params.parse_mode).toBeUndefined();
      }),
    ));

  test("if Telegram rejects the entities the text is resent as plain text", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        fake.failNextSend({ status: 400, body: { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Can't find end of the entity" } });
        const receipt = yield* adapter.send(out("a *b", { format: "markdown" }));
        expect(receipt.messageId).toBe("1001:5000");
        expect(fake.sends.map((s) => s.params.parse_mode)).toEqual([undefined]);
        expect(fake.sends[0]?.params.text).toBe("a *b");
      }),
    ));

  test("attachments: png as photo, other bytes as document (multipart), urls by reference", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        yield* adapter.send(
          out("", {
            attachments: [
              { type: "binary", filename: "p.png", contentType: "image/png", data: new Uint8Array([1, 2]) },
              { type: "binary", filename: "r.pdf", contentType: "application/pdf", data: new Uint8Array([3]) },
              { type: "url", filename: "u.jpg", contentType: "image/jpeg", url: "https://example.test/u.jpg" },
            ],
          }),
        );
        expect(fake.sends.map((s) => s.method)).toEqual(["sendPhoto", "sendDocument", "sendPhoto"]);
        expect([...(fake.sends[0]?.files.photo?.data ?? [])]).toEqual([1, 2]);
        expect(fake.sends[1]?.files.document?.filename).toBe("r.pdf");
        expect(fake.sends[2]?.params.photo).toBe("https://example.test/u.jpg");
      }),
    ));

  test("invalid references are typed unsupported errors, not platform calls", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        const thread = yield* Effect.flip(adapter.send(out("x", { conversation: { channelId: "1001", threadId: "topic-a" } })));
        const reply = yield* Effect.flip(adapter.send(out("x", { replyTo: "999:5" })));
        const empty = yield* Effect.flip(adapter.send(out("")));
        expect([thread.kind, reply.kind, empty.kind]).toEqual(["unsupported", "unsupported", "unsupported"]);
        expect(fake.sends).toEqual([]);
        // An envelope id for the same chat is a valid reply reference.
        yield* adapter.send(out("ok", { replyTo: "1001:5" }));
        expect(fake.sends[0]?.params.reply_parameters).toMatchObject({ message_id: 5 });
      }),
    ));

  test("DM and group sends respect Telegram's per-chat limits (delayed, not dropped)", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started({ chatRateLimit: {} });
        const dm = yield* Effect.forEach(["1", "2"], (t) => Effect.fork(adapter.send(out(t))));
        yield* settle;
        expect(fake.sends.length).toBe(1);
        yield* TestClock.adjust("1 second");
        yield* settle;
        yield* Effect.forEach(dm, Fiber.join);
        expect(fake.sends.length).toBe(2);

        const group = yield* Effect.forEach(Array.from({ length: 21 }, (_, i) => i), (i) =>
          Effect.fork(adapter.send(out(`g${i}`, { conversation: { channelId: "-100200" } }))),
        );
        yield* TestClock.adjust("1 second");
        yield* settle;
        expect(fake.sends.filter((s) => s.params.chat_id === -100200).length).toBe(20);
        yield* TestClock.adjust("1 minute");
        yield* settle;
        yield* Effect.forEach(group, Fiber.join);
        expect(fake.sends.filter((s) => s.params.chat_id === -100200).length).toBe(21);
      }),
    ));
});

describe("TelegramChannelAdapter secrets", () => {
  test("a transport failure whose text carries the URL never leaks the token", () =>
    run(
      Effect.gen(function* () {
        const fake = makeFakeTelegram();
        const leaky: FetchLike = (url, init) =>
          url.endsWith("/sendMessage")
            ? Promise.reject(Object.assign(new TypeError(`Unable to connect to ${url}`), { code: "ECONNREFUSED" }))
            : fake.fetch(url, init);
        const { adapter } = yield* started({ fetch: leaky });
        const error = yield* Effect.flip(adapter.send(out("x")));
        expect(error.kind).toBe("network");
        const surface = [error.message, String(error), JSON.stringify(error.cause)].join("\n");
        expect(surface).not.toContain(FAKE_TOKEN);
        expect(surface).not.toContain("api.telegram.org");
        // The token really is in the request URL; that is the only place it goes.
        expect(fake.urls.some((u) => u.includes(FAKE_TOKEN))).toBe(true);
      }),
    ));

  test("a Telegram error body that echoes the token is scrubbed from the retained cause", () =>
    run(
      Effect.gen(function* () {
        const { fake, adapter } = yield* started();
        fake.failNextSend({ status: 403, body: { ok: false, error_code: 403, description: `Forbidden for bot${FAKE_TOKEN}` } });
        const error = yield* Effect.flip(adapter.send(out("x")));
        expect(JSON.stringify(error.cause)).not.toContain(FAKE_TOKEN);
        expect(String(error)).not.toContain(FAKE_TOKEN);
      }),
    ));
});

describe("TelegramChannelAdapter webhook mode", () => {
  const SECRET = "hook-secret-value";
  const body = (m: unknown) => JSON.stringify({ update_id: 1, ...(m as object) });
  const headers = (secret = SECRET) => ({ "X-Telegram-Bot-Api-Secret-Token": secret });

  test("start registers the webhook with the secret and does not poll", () =>
    run(
      Effect.gen(function* () {
        const { fake } = yield* started({ webhook: { secretToken: SECRET, url: "https://example.test/hook" } });
        yield* settle;
        expect(fake.methods).toContain("setWebhook");
        expect(fake.methods).not.toContain("getUpdates");
        expect(fake.sends.find((s) => s.method === "setWebhook")?.params).toMatchObject({ url: "https://example.test/hook", secret_token: SECRET });
      }),
    ));

  test("a request with the right secret is delivered; wrong or missing secrets are forbidden", () =>
    run(
      Effect.gen(function* () {
        const { adapter } = yield* started({ webhook: { secretToken: SECRET } });
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(1), Stream.runCollect));
        const wrong = yield* Effect.flip(adapter.handleWebhook({ body: body(message()), headers: headers("nope") }));
        const missing = yield* Effect.flip(adapter.handleWebhook({ body: body(message()), headers: {} }));
        expect([wrong.kind, missing.kind]).toEqual(["forbidden", "forbidden"]);
        yield* adapter.handleWebhook({ body: body(message({ text: "via webhook" })), headers: headers() });
        expect(texts(yield* Fiber.join(fiber))).toEqual(["via webhook"]);
      }),
    ));

  test("without a configured secret every request is rejected (fail closed)", () =>
    run(
      Effect.gen(function* () {
        const { adapter } = yield* started();
        const error = yield* Effect.flip(adapter.handleWebhook({ body: body(message()), headers: headers() }));
        expect(error.kind).toBe("forbidden");
      }),
    ));

  test("before start() the webhook is not accepting, and a bad body is typed", () =>
    run(
      Effect.gen(function* () {
        const { adapter } = make({ webhook: { secretToken: SECRET } });
        const early = yield* Effect.flip(adapter.handleWebhook({ body: body(message()), headers: headers() }));
        expect(early.kind).toBe("unsupported");
        yield* adapter.start();
        const junk = yield* Effect.flip(adapter.handleWebhook({ body: "not json", headers: headers() }));
        expect(junk.kind).toBe("unsupported");
        expect(BOT_ID).toBeGreaterThan(0);
      }),
    ));
});

describe("TelegramChannelAdapter webhook backpressure", () => {
  const SECRET = "hook-secret-value";
  const hook = (updateId: number, text: string) => ({
    body: JSON.stringify({ update_id: updateId, ...message({ text }) }),
    headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET },
  });

  test("a full inbound buffer fails the webhook request as rate_limited after the enqueue timeout", () =>
    run(
      Effect.gen(function* () {
        const { adapter } = yield* started({
          webhook: { secretToken: SECRET },
          inboundCapacity: 1,
          enqueueTimeoutMs: 1000,
        });
        yield* adapter.handleWebhook(hook(11, "fills the buffer"));
        const stalled = yield* Effect.fork(Effect.flip(adapter.handleWebhook(hook(12, "no room"))));
        yield* Effect.yieldNow();
        yield* TestClock.adjust("1 second");
        const error = yield* Fiber.join(stalled);
        expect(error.kind).toBe("rate_limited");
      }),
    ));
});
