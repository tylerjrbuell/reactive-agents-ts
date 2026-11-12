import { createHash } from "node:crypto";
import { Clock, Context, Effect, Layer, Ref } from "effect";
import {
  ScheduleInvalidError,
  ScheduleNotFoundError,
  type ScheduleStoreError,
} from "../errors.js";
import type { CronEntry } from "../types.js";
import { parseCron } from "../services/cron-parser.js";
import { cronMatches, nextCronFire } from "./cron-scan.js";
import { appendRun, planRecovery, updateRun } from "./runs.js";
import { makeMemoryScheduleStore, makeSqliteScheduleStore, type ScheduleStore } from "./store.js";
import type {
  Schedule,
  ScheduleDeliveryRecord,
  ScheduleFire,
  ScheduleInput,
  SchedulePatch,
  ScheduleRunResult,
  ScheduleTrigger,
} from "./types.js";

const MINUTE_MS = 60_000;
/** Fires older than this are "missed" and follow the schedule's catch-up policy. */
export const DEFAULT_CATCH_UP_GRACE_MS = 5 * MINUTE_MS;
/** Longest gap scanned for missed fires after downtime. */
const MAX_CATCH_UP_SCAN_MS = 31 * 24 * 60 * MINUTE_MS;
const DEFAULT_MAX_FIRES = 10;

/**
 * Stable id for a config-declared cron entry: a hash of its definition, so the same entry keeps
 * its id (and its `lastRun` history) across restarts and reordering.
 */
export const configScheduleId = (entry: CronEntry): string =>
  `cfg-${createHash("sha256")
    .update(JSON.stringify([entry.agentId ?? "", entry.schedule, entry.instruction, entry.timezone ?? ""]))
    .digest("hex")
    .slice(0, 12)}`;

export type ScheduleRegistryService = {
  readonly list: () => Effect.Effect<readonly Schedule[]>;
  readonly get: (id: string) => Effect.Effect<Schedule, ScheduleNotFoundError>;
  readonly create: (
    input: ScheduleInput,
  ) => Effect.Effect<Schedule, ScheduleInvalidError | ScheduleStoreError>;
  readonly update: (
    id: string,
    patch: SchedulePatch,
  ) => Effect.Effect<Schedule, ScheduleNotFoundError | ScheduleInvalidError | ScheduleStoreError>;
  readonly pause: (id: string) => Effect.Effect<Schedule, ScheduleNotFoundError | ScheduleStoreError>;
  readonly resume: (id: string) => Effect.Effect<Schedule, ScheduleNotFoundError | ScheduleStoreError>;
  readonly remove: (id: string) => Effect.Effect<void, ScheduleNotFoundError | ScheduleStoreError>;
  /** Fire a schedule immediately (works while paused). The caller executes the returned fire. */
  readonly runNow: (id: string) => Effect.Effect<ScheduleFire, ScheduleNotFoundError | ScheduleStoreError>;
  /** The most recent run, or undefined when the schedule has never fired. */
  readonly lastResult: (id: string) => Effect.Effect<Schedule["lastRun"], ScheduleNotFoundError>;
  /**
   * Evaluate every enabled schedule up to `nowMs` (default: the Effect Clock) and return the fires
   * that are due, oldest first. Missed fires follow each schedule's catch-up policy. Advances
   * `lastCheckedAt` and `nextFireAt` and persists them.
   */
  readonly collectDue: (nowMs?: number) => Effect.Effect<readonly ScheduleFire[], ScheduleStoreError>;
  /** Report the outcome of a fire. A stale `fireId` (a newer fire superseded it) is ignored. */
  readonly completeRun: (
    id: string,
    fireId: string,
    result: ScheduleRunResult,
  ) => Effect.Effect<void, ScheduleNotFoundError | ScheduleStoreError>;
  /** Record the delivery receipt (or failure) for a fire's result. */
  readonly recordDelivery: (
    id: string,
    fireId: string,
    delivery: ScheduleDeliveryRecord,
  ) => Effect.Effect<void, ScheduleNotFoundError | ScheduleStoreError>;
};

/** Durable schedule store with ids, pause/resume, run-now, last results and restart catch-up. */
export class ScheduleRegistry extends Context.Tag("ScheduleRegistry")<
  ScheduleRegistry,
  ScheduleRegistryService
>() {}

export interface ScheduleRegistryOptions {
  /** SQLite file path. Omit for an in-memory (non-durable) registry. Ignored when `store` is given. */
  readonly path?: string;
  readonly store?: ScheduleStore;
  /** `GatewayConfig.crons`, seeded with stable ids and re-synced on every start. */
  readonly crons?: readonly CronEntry[];
  /** Default timezone for schedules that declare none. */
  readonly timezone?: string;
  readonly graceMs?: number;
}

const validateTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Build the registry. The store is closed when the surrounding scope closes. */
export const makeScheduleRegistry = (options: ScheduleRegistryOptions = {}) =>
  Effect.gen(function* () {
    const store: ScheduleStore =
      options.store ??
      (options.path !== undefined ? yield* makeSqliteScheduleStore(options.path) : makeMemoryScheduleStore());
    yield* Effect.addFinalizer(() => store.close());

    const defaultTz = options.timezone ?? "UTC";
    const graceMs = options.graceMs ?? DEFAULT_CATCH_UP_GRACE_MS;
    const state = yield* Ref.make(new Map<string, Schedule>());
    const seq = yield* Ref.make(0);
    const lock = yield* Effect.makeSemaphore(1);

    const tzOf = (s: Schedule): string => s.timezone ?? defaultTz;

    const nextFire = (s: Schedule, afterMs: number): number | null => {
      if (!s.enabled) return null;
      if (s.kind === "once") return s.runAt !== undefined && s.runAt > afterMs ? s.runAt : null;
      const parsed = s.cron !== undefined ? parseCron(s.cron) : null;
      return parsed ? nextCronFire(parsed, tzOf(s), afterMs) : null;
    };

    const commit = (changed: readonly Schedule[]) =>
      Effect.gen(function* () {
        if (changed.length === 0) return;
        yield* store.save(changed);
        yield* Ref.update(state, (m) => {
          const next = new Map(m);
          for (const s of changed) next.set(s.id, s);
          return next;
        });
      });

    const lookup = (id: string) =>
      Ref.get(state).pipe(
        Effect.flatMap((m) => {
          const s = m.get(id);
          return s
            ? Effect.succeed(s)
            : Effect.fail(new ScheduleNotFoundError({ message: `schedule not found: ${id}`, scheduleId: id }));
        }),
      );

    const validate = (
      kind: "cron" | "once",
      input: { cron?: string; runAt?: number; timezone?: string; instruction: string },
    ): Effect.Effect<void, ScheduleInvalidError> => {
      if (input.instruction.trim() === "") {
        return Effect.fail(new ScheduleInvalidError({ message: "instruction must not be empty", field: "instruction" }));
      }
      if (input.timezone !== undefined && !validateTimezone(input.timezone)) {
        return Effect.fail(new ScheduleInvalidError({ message: `unknown timezone: ${input.timezone}`, field: "timezone" }));
      }
      if (kind === "cron" && (input.cron === undefined || parseCron(input.cron) === null)) {
        return Effect.fail(new ScheduleInvalidError({ message: `invalid cron expression: ${input.cron ?? ""}`, field: "cron" }));
      }
      if (kind === "once" && (input.runAt === undefined || !Number.isFinite(input.runAt))) {
        return Effect.fail(new ScheduleInvalidError({ message: "runAt must be a finite epoch-ms number", field: "runAt" }));
      }
      return Effect.void;
    };

    const kindOf = (input: { cron?: string; runAt?: number }): Effect.Effect<"cron" | "once", ScheduleInvalidError> =>
      input.cron !== undefined && input.runAt === undefined
        ? Effect.succeed("cron")
        : input.runAt !== undefined && input.cron === undefined
          ? Effect.succeed("once")
          : Effect.fail(new ScheduleInvalidError({ message: "provide exactly one of cron or runAt", field: "cron" }));

    const build = (
      input: ScheduleInput,
      kind: "cron" | "once",
      id: string,
      now: number,
      checkedFrom: number = now,
    ): Schedule => {
      const base: Schedule = {
        id,
        ...(input.name !== undefined ? { name: input.name } : {}),
        kind,
        ...(input.cron !== undefined ? { cron: input.cron } : {}),
        ...(input.runAt !== undefined ? { runAt: input.runAt } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        instruction: input.instruction,
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        priority: input.priority ?? "normal",
        enabled: input.enabled ?? true,
        catchUp: input.catchUp ?? { mode: "fire-once" },
        ...(input.delivery !== undefined ? { delivery: input.delivery } : {}),
        source: input.source ?? "api",
        createdAt: now,
        lastCheckedAt: checkedFrom,
        nextFireAt: null,
        runCount: 0,
      };
      return { ...base, nextFireAt: nextFire(base, checkedFrom) };
    };

    const newId = Effect.map(Ref.updateAndGet(seq, (n) => n + 1), (n) => `sch-${Date.now().toString(36)}-${n}`);

    const create = (input: ScheduleInput) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const kind = yield* kindOf(input);
          yield* validate(kind, input);
          const now = yield* Clock.currentTimeMillis;
          const id = input.id ?? (yield* newId);
          if ((yield* Ref.get(state)).has(id)) {
            return yield* Effect.fail(new ScheduleInvalidError({ message: `schedule id already exists: ${id}`, field: "id" }));
          }
          const schedule = build(input, kind, id, now);
          yield* commit([schedule]);
          return schedule;
        }),
      );

    const mutate = (id: string, f: (s: Schedule, now: number) => Schedule) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const cur = yield* lookup(id);
          const now = yield* Clock.currentTimeMillis;
          const next = f(cur, now);
          yield* commit([next]);
          return next;
        }),
      );

    const makeFire = (s: Schedule, scheduledFor: number, firedAt: number, trigger: ScheduleTrigger, fireId: string): ScheduleFire => ({
      scheduleId: s.id,
      fireId,
      firedAt,
      scheduledFor,
      trigger,
      schedule: s,
    });

    const withRun = (s: Schedule, f: ScheduleFire): Schedule =>
      appendRun(
        { ...s, runCount: s.runCount + 1 },
        {
          fireId: f.fireId,
          runId: f.fireId,
          firedAt: f.firedAt,
          scheduledFor: f.scheduledFor,
          trigger: f.trigger,
          status: "running",
        },
      );

    /** Fires interrupted by a crash, re-offered by the next `collectDue` (see `planRecovery`). */
    let recovered: readonly ScheduleFire[] = [];

    /** Fires one schedule owes between `lastCheckedAt` and `now`, with catch-up policy applied. */
    const dueFor = (s: Schedule, now: number): { fires: ScheduleFire[]; skipped: number } => {
      const slots: readonly number[] =
        s.kind === "once"
          ? s.nextFireAt !== null && s.nextFireAt <= now
            ? [s.nextFireAt]
            : []
          : (() => {
              const parsed = s.cron !== undefined ? parseCron(s.cron) : null;
              if (!parsed) return [];
              const from = Math.max(s.lastCheckedAt, now - MAX_CATCH_UP_SCAN_MS);
              return cronMatches(parsed, tzOf(s), from, now, { limit: 50_000, keep: "newest" });
            })();
      const onTime = slots.filter((t) => now - t <= graceMs);
      const missed = slots.filter((t) => now - t > graceMs);
      const maxFires = s.catchUp.maxFires ?? DEFAULT_MAX_FIRES;
      const caught =
        s.catchUp.mode === "skip" ? [] : s.catchUp.mode === "fire-once" ? missed.slice(-1) : missed.slice(-maxFires);
      const mk = (t: number, trigger: ScheduleTrigger) => makeFire(s, t, now, trigger, `${s.id}@${t}`);
      return {
        fires: [...caught.map((t) => mk(t, "catch-up")), ...onTime.map((t) => mk(t, "schedule"))],
        skipped: missed.length - caught.length,
      };
    };

    const collectDue = (nowOverride?: number) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const now = nowOverride ?? (yield* Clock.currentTimeMillis);
          const all = [...(yield* Ref.get(state)).values()];
          const fires: ScheduleFire[] = [];
          const changed: Schedule[] = [];
          for (const s of all) {
            if (!s.enabled || s.lastCheckedAt >= now) continue;
            const { fires: due, skipped } = dueFor(s, now);
            if (skipped > 0) {
              yield* Effect.logWarning(`schedule ${s.id}: skipped ${skipped} missed fire(s) (catch-up: ${s.catchUp.mode})`);
            }
            let next: Schedule = { ...s, lastCheckedAt: now };
            for (const f of due) next = withRun(next, f);
            if (s.kind === "once") {
              // A once-schedule is spent when it fires or is skipped as missed.
              const spent = s.nextFireAt !== null && s.nextFireAt <= now;
              next = { ...next, nextFireAt: spent ? null : s.nextFireAt };
              if (spent && due.length === 0) {
                // Missed and skipped: leave a receipt instead of vanishing silently.
                next = appendRun(next, {
                  fireId: `${s.id}@${s.nextFireAt}`,
                  runId: `${s.id}@${s.nextFireAt}`,
                  firedAt: now,
                  trigger: "schedule",
                  status: "skipped",
                  error: "missed while the gateway was not running (catch-up: skip)",
                });
              }
            } else {
              next = { ...next, nextFireAt: nextFire(next, now) };
            }
            fires.push(...due);
            changed.push(next);
          }
          // Persist each fire as `running` BEFORE handing it out: a crash after this point leaves
          // a durable record that `planRecovery` re-offers on the next start.
          yield* commit(changed);
          const reoffered = recovered;
          recovered = [];
          return [...reoffered, ...fires];
        }),
      );

    const runNow = (id: string) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const cur = yield* lookup(id);
          const now = yield* Clock.currentTimeMillis;
          const n = yield* Ref.updateAndGet(seq, (x) => x + 1);
          const fire = makeFire(cur, now, now, "manual", `${id}@manual-${now}-${n}`);
          yield* commit([withRun(cur, fire)]);
          return fire;
        }),
      );

    const settle = (id: string, fireId: string, f: (run: NonNullable<Schedule["lastRun"]>) => NonNullable<Schedule["lastRun"]>) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const cur = yield* lookup(id);
          const next = updateRun(cur, fireId, f);
          if (next) yield* commit([next]);
        }),
      );

    // ── Load + config sync ───────────────────────────────────────────────
    const loaded = yield* store.load();
    yield* Ref.set(state, new Map(loaded.map((s) => [s.id, s])));

    // Crash recovery: fires that were handed out but never settled.
    const reoffer: ScheduleFire[] = [];
    for (const s of loaded) {
      const plan = planRecovery(s);
      if (!plan) continue;
      yield* commit([plan.schedule]);
      for (const run of plan.reoffer) {
        reoffer.push(makeFire(plan.schedule, run.scheduledFor ?? run.firedAt, run.firedAt, "catch-up", run.fireId));
      }
    }
    recovered = reoffer;

    if (options.crons !== undefined) {
      const wanted = new Map<string, CronEntry>();
      for (const entry of options.crons) {
        if (parseCron(entry.schedule) === null) {
          yield* Effect.logWarning(`gateway cron ignored (invalid expression): ${entry.schedule}`);
          continue;
        }
        wanted.set(configScheduleId(entry), entry);
      }
      const existing = yield* Ref.get(state);
      for (const [id, entry] of wanted) {
        const now = yield* Clock.currentTimeMillis;
        const current = (yield* Ref.get(state)).get(id);
        if (current !== undefined) {
          // Re-sync the non-identity fields the config declares; a runtime pause survives unless
          // the config's own `enabled` value changed since the last sync.
          const priority = entry.priority ?? "normal";
          const wantEnabled = entry.enabled !== false;
          const priorEnabled = current.configEnabled ?? true;
          let next: Schedule = { ...current, priority, configEnabled: wantEnabled };
          if (wantEnabled !== priorEnabled) {
            next = { ...next, enabled: wantEnabled, ...(wantEnabled ? { lastCheckedAt: now } : {}) };
            next = { ...next, nextFireAt: nextFire(next, now) };
          }
          if (JSON.stringify(next) !== JSON.stringify(current)) yield* commit([next]);
          continue;
        }
        const schedule = build(
          {
            cron: entry.schedule,
            instruction: entry.instruction,
            ...(entry.agentId !== undefined ? { agentId: entry.agentId } : {}),
            priority: entry.priority ?? "normal",
            ...(entry.timezone !== undefined ? { timezone: entry.timezone } : {}),
            enabled: entry.enabled !== false,
            source: "config",
          },
          "cron",
          id,
          now,
          // Config crons evaluate the minute they were seeded in (a restart inside the slot still fires).
          Math.floor(now / MINUTE_MS) * MINUTE_MS - 1,
        );
        yield* commit([{ ...schedule, configEnabled: entry.enabled !== false }]);
      }
      // The config is declarative: config-sourced schedules it no longer lists are removed.
      for (const s of existing.values()) {
        if (s.source === "config" && !wanted.has(s.id)) {
          yield* store.remove(s.id);
          yield* Ref.update(state, (m) => {
            const next = new Map(m);
            next.delete(s.id);
            return next;
          });
        }
      }
    }

    const service: ScheduleRegistryService = {
      list: () => Ref.get(state).pipe(Effect.map((m) => [...m.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)))),
      get: lookup,
      create,
      update: (id, patch) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const cur = yield* lookup(id);
            const merged = { ...cur, ...patch };
            if (patch.cron !== undefined && cur.kind === "once") {
              return yield* Effect.fail(new ScheduleInvalidError({ message: "cannot set cron on a once schedule", field: "cron" }));
            }
            if (patch.runAt !== undefined && cur.kind === "cron") {
              return yield* Effect.fail(new ScheduleInvalidError({ message: "cannot set runAt on a cron schedule", field: "runAt" }));
            }
            yield* validate(cur.kind, merged);
            const now = yield* Clock.currentTimeMillis;
            const retimed = patch.cron !== undefined || patch.runAt !== undefined || patch.timezone !== undefined;
            const next: Schedule = retimed
              ? { ...merged, lastCheckedAt: now, nextFireAt: nextFire(merged, now) }
              : merged;
            yield* commit([next]);
            return next;
          }),
        ),
      pause: (id) => mutate(id, (s) => ({ ...s, enabled: false, nextFireAt: null })),
      resume: (id) =>
        // No catch-up for time spent paused: evaluation restarts at resume.
        mutate(id, (s, now) => {
          const enabled = { ...s, enabled: true, lastCheckedAt: now };
          return { ...enabled, nextFireAt: nextFire(enabled, now) };
        }),
      remove: (id) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            yield* lookup(id);
            yield* store.remove(id);
            yield* Ref.update(state, (m) => {
              const next = new Map(m);
              next.delete(id);
              return next;
            });
          }),
        ),
      runNow,
      lastResult: (id) => Effect.map(lookup(id), (s) => s.lastRun),
      collectDue,
      completeRun: (id, fireId, result) =>
        settle(id, fireId, (run) => ({
          ...run,
          runId: result.runId ?? run.runId,
          status: result.status,
          ...(result.outputRef !== undefined ? { outputRef: result.outputRef } : {}),
          ...(result.error !== undefined ? { error: result.error } : {}),
        })),
      recordDelivery: (id, fireId, delivery) => settle(id, fireId, (run) => ({ ...run, delivery })),
    };
    return service;
  });

/**
 * Live layer. With `path` the registry is durable across restarts (SQLite); without it the
 * registry is in-memory, which is what tests use.
 */
export const ScheduleRegistryLive = (options: ScheduleRegistryOptions = {}) =>
  Layer.scoped(ScheduleRegistry, makeScheduleRegistry(options));
