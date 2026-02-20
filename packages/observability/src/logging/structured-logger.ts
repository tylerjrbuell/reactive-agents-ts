import { Effect, Ref } from "effect";
import type { LogEntry, LogLevel } from "../types.js";

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

export const makeStructuredLogger = Effect.gen(function* () {
  const logsRef = yield* Ref.make<LogEntry[]>([]);

  const log = (
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
  ): Effect.Effect<void, never> =>
    Ref.update(logsRef, (logs) => [
      ...logs,
      { timestamp: new Date(), level, message, metadata },
    ]);

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
