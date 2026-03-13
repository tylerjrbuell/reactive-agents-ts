---
title: Observability & Metrics
description: Read the metrics dashboard, export telemetry, subscribe to EventBus events, and wire up external monitoring.
sidebar:
  order: 8
---

`withObservability()` turns on distributed tracing, the metrics dashboard, and structured logging with a single builder call. This recipe shows how to use each piece.

## Enabling the Dashboard

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("research-bot")
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withObservability({ verbosity: "normal" })
  .build();

const result = await agent.run("Summarize the top 5 papers on transformer attention");
// Dashboard is printed automatically when the run completes
```

At `verbosity: "normal"` you get a dashboard like this printed to stdout:

```
┌─────────────────────────────────────────────────────────────┐
│ ✅ Agent Execution Summary                                   │
├─────────────────────────────────────────────────────────────┤
│ Status:    ✅ Success   Duration: 13.9s   Steps: 7          │
│ Tokens:    1,963        Cost: ~$0.003     Model: claude-3.5 │
└─────────────────────────────────────────────────────────────┘

📊 Execution Timeline
├─ [bootstrap]       100ms    ✅
├─ [guardrail]        50ms    ✅
├─ [strategy]         50ms    ✅
├─ [think]        10,001ms    ⚠️  (7 iter, 72% of time)
├─ [act]           1,000ms    ✅  (2 tools)
├─ [observe]         500ms    ✅
├─ [memory-flush]    200ms    ✅
└─ [complete]         28ms    ✅

🔧 Tool Execution (2 called)
├─ web-search    ✅ 2 calls, 350ms avg
└─ file-write    ✅ 1 call, 120ms avg

⚠️  Alerts & Insights
└─ think phase blocked ≥10s (LLM latency)
```

No manual instrumentation is needed. `MetricsCollector` auto-subscribes to the EventBus and aggregates all phase timings, tool calls, token usage, and cost estimates.

## Verbosity Levels

| Level | Dashboard | Real-time output |
|-------|-----------|-----------------|
| `"minimal"` | Not shown | Start + complete lines only |
| `"normal"` *(default)* | Full dashboard | Phase transitions + tool names |
| `"verbose"` | Full dashboard | + reasoning steps + LLM call summary |
| `"debug"` | Full dashboard | + full prompt/tool I/O (no truncation) |

## Live Phase Streaming

Set `live: true` to stream phase events to the console as the agent runs, in addition to the end-of-run dashboard:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .withObservability({ verbosity: "verbose", live: true })
  .build();

// Output as the agent runs:
// ◉ [bootstrap]     0 semantic, 0 episodic | 12ms
// ◉ [strategy]      reactive | tools: web-search, file-write
//   ┄ [thought]  I need to search for recent transformer papers...
//   ┄ [action]   web-search({"query":"transformer attention 2025"})
//   ┄ [obs]      Found 47 results [1,204 chars]
// ◉ [think]         5 steps | 4,800 tok | 8.1s
// ◉ [act]           web-search (1 tool)
// ◉ [complete]      ✓ task-abc | 4,800 tok | $0.0002 | 8.3s
```

## Reading the Debrief

When reasoning is enabled, every run produces a structured `AgentDebrief` attached to the result:

```typescript
const result = await agent.run("Compare React and Vue for a large SPA project");

if (result.debrief) {
  console.log(result.debrief.summary);
  // "The agent compared React and Vue across performance, ecosystem, and..."

  console.log(result.debrief.keyFindings);
  // ["React has a larger ecosystem", "Vue has gentler learning curve", ...]

  console.log(result.debrief.metrics);
  // { iterations: 4, toolCalls: 2, tokensUsed: 2100 }

  console.log(result.terminatedBy);
  // "final_answer" | "max_iterations" | "error"
}
```

The debrief is also persisted to SQLite (`agent_debriefs` table) if memory is enabled, so you can query historical run data.

## Subscribing to EventBus Events

For custom monitoring integrations, subscribe to the typed EventBus directly:

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .build();

// Subscribe to specific event types (fully typed)
agent.subscribe("ToolCallCompleted", (event) => {
  // event.toolName, event.durationMs, event.success are all typed
  console.log(`Tool ${event.toolName} took ${event.durationMs}ms`);
});

agent.subscribe("ReasoningStepCompleted", (event) => {
  if (event.thought) console.log(`Thought: ${event.thought}`);
  if (event.action) console.log(`Action: ${event.action}`);
  if (event.observation) console.log(`Obs: ${event.observation}`);
});

agent.subscribe("FinalAnswerProduced", (event) => {
  console.log(`Done in ${event.iteration} steps, ${event.totalTokens} tokens`);
});

// Or catch-all for all events
agent.subscribe((event) => {
  myMonitoringSystem.track(event._tag, event);
});

await agent.run("What is the top story on Hacker News right now?");
await agent.dispose();
```

### Available Event Tags

| Tag | When it fires |
|-----|--------------|
| `AgentStarted` | Task begins execution |
| `AgentCompleted` | Task finishes (success or failure) |
| `ReasoningStepCompleted` | Each thought/action/observation step |
| `ReasoningFailed` | Strategy error during reasoning loop |
| `FinalAnswerProduced` | Final answer extracted from loop |
| `ToolCallCompleted` | Each tool call (success or failure) |
| `GuardrailViolationDetected` | Input blocked by guardrails |
| `LLMRequestStarted` | LLM API call begins |
| `MemoryBootstrapped` | Memory loaded at task start |
| `MemoryFlushed` | Memory written at task end |
| `IterationProgress` | Every reasoning loop iteration (streaming) |
| `StrategySwitched` | Strategy switching triggered |

## Wiring External Monitoring

### Sending Metrics to Prometheus / Datadog

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools()
  .build();

// Collect metrics from events
agent.subscribe("ToolCallCompleted", (event) => {
  // Prometheus-style counter
  toolCallCounter.inc({ tool: event.toolName, success: String(event.success) });
  // Histogram for latency
  toolLatencyHistogram.observe({ tool: event.toolName }, event.durationMs / 1000);
});

agent.subscribe("AgentCompleted", (event) => {
  runDurationGauge.set(event.durationMs ?? 0);
  tokenUsageCounter.inc(event.tokensUsed ?? 0);
});
```

### Structured Logging to Files

Use `withLogging()` independently of the full observability stack:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withLogging({
    level: "info",
    format: "json",
    output: "file",
    filePath: "./logs/agent.log",
    maxFileSizeMb: 50,
    maxFiles: 7,
  })
  .build();

// All agent events are written as JSON lines to ./logs/agent.log
// Automatically rotates at 50 MB, keeps 7 rotated files
```

Each JSON log entry includes `timestamp`, `level`, `message`, `agentId`, `sessionId`, `traceId`, and any custom metadata.

## Health Probes

`withHealthCheck()` adds a `agent.health()` method that tests every wired service:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withMemory()
  .withGuardrails()
  .withHealthCheck()
  .build();

const health = await agent.health();
// {
//   status: "healthy",                // "healthy" | "degraded" | "unhealthy"
//   checks: [
//     { name: "llm-provider", status: "healthy", latencyMs: 234 },
//     { name: "memory",       status: "healthy", latencyMs: 12 },
//     { name: "guardrails",   status: "healthy", latencyMs: 1 },
//   ]
// }

if (health.status !== "healthy") {
  console.error("Agent degraded:", health.checks.filter(c => c.status !== "healthy"));
}
```

Call `agent.health()` from a Kubernetes readiness probe, a `/health` HTTP endpoint, or a pre-run guard in your application code.

## Distributed Tracing

Every execution produces a trace tree. View it via `obs.flush()` after a run:

```typescript
import { ReactiveAgents } from "reactive-agents";
import { ObservabilityService } from "@reactive-agents/observability";
import { Effect } from "effect";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withObservability({ verbosity: "normal" })
  .build();

await agent.run("Draft a short blog post about Effect-TS");
// Dashboard printed here

// Force-flush any buffered spans to the exporter
// (useful when using file or remote exporters)
```

Each trace span carries the `traceId` for correlation — you can join spans with logs using `traceId` when both are emitted from the same run.
