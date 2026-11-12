import { describe, test, expect } from "bun:test";
import { Effect, TestClock, TestContext, type Scope } from "effect";
import {
  makeScheduleRegistry,
  configScheduleId,
  type ScheduleRegistryOptions,
  type ScheduleRegistryService,
} from "../../src/schedule/registry.js";
import { makeMemoryScheduleStore, type ScheduleStore } from "../../src/schedule/store.js";
import { MAX_RUN_HISTORY } from "../../src/schedule/runs.js";
import type { CatchUpPolicy } from "../../src/schedule/types.js";

// Monday 2026-01-05 08:00 UTC
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const run = <A, E>(eff: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.scoped, Effect.provide(TestContext.TestContext)));

/** One "process lifetime" over a shared store (the memory store survives close, like a file would). */
const lifetime = <A>(
  options: ScheduleRegistryOptions,
  startMs: number,
  f: (r: ScheduleRegistryService) => Effect.Effect<A, unknown>,
): Promise<A> =>
  run(
    Effect.gen(function* () {
      yield* TestClock.setTime(startMs);
      const registry = yield* makeScheduleRegistry(options);
      return yield* f(registry);
    }),
  );

const daily = (catchUp: CatchUpPolicy) => ({
  cron: "0 9 * * *",
  instruction: "daily report",
  timezone: "UTC",
  catchUp,
});

describe("ScheduleRegistry: crash between collectDue and completeRun", () => {
  test("a fire is persisted as running before collectDue returns it", async () => {
    const store = makeMemoryScheduleStore();
    await lifetime({ store }, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "fire-once" }) });
        yield* TestClock.setTime(T0 + HOUR);
        const fires = yield* r.collectDue();
        expect(fires.length).toBe(1);
        const row = (yield* store.load()).find((s) => s.id === "d");
        expect(row?.lastRun).toMatchObject({ fireId: fires[0]?.fireId, status: "running" });
      }),
    );
  });

  test("a fire still running on restart is re-offered once, then settles normally", async () => {
    const store = makeMemoryScheduleStore();
    const first = await lifetime({ store }, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "fire-once" }) });
        yield* TestClock.setTime(T0 + HOUR);
        return yield* r.collectDue(); // process dies before completeRun
      }),
    );
    expect(first.length).toBe(1);

    const second = await lifetime({ store }, T0 + HOUR + 1000, (r) =>
      Effect.gen(function* () {
        const again = yield* r.collectDue();
        yield* r.completeRun("d", again[0]?.fireId ?? "", { status: "succeeded" });
        expect(yield* r.collectDue()).toEqual([]); // handed out once per process
        return again;
      }),
    );
    expect(second.map((f) => f.fireId)).toEqual(first.map((f) => f.fireId));
    expect(second[0]?.trigger).toBe("catch-up");
    expect(second[0]?.scheduledFor).toBe(first[0]?.scheduledFor);

    // Settled: the third start has nothing to recover.
    await lifetime({ store }, T0 + HOUR + 2000, (r) =>
      Effect.gen(function* () {
        expect(yield* r.collectDue()).toEqual([]);
        expect((yield* r.lastResult("d"))?.status).toBe("succeeded");
      }),
    );
  });

  test("catch-up skip does not re-offer: the interrupted run is closed as failed", async () => {
    const store = makeMemoryScheduleStore();
    await lifetime({ store }, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "skip" }) });
        yield* TestClock.setTime(T0 + HOUR);
        yield* r.collectDue();
      }),
    );
    await lifetime({ store }, T0 + HOUR + 1000, (r) =>
      Effect.gen(function* () {
        expect(yield* r.collectDue()).toEqual([]);
        expect(yield* r.lastResult("d")).toMatchObject({ status: "failed", error: "interrupted by gateway restart" });
      }),
    );
  });

  test("a manual run interrupted by a crash is closed, never re-run", async () => {
    const store = makeMemoryScheduleStore();
    await lifetime({ store }, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "fire-all" }) });
        yield* r.runNow("d");
      }),
    );
    await lifetime({ store }, T0 + 1000, (r) =>
      Effect.gen(function* () {
        expect(yield* r.collectDue()).toEqual([]);
        expect((yield* r.lastResult("d"))?.status).toBe("failed");
      }),
    );
  });

  test("fire-all re-offers every interrupted fire, oldest first", async () => {
    const store = makeMemoryScheduleStore();
    const handed = await lifetime({ store }, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "fire-all" }) });
        yield* TestClock.setTime(T0 + 3 * DAY);
        return yield* r.collectDue();
      }),
    );
    expect(handed.length).toBe(3);
    const again = await lifetime({ store }, T0 + 3 * DAY + 1000, (r) => r.collectDue());
    expect(again.map((f) => f.fireId)).toEqual(handed.map((f) => f.fireId));
  });
});

describe("ScheduleRegistry: fire-all keeps a result per fire", () => {
  test("completeRun settles each fire in runs, lastRun is the newest", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "fire-all" }) });
        yield* TestClock.setTime(T0 + 3 * DAY);
        const fires = yield* r.collectDue();
        expect(fires.length).toBe(3);
        for (const [i, f] of fires.entries()) {
          yield* r.completeRun("d", f.fireId, { status: i === 1 ? "failed" : "succeeded", error: i === 1 ? "boom" : undefined });
        }
        const s = yield* r.get("d");
        expect(s.runs?.map((x) => x.status)).toEqual(["succeeded", "failed", "succeeded"]);
        expect(s.runs?.map((x) => x.fireId)).toEqual(fires.map((f) => f.fireId));
        expect(s.lastRun?.fireId).toBe(fires[2]?.fireId);
        expect(s.lastRun?.status).toBe("succeeded");
      }),
    );
  });

  test("history is bounded", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "skip" }) });
        for (let i = 0; i < MAX_RUN_HISTORY + 5; i++) {
          yield* TestClock.adjust(1000);
          yield* r.runNow("d");
        }
        expect((yield* r.get("d")).runs?.length).toBe(MAX_RUN_HISTORY);
      }),
    );
  });
});

describe("ScheduleRegistry: config re-sync on restart", () => {
  const entry = { schedule: "0 9 * * *", instruction: "A", priority: "normal" as const, enabled: true };

  test("priority edits apply and a runtime pause is preserved", async () => {
    const store: ScheduleStore = makeMemoryScheduleStore();
    const id = configScheduleId(entry);
    await lifetime({ store, crons: [entry] }, T0, (r) => r.pause(id));
    const after = await lifetime({ store, crons: [{ ...entry, priority: "high" }] }, T0 + HOUR, (r) => r.get(id));
    expect(after.priority).toBe("high");
    expect(after.enabled).toBe(false);
    expect(after.nextFireAt).toBeNull();
  });

  test("a changed config enabled value wins over runtime state", async () => {
    const store: ScheduleStore = makeMemoryScheduleStore();
    const id = configScheduleId(entry);
    await lifetime({ store, crons: [{ ...entry, enabled: false }] }, T0, (r) => r.get(id));
    const on = await lifetime({ store, crons: [entry] }, T0 + HOUR, (r) => r.get(id));
    expect(on.enabled).toBe(true);
    expect(on.nextFireAt).not.toBeNull();
    // Unchanged config afterwards leaves a runtime pause alone.
    await lifetime({ store, crons: [entry] }, T0 + 2 * HOUR, (r) => r.pause(id));
    const still = await lifetime({ store, crons: [entry] }, T0 + 3 * HOUR, (r) => r.get(id));
    expect(still.enabled).toBe(false);
  });
});
