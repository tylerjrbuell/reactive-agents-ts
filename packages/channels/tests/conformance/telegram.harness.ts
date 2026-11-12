import { Effect, identity, Stream } from "effect";
import type { ChannelAdapter } from "../../src/adapter.js";
import { TelegramChannelAdapter } from "../../src/adapters/telegram.js";
import { channelError, type ChannelErrorKind } from "../../src/errors.js";
import type { AdapterHarness, MakeHarness, PlatformInbound } from "./harness.js";
import { BOT_ID, BOT_USERNAME, FAKE_TOKEN, makeFakeTelegram } from "./telegram.fake.js";

/** Deliberately broken adapters, to prove the shared cases go RED when a guarantee is cut. */
export type TelegramMutation = "duplicate-inbound" | "erase-error-kinds" | "no-echo-detection";

export const TELEGRAM_REPLY_REF = "41";
export const TELEGRAM_THREAD_REF = "77";

/** A Telegram failure shaped like the real thing, with the bot token in the text. */
const failureFor = (kind: ChannelErrorKind, retryAfterMs: number | undefined): { status: number; body: unknown } => {
  const fail = (status: number, description: string, parameters?: unknown) => ({
    status,
    body: { ok: false, error_code: status, description, ...(parameters ? { parameters } : {}) },
  });
  switch (kind) {
    case "auth":
      return fail(401, `Unauthorized (bot${FAKE_TOKEN})`);
    case "forbidden":
      return fail(403, `Forbidden: bot was blocked by the user (bot${FAKE_TOKEN})`);
    case "not_found":
      return fail(400, `Bad Request: chat not found (bot${FAKE_TOKEN})`);
    case "too_large":
      return fail(413, `Request Entity Too Large (bot${FAKE_TOKEN})`);
    case "rate_limited":
      return fail(429, `Too Many Requests: retry after ${(retryAfterMs ?? 0) / 1000}`, { retry_after: (retryAfterMs ?? 0) / 1000 });
    case "network":
      return fail(502, `Bad Gateway (bot${FAKE_TOKEN})`);
    default:
      return fail(400, `Bad Request: boom (bot${FAKE_TOKEN})`);
  }
};

/** Fake Bot API server wired to a started `TelegramChannelAdapter`: no network, no real token. */
export const makeTelegramHarness =
  (mutation?: TelegramMutation): MakeHarness =>
  (options = {}) =>
    Effect.gen(function* () {
      const fake = makeFakeTelegram();
      const userIds = new Map<string, number>([
        ["user-1", 1001],
        ["alice", 1002],
      ]);
      const groupIds = new Map<string, number>();
      const messageIds = new Map<string, number>();

      const userNum = (senderId: string): number => {
        if (/^\d+$/.test(senderId)) return Number(senderId);
        const existing = userIds.get(senderId);
        if (existing !== undefined) return existing;
        const made = 2000 + userIds.size;
        userIds.set(senderId, made);
        return made;
      };
      const chatNum = (m: PlatformInbound): number => {
        if (!m.isGroup) return userNum(m.senderId);
        const key = m.channelId ?? "chan-1";
        const existing = groupIds.get(key);
        if (existing !== undefined) return existing;
        const made = -1_000_000_000_000 - groupIds.size - 1;
        groupIds.set(key, made);
        return made;
      };
      const messageNum = (id: string): number => {
        const existing = messageIds.get(id);
        if (existing !== undefined) return existing;
        const made = 100 + messageIds.size;
        messageIds.set(id, made);
        return made;
      };

      const real = new TelegramChannelAdapter({
        id: "telegram-conf",
        token: FAKE_TOKEN,
        fetch: fake.fetch,
        inboundCapacity: options.inboundCapacity,
        rateLimit: options.rateLimit,
        chatRateLimit: false,
      });
      yield* real.start();

      const adapter: ChannelAdapter = mutation
        ? {
            id: real.id,
            platform: real.platform,
            capabilities: real.capabilities,
            inbound:
              mutation === "duplicate-inbound"
                ? real.inbound.pipe(Stream.flatMap((e) => Stream.make(e, e)))
                : mutation === "no-echo-detection"
                  ? real.inbound.pipe(Stream.map((e) => ({ ...e, isEcho: false })))
                  : real.inbound,
            state: real.state,
            currentState: real.currentState,
            start: () => real.start(),
            send: (m) =>
              real.send(m).pipe(
                mutation === "erase-error-kinds"
                  ? Effect.mapError((e) => channelError(e.adapter, "unknown"))
                  : identity,
              ),
          }
        : real;

      const toUpdate = (m: PlatformInbound): Record<string, unknown> => {
        const chat = chatNum(m);
        const files = (m.attachments ?? []).flatMap((a, i) => {
          if (a.type !== "binary") return [];
          const fileId = `file-${m.id}-${i}`;
          fake.addFile(fileId, a.data);
          return [{ file_id: fileId, file_unique_id: `u-${fileId}`, file_name: a.filename, mime_type: a.contentType, file_size: a.data.length }];
        });
        const mention = m.mentionsSelf === true && !m.echo;
        const text = mention ? `@${BOT_USERNAME} ${m.text}` : m.text;
        const message = {
          message_id: messageNum(m.id),
          date: 1_699_000_000,
          chat: { id: chat, type: m.isGroup ? "supergroup" : "private", ...(m.isGroup ? { title: "Group" } : {}) },
          from: m.echo
            ? { id: BOT_ID, is_bot: true, first_name: "RA Test", username: BOT_USERNAME }
            : {
                id: userNum(m.senderId),
                is_bot: false,
                first_name: m.displayName ?? "User",
                ...(m.displayName !== undefined ? { username: m.displayName } : {}),
              },
          ...(files.length > 0 ? { caption: text, document: files[0] } : { text }),
          ...(mention ? { entities: [{ type: "mention", offset: 0, length: BOT_USERNAME.length + 1 }] } : {}),
          ...(m.replyTo !== undefined
            ? { reply_to_message: { message_id: Number(m.replyTo), chat: { id: chat }, from: { id: 999, is_bot: false, first_name: "Other" } } }
            : {}),
          ...(m.threadId !== undefined ? { is_topic_message: true, message_thread_id: Number(m.threadId) } : {}),
        };
        return { message };
      };

      const harness: AdapterHarness = {
        adapter,
        secret: FAKE_TOKEN,
        replyToRef: TELEGRAM_REPLY_REF,
        threadRef: TELEGRAM_THREAD_REF,
        attachmentKinds: ["binary"],
        expected: (m) => ({
          id: `${chatNum(m)}:${messageNum(m.id)}`,
          channelId: String(chatNum(m)),
          userId: String(userNum(m.senderId)),
        }),
        pushInbound: (m) => Effect.promise(() => fake.push(toUpdate(m)).confirmed),
        failNextSend: (f) =>
          Effect.sync(() => {
            fake.failNextSend(failureFor(f.kind, f.retryAfterMs));
          }),
        platformSent: Effect.sync(() =>
          fake.sends
            .filter((s) => s.method === "sendMessage")
            .map((s) => ({
              channelId: String(s.params.chat_id),
              ...(s.params.message_thread_id !== undefined ? { threadId: String(s.params.message_thread_id) } : {}),
              text: String(s.params.text),
              ...(rec(s.params.reply_parameters)?.message_id !== undefined
                ? { replyTo: String(rec(s.params.reply_parameters)?.message_id) }
                : {}),
            })),
        ),
        dropConnection: Effect.sync(() => fake.dropConnection()),
      };
      return harness;
    });

const rec = (u: unknown): Record<string, unknown> | undefined =>
  typeof u === "object" && u !== null ? (u as Record<string, unknown>) : undefined;
