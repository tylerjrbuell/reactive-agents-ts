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
