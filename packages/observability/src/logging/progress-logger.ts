import { Effect } from "effect";
import { ObservabilityService } from "../observability-service.js";

export interface IterationProgress {
  readonly iteration: number;
  readonly maxIterations?: number;
  readonly phase: "thought" | "action" | "observation";
  readonly content: string;
  readonly tokensDelta?: number;
  readonly toolName?: string;
  readonly toolStatus?: "pending" | "success" | "error";
  readonly errorMessage?: string;
}

/**
 * ProgressLogger — Enhanced iteration-by-iteration visibility at "normal" verbosity
 *
 * Usage:
 * ```ts
 * const logger = new ProgressLogger(verbosity);
 * yield* logger.logIteration({
 *   iteration: 1,
 *   phase: "thought",
 *   content: "I need to search for information...",
 * });
 * ```
 */
export class ProgressLogger {
  constructor(
    private verbosity: "minimal" | "normal" | "verbose" | "debug",
  ) {}

  /**
   * Log an iteration with progress details.
   * At "normal" and higher, shows:
   * - Iteration counter and phase
   * - Tool calls with status
   * - Errors with context
   */
  logIteration(progress: IterationProgress): Effect.Effect<void> {
    const verbosity = this.verbosity;
    return Effect.gen(function* () {
      const obsOption = yield* Effect.serviceOption(ObservabilityService);
      if (!obsOption._tag || obsOption._tag === "None") return;

      const obs = obsOption.value;
      const isNormal = verbosity !== "minimal";
      const isVerbose = verbosity === "verbose" || verbosity === "debug";

      if (!isNormal) return;

      // Format iteration header
      const iterLabel = progress.maxIterations
        ? `[${progress.iteration}/${progress.maxIterations}]`
        : `[${progress.iteration}]`;

      switch (progress.phase) {
        case "thought": {
          // Show current thinking at normal verbosity
          const summary = progress.content.substring(0, 80);
          const msg = `  ┄ ${iterLabel} [thought] ${summary}${progress.content.length > 80 ? "..." : ""}`;
          yield* obs.info(msg).pipe(Effect.catchAll(() => Effect.void));
          break;
        }

        case "action": {
          // Show tool call at normal verbosity
          if (progress.toolName) {
            const status = progress.toolStatus === "error" ? "❌" : "→";
            const msg = `  ┄ ${iterLabel} [action]  ${progress.toolName}() ${status}`;
            yield* obs.info(msg).pipe(Effect.catchAll(() => Effect.void));
          }
          break;
        }

        case "observation": {
          // Show tool result at verbose verbosity
          if (isVerbose && progress.toolName) {
            const status = progress.toolStatus === "success" ? "✓" : "⚠";
            const msg = `  ┄ ${iterLabel} [obs]     ${progress.toolName}: ${status}`;
            yield* obs.debug(msg).pipe(Effect.catchAll(() => Effect.void));
          } else if (progress.toolStatus === "error" && progress.errorMessage) {
            const msg = `  ✗ ${iterLabel} [error]   ${progress.toolName ?? "unknown"}: ${progress.errorMessage}`;
            yield* obs.warn(msg).pipe(Effect.catchAll(() => Effect.void));
          }
          break;
        }
      }
    });
  }

  /**
   * Log tool execution with full details (errors, timeouts, etc.)
   */
  logToolExecution(
    toolName: string,
    status: "pending" | "success" | "error" | "timeout",
    durationMs: number,
    errorMessage?: string,
  ): Effect.Effect<void> {
    const verbosity = this.verbosity;
    return Effect.gen(function* () {
      const obsOption = yield* Effect.serviceOption(ObservabilityService);
      if (!obsOption._tag || obsOption._tag === "None") return;

      const obs = obsOption.value;
      const isNormal = verbosity !== "minimal";
      if (!isNormal) return;

      const statusIcon = status === "success" ? "✓" : status === "error" ? "✗" : status === "timeout" ? "⏱" : "→";
      const msg = `    ${statusIcon} ${toolName.padEnd(15)} ${durationMs.toString().padStart(4)}ms${errorMessage ? ` — ${errorMessage}` : ""}`;

      if (status === "error" || status === "timeout") {
        yield* obs.warn(msg).pipe(Effect.catchAll(() => Effect.void));
      } else {
        yield* obs.info(msg).pipe(Effect.catchAll(() => Effect.void));
      }
    });
  }

  /**
   * Log iteration checkpoint (milestone reached)
   */
  logCheckpoint(
    iteration: number,
    label: string,
    details?: Record<string, unknown>,
  ): Effect.Effect<void> {
    const verbosity = this.verbosity;
    return Effect.gen(function* () {
      const obsOption = yield* Effect.serviceOption(ObservabilityService);
      if (!obsOption._tag || obsOption._tag === "None") return;

      const obs = obsOption.value;
      const isVerbose = verbosity === "verbose" || verbosity === "debug";
      if (!isVerbose) return;

      const msg = `  📍 [${iteration}] ${label}${details ? ` ${JSON.stringify(details)}` : ""}`;
      yield* obs.info(msg).pipe(Effect.catchAll(() => Effect.void));
    });
  }

  /**
   * Log iteration completion summary
   */
  logIterationSummary(
    iteration: number,
    tokensUsed: number,
    toolsExecuted: string[],
    completionReason?: string,
  ): Effect.Effect<void> {
    const verbosity = this.verbosity;
    return Effect.gen(function* () {
      const obsOption = yield* Effect.serviceOption(ObservabilityService);
      if (!obsOption._tag || obsOption._tag === "None") return;

      const obs = obsOption.value;
      const isVerbose = verbosity === "verbose" || verbosity === "debug";
      const isNormal = verbosity !== "minimal";

      if (!isVerbose && !isNormal) return;

      const tools = toolsExecuted.length > 0 ? `${toolsExecuted.length} tools` : "no tools";
      const reason = completionReason ? ` — ${completionReason}` : "";
      const msg = `  ✓ Iter ${iteration}: ${tokensUsed} tok, ${tools}${reason}`;

      yield* obs.info(msg).pipe(Effect.catchAll(() => Effect.void));
    });
  }
}

/**
 * Helper to create a progress logger
 */
export function createProgressLogger(
  verbosity: "minimal" | "normal" | "verbose" | "debug",
): ProgressLogger {
  return new ProgressLogger(verbosity);
}
