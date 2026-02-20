import { Data } from "effect";

export class TracingError extends Data.TaggedError("TracingError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class MetricsError extends Data.TaggedError("MetricsError")<{
  readonly message: string;
  readonly metricName?: string;
}> {}

export class ExporterError extends Data.TaggedError("ExporterError")<{
  readonly message: string;
  readonly exporter: string;
  readonly cause?: unknown;
}> {}
