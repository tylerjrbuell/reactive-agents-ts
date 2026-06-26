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

## API
- `OpenInferenceTracerLayer` — Effect `Layer` that subscribes to the `EventBus` and emits OpenInference spans. Requires `EventBus`.
- `setupOpenInferenceExporter(config?)` — register an OTLP/HTTP exporter and global tracer provider; returns an `ExporterHandle`.
- `autoConfigureExporter(config?)` — set up the exporter only if `OTEL_EXPORTER_OTLP_ENDPOINT` is present; otherwise a no-op handle.
- `OpenInferenceExporterConfig` — `{ endpoint?, headers?, serviceName? }`.
- `ExporterHandle` — `{ shutdown(): Promise<void> }` to flush and tear down.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [Observability docs](https://docs.reactiveagents.dev) and the [full documentation](https://docs.reactiveagents.dev).
