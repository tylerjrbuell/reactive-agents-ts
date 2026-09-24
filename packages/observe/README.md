# @reactive-agents/observe

> OpenInference-compliant OpenTelemetry tracing for reactive-agents — maps AgentEvent stream to semantic spans

[![npm](https://img.shields.io/npm/v/@reactive-agents/observe?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/observe)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

Zero-config **OpenTelemetry tracing for AI agents**. This package subscribes to the Reactive Agents `EventBus` and emits [OpenInference](https://github.com/Arize-ai/openinference)-attributed spans (`AGENT`, `LLM`, `TOOL`) so your agent runs show up in any OTLP backend — Phoenix, Arize, Jaeger, Grafana Tempo, Honeycomb, and more. Drop-in **LLM observability** with model names, token counts, tool parameters, and inputs/outputs already on the spans.

## Install
```bash
bun add @reactive-agents/observe
# or: npm install @reactive-agents/observe
```

## Usage
Wire the OTLP exporter once at process start, then provide the tracer layer to your agent runtime so events become spans.

```typescript
import { setupOpenInferenceExporter, OpenInferenceTracerLayer } from "@reactive-agents/observe";

// 1. Start the exporter (sends spans over OTLP/HTTP).
const handle = setupOpenInferenceExporter({
  serviceName: "my-agent",
  endpoint: "http://localhost:4318", // defaults to OTEL_EXPORTER_OTLP_ENDPOINT
});

// 2. Provide OpenInferenceTracerLayer to your agent's Effect runtime
//    (it subscribes to the EventBus and records AGENT / LLM / TOOL spans).
//    ... run your agents ...

// 3. Flush + shut down before exit.
await handle.shutdown();
```

Already exporting OTel elsewhere? Use `autoConfigureExporter()` — it's a no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

## Langfuse

[Langfuse](https://langfuse.com) ingests OpenTelemetry natively. `setupLangfuseExporter` is a preset that computes the `/api/public/otel` endpoint and HTTP Basic auth header from your project keys, so spans arrive with OpenInference attributes and render as agent/LLM/tool traces.

```typescript
import { setupLangfuseExporter, OpenInferenceTracerLayer } from "@reactive-agents/observe";

// Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_HOST from env,
// or pass them explicitly:
const handle = setupLangfuseExporter({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  host: "https://cloud.langfuse.com", // EU (default). Regional/self-hosted also work:
  //     US   → https://us.cloud.langfuse.com
  //     Japan→ https://jp.cloud.langfuse.com
  serviceName: "my-agent",
});

// ... provide OpenInferenceTracerLayer to your agent, run agents ...

await handle.shutdown(); // flush to Langfuse before exit
```

`host` must match the region where your Langfuse project lives — a mismatch surfaces as `401 Invalid credentials. Confirm that you've configured the correct host.` The preset also sets `x-langfuse-ingestion-version: 4` for real-time ingestion (overridable via `headers`).

A runnable end-to-end check (ships a span and confirms it landed via the Langfuse API) lives at [`apps/examples/src/observe/langfuse-export.ts`](../../apps/examples/src/observe/langfuse-export.ts).

## API
- `OpenInferenceTracerLayer` — Effect `Layer` that subscribes to the `EventBus` and emits OpenInference spans. Requires `EventBus`.
- `setupOpenInferenceExporter(config?)` — register an OTLP/HTTP exporter and global tracer provider; returns an `ExporterHandle`.
- `setupLangfuseExporter(config?)` — Langfuse preset over `setupOpenInferenceExporter`; returns an `ExporterHandle`.
- `buildLangfuseConfig(config?)` — pure helper that returns the `OpenInferenceExporterConfig` (endpoint + auth) for a Langfuse project.
- `autoConfigureExporter(config?)` — set up the exporter only if `OTEL_EXPORTER_OTLP_ENDPOINT` is present; otherwise a no-op handle.
- `OpenInferenceExporterConfig` — `{ endpoint?, headers?, serviceName? }`.
- `LangfuseExporterConfig` — `{ publicKey?, secretKey?, host?, serviceName?, headers? }`.
- `ExporterHandle` — `{ shutdown(): Promise<void> }` to flush and tear down.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [Observability docs](https://docs.reactiveagents.dev) and the [full documentation](https://docs.reactiveagents.dev).
