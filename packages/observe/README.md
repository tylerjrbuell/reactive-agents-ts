# @reactive-agents/observe

> OpenInference OpenTelemetry tracing for Reactive Agents: turns the EventBus stream into AGENT, LLM and TOOL spans for any OTLP backend.

> **Stability:** unstable. Exporter config and span attributes may change between minor versions.

## Install

```bash
bun add @reactive-agents/observe
# or: npm install @reactive-agents/observe
```

## Usage

Start the exporter once at process start, then provide the tracer layer to your agent runtime so events become spans.

```ts
import { setupOpenInferenceExporter, OpenInferenceTracerLayer } from "@reactive-agents/observe";

const handle = setupOpenInferenceExporter({
  serviceName: "my-agent",
  endpoint: "http://localhost:4318", // defaults to OTEL_EXPORTER_OTLP_ENDPOINT
});

// Provide OpenInferenceTracerLayer to your agent's Effect runtime.
// It subscribes to the EventBus and records AGENT / LLM / TOOL spans.

await handle.shutdown(); // flush before exit
```

`autoConfigureExporter()` is a no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

### Langfuse

`setupLangfuseExporter` computes the Langfuse OTLP endpoint and auth header from your project keys.

```ts
import { setupLangfuseExporter } from "@reactive-agents/observe";

const handle = setupLangfuseExporter({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  host: "https://cloud.langfuse.com", // must match your project's region
  serviceName: "my-agent",
});

await handle.shutdown();
```

A host that does not match the project region returns `401 Invalid credentials`. Keys and host also read from `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_HOST`.

## API

| Export | Use it when |
|---|---|
| `OpenInferenceTracerLayer` | You turn EventBus events into OpenInference spans. Requires `EventBus`. |
| `setupOpenInferenceExporter(config?)` | You register an OTLP/HTTP exporter. Returns an `ExporterHandle`. |
| `setupLangfuseExporter(config?)` | You send to Langfuse. |
| `buildLangfuseConfig(config?)` | You want the Langfuse endpoint and headers without starting an exporter. |
| `autoConfigureExporter(config?)` | You export only when the OTel env var is set. |
| `ExporterHandle` | You flush and shut down with `shutdown()`. |

## Documentation

- [Observe](https://docs.reactiveagents.dev/features/observe/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
