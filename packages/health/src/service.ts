// packages/health/src/service.ts
import { Effect, Ref } from "effect";
import type {
  HealthConfig,
  HealthService,
  HealthResponse,
  HealthCheckResult,
} from "./types.js";

type HealthCheck = {
  readonly name: string;
  readonly check: () => Effect.Effect<boolean, never>;
};

/**
 * Create a HealthService that runs a Bun.serve HTTP server
 * with /health, /ready, and /metrics endpoints.
 */
export const makeHealthService = (
  config: HealthConfig,
): Effect.Effect<HealthService & { readonly _port: number }> =>
  Effect.gen(function* () {
    const checksRef = yield* Ref.make<HealthCheck[]>([]);
    const startedAt = Date.now();
    let server: ReturnType<typeof Bun.serve> | null = null;
    let boundPort = config.port;

    const runChecks = (): Effect.Effect<HealthCheckResult[], never> =>
      Effect.gen(function* () {
        const checks = yield* Ref.get(checksRef);
        const results: HealthCheckResult[] = [];
        for (const c of checks) {
          const start = Date.now();
          const healthy = yield* c.check();
          results.push({
            name: c.name,
            healthy,
            durationMs: Date.now() - start,
          });
        }
        return results;
      });

    const buildResponse = (checks: HealthCheckResult[]): HealthResponse => {
      const allHealthy = checks.every((c) => c.healthy);
      const anyHealthy = checks.some((c) => c.healthy);
      return {
        status:
          checks.length === 0 || allHealthy
            ? "healthy"
            : anyHealthy
              ? "degraded"
              : "unhealthy",
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        agent: config.agentName,
        checks,
        timestamp: new Date().toISOString(),
      };
    };

    const metricsText = (): string => {
      const uptime = ((Date.now() - startedAt) / 1000).toFixed(1);
      return (
        [
          `# HELP raxd_uptime_seconds Agent uptime in seconds`,
          `# TYPE raxd_uptime_seconds gauge`,
          `raxd_uptime_seconds ${uptime}`,
          `# HELP raxd_health_status Health status (1=healthy, 0=unhealthy)`,
          `# TYPE raxd_health_status gauge`,
          `raxd_health_status 1`,
        ].join("\n") + "\n"
      );
    };

    const handleRequest = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        const checks = await Effect.runPromise(runChecks());
        const body = buildResponse(checks);
        return Response.json(body, { status: 200 });
      }

      if (url.pathname === "/ready") {
        const checks = await Effect.runPromise(runChecks());
        const body = buildResponse(checks);
        const status = body.status === "unhealthy" ? 503 : 200;
        return Response.json(body, { status });
      }

      if (url.pathname === "/metrics") {
        return new Response(metricsText(), {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    };

    const service: HealthService & { readonly _port: number } = {
      get _port() {
        return boundPort;
      },

      start: () =>
        Effect.sync(() => {
          server = Bun.serve({
            port: config.port,
            fetch: handleRequest,
          });
          boundPort = server.port ?? config.port;
        }),

      stop: () =>
        Effect.sync(() => {
          if (server) {
            server.stop(true);
            server = null;
          }
        }),

      registerCheck: (name, check) =>
        Ref.update(checksRef, (checks) => [...checks, { name, check }]),

      check: () =>
        Effect.gen(function* () {
          const checks = yield* runChecks();
          return buildResponse(checks);
        }),
    };

    return service;
  });
