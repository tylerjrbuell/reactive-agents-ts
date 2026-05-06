# @reactive-agents/health

Health checks and readiness probes for the [Reactive Agents](https://docs.reactiveagents.dev/) framework. **v0.10.3**

Provides an HTTP health server with registered probes, returning structured status responses suitable for Kubernetes liveness/readiness, load-balancer health checks, and dashboards. Integrates with the builder via `.withHealthCheck()` and exposes `agent.health()` for programmatic access.

## Installation

```bash
bun add @reactive-agents/health
```

Or via the umbrella:

```bash
bun add reactive-agents
```

## Quick Example

### Builder Integration

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic", { model: "claude-haiku-4-5-20251001" })
  .withHealthCheck({ port: 8080 })
  .build();

const health = await agent.health();
// {
//   status: "healthy" | "degraded" | "unhealthy",
//   uptime: 12345,
//   checks: [
//     { name: "llm", healthy: true, durationMs: 42 },
//     { name: "memory", healthy: true, durationMs: 3 },
//   ],
//   timestamp: "2026-05-05T19:55:00Z",
// }
```

### Direct Service Usage

```typescript
import { Effect } from "effect";
import { makeHealthService, Health } from "@reactive-agents/health";

const program = Effect.gen(function* () {
  const health = yield* Health;
  yield* health.registerCheck("db", () =>
    Effect.tryPromise(() => myDb.ping().then(() => true)),
  );
  yield* health.start({ port: 8080 });
  const status = yield* health.check();
  return status;
});
```

## HTTP Endpoints

| Endpoint   | Returns                                                            |
| ---------- | ------------------------------------------------------------------ |
| `/health`  | Aggregate `HealthResponse` — overall status + per-probe results    |
| `/ready`   | Readiness probe — 200 when all checks pass, 503 otherwise          |

## Aggregation Logic

| Probe results          | Overall status |
| ---------------------- | -------------- |
| All probes healthy     | `healthy`      |
| Some probes unhealthy  | `degraded`     |
| All probes unhealthy   | `unhealthy`    |

Each probe reports its own `durationMs`, so latency regressions in dependencies surface immediately.

## Key Features

- **HTTP endpoints** — `/health` and `/ready` with structured JSON responses
- **Registered probes** — `registerCheck(name, fn)` for LLM, database, queue, etc.
- **Aggregate status** — `healthy` / `degraded` / `unhealthy`
- **Builder integration** — single `.withHealthCheck()` call enables the server
- **Per-check timing** — every probe reports its `durationMs`

## Key Exports

| Export                | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `Health`              | Service tag                                   |
| `makeHealthService`   | Constructs the health service                 |
| `HealthConfig`        | Configuration schema (`port`, `path`, etc.)   |
| `HealthResponse`      | Aggregate response shape                      |
| `HealthCheckResult`   | Per-probe result shape                        |
| `HealthServerError`   | Tagged error                                  |

## Documentation

Full documentation at [docs.reactiveagents.dev](https://docs.reactiveagents.dev/)

## License

MIT
