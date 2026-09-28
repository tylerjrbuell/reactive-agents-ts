---
"@reactive-agents/observe": minor
---

Add `setupLangfuseExporter` — a preset that ships OpenInference-attributed agent traces to Langfuse over OTLP.

- `setupLangfuseExporter(config?)` computes Langfuse's `/api/public/otel` endpoint and the HTTP Basic auth header from `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST` (or explicit config), and sets `x-langfuse-ingestion-version: 4` for real-time ingestion. Returns an `ExporterHandle`.
- `buildLangfuseConfig(config?)` exposes the pure endpoint/auth builder for advanced wiring and testing.
- New `LangfuseExporterConfig` type: `{ publicKey?, secretKey?, host?, serviceName?, headers? }`.

Because it builds on `setupOpenInferenceExporter`, spans arrive with LLM semantic attributes and render as agent/LLM/tool traces in the Langfuse UI. Regional and self-hosted hosts (EU/US/JP/custom) are supported via `host`.
