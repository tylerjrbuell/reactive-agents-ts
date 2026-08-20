import { Cause, Effect } from "effect";
import type { DefinedTool } from "./define-tool.js";
import { ToolDefinitionError, ToolExecutionError, ToolOutputValidationError } from "./errors.js";

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

export interface ToolObservabilityOptions {
  /**
   * When set, retries the underlying handler up to `maxAttempts` times (no
   * delay between attempts) before giving up. `maxAttempts` must be >= 1.
   */
  readonly retry?: { readonly maxAttempts: number };
}

/**
 * Runs `tool.handler(rawArgs)` up to `maxAttempts` times (no delay between
 * attempts), returning the resolved value together with the attempt number
 * that succeeded. Fails with the last observed cause if every attempt fails.
 *
 * Internal helper — the attempt count is only ever surfaced through
 * `withToolObservability`'s `meta.attempt`; nothing outside this module ever
 * sees the intermediate `{ value, attempt }` shape.
 */
function runWithRetry(
  tool: DefinedTool,
  rawArgs: Record<string, unknown>,
  maxAttempts: number,
): Effect.Effect<
  { readonly value: unknown; readonly attempt: number },
  ToolExecutionError | ToolOutputValidationError
> {
  return Effect.gen(function* () {
    let lastError: Cause.Cause<ToolExecutionError | ToolOutputValidationError> | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const exit = yield* Effect.exit(tool.handler(rawArgs));
      if (exit._tag === "Success") {
        return { value: exit.value, attempt };
      }
      lastError = exit.cause;
    }
    return yield* Effect.failCause(lastError!);
  });
}

/**
 * Wraps a `DefinedTool`'s handler so every successful call resolves to
 * `{ data, meta }` instead of a bare value — `meta` carries latency, which
 * attempt succeeded (1 unless `options.retry` is set), and a timestamp.
 * Failures are untouched (still reject with the tool's normal error type) so
 * existing error handling keeps working.
 *
 * Pass `options.retry` to compose retry behavior in — this is the only
 * supported way to observe the attempt count of a retried call.
 */
export function withToolObservability(
  tool: DefinedTool,
  options?: ToolObservabilityOptions,
): DefinedTool {
  const maxAttempts = options?.retry?.maxAttempts;
  if (maxAttempts !== undefined && maxAttempts < 1) {
    throw new ToolDefinitionError({
      message: `withToolObservability({ retry: { maxAttempts: ${maxAttempts} } }) for tool "${tool.definition.name}": maxAttempts must be >= 1.`,
      toolName: tool.definition.name,
      field: "retry.maxAttempts",
    });
  }

  return {
    definition: tool.definition,
    handler: (rawArgs: Record<string, unknown>) => {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      const run =
        maxAttempts !== undefined
          ? runWithRetry(tool, rawArgs, maxAttempts)
          : Effect.map(tool.handler(rawArgs), (value) => ({ value, attempt: 1 }));
      return run.pipe(
        Effect.map(({ value, attempt }) => {
          const meta: ToolObservabilityMeta = {
            toolName: tool.definition.name,
            latencyMs: Date.now() - startMs,
            attempt,
            startedAt,
          };
          return { data: value, meta } satisfies ObservedToolResult;
        }),
      );
    },
  };
}

/**
 * Wraps a `DefinedTool`'s handler with a bounded retry: on failure, retries
 * up to `maxAttempts` times with no delay between attempts (callers needing
 * backoff should combine with `fetchJsonTool`'s own retry, see Task 3 — do
 * not stack both retry layers on the same handler).
 *
 * Used standalone (not composed with `withToolObservability`), this resolves
 * to the tool's real, unwrapped return value — exactly as if no retry
 * wrapper were present. The attempt count is not observable via
 * `withToolRetry` alone; compose with `withToolObservability(tool, { retry
 * })` (or wrap `withToolRetry`'s result in `withToolObservability`) if you
 * need to know which attempt succeeded.
 */
export function withToolRetry(tool: DefinedTool, options: { maxAttempts: number }): DefinedTool {
  if (options.maxAttempts < 1) {
    throw new ToolDefinitionError({
      message: `withToolRetry(tool, { maxAttempts: ${options.maxAttempts} }) for tool "${tool.definition.name}": maxAttempts must be >= 1.`,
      toolName: tool.definition.name,
      field: "maxAttempts",
    });
  }

  const observed = withToolObservability(tool, { retry: { maxAttempts: options.maxAttempts } });
  return {
    definition: tool.definition,
    handler: (rawArgs: Record<string, unknown>) =>
      Effect.map(observed.handler(rawArgs), (result) => (result as ObservedToolResult).data),
  };
}
