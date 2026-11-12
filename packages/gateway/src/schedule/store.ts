import { Effect } from "effect";
import { Database } from "@reactive-agents/runtime-shim";
import { ScheduleStoreError } from "../errors.js";
import type { Schedule } from "./types.js";

/**
 * Persistence for the {@link import("./registry.js").ScheduleRegistry}. The registry keeps the
 * working set in memory and writes every change through, so a restart reloads exactly what was
 * last saved.
 */
export interface ScheduleStore {
  readonly load: () => Effect.Effect<readonly Schedule[], ScheduleStoreError>;
  /** Upsert by id, atomically. */
  readonly save: (schedules: readonly Schedule[]) => Effect.Effect<void, ScheduleStoreError>;
  readonly remove: (id: string) => Effect.Effect<void, ScheduleStoreError>;
  readonly close: () => Effect.Effect<void>;
}

const storeFailure = (op: string) => (cause: unknown) =>
  // The cause stays on the error for debugging; the message carries only the operation.
  new ScheduleStoreError({ message: `schedule store: ${op} failed`, cause });

/** Non-durable store: lives and dies with the process. Used by tests and ephemeral gateways. */
export const makeMemoryScheduleStore = (): ScheduleStore => {
  const rows = new Map<string, Schedule>();
  return {
    load: () => Effect.sync(() => [...rows.values()]),
    save: (schedules) =>
      Effect.sync(() => {
        for (const s of schedules) rows.set(s.id, s);
      }),
    remove: (id) => Effect.sync(() => void rows.delete(id)),
    close: () => Effect.void,
  };
};

/**
 * SQLite-backed store via the runtime-shim `Database` (bun:sqlite or node:sqlite). Each schedule
 * is one JSON row keyed by id. Pass `":memory:"` for a throwaway database.
 */
export const makeSqliteScheduleStore = (path: string): Effect.Effect<ScheduleStore, ScheduleStoreError> =>
  Effect.try({
    try: () => {
      const db = new Database(path);
      db.exec(
        "CREATE TABLE IF NOT EXISTS gateway_schedules (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL)",
      );
      const upsert = db.prepare(
        "INSERT INTO gateway_schedules (id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
      );
      const del = db.prepare("DELETE FROM gateway_schedules WHERE id = ?");
      const all = db.prepare("SELECT body FROM gateway_schedules ORDER BY id");
      const saveAll = db.transaction((schedules: readonly Schedule[]) => {
        const at = Date.now();
        for (const s of schedules) upsert.run(s.id, JSON.stringify(s), at);
      });
      const store: ScheduleStore = {
        load: () =>
          Effect.try({
            try: () => all.all().map((row) => JSON.parse((row as { body: string }).body) as Schedule),
            catch: storeFailure("load"),
          }),
        save: (schedules) => Effect.try({ try: () => saveAll(schedules), catch: storeFailure("save") }),
        remove: (id) => Effect.try({ try: () => void del.run(id), catch: storeFailure("remove") }),
        close: () => Effect.sync(() => db.close()),
      };
      return store;
    },
    catch: storeFailure("open"),
  });
