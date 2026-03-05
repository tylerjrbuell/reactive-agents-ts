import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";

describe("Gateway layer composition in createRuntime()", () => {
  test("GatewayService is resolvable when enableGateway is true", async () => {
    const { createRuntime } = await import("../src/runtime");
    const { GatewayService } = await import("@reactive-agents/gateway");

    const runtime = createRuntime({
      agentId: "gw-test",
      provider: "test",
      enableGateway: true,
      gatewayOptions: {
        policies: { dailyTokenBudget: 50000 },
      },
    });

    const status = await Effect.runPromise(
      GatewayService.pipe(
        Effect.flatMap((gw) => gw.status()),
        Effect.provide(runtime as Layer.Layer<any>),
      ),
    );

    expect(status).toBeDefined();
    expect(status.isRunning).toBe(false);
    expect(status.stats).toBeDefined();
    expect(status.stats.heartbeatsFired).toBe(0);
  });

  test("SchedulerService is resolvable when enableGateway is true", async () => {
    const { createRuntime } = await import("../src/runtime");
    const { SchedulerService } = await import("@reactive-agents/gateway");

    const runtime = createRuntime({
      agentId: "gw-sched-test",
      provider: "test",
      enableGateway: true,
      gatewayOptions: {
        heartbeat: { intervalMs: 60000, instruction: "Check for work" },
        crons: [{ schedule: "0 9 * * MON", instruction: "Weekly review" }],
      },
    });

    const hbEvent = await Effect.runPromise(
      SchedulerService.pipe(
        Effect.flatMap((sched) => sched.emitHeartbeat()),
        Effect.provide(runtime as Layer.Layer<any>),
      ),
    );

    expect(hbEvent).toBeDefined();
    expect(hbEvent.source).toBe("heartbeat");
    expect(hbEvent.agentId).toBe("gw-sched-test");
  });

  test("gateway layers are NOT composed when enableGateway is false", async () => {
    const { createRuntime } = await import("../src/runtime");
    const { GatewayService } = await import("@reactive-agents/gateway");

    const runtime = createRuntime({
      agentId: "no-gw-test",
      provider: "test",
      enableGateway: false,
    });

    // Missing Context.Tag service throws a Die (defect), not a typed error,
    // so we must use catchAllCause to intercept it.
    const result = await Effect.runPromise(
      GatewayService.pipe(
        Effect.flatMap((gw) => gw.status()),
        Effect.map(() => "found"),
        Effect.catchAllCause(() => Effect.succeed("not-found")),
        Effect.provide(runtime as Layer.Layer<any>),
      ),
    );

    expect(result).toBe("not-found");
  });
});
