# @reactive-agents/trace

> Structured execution trace recording and inspection for Reactive Agents

[![npm](https://img.shields.io/npm/v/@reactive-agents/trace?color=CB3837&logo=npm)](https://www.npmjs.com/package/@reactive-agents/trace)
[![docs](https://img.shields.io/badge/docs-reactiveagents.dev-7C3AED)](https://docs.reactiveagents.dev)

Structured **execution-trace recording for AI agents**. This package records every reactive-agent event to JSONL, then lets you load, analyze, and compare runs — surfacing guard interventions, failure modes, reasoning trajectories, tool outcomes, cost signals, and honesty checks. It's the data layer behind the `rax-diagnose` forensic CLI and deterministic replay, and the foundation for **LLM agent debugging and observability**.

## Install
```bash
bun add @reactive-agents/trace
# or: npm install @reactive-agents/trace
```

## Usage
Record runs by wiring `TraceBridgeLayer` over the recorder service, then inspect saved traces:

```typescript
import { Layer } from "effect";
import {
  TraceRecorderServiceLive,
  TraceBridgeLayer,
  loadTrace,
  traceStats,
  analyzeRun,
  renderRunReport,
} from "@reactive-agents/trace";

// Recording: bridge the EventBus into a JSONL recorder (dir: null = memory-only).
const TracingLayer = TraceBridgeLayer.pipe(
  Layer.provide(TraceRecorderServiceLive({ dir: "./traces" })),
);
// provide TracingLayer to your agent runtime...

// Inspecting a saved trace:
const trace = await loadTrace("./traces/<runId>.jsonl");
console.log(traceStats(trace));        // iterations, tokens, tool calls, ...
console.log(renderRunReport(analyzeRun(trace))); // human-readable run report
```

## API
- `TraceRecorderService` / `TraceRecorderServiceLive(opts)` — the recorder tag and its live layer (`{ dir: string | null }`). Recorder exposes `emit`, `snapshot`, `flush`, `flushAll`, `close`.
- `TraceBridgeLayer` — subscribes to the `EventBus` and converts `AgentEvent`s into recorded `TraceEvent`s.
- `loadTrace(path)` / `traceStats(trace)` — load a JSONL trace into a `Trace`; compute `TraceStats`.
- `analyzeRun(trace, opts?)` / `renderRunReport(analysis)` — full run analysis (`RunAnalysis`: failure modes, honesty checks, cost signals, reasoning trajectory) and its rendered report.
- `analyzeInterventions(...)` / `renderInterventionReport(...)` — guard-intervention analysis and report.
- `aggregateCohort(...)` / `compareCohorts(...)` / `renderCohortDelta(...)` — aggregate and diff cohorts of runs.
- `toTraceEvent(...)` (also exported from `@reactive-agents/trace/normalize`) — normalize an `AgentEvent` into a `TraceEvent`.
- `validateRationale` / `isRationale` / `isTraceEvent` — type guards for `Rationale` and `TraceEvent`.

## Part of Reactive Agents

This package is part of [Reactive Agents](https://github.com/tylerjrbuell/reactive-agents-ts) — the TypeScript AI agent framework built on Effect-TS. See the [Observability docs](https://docs.reactiveagents.dev) and the [full documentation](https://docs.reactiveagents.dev).
