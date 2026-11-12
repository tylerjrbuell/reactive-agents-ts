import type { Effect, Scope, Stream } from "effect";
import type { ChannelError } from "./errors.js";
import type { Attachment, InboundMessage } from "./types.js";

/**
 * The canonical channel contract. Every platform (Signal, Telegram, Discord, Slack, email, SMS,
 * webhook) is a {@link ChannelAdapter}: it owns the platform (inbound, outbound, identity,
 * receipts, reconnect) and the gateway only ever sees {@link InboundEnvelope} and
 * {@link OutboundMessage}. No platform-specific code lives in the gateway or runtime.
 *
 * Every shipped adapter must pass `runAdapterConformance` (`tests/conformance/`).
 */

/** Who sent a message. Access control keys on `platform:userId` (see gateway `channelSenderKey`). */
export interface ChannelIdentity {
  readonly platform: string;
  readonly userId: string;
  readonly displayName?: string;
}

/** Where a message lives: a DM, a group, or a thread inside one. */
export interface ChannelConversation {
  readonly channelId: string;
  readonly threadId?: string;
  readonly isGroup: boolean;
}

/** One inbound platform message, normalized by the adapter. */
export interface InboundEnvelope {
  /** Platform message id. The idempotency key: an adapter never emits the same id twice. */
  readonly id: string;
  readonly conversation: ChannelConversation;
  readonly sender: ChannelIdentity;
  readonly text: string;
  readonly attachments: readonly Attachment[];
  /** Platform id of the message this one replies to. */
  readonly replyTo?: string;
  /** Adapter-resolved: the message addresses the bot (mention, reply to bot, DM). */
  readonly mentionsSelf: boolean;
  /** The bot's own outbound message echoed back by the platform. `ChannelService` drops these. */
  readonly isEcho: boolean;
  /** Epoch milliseconds. */
  readonly receivedAt: number;
  /** Small platform-specific extras. Never secrets. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** One outbound message handed to {@link ChannelAdapter.send}. */
export interface OutboundMessage {
  readonly conversation: { readonly channelId: string; readonly threadId?: string };
  readonly text: string;
  readonly format?: "plain" | "markdown";
  readonly attachments?: readonly Attachment[];
  /** Platform id of the message to reply to. */
  readonly replyTo?: string;
}

/** Proof of delivery: the platform's real message id, never a fabricated one. */
export interface DeliveryReceipt {
  /** Real platform message id. Unique per send. */
  readonly messageId: string;
  readonly adapterId: string;
  readonly platform: string;
  /** `sent` accepted by the platform, `queued` accepted for later delivery, `delivered` confirmed. */
  readonly status: "sent" | "queued" | "delivered";
  /** Epoch milliseconds; non-decreasing across sequential sends from one adapter. */
  readonly sentAt: number;
}

/**
 * A later delivery confirmation for a message the adapter sent (Signal delivery and read receipts).
 * `messageId` is the {@link DeliveryReceipt.messageId} that `send` returned.
 */
export interface DeliveryUpdate {
  readonly messageId: string;
  readonly adapterId: string;
  readonly platform: string;
  readonly status: "delivered" | "read";
  /** Epoch milliseconds the platform reported. */
  readonly at: number;
}

/** What an adapter can do, so callers degrade instead of guessing. */
export interface ChannelCapabilities {
  readonly threads: boolean;
  readonly attachments: boolean;
  readonly markdown: boolean;
  /** Reports `delivered` receipts, not just `sent`. */
  readonly receipts: boolean;
  readonly groups: boolean;
  readonly maxTextLength?: number;
  readonly maxAttachmentBytes?: number;
}

/** Honest connection state; `ChannelService.status()` reads it. */
export type ConnectionState =
  | { readonly status: "connecting" }
  | { readonly status: "connected" }
  | { readonly status: "reconnecting"; readonly error: ChannelError }
  | { readonly status: "disconnected" }
  | { readonly status: "failed"; readonly error: ChannelError };

/**
 * A platform adapter.
 *
 * - `inbound` is a backpressured stream: a slow consumer slows the adapter instead of dropping messages.
 * - `start` is scoped: closing the scope disconnects. Reconnect with backoff is internal
 *   (see `withReconnect`).
 * - `send` returns a real {@link DeliveryReceipt} or fails with a typed {@link ChannelError}.
 * - Credentials are `Redacted` (or read from env/key store) and never appear in logs, errors or events.
 */
export interface ChannelAdapter {
  readonly id: string;
  readonly platform: string;
  readonly capabilities: ChannelCapabilities;
  readonly inbound: Stream.Stream<InboundEnvelope, ChannelError>;
  /** Connection-state changes (starts with the current value). */
  readonly state: Stream.Stream<ConnectionState>;
  /** Snapshot of the current connection state. */
  readonly currentState: Effect.Effect<ConnectionState>;
  /** Present when `capabilities.receipts`: delivered/read confirmations for earlier sends. */
  readonly deliveryUpdates?: Stream.Stream<DeliveryUpdate>;
  /**
   * Optional: receive the sender gate before `start`. Adapters that download inbound attachments
   * MUST consult it first and count a denied sender's files as unavailable, never fetch them.
   */
  setSenderGate?(gate: SenderGate): void;
  start(): Effect.Effect<void, ChannelError, Scope.Scope>;
  send(message: OutboundMessage): Effect.Effect<DeliveryReceipt, ChannelError>;
}

/**
 * Decides whether a sender may cause the adapter to spend resources on their behalf (download
 * attachments). `ChannelService` installs it from the gateway access policy on registration.
 */
export type SenderGate = (sender: {
  readonly platform: string;
  readonly userId: string;
}) => Effect.Effect<boolean>;

/** Structural check used by `ChannelService.registerAdapter` to tell new adapters from legacy `MessageChannel`s. */
export const isChannelAdapter = (x: unknown): x is ChannelAdapter => {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.start === "function" &&
    typeof o.send === "function" &&
    typeof o.platform === "string" &&
    typeof o.inbound === "object" &&
    o.inbound !== null
  );
};

/** Convert an {@link InboundEnvelope} to the legacy {@link InboundMessage} that triggers and sessions read. */
export const envelopeToInboundMessage = (env: InboundEnvelope): InboundMessage => ({
  id: env.id,
  platform: env.sender.platform,
  channelId: env.conversation.channelId,
  senderId: env.sender.userId,
  ...(env.sender.displayName !== undefined ? { senderName: env.sender.displayName } : {}),
  content: env.text,
  ...(env.attachments.length > 0 ? { attachments: [...env.attachments] } : {}),
  ...(env.replyTo !== undefined ? { replyTo: env.replyTo } : {}),
  metadata: {
    ...(env.metadata ?? {}),
    isGroup: env.conversation.isGroup,
    mentionsSelf: env.mentionsSelf,
    ...(env.conversation.threadId !== undefined ? { threadId: env.conversation.threadId } : {}),
  },
  timestamp: new Date(env.receivedAt),
});
