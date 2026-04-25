import { Effect, Ref } from "effect";
import type { LogEntry, LogLevel } from "../types.js";
import type { Redactor } from "../redaction/index.js";

export type LiveLogWriter = (entry: LogEntry) => void;

export interface StructuredLogger {
  readonly log: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
  readonly debug: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
  readonly info: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
  readonly warn: (message: string, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
  readonly error: (message: string, err?: unknown, metadata?: Record<string, unknown>) => Effect.Effect<void, never>;
  readonly getLogs: (filter?: { level?: LogLevel; agentId?: string; limit?: number }) => Effect.Effect<readonly LogEntry[], never>;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Apply a chain of redactors to a single string, in order. The last replacement
 * wins for any byte range covered by multiple patterns. Pure / synchronous.
 */
const redactString = (value: string, redactors: readonly Redactor[]): string => {
  let out = value;
  for (const r of redactors) {
    if (r.pattern.test(out)) {
      r.pattern.lastIndex = 0;
      out = out.replace(r.pattern, r.replacement);
    }
  }
  return out;
};

/**
 * Walk a metadata record and redact every string-valued leaf. Non-string values
 * (numbers, booleans, nested objects, arrays) pass through untouched — secrets
 * embedded inside them are caller's responsibility to surface as strings.
 *
 * Returns a new record only if any field was rewritten; otherwise returns the
 * original reference for cheap referential-equality checks downstream.
 */
const redactMetadata = (
  metadata: Record<string, unknown> | undefined,
  redactors: readonly Redactor[],
): Record<string, unknown> | undefined => {
  if (!metadata || redactors.length === 0) return metadata;
  let mutated: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v === "string") {
      const redacted = redactString(v, redactors);
      if (redacted !== v) {
        mutated ??= { ...metadata };
        mutated[k] = redacted;
      }
    }
  }
  return mutated ?? metadata;
};

export const makeStructuredLogger = (options?: {
  liveWriter?: LiveLogWriter;
  /**
   * Redactors applied to every log message and string-valued metadata field
   * before the entry is persisted or forwarded to the live writer. Empty /
   * absent → no redaction (backward-compat for callers that don't opt in).
   *
   * For Phase 0 S0.3 the framework wires `defaultRedactors` here automatically;
   * users can extend via `withObservability({ redactors: [...] })`.
   */
  redactors?: readonly Redactor[];
}) =>
  Effect.gen(function* () {
    const logsRef = yield* Ref.make<LogEntry[]>([]);
    const liveWriter = options?.liveWriter;
    const redactors = options?.redactors ?? [];

    const log = (
      level: LogLevel,
      message: string,
      metadata?: Record<string, unknown>,
    ): Effect.Effect<void, never> =>
      Effect.suspend(() => {
        const redactedMessage =
          redactors.length > 0 ? redactString(message, redactors) : message;
        const redactedMetadata = redactMetadata(metadata, redactors);
        const entry: LogEntry = {
          timestamp: new Date(),
          level,
          message: redactedMessage,
          metadata: redactedMetadata,
        };
        if (liveWriter) {
          liveWriter(entry);
        }
        return Ref.update(logsRef, (logs) => [...logs, entry]);
      });

    const debug = (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta);
    const info = (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta);
    const warn = (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta);
    const error = (msg: string, err?: unknown, meta?: Record<string, unknown>) =>
      log("error", msg, {
        ...meta,
        error: err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : { message: String(err) },
      });

    const getLogs = (filter?: { level?: LogLevel; agentId?: string; limit?: number }): Effect.Effect<readonly LogEntry[], never> =>
      Effect.gen(function* () {
        const logs = yield* Ref.get(logsRef);
        let filtered = logs;
        if (filter?.level) filtered = filtered.filter((l) => LOG_LEVEL_ORDER[l.level] >= LOG_LEVEL_ORDER[filter.level!]);
        if (filter?.agentId) filtered = filtered.filter((l) => l.agentId === filter.agentId);
        if (filter?.limit) filtered = filtered.slice(-filter.limit);
        return filtered;
      });

    return { log, debug, info, warn, error, getLogs } satisfies StructuredLogger;
  });
