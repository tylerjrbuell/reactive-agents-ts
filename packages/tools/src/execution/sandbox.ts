import { Duration, Effect } from "effect";

import { ToolExecutionError, ToolTimeoutError } from "../errors.js";

export const makeSandbox = () => {
  const execute = <A>(
    fn: () => Effect.Effect<A, ToolExecutionError>,
    options: { timeoutMs: number; toolName?: string },
  ): Effect.Effect<A, ToolExecutionError | ToolTimeoutError> =>
    fn().pipe(
      // Enforce timeout
      Effect.timeoutFail({
        duration: Duration.millis(options.timeoutMs),
        onTimeout: () =>
          new ToolTimeoutError({
            message: `Tool execution timed out after ${options.timeoutMs}ms`,
            toolName: options.toolName ?? "unknown",
            timeoutMs: options.timeoutMs,
          }),
      }),
      // Catch unexpected errors
      Effect.catchAllDefect((defect) =>
        Effect.fail(
          new ToolExecutionError({
            message: `Tool crashed: ${String(defect)}`,
            toolName: options.toolName ?? "unknown",
            cause: defect,
          }),
        ),
      ),
    );

  return { execute };
};
