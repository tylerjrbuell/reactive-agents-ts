import { Data } from "effect";

export class ChannelConnectionError extends Data.TaggedError("ChannelConnectionError")<{
  readonly adapter: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

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
