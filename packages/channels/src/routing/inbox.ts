import { Data, Effect } from "effect";
import type { Attachment, InboundMessage } from "../types.js";

/**
 * The durable inbox port. Every envelope the strict router accepts becomes one row; the row's status
 * says where the envelope is: `received` (accepted, no turn started), `running` (a turn holds it),
 * `done`, `failed` or `dropped`. Spec: `wiki/Architecture/Design-Specs/2026-11-16-always-on-gateway-primitives.md` (G1).
 *
 * Delivery is at-least-once with dedupe: a crash while a row is `running` re-runs it once per
 * attempt (bounded), a redelivery of an already accepted source id is refused.
 */
export type InboxStatus = "received" | "running" | "done" | "failed" | "dropped";

/** Row count per status. */
export type InboxCounts = Readonly<Record<InboxStatus, number>>;

/** A stored operation failed (disk full, locked file). The message names the operation, never message text. */
export class InboxError extends Data.TaggedError("InboxError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** One accepted envelope waiting for (or being retried into) a turn. */
export interface InboxEntry {
  /** Dedupe key: adapter id + the platform's source message id. */
  readonly key: string;
  readonly adapterId: string;
  readonly message: InboundMessage;
  readonly attempts: number;
}

/** What {@link RouterInbox.recover} changed at startup. */
export interface InboxRecovery {
  /** Rows returned to `received` for another attempt. */
  readonly requeued: ReadonlyArray<{ readonly key: string; readonly adapterId: string; readonly attempts: number }>;
  /** Rows out of attempts: now `failed`, never silent. */
  readonly exhausted: ReadonlyArray<{ readonly key: string; readonly adapterId: string; readonly attempts: number }>;
}

/** Terminal states a settled row may take. */
export type InboxSettled = "done" | "failed" | "dropped";

/** The durable inbox. Store failures are typed; the router reports and continues. */
export interface RouterInbox {
  /** Record a new envelope as `received`. False when the key was already accepted (a redelivery). */
  readonly accept: (key: string, adapterId: string, message: InboundMessage) => Effect.Effect<boolean, InboxError>;
  /** `received` to `running` (counts one attempt); a row already `running` is left as is. */
  readonly start: (keys: ReadonlyArray<string>) => Effect.Effect<void, InboxError>;
  /** Move rows to a terminal status. The stored message is cleared; the dedupe key stays until retention. */
  readonly settle: (
    keys: ReadonlyArray<string>,
    status: InboxSettled,
    detail?: string,
  ) => Effect.Effect<void, InboxError>;
  /** Startup recovery: `running` rows older than the lease TTL go back to `received`, or to `failed` when attempts ran out. */
  readonly recover: () => Effect.Effect<InboxRecovery, InboxError>;
  /** `received` rows, oldest first, ready to run. */
  readonly pending: () => Effect.Effect<ReadonlyArray<InboxEntry>, InboxError>;
  readonly counts: () => Effect.Effect<InboxCounts, InboxError>;
  /** Drop old terminal rows (age + count). Never touches `received` or `running`. Returns rows removed. */
  readonly prune: () => Effect.Effect<number, InboxError>;
}

/** Largest binary attachment kept in a stored row; a bigger one is dropped from the retry copy. */
const MAX_STORED_BINARY_BYTES = 1_048_576;

type StoredAttachment =
  | Extract<Attachment, { type: "url" }>
  | { readonly type: "binary"; readonly filename: string; readonly contentType: string; readonly base64: string };

const encodeAttachment = (a: Attachment): StoredAttachment | undefined =>
  a.type === "url"
    ? a
    : a.data.byteLength > MAX_STORED_BINARY_BYTES
      ? undefined
      : { type: "binary", filename: a.filename, contentType: a.contentType, base64: Buffer.from(a.data).toString("base64") };

const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null;

const decodeAttachment = (u: unknown): Attachment | undefined => {
  if (!isRecord(u) || typeof u["filename"] !== "string" || typeof u["contentType"] !== "string") return undefined;
  if (u["type"] === "url" && typeof u["url"] === "string") {
    return { type: "url", filename: u["filename"], contentType: u["contentType"], url: u["url"] };
  }
  if (u["type"] === "binary" && typeof u["base64"] === "string") {
    return { type: "binary", filename: u["filename"], contentType: u["contentType"], data: new Uint8Array(Buffer.from(u["base64"], "base64")) };
  }
  return undefined;
};

/** Serialize a message for the retry copy of an inbox row. */
export const encodeInboxMessage = (msg: InboundMessage): string =>
  JSON.stringify({
    id: msg.id,
    platform: msg.platform,
    channelId: msg.channelId,
    senderId: msg.senderId,
    ...(msg.senderName !== undefined ? { senderName: msg.senderName } : {}),
    content: msg.content,
    ...(msg.attachments ? { attachments: msg.attachments.map(encodeAttachment).filter((a) => a !== undefined) } : {}),
    ...(msg.replyTo !== undefined ? { replyTo: msg.replyTo } : {}),
    metadata: msg.metadata,
    timestamp: msg.timestamp.getTime(),
  });

/** Read a stored message back. Undefined when the row is not a valid message (the row is then failed, not run). */
export const decodeInboxMessage = (json: string): InboundMessage | undefined => {
  let u: unknown;
  try {
    u = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(u)) return undefined;
  const { id, platform, channelId, senderId, content, timestamp, metadata } = u;
  if (
    typeof id !== "string" ||
    typeof platform !== "string" ||
    typeof channelId !== "string" ||
    typeof senderId !== "string" ||
    typeof content !== "string" ||
    typeof timestamp !== "number" ||
    !isRecord(metadata)
  ) {
    return undefined;
  }
  const attachments = Array.isArray(u["attachments"])
    ? u["attachments"].map(decodeAttachment).filter((a): a is Attachment => a !== undefined)
    : undefined;
  return {
    id,
    platform,
    channelId,
    senderId,
    ...(typeof u["senderName"] === "string" ? { senderName: u["senderName"] } : {}),
    content,
    ...(attachments ? { attachments } : {}),
    ...(typeof u["replyTo"] === "string" ? { replyTo: u["replyTo"] } : {}),
    metadata,
    timestamp: new Date(timestamp),
  };
};
