import { ObservabilityServiceLive } from "./observability-service.js";
import type { ExporterConfig } from "./observability-service.js";

export const createObservabilityLayer = (exporterConfig: ExporterConfig = {}) =>
  ObservabilityServiceLive(exporterConfig);
