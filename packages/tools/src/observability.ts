import { Effect } from "effect";
import type { DefinedTool } from "./define-tool.js";

export interface ToolObservabilityMeta {
  readonly toolName: string;
  readonly latencyMs: number;
  readonly attempt: number;
  readonly startedAt: string;
}

export interface ObservedToolResult<T = unknown> {
  readonly data: T;
  readonly meta: ToolObservabilityMeta;
}

interface AttemptCarrier {
  readonly value: unknown;
  readonly attempt: number;
}

/**
 * Wraps a `DefinedTool`'s handler so every successful call resolves to
 * `{ data, meta }` instead of a bare value — `meta` carries latency, which
 * attempt succeeded (1 unless composed with `withToolRetry`), and a
 * timestamp. Failures are untouched (still reject with the tool's normal
 * error type) so existing error handling keeps working.
 */
export function withToolObservability(tool: DefinedTool): DefinedTool {
  return {
    definition: tool.definition,
    handler: (rawArgs: Record<string, unknown>) => {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      return tool.handler(rawArgs).pipe(
        Effect.map((resolved) => {
          const carrier = isAttemptCarrier(resolved) ? resolved : { value: resolved, attempt: 1 };
          const meta: ToolObservabilityMeta = {
            toolName: tool.definition.name,
            latencyMs: Date.now() - startMs,
            attempt: carrier.attempt,
            startedAt,
          };
          return { data: carrier.value, meta } satisfies ObservedToolResult;
        }),
      );
    },
  };
}

function isAttemptCarrier(value: unknown): value is AttemptCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "attempt" in value &&
    typeof (value as { attempt: unknown }).attempt === "number"
  );
}

/**
 * Wraps a `DefinedTool`'s handler with a bounded retry: on failure, retries
 * up to `maxAttempts` times with no delay between attempts (callers needing
 * backoff should combine with `fetchJsonTool`'s own retry, see Task 3 — do
 * not stack both retry layers on the same handler). Tags the resolved value
 * with the attempt number so `withToolObservability` can report it.
 */
export function withToolRetry(tool: DefinedTool, options: { maxAttempts: number }): DefinedTool {
  const { maxAttempts } = options;
  return {
    definition: tool.definition,
    handler: (rawArgs: Record<string, unknown>) =>
      Effect.gen(function* () {
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const exit = yield* Effect.exit(tool.handler(rawArgs));
          if (exit._tag === "Success") {
            return { value: exit.value, attempt } satisfies AttemptCarrier;
          }
          lastError = exit.cause;
        }
        return yield* Effect.failCause(lastError as Parameters<typeof Effect.failCause>[0]);
      }),
  };
}
