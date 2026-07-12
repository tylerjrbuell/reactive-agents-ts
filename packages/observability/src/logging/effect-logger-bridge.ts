import { Cause, Effect, HashMap, Layer, Logger, LogLevel as EffectLogLevel } from "effect";
import type { LogLevel } from "../types.js";
import type { ObservableLoggerService } from "./observable-logger.js";

/**
 * Routes Effect's own logging (`Effect.log`, `logDebug`, `logInfo`,
 * `logWarning`, `logError`) into an `ObservableLogger`.
 *
 * This replaces `Logger.replace(Logger.defaultLogger, Logger.none)` in the
 * execution engine. That provided silence — which was the goal, since
 * ObservableLogger owns the structured output channel and Effect's default
 * logger would double-print to stdout — but it achieved silence by DISCARDING
 * the record. Every `Effect.logDebug` / `Effect.logWarning` in the kernel went
 * nowhere, while `core/src/errors` instructs authors to prefer exactly those
 * calls over `console.*`. The framework's own logging policy pointed into a
 * black hole.
 *
 * The bridge keeps stdout quiet (an ObservableLogger only prints when `live`)
 * and keeps the record.
 *
 * Emission is forked rather than run synchronously: `emit` notifies subscribers,
 * and a subscriber is free to be asynchronous (a file writer, an OTLP export).
 * `Effect.runSync` would throw on the first such subscriber. `emit` cannot fail
 * (`Effect<void, never>`), so forking it is safe — at worst a log line lands a
 * tick late, which is why callers that assert on the buffer should let the
 * fibers drain.
 */
const toLevel = (level: EffectLogLevel.LogLevel): LogLevel => {
  switch (level._tag) {
    case "Trace":
    case "Debug":
      return "debug";
    case "Warning":
      return "warn";
    case "Error":
    case "Fatal":
      return "error";
    default:
      return "info";
  }
};

const annotationsToFields = (
  annotations: HashMap.HashMap<string, unknown>,
): Record<string, unknown> | undefined => {
  if (HashMap.size(annotations) === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of HashMap.entries(annotations)) {
    out[k] = v;
  }
  return out;
};

export const makeEffectLoggerBridge = (
  logger: ObservableLoggerService,
): Logger.Logger<unknown, void> =>
  Logger.make(({ logLevel, message, annotations, cause }) => {
    // Effect passes `message` as unknown (and as an array for multi-arg logs).
    const text = Array.isArray(message)
      ? message.map((m) => (typeof m === "string" ? m : String(m))).join(" ")
      : typeof message === "string"
        ? message
        : String(message);

    const fields = annotationsToFields(annotations);

    // Effect reports a fiber's failure by putting it in `cause`, NOT in the
    // message — its runtime logs "Fiber terminated with an unhandled error"
    // with the actual error attached there. Dropping it printed that line bare,
    // which is exactly the shape of an alarming, unactionable log: the one field
    // that says WHAT failed was the one we threw away.
    const causeText =
      cause !== undefined && !Cause.isEmpty(cause) ? Cause.pretty(cause) : undefined;

    Effect.runFork(
      logger.emit({
        _tag: "log",
        level: toLevel(logLevel),
        message: causeText ? `${text} — ${causeText}` : text,
        ...(fields || causeText
          ? { fields: { ...(fields ?? {}), ...(causeText ? { cause: causeText } : {}) } }
          : {}),
        source: "effect",
        timestamp: new Date(),
      }),
    );
  });

const MIN_LEVEL: Record<LogLevel, EffectLogLevel.LogLevel> = {
  debug: EffectLogLevel.Debug,
  info: EffectLogLevel.Info,
  warn: EffectLogLevel.Warning,
  error: EffectLogLevel.Error,
};

/**
 * The layer to provide in place of `Logger.replace(Logger.defaultLogger, Logger.none)`.
 *
 * Sets the minimum level as well as the logger. Effect's own default minimum is
 * `Info`, so without this every `Effect.logDebug` in the kernel is filtered out
 * before it ever reaches a logger — swapping `Logger.none` for the bridge alone
 * would still silently drop them, which is most of what the kernel writes.
 */
export const effectLoggerBridgeLayer = (
  logger: ObservableLoggerService,
  minLevel: LogLevel = "debug",
) =>
  Layer.merge(
    Logger.replace(Logger.defaultLogger, makeEffectLoggerBridge(logger)),
    Logger.minimumLogLevel(MIN_LEVEL[minLevel]),
  );
