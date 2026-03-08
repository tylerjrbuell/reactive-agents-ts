/**
 * Telemetry module — anonymized run-level data collection for collective intelligence.
 *
 * @module
 */
export {
  TelemetryRecordSchema,
  TelemetryAggregateSchema,
  ModelTier,
  SAFE_TOOL_NAMES,
} from "./telemetry-schema.js";
export type { TelemetryRecord, TelemetryAggregate } from "./telemetry-schema.js";

export {
  preservePrivacy,
  classifyModelTier,
  bucketToHour,
  sanitizeToolNames,
} from "./privacy-preserver.js";
export type { RawRunData, PrivacyConfig } from "./privacy-preserver.js";

export {
  TelemetryAggregatorTag,
  TelemetryAggregatorLive,
} from "./local-aggregator.js";
export type { TelemetryAggregator } from "./local-aggregator.js";

export {
  TelemetryCollectorTag,
  TelemetryCollectorLive,
} from "./telemetry-collector.js";
export type { TelemetryCollector, TelemetryMode, TelemetryConfig } from "./telemetry-collector.js";
