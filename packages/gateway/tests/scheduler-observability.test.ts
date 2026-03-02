import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  SchedulerService,
  SchedulerServiceLive,
} from "../src/services/scheduler-service.js";

describe("SchedulerService observability", () => {
  test("publishes GatewayEventReceived on emitHeartbeat when bus provided", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };
    const layer = SchedulerServiceLive(
      { agentId: "test-agent", heartbeat: { intervalMs: 1000 } },
      bus,
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const sched = yield* SchedulerService;
        yield* sched.emitHeartbeat();
      }).pipe(Effect.provide(layer)),
    );
    expect(published).toHaveLength(1);
    expect(published[0]._tag).toBe("GatewayEventReceived");
    expect(published[0].source).toBe("heartbeat");
    expect(published[0].agentId).toBe("test-agent");
    expect(published[0].eventId).toMatch(/^hb-/);
    expect(typeof published[0].timestamp).toBe("number");
  });

  test("publishes GatewayEventReceived for each fired cron", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };
    const layer = SchedulerServiceLive(
      {
        agentId: "test-agent",
        crons: [{ schedule: "* * * * *", instruction: "Test cron" }],
      },
      bus,
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const sched = yield* SchedulerService;
        yield* sched.checkCrons(new Date());
      }).pipe(Effect.provide(layer)),
    );
    const cronEvents = published.filter((e) => e.source === "cron");
    expect(cronEvents.length).toBeGreaterThanOrEqual(1);
    expect(cronEvents[0]._tag).toBe("GatewayEventReceived");
    expect(cronEvents[0].agentId).toBe("test-agent");
    expect(cronEvents[0].eventId).toMatch(/^cron-/);
  });

  test("works silently when no bus provided", async () => {
    const layer = SchedulerServiceLive({ agentId: "test-agent" });
    const event = await Effect.runPromise(
      Effect.gen(function* () {
        const sched = yield* SchedulerService;
        return yield* sched.emitHeartbeat();
      }).pipe(Effect.provide(layer)),
    );
    expect(event.source).toBe("heartbeat");
  });

  test("does not publish when crons do not fire", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };
    // Use a cron schedule that won't match "now" (Feb 30 never exists)
    const layer = SchedulerServiceLive(
      {
        agentId: "test-agent",
        crons: [{ schedule: "0 0 30 2 *", instruction: "Never fires" }],
      },
      bus,
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const sched = yield* SchedulerService;
        yield* sched.checkCrons(new Date("2026-01-15T12:00:00Z"));
      }).pipe(Effect.provide(layer)),
    );
    expect(published).toHaveLength(0);
  });
});
