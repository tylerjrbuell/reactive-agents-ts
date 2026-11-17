# @reactive-agents/health

> HTTP health, readiness and metrics endpoints with registered probes, for agents that run under Kubernetes or a load balancer.

> **Stability:** unstable. Not listed as stable in the stability reference; the API may change between minors.

## Install

```bash
bun add @reactive-agents/health
# or: npm install @reactive-agents/health
```

The facade (`bun add reactive-agents`) does not re-export this package. The builder's `.withHealthCheck()` uses it for you.

## Usage

```ts
import { Effect } from "effect";
import { Health, makeHealthService } from "@reactive-agents/health";

const program = Effect.gen(function* () {
  const health = yield* makeHealthService({ port: 8080, agentName: "my-agent" });
  yield* health.registerCheck("db", () => Effect.succeed(true));
  yield* health.start();
  const status = yield* health.check();
  console.log(status.status); // "healthy" | "degraded" | "unhealthy"
  yield* health.stop();
});

await Effect.runPromise(program);
```

On a built agent, call `.withHealthCheck()` on the builder and read `await agent.health()`.

Endpoints: `/health` (aggregate status), `/ready` (503 only when `unhealthy`), `/metrics` (text metrics).

## API

| Export | Use it when |
|---|---|
| `makeHealthService` | You construct the health server and register probes yourself |
| `Health` | You need the service tag in an Effect program |
| `HealthConfig` | You configure `port` and `agentName` |
| `HealthResponse`, `HealthCheckResult` | You type the aggregate and per-probe results |
| `HealthServerError` | You handle server startup failures |

## Documentation

- [Configuration reference](https://docs.reactiveagents.dev/reference/configuration/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
