/**
 * Langfuse exporter preset.
 *
 * Langfuse ingests OpenTelemetry traces natively over OTLP HTTP, authenticated
 * with HTTP Basic Auth over the project's public/secret key pair. This is not a
 * new exporter — it is a thin preset that computes the Langfuse endpoint + auth
 * header and delegates to {@link setupOpenInferenceExporter}, so the spans that
 * land carry OpenInference semantic attributes and render as LLM/tool/agent
 * traces in the Langfuse UI (not flat generic spans).
 *
 * @example
 * ```typescript
 * // Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_HOST from env
 * const handle = setupLangfuseExporter();
 * // ... run agents ...
 * await handle.shutdown();
 * ```
 *
 * @example
 * ```typescript
 * const handle = setupLangfuseExporter({
 *   publicKey: "pk-lf-...",
 *   secretKey: "sk-lf-...",
 *   host: "https://us.cloud.langfuse.com", // or a self-hosted URL
 *   serviceName: "production-agent",
 * });
 * ```
 */
import {
  setupOpenInferenceExporter,
  type ExporterHandle,
  type OpenInferenceExporterConfig,
} from "./otlp.js";

/** Langfuse Cloud EU — the default when no host is configured. */
const DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com";

/** Configuration for the Langfuse exporter preset. */
export interface LangfuseExporterConfig {
  /** Langfuse public key (`pk-lf-...`). Defaults to `LANGFUSE_PUBLIC_KEY`. */
  publicKey?: string;
  /** Langfuse secret key (`sk-lf-...`). Defaults to `LANGFUSE_SECRET_KEY`. */
  secretKey?: string;
  /**
   * Langfuse host, without the OTLP path. Defaults to `LANGFUSE_HOST`, then
   * `https://cloud.langfuse.com`. Use a regional (`https://us.cloud.langfuse.com`)
   * or self-hosted base URL as needed. A trailing slash is stripped.
   */
  host?: string;
  /** Service name reported to Langfuse. Defaults to "reactive-agents". */
  serviceName?: string;
  /**
   * Extra HTTP headers merged into the request. Applied before the computed
   * `Authorization` header, so auth cannot be accidentally clobbered.
   */
  headers?: Record<string, string>;
}

/**
 * Compute the {@link OpenInferenceExporterConfig} for a Langfuse project —
 * endpoint path and Basic Auth header. Pure and side-effect-free, so it can be
 * asserted directly in tests without standing up a real exporter.
 *
 * @throws if neither config nor env supply both a public and secret key.
 */
export function buildLangfuseConfig(
  config: LangfuseExporterConfig = {},
): OpenInferenceExporterConfig {
  const publicKey = config.publicKey ?? process.env["LANGFUSE_PUBLIC_KEY"];
  const secretKey = config.secretKey ?? process.env["LANGFUSE_SECRET_KEY"];

  if (!publicKey || !secretKey) {
    throw new Error(
      "setupLangfuseExporter requires a Langfuse public key and secret key. " +
        "Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY, or pass { publicKey, secretKey }.",
    );
  }

  const host = (
    config.host ??
    process.env["LANGFUSE_HOST"] ??
    DEFAULT_LANGFUSE_HOST
  ).replace(/\/$/, "");

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  return {
    // setupOpenInferenceExporter appends `/v1/traces` to this endpoint.
    endpoint: `${host}/api/public/otel`,
    serviceName: config.serviceName ?? "reactive-agents",
    headers: {
      // Real-time ingestion on Langfuse v4; without it, directly-ingested OTel
      // data can be delayed up to 10 minutes. Harmless on older/self-hosted.
      "x-langfuse-ingestion-version": "4",
      ...config.headers,
      Authorization: `Basic ${auth}`,
    },
  };
}

/**
 * Wire up an OTLP HTTP exporter that ships OpenInference-attributed spans to
 * Langfuse. Call once at process start, before running any agents.
 *
 * @throws if the public/secret key pair is not available (see {@link buildLangfuseConfig}).
 */
export function setupLangfuseExporter(
  config: LangfuseExporterConfig = {},
): ExporterHandle {
  return setupOpenInferenceExporter(buildLangfuseConfig(config));
}
