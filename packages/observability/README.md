# @reactive-agents/observability

Production observability for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.3**

Distributed tracing (OpenTelemetry / OTLP), metrics collection, structured logging with file rotation, kernel thought tracing, and privacy-aware telemetry export — all wired into the agent execution pipeline so every phase, tool call, and entropy score is observable.

## Installation

```bash
bun add @reactive-agents/observability
```

Or via the umbrella:

```bash
bun add reactive-agents
```

## Features

- **Distributed tracing** — OpenTelemetry spans per execution phase, OTLP HTTP exporter included (`setupOTLPExporter`)
- **Structured logging** — JSON output with trace context, file rotation via `LiveLogWriter`, observable bus via `ObservableLogger`
- **Metrics collector** — token usage, latency, step count, cost, tool success rates per run + aggregate
- **Thought tracer** — captures the kernel's reasoning tree (`ThoughtNode`) for debugging and replay
- **Console + file + dashboard exporters** — pretty-printed local output, JSON file, and a live dashboard data view (`buildDashboardData`)
- **Telemetry pipeline** — privacy-aware (`preservePrivacy`, `defaultRedactors`), aggregated (`TelemetryAggregator`), opt-in collection (`TelemetryCollector`)
- **Cortex reporter** — pipes selected events to a Cortex hub for cross-agent visibility
- **Calibration provenance renderer** — formats per-model calibration data for human review

## Quick Example

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("traced-agent")
  .withProvider("anthropic", { model: "claude-sonnet-4-20250514" })
  .withObservability({
    exporters: ["console", "file", "otlp"],
    otlpEndpoint: "http://localhost:4318/v1/traces",
    logFile: "./logs/agent.jsonl",
  })
  .build();

const result = await agent.run("Analyze this dataset");
// All execution phases produce spans; tool calls, errors, and entropy scores
// are recorded as structured log events with shared trace IDs.
```

## What Gets Traced

Each execution phase emits a span. The kernel's 12-phase loop produces a structured trace tree:

```
bootstrap → comprehend → attend → reason → decide → act
         → observe → reflect → verify → terminate → output
```

Tool calls, LLM streams, and entropy events are children of the relevant phase span.

## Direct Service Usage

```typescript
import { Effect } from "effect";
import {
  ObservabilityService,
  ObservabilityServiceLive,
  makeMetricsCollector,
  makeThoughtTracer,
} from "@reactive-agents/observability";

const program = Effect.gen(function* () {
  const obs = yield* ObservabilityService;
  const tracer = yield* obs.tracer();
  const span = yield* tracer.startSpan("custom-step");
  // ... do work ...
  yield* tracer.endSpan(span, { status: "ok" });
});
```

## Privacy + Redaction

The redaction pipeline strips secrets and PII before any exporter sees them:

```typescript
import { applyRedactors, defaultRedactors } from "@reactive-agents/observability";

const safe = applyRedactors(rawEvent, defaultRedactors);
// Removes API keys, OAuth tokens, JWT, email patterns, etc.
```

Telemetry export is **opt-in** and uses HMAC-signed payloads (`signPayload`) when sending anonymized run reports.

## Key Exports

| Export                                     | Purpose                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `ObservabilityService`, `ObservabilityServiceLive` | Composite observability entry point             |
| `makeTracer`                               | OpenTelemetry-compatible span creator                     |
| `makeStructuredLogger`, `makeLoggerService`, `makeObservableLogger` | Logging stack            |
| `makeMetricsCollector`, `MetricsCollectorLive` | Run + aggregate metrics                              |
| `makeThoughtTracer`, `ThoughtTracerLive`   | Kernel reasoning-tree capture                             |
| `makeConsoleExporter`, `makeFileExporter`, `setupOTLPExporter` | Exporter factories            |
| `buildDashboardData`, `formatMetricsDashboard` | Dashboard rendering                                  |
| `CortexReporter`, `CortexReporterLive`     | Cross-agent event hub reporter                            |
| `TelemetryAggregatorLive`, `TelemetryCollectorLive` | Privacy-aware telemetry pipeline                 |
| `applyRedactors`, `defaultRedactors`       | Secret + PII stripping                                    |
| `createObservabilityLayer`                 | Factory for the runtime layer                             |

## Documentation

- Full docs: [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)
- Observability guide: [docs.reactiveagents.dev/guides/observability/](https://docs.reactiveagents.dev/guides/observability/)

## License

MIT
