import { Effect, Context, Stream as EStream } from "effect";
import type { LogEvent, RunSummary } from "../types.js";

/**
 * ObservableLogger — Unified logging service for Reactive Agents
 *
 * Emits structured LogEvents that are:
 * - Streamed live (if live=true in config)
 * - Buffered for end-of-run summary
 * - Machine-parseable for agentic feedback loops
 * - Human-readable when formatted
 *
 * Usage:
 *   const logger = yield* Effect.service(ObservableLogger);
 *   yield* logger.emit({ _tag: 'phase_started', phase: 'think', timestamp: new Date() });
 */
export interface ObservableLogger {
  /**
   * Emit a structured event.
   * If live=true, immediately formats and notifies subscribers.
   * Always buffers for flush() at run end.
   */
  readonly emit: (event: LogEvent) => Effect.Effect<void, never>;

  /**
   * Subscribe to real-time events.
   * Callback receives both the raw event and formatted string.
   * Returns unsubscribe function.
   */
  readonly subscribe: (
    handler: (event: LogEvent, formatted: string) => Effect.Effect<void, never>,
  ) => Effect.Effect<() => void, never>;

  /**
   * Get events as an Effect Stream for piping to UI, files, etc.
   * Emits { event, formatted } tuples.
   */
  readonly toStream: () => EStream.Stream<
    { event: LogEvent; formatted: string },
    never
  >;

  /**
   * Get all buffered events (for end-of-run inspection/parsing).
   */
  readonly getBuffer: () => Effect.Effect<readonly LogEvent[], never>;

  /**
   * Format a single event to human-readable string.
   * Used internally by subscribers; public for custom formatters.
   */
  readonly format: (event: LogEvent) => string;

  /**
   * Assemble and return the run summary from buffered events.
   * Call at end of execution.
   */
  readonly flush: () => Effect.Effect<RunSummary, never>;

  /**
   * Clear the buffer and reset subscriber count.
   * Call between runs or at shutdown.
   */
  readonly reset: () => Effect.Effect<void, never>;
}

export class ObservableLogger extends Context.Tag("ObservableLogger")<
  ObservableLogger,
  ObservableLogger
>() {}
