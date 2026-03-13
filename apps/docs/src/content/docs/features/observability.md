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

For real-time visibility while the agent runs, pass verbosity and live options:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withObservability({ verbosity: "verbose", live: true })
  .build();

// Live output as the agent runs:
// ◉ [bootstrap]     0 semantic, 0 episodic | 12ms
// ◉ [strategy]      reactive | tools: web-search, http-get
//   ┄ [thought]  I need to search for the current price...
//   ┄ [action]   web-search({"query":"bitcoin price USD"})
//   ┄ [obs]      Bitcoin is trading at $64,500 [42 chars]
// ◉ [think]         3 steps | 6,633 tok | 8.3s
// ◉ [act]           web-search (1 tools)
// ◉ [complete]      ✓ task-abc | 6,633 tok | $0.0001 | 8.5s
```

### Verbosity Levels

| Level | Output |
|-------|--------|
| `"minimal"` | Start + complete lines only |
| `"normal"` (default) | Phase transitions + tool names + final stats |
| `"verbose"` | + reasoning steps + LLM call summary + memory stats |
| `"debug"` | + full prompt content + full tool I/O (no truncation) |

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

## Telemetry System

Reactive Agents includes a **privacy-first telemetry system** that collects performance and behavior data locally. All data remains on your machine by default — nothing is sent to external servers without explicit opt-in.

### What Gets Collected

The telemetry system automatically aggregates:

- **Execution metrics**: phase durations, token usage, cost per run
- **Tool execution data**: which tools were called, success/error rates, latency
- **Strategy selection**: which reasoning strategy was chosen and why
- **Error tracking**: error types, frequencies, and recovery outcomes
- **Context metrics**: context window usage, compaction effectiveness

### Privacy Guarantees

| Aspect | Guarantee |
|--------|-----------|
| **Local-first** | All data stored in your SQLite database (`memory-db` by default) |
| **No PII** | Agent inputs are never logged; only metadata (token counts, durations) |
| **Opt-in export** | Telemetry only leaves your machine if you explicitly call `exportTelemetry()` |
| **Data ownership** | You control what's collected and when it's cleared |

### Aggregation Strategy

Telemetry data is aggregated by:
- **Time windows** (per hour, per day, per week)
- **Task type** (inferred from tool usage patterns)
- **Strategy** (which reasoning mode was used)
- **Model** (which LLM provider and model)
- **Custom labels** (agent name, environment, etc.)

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withObservability({ verbosity: "normal" })
  .build();

// Telemetry is collected automatically to local SQLite
const result = await agent.run("Fetch and summarize top 5 HN posts");

// Later: Query aggregated telemetry
const telemetry = yield* obs.getTelemetry({
  timeRange: { start: new Date("2026-03-01"), end: new Date("2026-03-10") },
  groupBy: ["strategy", "model"],
});

console.log(telemetry);
// {
//   "react:claude-sonnet": { avgDuration: 4500, totalTokens: 125000, cost: 0.25, runCount: 42 },
//   "tree-of-thought:claude-opus": { avgDuration: 8200, totalTokens: 245000, cost: 0.85, runCount: 18 }
// }
```

### Configuring Telemetry

By default, telemetry is enabled when observability is enabled. To disable:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withObservability({ verbosity: "normal", telemetry: { enabled: false } })
  .build();
```

To customize what's collected:

```typescript
.withObservability({
  verbosity: "normal",
  telemetry: {
    enabled: true,
    collectPhaseMetrics: true,   // Record duration of each phase
    collectToolMetrics: true,    // Track which tools are called
    collectTokenMetrics: true,   // Record token usage per run
    collectCostMetrics: true,    // Track estimated costs
    collectErrors: true,         // Log error types and frequencies
    retentionDays: 30,          // Keep 30 days of data (default)
  }
})
```

### Exporting Telemetry

To export aggregated telemetry for analysis:

```typescript
const exported = yield* obs.exportTelemetry({
  format: "json",  // or "csv"
  aggregation: "daily",  // or "hourly", "weekly"
  metrics: ["duration", "tokens", "cost"],
});

// Save to file
import { writeFileSync } from "fs";
writeFileSync("telemetry-export.json", JSON.stringify(exported, null, 2));
```

The export contains **aggregated statistics only** — no raw request data, no inputs, no conversation history.

## Standalone Structured Logging

For applications that want structured logging independently of full observability, use `makeLoggerService()` from `@reactive-agents/observability` and the `withLogging()` builder method.

### Builder Integration

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withLogging({
    level: "info",          // "debug" | "info" | "warn" | "error"
    format: "json",         // "json" | "text"
    output: "file",         // "console" | "file"
    filePath: "./logs/agent.log",
    maxFileSizeMb: 10,      // Rotate after 10 MB
    maxFiles: 5,            // Keep 5 rotated files
  })
  .build();
```

When `output: "console"`, logs are written to stdout with level-based filtering. When `output: "file"`, logs are written to the specified file with automatic rotation.

### makeLoggerService

For direct use in Effect programs:

```typescript
import { makeLoggerService } from "@reactive-agents/observability";
import { Effect } from "effect";

const LoggerLive = makeLoggerService({
  level: "warn",
  format: "json",
  output: "console",
});

const program = Effect.gen(function* () {
  const logger = yield* LoggerLive;
  yield* logger.info("Agent started", { agentId: "my-agent" });
  yield* logger.warn("High token usage", { tokensUsed: 45000, budget: 50000 });
  yield* logger.error("Tool call failed", new Error("timeout"), { tool: "web-search" });
});
```

### Log Rotation

When `output: "file"` is configured:
- The current log file is written to `filePath`
- When the file exceeds `maxFileSizeMb`, it is renamed to `{filePath}.1` and a new file is started
- Up to `maxFiles` rotated files are kept; older ones are deleted automatically

## ThoughtTracer

`ThoughtTracer` captures reasoning steps from all 5 strategies automatically via the EventBus. Add it via `ThoughtTracerLive`:

```typescript
import { ThoughtTracerService, ThoughtTracerLive } from "@reactive-agents/observability";
import { EventBusLive } from "@reactive-agents/core";
import { Layer, Effect } from "effect";

const tracerWithBus = Layer.provideMerge(ThoughtTracerLive, EventBusLive);

const steps = await Effect.runPromise(
  Effect.gen(function* () {
    // ... run agent ...
    const tracer = yield* ThoughtTracerService;
    return yield* tracer.getThoughtChain("reactive");
  }).pipe(Effect.provide(tracerWithBus)),
);
```

Each step in the chain has `{ step, thought?, action?, observation?, strategy }` fields.

## Exporting

Call `flush()` to ensure all buffered metrics and logs are exported:

```typescript
yield* obs.flush();
```

## Metrics Dashboard

When `verbosity` is set to `"normal"` or higher, a professional metrics dashboard is printed automatically at the end of every agent execution. No manual instrumentation is required — the `MetricsCollector` auto-subscribes to the EventBus and aggregates all phase timings, tool calls, token usage, and cost estimates.

### Enabling the Dashboard

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withObservability({ verbosity: "normal", live: true })
  .build();
```

Setting `live: true` additionally streams phase events to the console in real-time as the agent runs. The dashboard is shown once on completion regardless of `live`.

### Dashboard Sections

```
┌─────────────────────────────────────────────────────────────┐
│ ✅ Agent Execution Summary                                   │
├─────────────────────────────────────────────────────────────┤
│ Status:    ✅ Success   Duration: 13.9s   Steps: 7          │
│ Tokens:    1,963        Cost: ~$0.003     Model: claude-3.5 │
└─────────────────────────────────────────────────────────────┘

📊 Execution Timeline
├─ [bootstrap]       100ms    ✅
├─ [think]        10,001ms    ⚠️  (7 iter, 72% of time)
└─ [complete]         28ms    ✅

🔧 Tool Execution (2 called)
├─ file-write    ✅ 3 calls, 450ms avg
└─ web-search    ✅ 2 calls, 280ms avg

⚠️  Alerts & Insights
└─ think phase blocked ≥10s (LLM latency)
```

**1. Header Card** — Overall status (success/failure), total wall-clock duration, step count, token usage, estimated USD cost, and the model that handled the request.

**2. Execution Timeline** — Each execution phase listed with its duration and percentage of total time. Phases that take 10 seconds or more are flagged with a warning icon (`⚠️`) to highlight bottlenecks at a glance.

**3. Tool Execution** — All tool calls grouped by tool name, showing success count, error count, and average call duration. Only shown when at least one tool was called.

**4. Alerts & Insights** — Smart warnings about detected bottlenecks (e.g., slow `think` phase, high iteration count, budget approach). Only rendered when relevant — executions with no anomalies produce no alerts section.

### Verbosity and Dashboard Visibility

| Verbosity | Dashboard |
|-----------|-----------|
| `"minimal"` | Not shown |
| `"normal"` | Full dashboard |
| `"verbose"` | Full dashboard + detailed per-phase logs |
| `"debug"` | Full dashboard + full prompt/tool I/O (no truncation) |
