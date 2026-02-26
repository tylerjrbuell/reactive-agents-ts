import { Layer } from "effect";
import { ObservabilityServiceLive } from "./observability-service.js";
import type { ExporterConfig } from "./observability-service.js";
import { MetricsCollectorLive } from "./metrics/metrics-collector.js";

export const createObservabilityLayer = (exporterConfig: ExporterConfig = {}) =>
  ObservabilityServiceLive(exporterConfig).pipe(
    Layer.provide(MetricsCollectorLive),
  );
