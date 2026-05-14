import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import * as otelApi from "@opentelemetry/api";

export interface OpenInferenceExporterConfig {
  /** OTLP endpoint URL. Defaults to OTEL_EXPORTER_OTLP_ENDPOINT env var, then http://localhost:4318 */
  endpoint?: string;
  /** Additional HTTP headers (auth tokens, etc.) */
  headers?: Record<string, string>;
  /** Service name reported to backend. Defaults to "reactive-agents" */
  serviceName?: string;
}

export interface ExporterHandle {
  /** Flush pending spans and shut down the exporter. */
  shutdown(): Promise<void>;
}

/**
 * Wire up an OTLP HTTP exporter that emits OpenInference-attributed spans.
 *
 * Call this once at process start, before running any agents.
 *
 * @example
 * ```typescript
 * const handle = setupOpenInferenceExporter({ serviceName: "my-agent" });
 * // ... run agents ...
 * await handle.shutdown();
 * ```
 */
export function setupOpenInferenceExporter(
  config: OpenInferenceExporterConfig = {},
): ExporterHandle {
  const endpoint =
    config.endpoint ??
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ??
    "http://localhost:4318";

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
    headers: config.headers,
  });

  const provider = new NodeTracerProvider({
    spanProcessors: [new BatchSpanProcessor(exporter)],
    resource: resourceFromAttributes({
      "service.name": config.serviceName ?? "reactive-agents",
    }),
  });

  provider.register();
  otelApi.trace.setGlobalTracerProvider(provider);

  return {
    async shutdown() {
      await provider.shutdown();
    },
  };
}

/**
 * Auto-configure OTLP export if OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * No-op otherwise. Returns handle (shutdown is safe to call even if no-op).
 */
export function autoConfigureExporter(
  config?: Omit<OpenInferenceExporterConfig, "endpoint">,
): ExporterHandle {
  if (!process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]) {
    return { shutdown: async () => {} };
  }
  return setupOpenInferenceExporter(config);
}
