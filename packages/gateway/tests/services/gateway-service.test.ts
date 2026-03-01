import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

describe("GatewayService", () => {
  test("creates gateway with config and returns initial status", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        return yield* gw.status();
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            heartbeat: { intervalMs: 60000, policy: "adaptive" },
            policies: {
              dailyTokenBudget: 50000,
              maxActionsPerHour: 20,
            },
          }),
        ),
      ),
    );
    expect(result.isRunning).toBe(false);
    expect(result.stats.heartbeatsFired).toBe(0);
    expect(result.stats.webhooksReceived).toBe(0);
    expect(result.stats.cronsExecuted).toBe(0);
    expect(result.stats.totalTokensUsed).toBe(0);
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  test("processEvent routes through policy engine", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        return yield* gw.processEvent({
          id: "test-1",
          source: "webhook",
          timestamp: new Date(),
          priority: "normal",
          payload: { data: "test" },
          metadata: {},
        });
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: {
              dailyTokenBudget: 100000,
              maxActionsPerHour: 50,
            },
          }),
        ),
      ),
    );
    expect(result.action).toBe("execute");
  });

  test("tracks gateway stats after processing events", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent({
          id: "test-1",
          source: "webhook",
          timestamp: new Date(),
          priority: "normal",
          payload: {},
          metadata: {},
        });
        return yield* gw.status();
      }).pipe(Effect.provide(GatewayServiceLive({}))),
    );
    expect(result.stats.webhooksReceived).toBe(1);
  });

  test("tracks token usage across state and stats", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.updateTokensUsed(1500);
        yield* gw.updateTokensUsed(500);
        return yield* gw.status();
      }).pipe(Effect.provide(GatewayServiceLive({}))),
    );
    expect(result.stats.totalTokensUsed).toBe(2000);
    expect(result.state.tokensUsedToday).toBe(2000);
  });

  test("tracks heartbeat skip stats and consecutive skip counter", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );
    // Use adaptive mode with a lastExecutionAt set via a webhook first,
    // then send heartbeats. Adaptive skips when idle (no pending, has executed).
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        // First: execute a webhook so lastExecutionAt is set (not null)
        yield* gw.processEvent({
          id: "wh-1",
          source: "webhook",
          timestamp: new Date(),
          priority: "normal",
          payload: {},
          metadata: {},
        });
        // Now heartbeats in adaptive mode (no pending events, has executed) => skip
        yield* gw.processEvent({
          id: "hb-1",
          source: "heartbeat",
          timestamp: new Date(),
          priority: "normal",
          payload: {},
          metadata: {},
        });
        yield* gw.processEvent({
          id: "hb-2",
          source: "heartbeat",
          timestamp: new Date(),
          priority: "normal",
          payload: {},
          metadata: {},
        });
        return yield* gw.status();
      }).pipe(Effect.provide(GatewayServiceLive({}))),
    );
    expect(result.stats.heartbeatsSkipped).toBe(2);
    expect(result.stats.actionsSuppressed).toBe(2);
    expect(result.state.consecutiveHeartbeatSkips).toBe(2);
  });

  test("increments cronsExecuted for cron events", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent({
          id: "cron-1",
          source: "cron",
          timestamp: new Date(),
          priority: "normal",
          payload: { instruction: "daily summary" },
          metadata: {},
        });
        return yield* gw.status();
      }).pipe(Effect.provide(GatewayServiceLive({}))),
    );
    expect(result.stats.cronsExecuted).toBe(1);
  });

  test("tracks channel messages", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent({
          id: "ch-1",
          source: "channel",
          timestamp: new Date(),
          priority: "normal",
          payload: { message: "hello" },
          metadata: {},
        });
        return yield* gw.status();
      }).pipe(Effect.provide(GatewayServiceLive({}))),
    );
    expect(result.stats.channelMessages).toBe(1);
  });
});
