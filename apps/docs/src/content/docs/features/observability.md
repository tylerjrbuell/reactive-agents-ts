---
title: Observability
description: Distributed tracing, metrics, structured logging, and agent state snapshots.
sidebar:
  order: 5
---

The observability layer gives you full visibility into agent behavior. Every execution phase emits spans, every LLM call records metrics, and every decision is logged with structured context.

## Quick Start

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withObservability()   // Enable tracing + metrics + logging
  .build();
```

When observability is enabled, the execution engine automatically wraps every phase in a trace span and records metrics for duration, token usage, and cost.

## Distributed Tracing

Every agent task gets a unique trace ID. Each execution phase creates a child span:

```
Trace: abc-123
  └─ execution.phase.bootstrap      [12ms]
  └─ execution.phase.guardrail      [3ms]
  └─ execution.phase.cost-route     [1ms]
  └─ execution.phase.strategy-select [1ms]
  └─ execution.phase.think          [1,200ms]  ← LLM call
  └─ execution.phase.act            [450ms]    ← Tool execution
  └─ execution.phase.observe        [2ms]
  └─ execution.phase.verify         [800ms]
  └─ execution.phase.memory-flush   [15ms]
  └─ execution.phase.cost-track     [1ms]
  └─ execution.phase.audit          [1ms]
  └─ execution.phase.complete       [1ms]
```

### Using Spans

Wrap any Effect in a trace span:

```typescript
import { ObservabilityService } from "@reactive-agents/observability";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const obs = yield* ObservabilityService;

  // Wrap an operation in a span
  const result = yield* obs.withSpan(
    "my-custom-operation",
    myExpensiveEffect,
    { agentId: "agent-1", customField: "value" },
  );

  // Get current trace context for correlation
  const { traceId, spanId } = yield* obs.getTraceContext();
  console.log(`Trace: ${traceId}, Span: ${spanId}`);
});
```

Spans automatically:
- Record start/end times
- Set status to "ok" or "error"
- Increment `spans.completed` or `spans.error` counters

## Metrics

Three metric types are available:

### Counters

Track cumulative values that only go up:

```typescript
yield* obs.incrementCounter("requests.total", 1, { agent: "agent-1" });
yield* obs.incrementCounter("tokens.used", 1500, { model: "claude-sonnet" });
yield* obs.incrementCounter("tools.executed", 1, { tool: "web_search" });
```

### Histograms

Track distributions of values (latency, token counts, etc.):

```typescript
yield* obs.recordHistogram("llm.latency_ms", 1200, { provider: "anthropic" });
yield* obs.recordHistogram("phase.duration_ms", 450, { phase: "think" });
```

### Gauges

Track point-in-time values:

```typescript
yield* obs.setGauge("active_sessions", 5);
yield* obs.setGauge("context_window_usage", 0.73, { agent: "agent-1" });
```

### Querying Metrics

```typescript
const metrics = yield* obs.getMetrics({
  name: "llm.latency_ms",
  startTime: new Date("2026-02-20"),
  endTime: new Date("2026-02-21"),
});

for (const m of metrics) {
  console.log(`${m.name}: ${m.value} (${m.labels.provider})`);
}
```

## Structured Logging

All log entries include structured context for filtering and correlation:

```typescript
yield* obs.debug("Starting reasoning loop", { strategy: "react", iteration: 1 });
yield* obs.info("Tool executed successfully", { tool: "web_search", latencyMs: 450 });
yield* obs.warn("Approaching context window limit", { usage: 0.9, maxTokens: 200000 });
yield* obs.error("LLM call failed", rateLimitError, { provider: "anthropic", retryIn: 60000 });
```

### Log Entry Fields

Every log entry automatically includes:

| Field | Description |
|-------|-------------|
| `timestamp` | When the log was recorded |
| `level` | "debug", "info", "warn", "error" |
| `message` | Human-readable description |
| `agentId` | The agent that produced this log |
| `sessionId` | Current session |
| `traceId` | Correlation with distributed trace |
| `spanId` | Current span |
| `layer` | Which service layer produced the log |
| `operation` | What operation was happening |
| `durationMs` | Duration if applicable |
| `metadata` | Custom key-value pairs |

## Agent State Snapshots

Capture the full state of an agent at a point in time for debugging:

```typescript
const snapshot = yield* obs.captureSnapshot("agent-1", {
  workingMemory: ["current task context", "recent tool result"],
  currentStrategy: "react",
  reasoningStep: 3,
  activeTools: ["web_search", "calculator"],
  tokenUsage: {
    inputTokens: 5000,
    outputTokens: 1200,
    contextWindowUsed: 6200,
    contextWindowMax: 200000,
  },
  costAccumulated: 0.015,
});

// Retrieve historical snapshots
const history = yield* obs.getSnapshots("agent-1", 10);
```

## Integration with Execution Engine

When observability is enabled, the execution engine automatically:

1. Creates a span for each of the 10 execution phases
2. Records phase duration as histogram metrics
3. Increments completion/error counters per phase
4. Logs audit entries at Phase 9 with full task summary
5. Includes task metadata (iterations, tokens, cost, strategy, duration) in audit logs

No manual instrumentation needed — just enable `.withObservability()` and everything is traced.

## Exporting

Call `flush()` to ensure all buffered metrics and logs are exported:

```typescript
yield* obs.flush();
```
