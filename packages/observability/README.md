# @reactive-agents/observability

> Tracing, metrics, structured logging and redaction for Reactive Agents, wired into every phase of the agent run.

> **Stability:** unstable. Public event tags are stable; exporter and service shapes may change between minor versions.

## Install

```bash
bun add @reactive-agents/observability
# or: npm install @reactive-agents/observability
```

Most apps enable it through the facade (`bun add reactive-agents`) and `.withObservability()`.

## Usage

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("traced-agent")
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withObservability({ verbosity: "verbose" })
  .build();

await agent.run("Analyze this dataset");
```

Redact secrets and PII before an exporter sees an event:

```ts
import { redactSecrets, defaultRedactors } from "@reactive-agents/observability";

const safe = redactSecrets("key: sk-ant-api03-abc123", defaultRedactors);
```

## API

| Export | Use it when |
|---|---|
| `ObservabilityService`, `ObservabilityServiceLive` | You wrap work in spans (`withSpan`) or log with trace context. |
| `createObservabilityLayer` | You build the runtime layer yourself. |
| `makeTracer`, `makeStructuredLogger` | You need the span or logging primitives. |
| `makeMetricsCollector`, `MetricsCollectorLive` | You read token, latency, step and tool metrics per run. |
| `makeThoughtTracer`, `ThoughtTracerLive` | You capture the kernel's reasoning tree. |
| `makeConsoleExporter`, `makeFileExporter`, `setupOTLPExporter` | You choose where traces and logs go. |
| `buildDashboardData`, `formatMetricsDashboard` | You render a run summary. |
| `CortexReporter`, `CortexReporterLive` | You report events to a Cortex hub. |
| `TelemetryAggregatorLive`, `TelemetryCollectorLive` | You use the opt-in, privacy-aware telemetry pipeline. |
| `applyRedactors`, `defaultRedactors` | You strip secrets and PII. |

For OpenInference spans to Phoenix, Langfuse and other OTLP backends, see [`@reactive-agents/observe`](https://www.npmjs.com/package/@reactive-agents/observe).

## Documentation

- [Observability](https://docs.reactiveagents.dev/features/observability/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
