# @reactive-agents/health

Health checks and readiness probes for the [Reactive Agents](https://docs.reactiveagents.dev/) framework.

Provides an HTTP health server with registered probes, returning structured status responses. Integrates with the builder via `.withHealthCheck()` and exposes `agent.health()` for programmatic access.

## Installation

```bash
bun add @reactive-agents/health
```

Or install everything at once:

```bash
bun add reactive-agents
```

## Usage

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withHealthCheck()
  .build();

const health = await agent.health();
// {
//   status: "healthy",
//   uptime: 12345,
//   checks: [{ name: "llm", healthy: true, durationMs: 42 }],
//   timestamp: "2026-03-15T..."
// }
```

### Direct Service Usage

```typescript
import { Effect } from "effect";
import { makeHealthService, Health } from "@reactive-agents/health";

const program = Effect.gen(function* () {
  const health = yield* Health;
  yield* health.registerCheck("db", () => Effect.succeed(true));
  yield* health.start();
  const status = yield* health.check();
  return status;
});
```

## Key Features

- **HTTP endpoints** — `/health` and `/ready` with structured JSON responses
- **Registered probes** — add custom checks for LLM connectivity, database, external services
- **Aggregate status** — reports `healthy`, `degraded`, or `unhealthy` based on all probes
- **Builder integration** — single `.withHealthCheck()` call enables health probes
- **Per-check timing** — each probe reports its own `durationMs` for latency visibility

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
