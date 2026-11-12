import type { Duration, Effect, Scope } from "effect";
import type { ChannelAdapter } from "../../src/adapter.js";
import type { ChannelErrorKind } from "../../src/errors.js";
import type { Attachment } from "../../src/types.js";

/** A message as the fake platform delivers it to the adapter. */
export interface PlatformInbound {
  readonly id: string;
  readonly text: string;
  readonly senderId: string;
  readonly displayName?: string;
  readonly channelId?: string;
  readonly threadId?: string;
  readonly isGroup?: boolean;
  readonly replyTo?: string;
  readonly mentionsSelf?: boolean;
  /** The platform echoes the bot's own outbound message back. */
  readonly echo?: boolean;
  readonly attachments?: readonly Attachment[];
}

/** What the fake platform recorded as received from the adapter. */
export interface PlatformSent {
  readonly channelId: string;
  readonly threadId?: string;
  readonly text: string;
  readonly replyTo?: string;
}

export interface HarnessOptions {
  /** Inbound buffer size; the backpressure case uses a small one. */
  readonly inboundCapacity?: number;
  /** Outbound rate limit; the rate-limit case uses `{ max: 2, window: "1 second" }`. */
  readonly rateLimit?: { readonly max: number; readonly window: Duration.DurationInput };
}

/**
 * A fake platform wired to one started adapter (no network, no tokens). Each adapter under test
 * supplies one; the shared cases drive only this interface.
 */
export interface AdapterHarness {
  readonly adapter: ChannelAdapter;
  /** The credential in use, for the secret-leak case. Omit when the adapter has none. */
  readonly secret?: string;
  /**
   * The platform delivers a message to the adapter. Completes once the adapter has accepted it, so
   * it waits while the adapter applies backpressure.
   */
  readonly pushInbound: (message: PlatformInbound) => Effect.Effect<void>;
  /**
   * The platform's next outbound call fails the way a real platform would. The failure text includes
   * the secret (like a URL with a token) so the leak case is meaningful.
   */
  readonly failNextSend: (failure: { readonly kind: ChannelErrorKind; readonly retryAfterMs?: number }) => Effect.Effect<void>;
  readonly platformSent: Effect.Effect<readonly PlatformSent[]>;
  /**
   * The identifiers the envelope for a pushed message must carry. Default: the pushed `id` and
   * `channelId`. Platforms whose message ids are structured (Signal: `<author>:<timestamp>`) or whose
   * DM conversation is the sender's address supply this.
   */
  readonly expected?: (message: PlatformInbound) => {
    readonly id: string;
    readonly channelId: string;
    /** Platforms whose user ids are numeric (Telegram) map the pushed `senderId`. Default: `senderId`. */
    readonly userId?: string;
  };
  /** A thread reference this platform can parse (inbound `threadId` and outbound `threadId`). Default: opaque strings. */
  readonly threadRef?: string;
  /** A reply reference this platform can parse (inbound `replyTo` and outbound `replyTo`). Default: opaque strings. */
  readonly replyToRef?: string;
  /** Attachment kinds the platform carries. Default: both. */
  readonly attachmentKinds?: ReadonlyArray<"url" | "binary">;
  /** Simulate a socket drop. Omit for adapters without a long-lived connection (webhook). */
  readonly dropConnection?: Effect.Effect<void>;
}

export type MakeHarness = (options?: HarnessOptions) => Effect.Effect<AdapterHarness, never, Scope.Scope>;
