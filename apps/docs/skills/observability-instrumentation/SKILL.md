---
name: observability-instrumentation
description: Instrument agents with structured traces, events, metrics, and execution-phase diagnostics for production debugging.
compatibility: Reactive Agents projects using observability and EventBus layers.
metadata:
  author: reactive-agents
  version: "1.0"
---

# Observability Instrumentation

Use this skill when you need explainable, debuggable agent behavior.

## Agent objective

When implementing observability, generate code/config that:

- Makes every execution phase measurable.
- Correlates events across agent, task, and delegated sub-runs.
- Surfaces actionable bottlenecks instead of raw logs only.

## What this skill does

- Emits phase-level timing and token/cost metrics.
- Captures tool call success/error distributions.
- Correlates task, agent, and session identifiers in traces.

## Workflow

1. Enable observability in the builder.
2. Subscribe metrics collectors to execution events.
3. Log model I/O boundaries and major state transitions.
4. Surface bottleneck alerts in execution summaries.

## Minimum telemetry set

- Phase durations and iteration count.
- Tokens and cost per task.
- Verification outcomes.
- Tool latency/error rate.

## Expected implementation output

- Builder usage with `.withObservability()` and appropriate verbosity.
- Structured metrics/events suitable for dashboards and alerts.
- Diagnostics that connect slow phases to concrete tool/model causes.

## Code Examples

### Enabling Observability

The primary way to enable observability is with the `.withObservability()` builder method. It accepts different verbosity levels and can stream live events or log to a file.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

// Example 1: Normal verbosity with dashboard on completion and JSONL file export
const agent1 = await ReactiveAgents.create()
  .withName("observed-agent")
  .withProvider("anthropic")
  .withObservability({ verbosity: "normal", live: false, file: "/tmp/agent-run.jsonl" })
  .build();

// Example 2: Verbose mode for detailed, structured phase logs during execution
const agent2 = await ReactiveAgents.create()
  .withName("verbose-agent")
  .withProvider("anthropic")
  .withObservability({ verbosity: "verbose", live: true })
  .build();

// Example 3: Minimal mode for silent execution
const agent3 = await ReactiveAgents.create()
  .withName("minimal-agent")
  .withProvider("anthropic")
  .withObservability({ verbosity: "minimal" })
  .build();
```

### Expected Dashboard Output

When `verbosity` is `"normal"` or higher, a summary dashboard is printed upon completion. This provides a high-level overview of the agent's performance without requiring manual log parsing.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ 📄 Agent Execution Summary                                               │
├──────────────────────────────────────────────────────────────────────────┤
│ ✅ Success  Duration:   22.1s  Steps: 6                                  │
│ Model: cogito:14b      (ollama)  Tokens: 13,299                          │
└──────────────────────────────────────────────────────────────────────────┘
📊 Execution Timeline
├─ [bootstrap]            4ms  ✅
├─ [strategy-select]      0ms  ✅
├─ [think]              22.1s  ⚠️  (6 iter, 100% of time)
├─ [memory-flush]         2ms  ✅
└─ [complete]             0ms  ✅
🔧 Tool Execution (2 called)
├─ github/list_commits ✅ 1 calls, 281ms avg
└─ signal/send_message_to_user ✅ 1 calls, 244ms avg
⚠️  Alerts & Insights
└─ ⚠️  think phase blocked ≥10s (LLM latency)
```

## Pitfalls to avoid

- Relying on ad-hoc `console.log` for root cause analysis.
- Missing correlation IDs across sub-agent calls.
- No alerting on long think/tool phases.
