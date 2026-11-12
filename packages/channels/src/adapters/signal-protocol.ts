import { channelError, classifyChannelFailure, isChannelError, type ChannelError } from "../errors.js";
import { Predicate } from "effect";
import type { SignalNotification, SignalRpcError } from "./signal-transport.js";

const isSignalRpcError = (u: unknown): u is SignalRpcError => Predicate.isTagged(u, "SignalRpcError");

/**
 * Pure signal-cli JSON-RPC knowledge: notification parsing and failure mapping. No effects, so it is
 * tested directly and the adapter stays small.
 */

const rec = (u: unknown): Record<string, unknown> | undefined =>
  typeof u === "object" && u !== null && !Array.isArray(u) ? (u as Record<string, unknown>) : undefined;
const str = (u: unknown): string | undefined => (typeof u === "string" && u !== "" ? u : undefined);
const num = (u: unknown): number | undefined => (typeof u === "number" && Number.isFinite(u) ? u : undefined);
const list = (u: unknown): readonly unknown[] => (Array.isArray(u) ? u : []);

/** Attachment metadata from a received message; the bytes are fetched separately. */
export interface SignalAttachmentRef {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size?: number;
}

/** The bot's own identifiers, used to resolve `mentionsSelf` and echoes. */
export interface SignalSelf {
  readonly account: string;
  readonly accountUuid?: string;
}

/** A parsed `receive` notification. */
export type SignalEvent =
  | {
      readonly kind: "message";
      /** `<author>:<timestamp>`: unique across authors; also the format {@link parseReplyRef} accepts. */
      readonly id: string;
      readonly timestamp: number;
      readonly userId: string;
      readonly displayName?: string;
      readonly channelId: string;
      readonly isGroup: boolean;
      readonly text: string;
      readonly replyTo?: string;
      readonly mentionsSelf: boolean;
      readonly isEcho: boolean;
      readonly attachments: readonly SignalAttachmentRef[];
    }
  | {
      readonly kind: "receipt";
      readonly status: "delivered" | "read";
      /** Timestamps of the messages (as returned by `send`) the receipt confirms. */
      readonly messageTimestamps: readonly number[];
      readonly at: number;
    }
  | { readonly kind: "ignore" };

const IGNORE: SignalEvent = { kind: "ignore" };

/**
 * Parse one signal-cli notification.
 *
 * - `dataMessage`: a message from another account.
 * - `syncMessage.sentMessage`: a message sent from this account (another linked device, or this
 *   adapter). It is an echo only when its timestamp is one this adapter sent; echo detection is by
 *   message id (timestamp), never by text, so a user repeating the bot's words is still a user.
 * - `receiptMessage`: delivery or read confirmation for earlier sends.
 * - Typing indicators, reactions, empty messages and everything else are ignored.
 */
export const parseSignalNotification = (
  notification: SignalNotification,
  self: SignalSelf,
  wasSentByUs: (timestamp: string) => boolean,
): SignalEvent => {
  if (notification.method !== "receive") return IGNORE;
  const env = rec(notification.params.envelope);
  if (!env) return IGNORE;

  const receipt = rec(env.receiptMessage);
  if (receipt) {
    const status = receipt.isRead === true ? "read" : receipt.isDelivery === true ? "delivered" : undefined;
    const timestamps = list(receipt.timestamps).map(num).filter((t): t is number => t !== undefined);
    if (!status || timestamps.length === 0) return IGNORE;
    return { kind: "receipt", status, messageTimestamps: timestamps, at: num(receipt.when) ?? num(env.timestamp) ?? 0 };
  }

  const data = rec(env.dataMessage);
  const sync = rec(rec(env.syncMessage)?.sentMessage);
  const content = data ?? sync;
  if (!content) return IGNORE;

  const text = str(content.message) ?? "";
  const attachments: SignalAttachmentRef[] = [];
  for (const raw of list(content.attachments)) {
    const a = rec(raw);
    const id = str(a?.id);
    if (!a || !id) continue;
    attachments.push({
      id,
      filename: str(a.filename) ?? id,
      contentType: str(a.contentType) ?? "application/octet-stream",
      ...(num(a.size) !== undefined ? { size: num(a.size) as number } : {}),
    });
  }
  if (text === "" && attachments.length === 0) return IGNORE;

  const timestamp = num(content.timestamp) ?? num(env.timestamp);
  if (timestamp === undefined) return IGNORE;

  const userId = data ? (str(env.sourceNumber) ?? str(env.sourceUuid) ?? str(env.source)) : self.account;
  if (!userId) return IGNORE;

  const groupId = str(rec(content.groupInfo)?.groupId);
  const destination = sync ? (str(sync.destinationNumber) ?? str(sync.destination) ?? str(sync.destinationUuid)) : undefined;
  const channelId = groupId ?? (data ? userId : destination);
  if (!channelId) return IGNORE;
  const isGroup = groupId !== undefined;

  const isSelf = (candidate: string | undefined): boolean =>
    candidate !== undefined && (candidate === self.account || candidate === self.accountUuid);
  const quote = rec(content.quote);
  const quoteAuthor = str(quote?.authorNumber) ?? str(quote?.author) ?? str(quote?.authorUuid);
  const quoteId = num(quote?.id);
  const mentioned = list(content.mentions).some((m) => isSelf(str(rec(m)?.number)) || isSelf(str(rec(m)?.uuid)));

  const displayName = data ? str(env.sourceName) : undefined;
  return {
    kind: "message",
    id: `${userId}:${timestamp}`,
    timestamp,
    userId,
    ...(displayName !== undefined ? { displayName } : {}),
    channelId,
    isGroup,
    text,
    ...(quoteId !== undefined && quoteAuthor !== undefined ? { replyTo: `${quoteAuthor}:${quoteId}` } : {}),
    mentionsSelf: !isGroup || mentioned || isSelf(quoteAuthor),
    isEcho: sync !== undefined && data === undefined && wasSentByUs(String(timestamp)),
    attachments,
  };
};

/** Split a `<author>:<timestamp>` reply reference. Undefined when it is not one. */
export const parseReplyRef = (ref: string): { readonly author: string; readonly timestamp: number } | undefined => {
  const at = ref.lastIndexOf(":");
  if (at <= 0) return undefined;
  const timestamp = Number(ref.slice(at + 1));
  return Number.isInteger(timestamp) && timestamp > 0 ? { author: ref.slice(0, at), timestamp } : undefined;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DMs are addressed by phone number or uuid; everything else is a group id. */
export const isDirectAddress = (channelId: string): boolean => channelId.startsWith("+") || UUID.test(channelId);

// ── Failure mapping ─────────────────────────────────────────────────────────

const retryAfterMsOf = (data: unknown): number | undefined => {
  const seconds = (u: unknown): number | undefined => {
    const o = rec(u);
    return num(o?.retryAfterSeconds) ?? num(o?.retryAfter);
  };
  const direct = seconds(data);
  if (direct !== undefined) return Math.round(direct * 1000);
  const results = list(rec(rec(data)?.response)?.results ?? rec(data)?.results);
  for (const r of results) {
    const s = seconds(r);
    if (s !== undefined) return Math.round(s * 1000);
  }
  return undefined;
};

/** Per-recipient send result `type` values from signal-cli, mapped to {@link ChannelError} kinds. */
const RESULT_KIND: Readonly<Record<string, ChannelError["kind"]>> = {
  UNREGISTERED_FAILURE: "not_found",
  INVALID_NUMBER_FAILURE: "not_found",
  IDENTITY_FAILURE: "forbidden",
  PROOF_REQUIRED_FAILURE: "forbidden",
  RATE_LIMIT_FAILURE: "rate_limited",
  NETWORK_FAILURE: "network",
};

/**
 * Map a `send` response whose per-recipient results all failed. Returns undefined when at least
 * one recipient succeeded or the response has no results (signal-cli omits them on success).
 */
export const failureFromSendResult = (adapter: string, result: unknown): ChannelError | undefined => {
  const results = list(rec(result)?.results).map(rec).filter((r): r is Record<string, unknown> => r !== undefined);
  if (results.length === 0 || results.some((r) => r.type === "SUCCESS")) return undefined;
  const first = results[0];
  const type = str(first?.type) ?? "";
  const kind = RESULT_KIND[type] ?? "unknown";
  const retryAfterMs = kind === "rate_limited" ? retryAfterMsOf(first) : undefined;
  return channelError(adapter, kind, {
    message: `channel ${adapter}: signal send failed (${type || "unknown"})`,
    cause: first,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
};

/**
 * Map a signal-cli RPC error to a typed {@link ChannelError}. signal-cli reports most failures as
 * text, so this matches on message patterns; codes `-32601`/`-32602` mean the request itself was
 * wrong (`unsupported`). The raw text stays in `cause` only: it can contain the account number.
 */
export const mapSignalFailure = (adapter: string, failure: unknown): ChannelError => {
  if (isChannelError(failure)) return failure;
  if (!isSignalRpcError(failure)) return classifyChannelFailure(adapter, failure);
  const text = `${failure.message} ${typeof failure.data === "string" ? failure.data : JSON.stringify(failure.data ?? "")}`.toLowerCase();
  const make = (kind: ChannelError["kind"], retryAfterMs?: number): ChannelError =>
    channelError(adapter, kind, {
      message: `channel ${adapter}: signal-cli ${kind}`,
      cause: failure,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  if (/unregistereduser|unregistered user|not a signal user|recipient not registered|group not found|no such group/.test(text)) {
    return make("not_found");
  }
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return make("rate_limited", retryAfterMsOf(failure.data));
  if (/account.*(not registered|deregistered)|authorization|unauthori[sz]ed|invalid credentials|captcha|registration/.test(text)) {
    return make("auth");
  }
  if (/untrusted identity|identity key|not a member|blocked|forbidden/.test(text)) return make("forbidden");
  if (/too large|exceeds|size limit|\b413\b/.test(text)) return make("too_large");
  if (/timed out|timeout|connection|network|socket|unreachable|io ?exception|\b503\b/.test(text)) return make("network");
  if (failure.code === -32601 || failure.code === -32602) return make("unsupported");
  return make("unknown");
};
