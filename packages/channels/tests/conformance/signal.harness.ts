import { Clock, Deferred, Effect, identity, Queue, Stream } from "effect";
import type { ChannelAdapter } from "../../src/adapter.js";
import { SignalChannelAdapter } from "../../src/adapters/signal.js";
import { SignalRpcError, type SignalConnection, type SignalNotification, type SignalTransport } from "../../src/adapters/signal-transport.js";
import { channelError, type ChannelErrorKind } from "../../src/errors.js";
import type { AdapterHarness, MakeHarness, PlatformInbound, PlatformSent } from "./harness.js";

/** Deliberately broken adapters, to prove the shared cases go RED when a guarantee is cut. */
export type SignalMutation = "duplicate-inbound" | "erase-error-kinds" | "no-echo-detection";

/** The bot's own number: the credential the leak case hunts for. */
export const SIGNAL_ACCOUNT = "+15559990000";
export const SIGNAL_REPLY_REF = "+15550001111:1698000000000";

const BASE_TS = 1_699_000_000_000;

/** A signal-cli failure shaped like the real thing, with the account number in the text. */
const failureFor = (kind: ChannelErrorKind, retryAfterMs: number | undefined): { error?: SignalRpcError; result?: unknown } => {
  switch (kind) {
    case "auth":
      return { error: new SignalRpcError({ code: -1, message: `Authorization failed for ${SIGNAL_ACCOUNT}` }) };
    case "forbidden":
      return { error: new SignalRpcError({ code: -1, message: `Untrusted identity for ${SIGNAL_ACCOUNT}` }) };
    case "too_large":
      return { error: new SignalRpcError({ code: -1, message: `Message size exceeds limit (${SIGNAL_ACCOUNT})` }) };
    case "not_found":
      return { result: { results: [{ type: "UNREGISTERED_FAILURE", recipientAddress: { number: SIGNAL_ACCOUNT } }] } };
    case "rate_limited":
      return {
        result: { results: [{ type: "RATE_LIMIT_FAILURE", retryAfterSeconds: (retryAfterMs ?? 0) / 1000 }] },
      };
    case "network":
      return { result: { results: [{ type: "NETWORK_FAILURE" }] } };
    default:
      return { error: new SignalRpcError({ code: -1, message: `boom ${SIGNAL_ACCOUNT}` }) };
  }
};

/** Fake signal-cli: JSON-RPC in/out with no process, socket or account. */
export const makeSignalHarness =
  (mutation?: SignalMutation): MakeHarness =>
  (options = {}) =>
    Effect.gen(function* () {
      const sent: PlatformSent[] = [];
      let pending: { kind: ChannelErrorKind; retryAfterMs?: number } | undefined;
      let reservedTimestamp: number | undefined;
      let lastTimestamp = 0;
      let nextTs = BASE_TS;
      const timestamps = new Map<string, number>();
      const blobs = new Map<string, Uint8Array>();
      let dropCurrent: Deferred.Deferred<void> | undefined;
      const incoming = yield* Queue.unbounded<{ notification: SignalNotification; done: Deferred.Deferred<void> }>();

      const tsOf = (id: string): number => {
        const existing = timestamps.get(id);
        if (existing !== undefined) return existing;
        nextTs += 1000;
        timestamps.set(id, nextTs);
        return nextTs;
      };

      const request: SignalConnection["request"] = (method, params = {}) =>
        Effect.gen(function* () {
          if (method === "getAttachment") {
            const data = blobs.get(String(params.id));
            return data ? { data: Buffer.from(data).toString("base64") } : yield* Effect.fail(new SignalRpcError({ code: -1, message: "no such attachment" }));
          }
          if (method !== "send") return yield* Effect.fail(new SignalRpcError({ code: -32601, message: "Method not found" }));
          if (pending) {
            const f = failureFor(pending.kind, pending.retryAfterMs);
            pending = undefined;
            if (f.error) return yield* Effect.fail(f.error);
            return f.result;
          }
          const now = yield* Clock.currentTimeMillis;
          const timestamp = reservedTimestamp ?? Math.max(lastTimestamp + 1, now);
          reservedTimestamp = undefined;
          lastTimestamp = timestamp;
          const recipient = Array.isArray(params.recipient) ? String(params.recipient[0]) : undefined;
          sent.push({
            channelId: typeof params.groupId === "string" ? params.groupId : (recipient ?? ""),
            text: String(params.message),
            ...(typeof params.quoteTimestamp === "number"
              ? { replyTo: `${String(params.quoteAuthor)}:${params.quoteTimestamp}` }
              : {}),
          });
          return { timestamp, results: [{ type: "SUCCESS" }] };
        });

      // Each element is acknowledged only after the adapter has pulled past it, so a push completes
      // when the adapter accepted the message (and waits while the adapter applies backpressure).
      const transport: SignalTransport = {
        open: Effect.gen(function* () {
          const dropped = yield* Deferred.make<void>();
          dropCurrent = dropped;
          const notifications = Stream.fromQueue(incoming).pipe(
            Stream.flatMap(({ notification, done }) =>
              Stream.make(notification).pipe(
                Stream.concat(Stream.fromEffect(Deferred.succeed(done, undefined)).pipe(Stream.drain)),
              ),
            ),
            Stream.interruptWhen(Deferred.await(dropped)),
          );
          return { notifications, request };
        }),
      };

      const real = new SignalChannelAdapter({
        id: "signal-conf",
        account: SIGNAL_ACCOUNT,
        transport,
        inboundCapacity: options.inboundCapacity,
        rateLimit: options.rateLimit,
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

      const dmAddress = (m: PlatformInbound): string => m.senderId;

      const harness: AdapterHarness = {
        adapter,
        secret: SIGNAL_ACCOUNT,
        replyToRef: SIGNAL_REPLY_REF,
        attachmentKinds: ["binary"],
        expected: (m) => ({
          id: `${m.echo ? SIGNAL_ACCOUNT : m.senderId}:${tsOf(m.id)}`,
          channelId: m.isGroup ? (m.channelId ?? "chan-1") : dmAddress(m),
        }),
        pushInbound: (m: PlatformInbound) =>
          Effect.gen(function* () {
            const timestamp = tsOf(m.id);
            if (m.echo) {
              // The adapter really sends first, so the echo is recognised by the timestamp it was given.
              reservedTimestamp = timestamp;
              yield* real.send({ conversation: { channelId: m.channelId ?? "chan-1" }, text: m.text });
            }
            const attachments = (m.attachments ?? []).flatMap((a, i) => {
              if (a.type !== "binary") return [];
              const id = `att-${timestamp}-${i}`;
              blobs.set(id, a.data);
              return [{ id, contentType: a.contentType, filename: a.filename, size: a.data.length }];
            });
            const reply = m.replyTo?.match(/^(.+):(\d+)$/);
            const content = {
              timestamp,
              message: m.text,
              ...(m.isGroup ? { groupInfo: { groupId: m.channelId ?? "chan-1" } } : {}),
              ...(m.mentionsSelf ? { mentions: [{ number: SIGNAL_ACCOUNT, start: 0, length: 1 }] } : {}),
              ...(reply ? { quote: { id: Number(reply[2]), authorNumber: reply[1] } } : {}),
              ...(attachments.length > 0 ? { attachments } : {}),
            };
            const envelope = m.echo
              ? { source: SIGNAL_ACCOUNT, timestamp, syncMessage: { sentMessage: { ...content, destinationNumber: m.channelId ?? "chan-1" } } }
              : {
                  source: m.senderId,
                  sourceNumber: m.senderId,
                  ...(m.displayName !== undefined ? { sourceName: m.displayName } : {}),
                  timestamp,
                  dataMessage: content,
                };
            const done = yield* Deferred.make<void>();
            yield* Queue.offer(incoming, { notification: { method: "receive", params: { envelope } }, done });
            yield* Deferred.await(done);
          }),
        failNextSend: (f) =>
          Effect.sync(() => {
            pending = f;
          }),
        platformSent: Effect.sync(() => [...sent]),
        dropConnection: Effect.suspend(() => (dropCurrent ? Deferred.succeed(dropCurrent, undefined) : Effect.void)).pipe(
          Effect.asVoid,
        ),
      };
      return harness;
    });
