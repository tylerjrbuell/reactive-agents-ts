# @reactive-agents/observability

Observability for the [Reactive Agents](https://tylerjrbuell.github.io/reactive-agents-ts/) framework.

Adds distributed tracing, metrics, and structured logging to every phase of the agent execution engine.

## Installation

```bash
bun add @reactive-agents/observability effect
```

## Features

- **Distributed tracing** — span per execution phase, compatible with OpenTelemetry exporters
- **Metrics** — token usage, latency, step count, cost per run
- **Structured logging** — JSON logs with trace context for easy querying

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("traced-agent")
  .withProvider("anthropic")
  .withObservability()
  .build();

const result = await agent.run("Analyze this data");
// All 10 execution phases are traced automatically
```

## What Gets Traced

Each of the 10 execution phases emits a span:

```
bootstrap → guardrail → cost-route → strategy-select →
think → act → observe → verify → memory-flush → complete
```

## Documentation

Full documentation at [tylerjrbuell.github.io/reactive-agents-ts](https://tylerjrbuell.github.io/reactive-agents-ts/)
