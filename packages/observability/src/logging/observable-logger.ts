import { Effect, Context, Stream as EStream, Ref, Chunk } from "effect";
import type { LogEvent, RunSummary } from "../types.js";
import { formatEvent } from "./event-formatter.js";

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
export interface ObservableLoggerService {
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
  ObservableLoggerService
>() {}

// ─── Level filtering ──────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function eventLevel(event: LogEvent): LogLevel {
  switch (event._tag) {
    case "iteration":
    case "metric":
      return "debug";
    case "warning":
      return "warn";
    case "error":
      return "error";
    default:
      return "info";
  }
}

function passesLevel(event: LogEvent, minLevel: LogLevel): boolean {
  return LEVEL_RANK[eventLevel(event)] >= LEVEL_RANK[minLevel];
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Create an ObservableLogger instance.
 * Config controls live vs buffered behavior.
 */
export function makeObservableLogger(config: {
  live: boolean;
  minLevel?: LogLevel;
}): Effect.Effect<ObservableLoggerService, never, never> {
  const minLevel: LogLevel = config.minLevel ?? "debug";
  return Effect.gen(function* () {
    const bufferRef = yield* Ref.make<LogEvent[]>([]);
    const subscribersRef = yield* Ref.make<
      Array<(event: LogEvent, formatted: string) => Effect.Effect<void, never>>
    >([]);

    const emit = (event: LogEvent): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        if (!passesLevel(event, minLevel)) return;
        const formatted = formatEvent(event);
        const subscribers = yield* Ref.get(subscribersRef);

        // Buffer always
        yield* Ref.update(bufferRef, (buf) => [...buf, event]);

        // Notify subscribers
        for (const sub of subscribers) {
          yield* sub(event, formatted).pipe(Effect.catchAll(() => Effect.void));
        }

        // If live, print to console
        if (config.live) {
          yield* Effect.sync(() => {
            console.log(formatted);
          });
        }
      });

    const subscribe = (
      handler: (event: LogEvent, formatted: string) => Effect.Effect<void, never>,
    ): Effect.Effect<() => void, never> =>
      Effect.gen(function* () {
        yield* Ref.update(subscribersRef, (subs) => [...subs, handler]);

        // Return unsubscribe function (fire-and-forget removal)
        return (): void => {
          void Effect.runPromise(
            Ref.update(subscribersRef, (subs) => subs.filter((s) => s !== handler)),
          );
        };
      });

    const toStream = (): EStream.Stream<
      { event: LogEvent; formatted: string },
      never
    > =>
      EStream.flatten(
        EStream.fromEffect(
          Effect.gen(function* () {
            const buffer = yield* Ref.get(bufferRef);
            return EStream.fromIterable(
              buffer.map((event) => ({
                event,
                formatted: formatEvent(event),
              })),
            );
          }),
        ),
      );

    const getBuffer = (): Effect.Effect<readonly LogEvent[], never> =>
      Ref.get(bufferRef);

    const format = (event: LogEvent): string => formatEvent(event);

    const flush = (): Effect.Effect<RunSummary, never> =>
      Effect.gen(function* () {
        const buffer = yield* Ref.get(bufferRef);
        return assembleSummary(buffer);
      });

    const reset = (): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        yield* Ref.set(bufferRef, []);
        yield* Ref.set(subscribersRef, []);
      });

    return {
      emit,
      subscribe,
      toStream,
      getBuffer,
      format,
      flush,
      reset,
    } satisfies ObservableLoggerService;
  });
}

/**
 * Assemble RunSummary from buffered events.
 */
function assembleSummary(buffer: readonly LogEvent[]): RunSummary {
  let status: "success" | "error" | "partial" = "partial";
  let duration = 0;
  let totalTokens = 0;
  const phaseMetrics: Record<string, { duration: number; status: "error" | "success" | "warning" }> = {};
  const toolMetrics: Record<string, { calls: number; successes: number; failures: number }> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  let startTime: Date | undefined;
  let endTime: Date | undefined;

  for (const event of buffer) {
    switch (event._tag) {
      case "phase_started":
        if (!startTime) startTime = event.timestamp;
        break;

      case "phase_complete":
        phaseMetrics[event.phase] = {
          duration: event.duration,
          status: event.status as "error" | "success" | "warning",
        };
        break;

      case "metric":
        if (event.name === "tokens_used") {
          totalTokens = event.value;
        }
        break;

      case "tool_call":
        if (!toolMetrics[event.tool]) {
          toolMetrics[event.tool] = { calls: 0, successes: 0, failures: 0 };
        }
        toolMetrics[event.tool].calls++;
        break;

      case "tool_result":
        if (!toolMetrics[event.tool]) {
          toolMetrics[event.tool] = { calls: 0, successes: 0, failures: 0 };
        }
        if (event.status === "success") {
          toolMetrics[event.tool].successes++;
        } else {
          toolMetrics[event.tool].failures++;
        }
        break;

      case "warning":
        warnings.push(event.message);
        break;

      case "error":
        errors.push(event.message);
        break;

      case "completion":
        status = event.success ? "success" : "error";
        endTime = event.timestamp;
        break;

      case "notice":
      case "iteration":
        // These events don't affect the summary
        break;
    }
  }

  if (startTime && endTime) {
    duration = endTime.getTime() - startTime.getTime();
  }

  return {
    status,
    duration,
    totalTokens,
    phaseMetrics,
    toolMetrics,
    warnings,
    errors,
  };
}
