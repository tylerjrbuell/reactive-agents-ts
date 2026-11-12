import { describe, test, expect } from "bun:test";
import { Effect, TestClock, TestContext, Exit, type Scope } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  makeScheduleRegistry,
  configScheduleId,
  type ScheduleRegistryOptions,
  type ScheduleRegistryService,
} from "../../src/schedule/registry.js";
import {
  SchedulerService,
  SchedulerServiceLive,
} from "../../src/services/scheduler-service.js";
import type { CatchUpPolicy } from "../../src/schedule/types.js";

// Monday 2026-01-05 08:00 UTC
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const run = <A, E>(eff: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.scoped, Effect.provide(TestContext.TestContext)));

const withTmpDb = async (f: (path: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "ra-sched-"));
  try {
    await f(join(dir, "schedules.db"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** One "process lifetime": open the registry at `startMs`, run `f`, close it. */
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

describe("ScheduleRegistry: ids and CRUD", () => {
  test("config cron ids are stable across restarts and reordering", async () => {
    const a = { schedule: "0 9 * * *", instruction: "A" };
    const b = { schedule: "*/5 * * * *", instruction: "B" };
    expect(configScheduleId(a)).toBe(configScheduleId({ ...a }));
    expect(configScheduleId(a)).not.toBe(configScheduleId(b));

    await withTmpDb(async (path) => {
      const first = await lifetime({ path, crons: [a, b] }, T0, (r) => r.list());
      const second = await lifetime({ path, crons: [b, a] }, T0 + HOUR, (r) => r.list());
      expect(first.map((s) => s.id).sort()).toEqual(second.map((s) => s.id).sort());
      expect(second.map((s) => s.id)).toContain(configScheduleId(a));
    });
  });

  test("config schedules dropped from config are removed; api schedules survive", async () => {
    await withTmpDb(async (path) => {
      const a = { schedule: "0 9 * * *", instruction: "A" };
      await lifetime({ path, crons: [a] }, T0, (r) =>
        r.create({ id: "mine", cron: "0 10 * * *", instruction: "user schedule" }),
      );
      const after = await lifetime({ path, crons: [] }, T0 + HOUR, (r) => r.list());
      expect(after.map((s) => s.id)).toEqual(["mine"]);
    });
  });

  test("create, get, update, pause, resume, remove", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        const s = yield* r.create({ id: "x", ...daily({ mode: "skip" }) });
        expect(s.nextFireAt).toBe(Date.UTC(2026, 0, 5, 9, 0, 0));
        expect(s.enabled).toBe(true);

        const updated = yield* r.update("x", { cron: "0 10 * * *" });
        expect(updated.nextFireAt).toBe(Date.UTC(2026, 0, 5, 10, 0, 0));

        const paused = yield* r.pause("x");
        expect(paused.enabled).toBe(false);
        expect(paused.nextFireAt).toBeNull();

        const resumed = yield* r.resume("x");
        expect(resumed.enabled).toBe(true);
        expect(resumed.nextFireAt).toBe(Date.UTC(2026, 0, 5, 10, 0, 0));

        yield* r.remove("x");
        const missing = yield* Effect.flip(r.get("x"));
        expect(missing._tag).toBe("ScheduleNotFoundError");
      }),
    );
  });

  test("rejects invalid definitions with typed errors", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        const badCron = yield* Effect.flip(r.create({ cron: "nope", instruction: "x" }));
        expect(badCron._tag).toBe("ScheduleInvalidError");
        const both = yield* Effect.flip(r.create({ cron: "* * * * *", runAt: T0, instruction: "x" }));
        expect(both._tag).toBe("ScheduleInvalidError");
        const badTz = yield* Effect.flip(r.create({ cron: "* * * * *", timezone: "Mars/Base", instruction: "x" }));
        expect(badTz._tag).toBe("ScheduleInvalidError");
        const empty = yield* Effect.flip(r.create({ cron: "* * * * *", instruction: "  " }));
        expect(empty._tag).toBe("ScheduleInvalidError");
        yield* r.create({ id: "dup", cron: "* * * * *", instruction: "x" });
        const dup = yield* Effect.flip(r.create({ id: "dup", cron: "* * * * *", instruction: "x" }));
        expect(dup._tag).toBe("ScheduleInvalidError");
      }),
    );
  });
});

describe("ScheduleRegistry: firing", () => {
  test("a schedule fires once when its slot passes, with lastRun and runCount", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "skip" }) });
        yield* TestClock.setTime(T0 + HOUR); // 09:00
        const fires = yield* r.collectDue();
        expect(fires.map((f) => f.trigger)).toEqual(["schedule"]);
        const s = yield* r.get("d");
        expect(s.runCount).toBe(1);
        expect(s.lastRun?.status).toBe("running");
        expect(s.nextFireAt).toBe(Date.UTC(2026, 0, 6, 9, 0, 0));
        // Same instant again: nothing new.
        expect(yield* r.collectDue()).toEqual([]);
      }),
    );
  });

  test("paused schedules do not fire and do not catch up after resume", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "fire-all" }) });
        yield* r.pause("d");
        yield* TestClock.setTime(T0 + 2 * DAY);
        expect(yield* r.collectDue()).toEqual([]);
        yield* r.resume("d");
        expect(yield* r.collectDue()).toEqual([]);
        yield* TestClock.setTime(T0 + 2 * DAY + 2 * HOUR); // next 09:00 after resume
        expect((yield* r.collectDue()).length).toBe(1);
      }),
    );
  });

  test("runNow fires a paused schedule and records the lifecycle in lastResult", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "skip" }) });
        yield* r.pause("d");
        expect(yield* r.lastResult("d")).toBeUndefined();

        const fire = yield* r.runNow("d");
        expect(fire.trigger).toBe("manual");
        const running = yield* r.lastResult("d");
        expect(running?.status).toBe("running");
        expect(running?.fireId).toBe(fire.fireId);

        yield* r.completeRun("d", fire.fireId, { runId: "run-42", status: "succeeded", outputRef: "trace:42" });
        const done = yield* r.lastResult("d");
        expect(done).toMatchObject({ runId: "run-42", status: "succeeded", outputRef: "trace:42", trigger: "manual" });
        expect((yield* r.get("d")).enabled).toBe(false); // runNow does not resume

        yield* r.recordDelivery("d", fire.fireId, { status: "delivered", messageId: "m-1" });
        expect((yield* r.lastResult("d"))?.delivery).toEqual({ status: "delivered", messageId: "m-1" });
      }),
    );
  });

  test("a stale completion for a superseded fire is ignored", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "d", ...daily({ mode: "skip" }) });
        const first = yield* r.runNow("d");
        yield* TestClock.adjust(1000);
        const second = yield* r.runNow("d");
        yield* r.completeRun("d", first.fireId, { status: "failed", error: "late" });
        expect((yield* r.lastResult("d"))?.status).toBe("running");
        yield* r.completeRun("d", second.fireId, { status: "failed", error: "boom" });
        expect((yield* r.lastResult("d"))).toMatchObject({ status: "failed", error: "boom" });
      }),
    );
  });

  test("a once schedule fires a single time then is spent", async () => {
    await lifetime({}, T0, (r) =>
      Effect.gen(function* () {
        yield* r.create({ id: "o", runAt: T0 + HOUR, instruction: "one shot" });
        yield* TestClock.setTime(T0 + HOUR + 1000);
        expect((yield* r.collectDue()).length).toBe(1);
        expect((yield* r.get("o")).nextFireAt).toBeNull();
        yield* TestClock.setTime(T0 + 2 * HOUR);
        expect(yield* r.collectDue()).toEqual([]);
      }),
    );
  });
});

describe("ScheduleRegistry: restart catch-up", () => {
  const downtime = async (catchUp: CatchUpPolicy) =>
    withTmpDbResult(async (path) => {
      await lifetime({ path }, T0, (r) => r.create({ id: "d", ...daily(catchUp) }));
      // Process is down for three days: slots at Jan 5, 6 and 7 09:00 are missed.
      return lifetime({ path }, T0 + 3 * DAY, (r) => r.collectDue());
    });

  const withTmpDbResult = async <A>(f: (path: string) => Promise<A>): Promise<A> => {
    let out: A | undefined;
    await withTmpDb(async (p) => {
      out = await f(p);
    });
    return out as A;
  };

  test("skip drops every missed fire", async () => {
    expect(await downtime({ mode: "skip" })).toEqual([]);
  });

  test("fire-once runs only the most recent missed fire, marked catch-up", async () => {
    const fires = await downtime({ mode: "fire-once" });
    expect(fires.length).toBe(1);
    expect(fires[0]?.trigger).toBe("catch-up");
    expect(fires[0]?.scheduledFor).toBe(Date.UTC(2026, 0, 7, 9, 0, 0));
  });

  test("fire-all runs missed fires oldest first, bounded by maxFires", async () => {
    const all = await downtime({ mode: "fire-all" });
    expect(all.map((f) => f.scheduledFor)).toEqual([
      Date.UTC(2026, 0, 5, 9, 0, 0),
      Date.UTC(2026, 0, 6, 9, 0, 0),
      Date.UTC(2026, 0, 7, 9, 0, 0),
    ]);
    const bounded = await downtime({ mode: "fire-all", maxFires: 2 });
    expect(bounded.map((f) => f.scheduledFor)).toEqual([
      Date.UTC(2026, 0, 6, 9, 0, 0),
      Date.UTC(2026, 0, 7, 9, 0, 0),
    ]);
  });

  test("a restart inside the grace window fires normally, not as catch-up", async () => {
    await withTmpDb(async (path) => {
      await lifetime({ path }, T0, (r) => r.create({ id: "d", ...daily({ mode: "skip" }) }));
      const fires = await lifetime({ path }, T0 + HOUR + 2 * 60_000, (r) => r.collectDue());
      expect(fires.map((f) => f.trigger)).toEqual(["schedule"]);
    });
  });

  test("a fire already collected before the restart is not fired twice", async () => {
    await withTmpDb(async (path) => {
      await lifetime({ path }, T0, (r) => r.create({ id: "d", ...daily({ mode: "fire-all" }) }));
      await lifetime({ path }, T0 + HOUR, (r) => r.collectDue());
      const again = await lifetime({ path }, T0 + HOUR + 60_000, (r) => r.collectDue());
      expect(again).toEqual([]);
    });
  });

  test("lastRun and runCount survive a restart", async () => {
    await withTmpDb(async (path) => {
      await lifetime({ path }, T0, (r) => r.create({ id: "d", ...daily({ mode: "skip" }) }));
      await lifetime({ path }, T0 + HOUR, (r) =>
        Effect.gen(function* () {
          const [fire] = yield* r.collectDue();
          yield* r.completeRun("d", fire!.fireId, { runId: "run-1", status: "succeeded" });
        }),
      );
      const s = await lifetime({ path }, T0 + 2 * HOUR, (r) => r.get("d"));
      expect(s.runCount).toBe(1);
      expect(s.lastRun).toMatchObject({ runId: "run-1", status: "succeeded" });
    });
  });

  test("a missed once schedule with skip leaves a skipped receipt", async () => {
    await withTmpDb(async (path) => {
      await lifetime({ path }, T0, (r) =>
        r.create({ id: "o", runAt: T0 + HOUR, instruction: "x", catchUp: { mode: "skip" } }),
      );
      const s = await lifetime({ path }, T0 + DAY, (r) =>
        Effect.gen(function* () {
          expect(yield* r.collectDue()).toEqual([]);
          return yield* r.get("o");
        }),
      );
      expect(s.lastRun?.status).toBe("skipped");
      expect(s.nextFireAt).toBeNull();
    });
  });
});

describe("SchedulerService over the registry", () => {
  test("runNow queues an event that carries schedule and fire ids, drained by checkCrons", async () => {
    await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(T0);
        const sched = yield* SchedulerService;
        const id = configScheduleId({ schedule: "0 9 * * *", instruction: "report" });
        const ev = yield* sched.runNow(id);
        expect(ev.metadata["scheduleId"]).toBe(id);
        expect(ev.metadata["trigger"]).toBe("manual");
        expect((yield* sched.pendingEvents()).length).toBe(1);
        const drained = yield* sched.checkCrons(new Date(T0));
        expect(drained.map((e) => e.id)).toContain(ev.id);
        expect((yield* sched.pendingEvents()).length).toBe(0);
      }).pipe(
        Effect.provide(SchedulerServiceLive({ agentId: "a", crons: [{ schedule: "0 9 * * *", instruction: "report" }] })),
      ),
    );
  });

  test("checkCrons fires a config cron at its slot with the stable schedule id", async () => {
    const entry = { schedule: "0 9 * * *", instruction: "report", timezone: "UTC" };
    const events = await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(T0);
        const sched = yield* SchedulerService;
        yield* sched.checkCrons(new Date(T0));
        return yield* sched.checkCrons(new Date(T0 + HOUR));
      }).pipe(Effect.provide(SchedulerServiceLive({ agentId: "a", crons: [entry] }))),
    );
    expect(events.length).toBe(1);
    expect(events[0]?.metadata["scheduleId"]).toBe(configScheduleId(entry));
    expect(events[0]?.source).toBe("cron");
  });

  test("scope close releases the store (exit is clean)", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(makeScheduleRegistry({ path: ":memory:" })).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
