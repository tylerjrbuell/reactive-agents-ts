// packages/health/src/types.ts
import { Context, Effect } from "effect";

/**
 * Health check result from a registered probe.
 */
export interface HealthCheckResult {
  readonly name: string;
  readonly healthy: boolean;
  readonly message?: string;
  readonly durationMs: number;
}

/**
 * Full health response returned from /health and /ready endpoints.
 */
export interface HealthResponse {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly uptime: number;
  readonly agent?: string;
  readonly checks: readonly HealthCheckResult[];
  readonly timestamp: string;
}

/**
 * Configuration for the health server.
 */
export interface HealthConfig {
  /** Port to bind the health HTTP server. Default: 3000 */
  readonly port: number;
  /** Agent name to include in health responses. */
  readonly agentName?: string;
}

/**
 * Health service interface — manages an HTTP health server and registered probes.
 */
export interface HealthService {
  /** Start the HTTP health server on the configured port. */
  readonly start: () => Effect.Effect<void, never>;
  /** Stop the HTTP health server gracefully. */
  readonly stop: () => Effect.Effect<void, never>;
  /** Register a named health check probe. */
  readonly registerCheck: (
    name: string,
    check: () => Effect.Effect<boolean, never>,
  ) => Effect.Effect<void, never>;
  /** Run all registered checks and return the aggregate result. */
  readonly check: () => Effect.Effect<HealthResponse, never>;
}

/**
 * Effect-TS Context Tag for HealthService.
 */
export class Health extends Context.Tag("HealthService")<
  Health,
  HealthService
>() {}
