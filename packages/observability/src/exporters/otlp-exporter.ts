/**
 * OTLP Exporter — sends traces and metrics to any OTel-compatible backend.
 *
 * Configures and registers a global TracerProvider with OTLP HTTP exporters
 * so that spans created by our tracer (via `@opentelemetry/api`) are exported
 * to Jaeger, Grafana Tempo, Datadog, or any OTLP endpoint.
 *
 * @example
 * ```typescript
 * const shutdown = setupOTLPExporter({
 *   endpoint: "http://localhost:4318",
 *   serviceName: "my-agent",
 *   headers: { Authorization: "Bearer ..." },
 * });
 * // ... agent runs, spans are exported automatically ...
 * await shutdown(); // flush and shut down
 * ```
 */
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import * as otelApi from "@opentelemetry/api";

/** Configuration for the OTLP exporter. */
export interface OTLPExporterConfig {
  /** OTLP endpoint URL (e.g., "http://localhost:4318"). Uses /v1/traces and /v1/metrics paths. */
  readonly endpoint: string;
  /** Service name reported in OTel resource attributes. @default "reactive-agents" */
  readonly serviceName?: string;
  /** Service version. @default "0.6.3" */
  readonly serviceVersion?: string;
  /** Optional HTTP headers for authentication (e.g., API keys). */
  readonly headers?: Record<string, string>;
  /** Use BatchSpanProcessor (true, default) or SimpleSpanProcessor (false, for testing). */
  readonly batch?: boolean;
  /** Metric export interval in milliseconds. @default 60000 */
  readonly metricIntervalMs?: number;
}

/**
 * Sets up the global OTel TracerProvider and MeterProvider with OTLP HTTP exporters.
 *
 * @returns An async shutdown function that flushes pending data and cleans up.
 */
export function setupOTLPExporter(config: OTLPExporterConfig): () => Promise<void> {
  const serviceName = config.serviceName ?? "reactive-agents";
  const serviceVersion = config.serviceVersion ?? "0.6.3";
  const useBatch = config.batch !== false;

  const resource = resourceFromAttributes({
    "service.name": serviceName,
    "service.version": serviceVersion,
  });

  // ── Trace exporter ──
  const traceExporter = new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
    headers: config.headers,
  });

  const spanProcessor = useBatch
    ? new BatchSpanProcessor(traceExporter)
    : new SimpleSpanProcessor(traceExporter);

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [spanProcessor],
  });

  // Register as global provider so our tracer (`otelApi.trace.getTracer(...)`) uses it
  otelApi.trace.setGlobalTracerProvider(tracerProvider);

  // ── Metrics exporter ──
  const metricExporter = new OTLPMetricExporter({
    url: `${config.endpoint}/v1/metrics`,
    headers: config.headers,
  });

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: config.metricIntervalMs ?? 60_000,
      }),
    ],
  });

  otelApi.metrics.setGlobalMeterProvider(meterProvider);

  // ── Shutdown ──
  return async () => {
    await tracerProvider.shutdown();
    await meterProvider.shutdown();
  };
}
