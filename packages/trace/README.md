# @reactive-agents/trace

> Record every agent event to JSONL, then load, analyze and compare runs: failure causes, harness-vs-model attribution, guard activity and cost.

[![npm](https://img.shields.io/npm/v/@reactive-agents/trace?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/trace)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev/concepts/decision-tracing/)

> **Stability:** unstable. Not in the stable tier; analyzer outputs (cause and attribution reasons) can change between minors. Pin an exact version.

## Install

```bash
bun add @reactive-agents/trace
# or: npm install @reactive-agents/trace
```

## Usage

Record runs by wiring `TraceBridgeLayer` over the recorder service, then inspect saved traces. Analysis reads trace events only and costs zero tokens.

```ts
import { Layer } from "effect";
import {
  TraceRecorderServiceLive,
  TraceBridgeLayer,
  loadTrace,
  traceStats,
  analyzeCause,
  attributeFailure,
  mechanismActivity,
} from "@reactive-agents/trace";

// Recording: bridge the EventBus into a JSONL recorder (dir: null = memory-only).
const TracingLayer = TraceBridgeLayer.pipe(
  Layer.provide(TraceRecorderServiceLive({ dir: "./traces" })),
);
// provide TracingLayer to your agent runtime...

// Inspecting a saved trace:
const trace = await loadTrace("./traces/<runId>.jsonl");
console.log(traceStats(trace));
console.log(analyzeCause(trace).cause);      // how the run ended
console.log(attributeFailure(trace).reason); // harness or model, e.g. "harness:completeness-blind"
console.log([...mechanismActivity(trace)]);  // harness mechanisms that acted
```

The same analyzers power the [`rax-diagnose`](https://www.npmjs.com/package/@reactive-agents/diagnose) CLI.

## API

| Export | Use it when |
|---|---|
| `TraceRecorderService` / `TraceRecorderServiceLive({ dir })` | You record traces. `dir: null` keeps them in memory. |
| `TraceBridgeLayer` | You subscribe the EventBus and convert `AgentEvent`s into `TraceEvent`s. |
| `loadTrace(path)` / `traceStats(trace)` | You load a JSONL trace and compute iterations, tokens and tool calls. |
| `analyzeRun` / `renderRunReport` | You want a full run analysis: failure modes, honesty checks, cost signals, reasoning trajectory. |
| `analyzeInterventions` / `renderInterventionReport` | You want guard-intervention analysis. |
| `analyzeCause` / `renderCause` / `tallyCauses` | You ask why a run ended as it did: a deterministic cause, confidence, supporting events and missing signals. |
| `attributeFailure` / `renderAttribution` / `tallyAttributions` | You ask whether a failed run is the harness's fault or the model's (verdict `harness`, `model`, `environment` or `unattributed`, plus reason, divergence turn and evidence). |
| `mechanismActivity` / `compareActivity` / `runsWithMechanism` | You check that a harness change you are measuring actually ran. |
| `aggregateCohort` / `compareCohorts` / `renderCohortDelta` | You aggregate and diff cohorts of runs. |
| `toTraceEvent` (also `@reactive-agents/trace/normalize`) | You normalize an `AgentEvent` into a `TraceEvent`. |
| `validateRationale` / `isRationale` / `isTraceEvent` | You need type guards. |

## Documentation

- [Decision tracing](https://docs.reactiveagents.dev/concepts/decision-tracing/)
- [Observability](https://docs.reactiveagents.dev/features/observability/)
- [`rax diagnose` CLI reference](https://docs.reactiveagents.dev/reference/cli/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
