---
title: Observability, lifecycle and testing
description: >-
  Builder reference for observability, Cortex reporting, streaming, logging, tracing, health checks, audit, error handling, lifecycle hooks and test scenarios.
sidebar:
  order: 7
topic: config-reference
related:
  - reference/builder-api
  - features/observability
  - guides/hooks
  - cookbook/testing-agents
---

Methods that make a run visible and testable: observability, Cortex reporting, streaming, logging and tracing, health checks, audit, error handling, lifecycle hooks and the deterministic test provider. Part of the [builder reference](/reference/builder-api/).

## Observability and telemetry methods

| Method                               | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withObservability(options?)`        | Metrics dashboard, tracing, verbosity. Options: `verbosity` (`"minimal"\|"normal"\|"verbose"\|"debug"`), `live` (stream phase events), `file` (JSONL path), `logPrefix`, `logModelIO` (when `true` or when `verbosity: "debug"`, logs the complete FC conversation thread with role labels `[USER]`/`[ASSISTANT]`/`[TOOL]` and raw LLM response for every iteration — essential for debugging prompt issues). **Note:** observability is enabled at `"normal"` verbosity by default — you only need `.withObservability()` to customize the verbosity level or output format. Also the single entry point for run telemetry (`telemetry: true \| TelemetryConfig` — privacy modes, default `isolated`) and trace-file control (`tracing: false` disables; `tracing: { dir }` sets the directory). |
| `withCortex(url?)`                   | Enable best-effort Cortex reporting. Streams all EventBus events to the [Cortex local studio](/features/cortex/) over WebSocket (`/ws/ingest`). URL priority: explicit `url` arg → `CORTEX_URL` env → `http://localhost:4321`. Connection is non-blocking — if Cortex is unreachable the agent continues normally. See [Cortex Studio](/features/cortex/) for the full feature reference.                    |
| `withStreaming(options?)`            | Default density for `agent.runStream()`: `{ density?: "tokens" \| "full" }`                                                                                                                                                                                                                                                                                                                                  |
| `withLogging(config)`                | `makeLoggerService` — `{ level?, format?, output?: "console" \| "file" \| WritableStream, filePath?, maxFileSizeBytes?, maxFiles? }`                                                                                                                                                                                                                                                                         |
| `withHealthCheck()`                  | Enables `agent.health()`                                                                                                                                                                                                                                                                                                                                                                                     |
| `withEvents()`                       | Ensures EventBus wiring for `agent.subscribe()`                                                                                                                                                                                                                                                                                                                                                              |
| `withAudit()`                        | Audit trail                                                                                                                                                                                                                                                                                                                                                                                                  |
| `withTracing(opts?)`                 | Write structured trace files (`{ dir? }`) for `rax diagnose`. Governed separately from the metrics dashboard; also toggled by `REACTIVE_AGENTS_TRACE`. Disable with `.withObservability({ tracing: false })`.                                                                                                                                                                                                 |
| `withErrorHandler(handler)`          | Observe-only callback on `agent.run()` failures — does not swallow errors                                                                                                                                                                                                                                                                                                                                    |
| `withReactiveIntelligence(false)`    | Disable the Reactive Intelligence layer (enabled by default).                                                                                                                                                                                                                                                                                                                                                |
| `withReactiveIntelligence(options?)` | Entropy, controller, telemetry, hooks (`onEntropyScored`, `onControllerDecision`, …). See [Reactive Intelligence](/features/reactive-intelligence/)                                                                                                                                                                                                                                                          |

## Lifecycle

| Method     | Signature                       | Description               |
| ---------- | ------------------------------- | ------------------------- |
| `withHook` | `(hook: LifecycleHook) => this` | Register a lifecycle hook |

### LifecycleHook

Use the exported `LifecycleHook` type from `@reactive-agents/runtime`. Handlers return **`Effect.Effect<ExecutionContext, ExecutionError>`** (import `Effect` from `"effect"`).

`LifecyclePhase` values include: `bootstrap`, `guardrail`, `cost-route`, `strategy-select`, `think`, `act`, `observe`, `verify`, `memory-flush`, `cost-track`, `audit`, `complete`.

## Testing

| Method             | Signature                     | Description                                                                                                                                                                                                                                 |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withTestScenario` | `(turns: TestTurn[]) => this` | Deterministic **test** provider. Forces `provider: "test"`. Turns are `TestTurn` values from `@reactive-agents/llm-provider`: `{ text? }`, `{ toolCall? }`, `{ toolCalls? }`, `{ json? }`, `{ error? }`, optional `match?` (regex) per turn |

See [Testing agents](/cookbook/testing-agents/) and [Configuration](/reference/configuration/) for examples.
