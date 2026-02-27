import { Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ObservabilityServiceLive } from "./observability-service.js";
import type { ExporterConfig } from "./observability-service.js";
import { MetricsCollectorLive } from "./metrics/metrics-collector.js";

/**
 * Create observability layer with optional pre-created metrics collector.
 * If metricsCollectorLayer is provided, it will be used instead of creating a new one.
 * This ensures metrics are shared across ExecutionEngine and ObservabilityService.
 *
 * IMPORTANT: EventBusLive is provided to the metrics collector so it can subscribe
 * to ToolCallCompleted events and record tool execution metrics.
 */
export const createObservabilityLayer = (
  exporterConfig: ExporterConfig = {},
  metricsCollectorLayer: Layer.Layer<any, any> = MetricsCollectorLive,
) =>
  ObservabilityServiceLive(exporterConfig).pipe(
    // Note: metricsCollectorLayer should already have EventBusLive provided by the caller (runtime.ts)
    // This ensures the collector can access EventBus during setup
    Layer.provide(metricsCollectorLayer),
  );
