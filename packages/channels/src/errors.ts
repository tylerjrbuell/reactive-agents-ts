import { Data, Predicate } from "effect";

export class ChannelConnectionError extends Data.TaggedError("ChannelConnectionError")<{
  readonly adapter: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/** Why a channel operation failed. Drives retry policy and operator-facing messages. */
export type ChannelErrorKind =
  | "auth"
  | "rate_limited"
  | "not_found"
  | "forbidden"
  | "too_large"
  | "unsupported"
  | "network"
  | "unknown";

/**
 * Typed failure of the canonical {@link import("./adapter.js").ChannelAdapter} contract.
 * `message` is generic by design: platform error text can echo URLs or tokens, so the raw
 * failure lives only in `cause` and must not be logged or published.
 */
export class ChannelError extends Data.TaggedError("ChannelError")<{
  readonly adapter: string;
  readonly kind: ChannelErrorKind;
  /** True when retrying the same operation later can succeed (`rate_limited`, `network`). */
  readonly retryable: boolean;
  /** Platform-requested wait before retry (rate limits). */
  readonly retryAfterMs?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** `_tag` guard for {@link ChannelError}. */
export const isChannelError = (u: unknown): u is ChannelError => Predicate.isTagged(u, "ChannelError");

const isChannelSendError = (u: unknown): u is ChannelSendError => Predicate.isTagged(u, "ChannelSendError");

const RETRYABLE_KINDS: ReadonlySet<ChannelErrorKind> = new Set(["rate_limited", "network"]);

/** Build a {@link ChannelError}; `retryable` is derived from `kind`. */
export const channelError = (
  adapter: string,
  kind: ChannelErrorKind,
  opts: { readonly message?: string; readonly retryAfterMs?: number; readonly cause?: unknown } = {},
): ChannelError =>
  new ChannelError({
    adapter,
    kind,
    retryable: RETRYABLE_KINDS.has(kind),
    message: opts.message ?? `channel ${adapter}: ${kind}`,
    ...(opts.retryAfterMs !== undefined ? { retryAfterMs: opts.retryAfterMs } : {}),
    ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
  });

const NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

const LEGACY_REASON_TO_KIND: Readonly<Record<string, ChannelErrorKind>> = {
  rate_limited: "rate_limited",
  message_too_large: "too_large",
  channel_not_found: "not_found",
  unauthorized: "auth",
};

/**
 * Map any thrown value to a {@link ChannelError}. Understands existing {@link ChannelError}s,
 * legacy {@link ChannelSendError}s, HTTP-style `{ status, retryAfterMs? }` and Node `{ code }` failures.
 */
export const classifyChannelFailure = (adapter: string, cause: unknown): ChannelError => {
  if (isChannelError(cause)) return cause;
  if (isChannelSendError(cause)) {
    return channelError(adapter, LEGACY_REASON_TO_KIND[cause.reason] ?? "unknown", { cause });
  }
  if (typeof cause === "object" && cause !== null) {
    const c = cause as { status?: unknown; code?: unknown; retryAfterMs?: unknown };
    if (typeof c.status === "number") {
      const retryAfterMs = typeof c.retryAfterMs === "number" ? c.retryAfterMs : undefined;
      if (c.status === 401) return channelError(adapter, "auth", { cause });
      if (c.status === 403) return channelError(adapter, "forbidden", { cause });
      if (c.status === 404) return channelError(adapter, "not_found", { cause });
      if (c.status === 413) return channelError(adapter, "too_large", { cause });
      if (c.status === 429) return channelError(adapter, "rate_limited", { cause, retryAfterMs });
      if (c.status >= 500) return channelError(adapter, "network", { cause });
    }
    if (typeof c.code === "string" && NETWORK_CODES.has(c.code)) {
      return channelError(adapter, "network", { cause });
    }
  }
  return channelError(adapter, "unknown", { cause });
};

/** @deprecated Use {@link ChannelError}; kept for the legacy `MessageChannel.sendMessage` surface. */
export class ChannelSendError extends Data.TaggedError("ChannelSendError")<{
  readonly adapter: string;
  readonly target: {
    readonly channelId: string;
    readonly threadId?: string;
    readonly replyToMessageId?: string;
  };
  readonly reason: "rate_limited" | "message_too_large" | "channel_not_found" | "unauthorized" | "unknown";
  readonly cause?: unknown;
}> {}

export class SessionResolutionError extends Data.TaggedError("SessionResolutionError")<{
  readonly externalId: {
    readonly platform: string;
    readonly userId: string;
    readonly displayName?: string;
    readonly metadata?: Record<string, unknown>;
  };
  readonly reason: string;
  readonly cause?: unknown;
}> {}
