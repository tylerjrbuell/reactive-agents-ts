---
name: observability-instrumentation
description: Configure verbosity levels, live log streaming, JSONL file export, model I/O logging, and audit trails for monitoring agent execution.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Observability and Instrumentation

## Agent objective

Produce a builder with observability configured at the right verbosity level, with optional live streaming and file export, so agent execution can be monitored and debugged.

## When to load this skill

- Debugging unexpected agent behavior in development
- Capturing structured logs for post-hoc analysis
- Streaming live execution traces to a dashboard or log aggregator
- Auditing all tool calls and model decisions in production
- Comparing model I/O before/after a system prompt change

## Implementation baseline

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("monitor")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "adaptive", maxIterations: 10 })
  .withTools({ allowedTools: ["web-search", "http-get", "checkpoint"] })
  .withObservability({
    verbosity: "normal",    // show metrics dashboard on completion
    live: true,             // stream events as they happen
    file: "./logs/agent.jsonl",  // write structured JSONL log
  })
  .withAudit()              // record all tool calls and decisions
  .build();
```

## Verbosity levels

| Level | Output |
|-------|--------|
| `"minimal"` | No output except final result — for programmatic/embedded use |
| `"normal"` | Metrics dashboard on completion (default) — recommended for production |
| `"verbose"` | Step-by-step phase summaries as the agent runs |
| `"debug"` | Full phase traces including tool call args/results and model responses |

```ts
.withObservability({ verbosity: "minimal" })   // silent — result only
.withObservability({ verbosity: "normal" })    // dashboard on finish (default)
.withObservability({ verbosity: "verbose" })   // running commentary
.withObservability({ verbosity: "debug" })     // everything, including prompt/response dumps
```

## Key patterns

### Live streaming

```ts
.withObservability({ verbosity: "verbose", live: true })
// Streams log events in real-time as each phase completes.
// Without live: true, output is buffered and printed at the end.
// Combine with verbosity: "verbose" or "debug" for full traces.
```

### JSONL file export

```ts
.withObservability({
  verbosity: "normal",
  file: "./logs/run-2026-04-09.jsonl",   // appends structured events as JSONL
})
// Each line is a JSON object: { timestamp, event, phase, data }
// Suitable for ingestion into log aggregators (Datadog, Loki, etc.)
```

### Model I/O logging

```ts
.withObservability({
  verbosity: "debug",
  logModelIO: true,    // log full system prompts and model responses
})
// logModelIO defaults to true at "debug" verbosity, false at all other levels.
// Set logModelIO: false at "debug" to debug phases without exposing prompt content.
```

### Audit trail

```ts
.withAudit()
// Records structured audit events for every tool call, guardrail check, contract
// validation, and cost tracking decision.
// Audit events appear in the observability stream and are written to the file if configured.
// Use alongside .withObservability() to capture audit events to a file.
```

### Minimal production config (observability without noise)

```ts
.withObservability({ verbosity: "minimal" })
// Disables all terminal output — the agent runs silently.
// Results are returned programmatically only.
// Combine with .withCostTracking() to still enforce budgets without logging.
```

### Development debug config

```ts
.withObservability({
  verbosity: "debug",
  live: true,
  logModelIO: true,
  file: "./debug.jsonl",
})
// Maximum visibility: live stream + full model I/O + JSONL file
```

## ObservabilityOptions reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `verbosity` | `"minimal"\|"normal"\|"verbose"\|"debug"` | `"normal"` | Output detail level |
| `live` | `boolean` | `false` | Stream events in real-time |
| `file` | `string` | — | JSONL log file path (appends) |
| `logModelIO` | `boolean` | `true` at debug, `false` otherwise | Log full prompts and responses |

## Pitfalls

- `verbosity: "normal"` prints a metrics dashboard at completion — this is terminal output, not a structured event. Use `file` for structured capture
- `live: true` at `verbosity: "debug"` produces very high-volume output — only use for targeted debugging sessions
- `logModelIO: true` logs full system prompts — ensure logs are stored securely, as they may contain sensitive system prompt content
- JSONL file output appends to existing files — rotate or clear the file between runs in long-running test suites
- `.withAudit()` alone does not produce console output — combine with `.withObservability()` to see audit events
- At `verbosity: "minimal"`, even errors are not printed to console — check the returned `AgentResult` for failure details
