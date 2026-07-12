import { Duration, Effect } from "effect";

import { ToolExecutionError, ToolTimeoutError } from "../errors.js";

export const makeSandbox = () => {
  const execute = <A>(
    fn: () => Effect.Effect<A, ToolExecutionError>,
    options: { timeoutMs: number; toolName?: string },
  ): Effect.Effect<A, ToolExecutionError | ToolTimeoutError> =>
    fn().pipe(
      // Defects become typed failures before anything else, so a crashing
      // handler is reported as a tool error rather than tearing down the run.
      Effect.catchAllDefect((defect) =>
        Effect.fail(
          new ToolExecutionError({
            message: `Tool crashed: ${String(defect)}`,
            toolName: options.toolName ?? "unknown",
            cause: defect,
          }),
        ),
      ),
      // `timeoutFail` races, and racing FORKS its child. A child fiber that
      // fails with nobody observing it is reported by Effect's runtime as
      // "Fiber terminated with an unhandled error" (Debug level) — even though
      // the race parent re-raises the error perfectly well. Every failing tool
      // call (an ENOENT file-read, say) therefore printed an alarming, causeless
      // line while behaving correctly. Reifying the outcome as an Exit makes the
      // raced child ALWAYS succeed, so there is no unobserved failure to report;
      // the error is re-raised in the parent below, unchanged.
      Effect.exit,
      Effect.timeoutFail({
        duration: Duration.millis(options.timeoutMs),
        onTimeout: () =>
          new ToolTimeoutError({
            message: `Tool execution timed out after ${options.timeoutMs}ms`,
            toolName: options.toolName ?? "unknown",
            timeoutMs: options.timeoutMs,
          }),
      }),
      // Exit is itself an Effect — this re-raises the original typed failure.
      Effect.flatMap((exit) => exit),
    );

  return { execute };
};
