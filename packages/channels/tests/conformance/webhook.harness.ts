import { createHmac } from "node:crypto";
import { Clock, Effect, identity, Stream } from "effect";
import type { ChannelAdapter } from "../../src/adapter.js";
import { WebhookChannelAdapter } from "../../src/adapters/webhook.js";
import { channelError, type ChannelErrorKind } from "../../src/errors.js";
import type { Attachment } from "../../src/types.js";
import type { AdapterHarness, MakeHarness, PlatformInbound, PlatformSent } from "./harness.js";

/** Deliberately broken adapters, to prove the shared cases go RED when a guarantee is cut. */
export type WebhookMutation = "duplicate-inbound" | "erase-error-kinds" | "leak-secret";

export const WEBHOOK_SECRET = "whsec_TOPSECRET_123";

const failureFor = (kind: ChannelErrorKind, retryAfterMs: number | undefined): Error => {
  // Like a real HTTP client error: the URL (with credential) is in the message.
  const message = `POST https://hooks.example.test/${WEBHOOK_SECRET}/send failed`;
  switch (kind) {
    case "auth":
      return Object.assign(new Error(message), { status: 401 });
    case "forbidden":
      return Object.assign(new Error(message), { status: 403 });
    case "not_found":
      return Object.assign(new Error(message), { status: 404 });
    case "too_large":
      return Object.assign(new Error(message), { status: 413 });
    case "rate_limited":
      return Object.assign(new Error(message), { status: 429, retryAfterMs });
    case "network":
      return Object.assign(new Error(message), { code: "ECONNRESET" });
    default:
      return new Error(message);
  }
};

const toWireAttachment = (a: Attachment): Record<string, unknown> =>
  a.type === "url"
    ? { url: a.url, filename: a.filename, contentType: a.contentType }
    : { data: Buffer.from(a.data).toString("base64"), filename: a.filename, contentType: a.contentType };

/** Fake platform for {@link WebhookChannelAdapter}: signed HTTP posts in, `onResponse` callback out. */
export const makeWebhookHarness =
  (mutation?: WebhookMutation): MakeHarness =>
  (options = {}) =>
    Effect.gen(function* () {
      const sent: PlatformSent[] = [];
      let pending: { kind: ChannelErrorKind; retryAfterMs?: number } | undefined;

      const real = new WebhookChannelAdapter({
        id: "wh-conf",
        secret: WEBHOOK_SECRET,
        inboundCapacity: options.inboundCapacity,
        rateLimit: options.rateLimit,
        onResponse: async (target, content) => {
          if (pending) {
            const f = pending;
            pending = undefined;
            throw failureFor(f.kind, f.retryAfterMs);
          }
          sent.push({
            channelId: target.channelId,
            ...(target.threadId !== undefined ? { threadId: target.threadId } : {}),
            text: content.text,
            ...(target.replyToMessageId !== undefined ? { replyTo: target.replyToMessageId } : {}),
          });
        },
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
                : real.inbound,
            state: real.state,
            currentState: real.currentState,
            start: () => real.start(),
            send: (m) =>
              real.send(m).pipe(
                mutation === "erase-error-kinds"
                  ? Effect.mapError((e) => channelError(e.adapter, "unknown"))
                  : mutation === "leak-secret"
                    ? Effect.mapError((e) => channelError(e.adapter, e.kind, { message: `failed using ${WEBHOOK_SECRET}` }))
                    : identity,
              ),
          }
        : real;

      const harness: AdapterHarness = {
        adapter,
        secret: WEBHOOK_SECRET,
        pushInbound: (m: PlatformInbound) =>
          Effect.gen(function* () {
            const body = JSON.stringify({
              id: m.id,
              content: m.text,
              channelId: m.channelId ?? "chan-1",
              senderId: m.senderId,
              senderName: m.displayName,
              threadId: m.threadId,
              isGroup: m.isGroup,
              replyTo: m.replyTo,
              mentionsSelf: m.mentionsSelf,
              isEcho: m.echo,
              attachments: m.attachments?.map(toWireAttachment),
            });
            const ts = String(Math.floor((yield* Clock.currentTimeMillis) / 1000));
            const signature = createHmac("sha256", WEBHOOK_SECRET).update(`${ts}.${body}`).digest("hex");
            yield* real.handleRequest({
              body,
              headers: { "x-channels-signature": signature, "x-channels-timestamp": ts },
            });
          }).pipe(Effect.orDie),
        failNextSend: (f) =>
          Effect.sync(() => {
            pending = f;
          }),
        platformSent: Effect.sync(() => [...sent]),
      };
      return harness;
    });
