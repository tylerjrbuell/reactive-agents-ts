import { Data } from "effect";

export class CortexError extends Data.TaggedError("CortexError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class CortexNotFoundError extends Data.TaggedError("CortexNotFoundError")<{
  readonly id: string;
  readonly resource: string;
}> {}

export type CortexErrors = CortexError | CortexNotFoundError;

/** A chat turn run by the server (goal segment, schedule or loop fire) ended without a usable result. */
export class ChatTurnFailedError extends Data.TaggedError("ChatTurnFailedError")<{
  readonly message: string;
}> {}

/** A webhook channel reply was refused or answered with an error status. */
export class ChannelReplyError extends Data.TaggedError("ChannelReplyError")<{
  readonly message: string;
  /** HTTP status of the reply endpoint, when it answered. */
  readonly status?: number;
}> {}

/** The channel hub's router could not be started. */
export class ChannelHubStartError extends Data.TaggedError("ChannelHubStartError")<{
  readonly message: string;
}> {}

/** A channel-hub agent could not be resolved or its built surface exceeds the route's exposure. */
export class HubAgentBuildError extends Data.TaggedError("HubAgentBuildError")<{
  readonly message: string;
}> {}

/** The server refused to start (for example a non-loopback bind without an access token). */
export class CortexStartRefusedError extends Data.TaggedError("CortexStartRefusedError")<{
  readonly message: string;
}> {}
