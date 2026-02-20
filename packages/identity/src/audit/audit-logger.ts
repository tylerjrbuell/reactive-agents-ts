import { Effect, Ref } from "effect";
import type { AuditEntry } from "../types.js";
import { AuditError } from "../errors.js";

export interface AuditLogger {
  readonly log: (entry: Omit<AuditEntry, "id" | "timestamp">) => Effect.Effect<void, AuditError>;
  readonly query: (agentId: string, options?: { startDate?: Date; endDate?: Date; action?: string; limit?: number }) => Effect.Effect<readonly AuditEntry[], AuditError>;
}

export const makeAuditLogger = Effect.gen(function* () {
  const logRef = yield* Ref.make<AuditEntry[]>([]);

  const log = (
    entry: Omit<AuditEntry, "id" | "timestamp">,
  ): Effect.Effect<void, AuditError> =>
    Ref.update(logRef, (entries) => [
      ...entries,
      { ...entry, id: crypto.randomUUID(), timestamp: new Date() },
    ]).pipe(
      Effect.mapError((e) => new AuditError({ message: "Audit logging failed", cause: e })),
    );

  const query = (
    agentId: string,
    options?: { startDate?: Date; endDate?: Date; action?: string; limit?: number },
  ): Effect.Effect<readonly AuditEntry[], AuditError> =>
    Effect.gen(function* () {
      const allEntries = yield* Ref.get(logRef);

      let filtered = allEntries.filter((e) => {
        if (e.agentId !== agentId) return false;
        if (options?.startDate && e.timestamp < options.startDate) return false;
        if (options?.endDate && e.timestamp > options.endDate) return false;
        if (options?.action && e.action !== options.action) return false;
        return true;
      });

      if (options?.limit) {
        filtered = filtered.slice(-options.limit);
      }

      return filtered;
    }).pipe(
      Effect.mapError((e) => new AuditError({ message: "Audit query failed", cause: e })),
    );

  return { log, query } satisfies AuditLogger;
});
