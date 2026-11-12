import { Data } from "effect";

export class GatewayError extends Data.TaggedError("GatewayError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class GatewayConfigError extends Data.TaggedError("GatewayConfigError")<{
  readonly message: string;
  readonly field?: string;
}> {}

export class WebhookValidationError extends Data.TaggedError("WebhookValidationError")<{
  readonly message: string;
  readonly source: string;
  readonly statusCode?: number;
}> {}

export class WebhookTransformError extends Data.TaggedError("WebhookTransformError")<{
  readonly message: string;
  readonly source: string;
  readonly payload?: unknown;
}> {}

export class PolicyViolationError extends Data.TaggedError("PolicyViolationError")<{
  readonly message: string;
  readonly policy: string;
  readonly eventId: string;
}> {}

export class SchedulerError extends Data.TaggedError("SchedulerError")<{
  readonly message: string;
  readonly schedule?: string;
}> {}

export class ChannelConnectionError extends Data.TaggedError("ChannelConnectionError")<{
  readonly message: string;
  readonly platform: string;
}> {}

/** No schedule with this id exists in the {@link import("./schedule/registry.js").ScheduleRegistry}. */
export class ScheduleNotFoundError extends Data.TaggedError("ScheduleNotFoundError")<{
  readonly message: string;
  readonly scheduleId: string;
}> {}

/** A schedule definition was rejected (bad cron expression, missing runAt, empty instruction). */
export class ScheduleInvalidError extends Data.TaggedError("ScheduleInvalidError")<{
  readonly message: string;
  readonly field?: string;
}> {}

/** The schedule store could not be read or written. The cause is kept, never printed into `message`. */
export class ScheduleStoreError extends Data.TaggedError("ScheduleStoreError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** The ingress HTTP server could not be started (bad config, port in use). */
export class IngressStartError extends Data.TaggedError("IngressStartError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
