import { Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ObservabilityServiceLive } from "../src/observability-service.js";
import { MetricsCollectorLive } from "../src/metrics/metrics-collector.js";

/**
 * ObservabilityService test layer with `MetricsCollectorTag` provided (#166).
 *
 * Bare `ObservabilityServiceLive()` omits the collector, so the service falls
 * back to a fresh one and logs the "MetricsCollectorTag not provided in Layer
 * — ExecutionEngine writes and ObservabilityService reads will diverge" WARN
 * on every run. This helper wires `MetricsCollectorLive` (with its `EventBus`
 * dependency), mirroring the shared-layer wiring the runtime uses in prod, so
 * tests exercise the supported configuration and the WARN no longer fires.
 */
export const makeObservabilityTestLayer = (
  config?: Parameters<typeof ObservabilityServiceLive>[0],
) =>
  ObservabilityServiceLive(config).pipe(
    Layer.provide(MetricsCollectorLive.pipe(Layer.provide(EventBusLive))),
  );
