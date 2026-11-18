/**
 * The builder's one notice channel.
 *
 * Withers and `build()` run outside any execution, so an `Effect.logWarning`
 * there meets Effect's default logger and prints logfmt
 * (`timestamp=… level=WARN fiber=#N message=…`). Every builder notice goes
 * through {@link emitBuilderNotice} instead: still an Effect log record, but
 * rendered by a logger that writes one `⚠ <message>` line to stderr, the same
 * shape `build()` uses for validation warnings.
 */
import { Cause, Effect, Logger } from "effect";

/** Renders each log record as one `⚠ <message>` line on stderr (`console.warn`). */
const builderNoticeLogger = Logger.make(({ message, cause }) => {
  const parts = (Array.isArray(message) ? message : [message]).map((part) =>
    typeof part === "string" ? part : String(part),
  );
  const causeText = Cause.isEmpty(cause) ? "" : `\n${Cause.pretty(cause)}`;
  console.warn(`⚠ ${parts.join(" ")}${causeText}`);
});

const builderNoticeLayer = Logger.replace(Logger.defaultLogger, builderNoticeLogger);

/**
 * Print a builder notice: a misconfiguration the builder tolerates but the
 * developer should fix. Never suppressed by verbosity (warnings always print).
 *
 * @param message - One line naming the problem and the fix.
 */
export const emitBuilderNotice = (message: string): void => {
  Effect.runSync(Effect.logWarning(message).pipe(Effect.provide(builderNoticeLayer)));
};
