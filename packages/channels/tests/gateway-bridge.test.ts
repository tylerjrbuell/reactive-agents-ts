import { describe, expect, test } from "bun:test";
import { Chunk, Effect, Fiber, Stream } from "effect";
import {
  makeScheduleRegistry,
  startIngress,
  WebhookServiceLive,
  type ScheduleRegistryService,
} from "@reactive-agents/gateway";
import { TelegramChannelAdapter } from "../src/adapters/telegram.js";
import { channelError } from "../src/errors.js";
import { channelWebhookRoute, deliverScheduleResult } from "../src/services/gateway-bridge.js";
import { FAKE_TOKEN, makeFakeTelegram } from "./conformance/telegram.fake.js";

const SECRET = "whsec_bridge";

const update = (text: string) =>
  JSON.stringify({
    update_id: 1,
    message: {
      message_id: 7,
      date: 1_700_000_000,
      chat: { id: 1001, type: "private" },
      from: { id: 1001, is_bot: false, first_name: "Ann", username: "ann" },
      text,
    },
  });

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", body, headers });

describe("telegram webhook through gateway ingress", () => {
  const boot = (f: (ctx: { url: string; adapter: TelegramChannelAdapter }) => Effect.Effect<void>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const adapter = new TelegramChannelAdapter({
          token: FAKE_TOKEN,
          fetch: makeFakeTelegram().fetch,
          chatRateLimit: false,
          webhook: { secretToken: SECRET },
        });
        yield* adapter.start();
        const ingress = yield* startIngress({
          maxBodyBytes: 4096,
          channelRoutes: [channelWebhookRoute("/channels/telegram", adapter)],
          onEvent: () => Effect.void,
        });
        yield* f({ url: ingress.url, adapter });
      }).pipe(Effect.provide(WebhookServiceLive()), Effect.scoped),
    );

  test("a correctly authenticated update reaches the adapter's inbound stream", () =>
    boot(({ url, adapter }) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(adapter.inbound.pipe(Stream.take(1), Stream.runCollect));
        const res = yield* Effect.promise(() =>
          post(`${url}/channels/telegram`, update("via ingress"), { "X-Telegram-Bot-Api-Secret-Token": SECRET }),
        );
        expect(res.status).toBe(200);
        const got = Chunk.toReadonlyArray(yield* Fiber.join(fiber));
        expect(got.map((e) => e.text)).toEqual(["via ingress"]);
      }),
    ));

  test("wrong or missing secret is 401 and nothing is enqueued", () =>
    boot(({ url }) =>
      Effect.gen(function* () {
        const wrong = yield* Effect.promise(() =>
          post(`${url}/channels/telegram`, update("x"), { "X-Telegram-Bot-Api-Secret-Token": "nope" }),
        );
        const missing = yield* Effect.promise(() => post(`${url}/channels/telegram`, update("x")));
        expect(wrong.status).toBe(401);
        expect(missing.status).toBe(401);
        expect(yield* Effect.promise(() => wrong.text())).not.toContain(SECRET);
      }),
    ));

  test("an oversized update is 413 before the adapter sees it", () =>
    boot(({ url }) =>
      Effect.gen(function* () {
        const res = yield* Effect.promise(() =>
          post(`${url}/channels/telegram`, update("x".repeat(8000)), { "X-Telegram-Bot-Api-Secret-Token": SECRET }),
        );
        expect(res.status).toBe(413);
      }),
    ));
});

describe("deliverScheduleResult", () => {
  // The in-memory store has nothing to release, so the registry outlives the closed scope.
  const withRun = async <A>(f: (r: ScheduleRegistryService) => Promise<A>): Promise<A> =>
    f(await Effect.runPromise(makeScheduleRegistry({}).pipe(Effect.scoped)));

  test("records the platform message id on success", () =>
    withRun(async (registry) => {
      const s = await Effect.runPromise(
        registry.create({
          id: "s1",
          cron: "* * * * *",
          instruction: "x",
          delivery: { adapterId: "tg", conversationId: "1001" },
        }),
      );
      const fire = await Effect.runPromise(registry.runNow("s1"));
      const sent: string[] = [];
      const channels = {
        deliver: (_id: string, m: { text: string }) =>
          Effect.sync(() => {
            sent.push(m.text);
            return { messageId: "tg-99", adapterId: "tg", platform: "telegram", status: "sent" as const, sentAt: 1 };
          }),
      };
      const record = await Effect.runPromise(
        deliverScheduleResult(channels, registry, { scheduleId: s.id, fireId: fire.fireId, delivery: s.delivery }, "report"),
      );
      expect(record).toEqual({ status: "delivered", messageId: "tg-99", adapterId: "tg", receiptStatus: "sent" });
      expect(sent).toEqual(["report"]);
      expect((await Effect.runPromise(registry.lastResult("s1")))?.delivery).toEqual(record);
    }));

  test("a failed send is recorded as a typed kind, not swallowed", () =>
    withRun(async (registry) => {
      await Effect.runPromise(
        registry.create({ id: "s2", cron: "* * * * *", instruction: "x", delivery: { adapterId: "tg", conversationId: "1" } }),
      );
      const fire = await Effect.runPromise(registry.runNow("s2"));
      const channels = { deliver: () => Effect.fail(channelError("tg", "rate_limited", { message: "tok_SECRET" })) };
      const record = await Effect.runPromise(
        deliverScheduleResult(
          channels,
          registry,
          { scheduleId: "s2", fireId: fire.fireId, delivery: { adapterId: "tg", conversationId: "1" } },
          "report",
        ),
      );
      expect(record).toEqual({
        status: "failed",
        error: "rate_limited",
        adapterId: "tg",
        errorKind: "rate_limited",
        retryable: true,
      });
      expect(JSON.stringify(await Effect.runPromise(registry.lastResult("s2")))).not.toContain("tok_SECRET");
    }));

  test("no delivery target means nothing is sent", () =>
    withRun(async (registry) => {
      const channels = { deliver: () => Effect.die("must not be called") };
      const record = await Effect.runPromise(
        deliverScheduleResult(channels, registry, { scheduleId: "s", fireId: "f" }, "x"),
      );
      expect(record).toBeUndefined();
    }));
});
