import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

describe("Gateway Integration", () => {
  test("full pipeline: heartbeat → adaptive skip", async () => {
    // Create GatewayService with adaptive heartbeat policy
    // Process a heartbeat event
    // First heartbeat: lastExecutionAt is null so adaptive passes through → execute
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );
    const { createHeartbeatEvent } = await import(
      "../../src/services/scheduler-service.js"
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        const event = createHeartbeatEvent("test-agent");
        const decision = yield* gw.processEvent(event);
        // First heartbeat: lastExecutionAt is null so adaptive passes through
        expect(decision.action).toBe("execute");
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            heartbeat: { intervalMs: 60000, policy: "adaptive" },
            policies: { dailyTokenBudget: 50000 },
          }),
        ),
      ),
    );
  });

  test("full pipeline: webhook → execute decision", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        return yield* gw.processEvent({
          id: "wh-1",
          source: "webhook",
          timestamp: new Date(),
          priority: "normal",
          payload: { action: "opened" },
          metadata: { adapter: "github", category: "pull_request.opened" },
        });
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: { dailyTokenBudget: 100000, maxActionsPerHour: 50 },
          }),
        ),
      ),
    );
    expect(result.action).toBe("execute");
  });

  test("full pipeline: budget exhausted → queue decision", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.updateTokensUsed(60000);
        return yield* gw.processEvent({
          id: "wh-2",
          source: "webhook",
          timestamp: new Date(),
          priority: "normal",
          payload: {},
          metadata: {},
        });
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: { dailyTokenBudget: 50000 },
          }),
        ),
      ),
    );
    expect(result.action).toBe("queue");
  });

  test("critical events bypass budget", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.updateTokensUsed(999999);
        return yield* gw.processEvent({
          id: "critical-1",
          source: "webhook",
          timestamp: new Date(),
          priority: "critical",
          payload: {},
          metadata: {},
        });
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: { dailyTokenBudget: 50000 },
          }),
        ),
      ),
    );
    expect(result.action).toBe("execute");
  });

  test("stats track all event sources correctly", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../../src/services/gateway-service.js"
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        // Webhook
        yield* gw.processEvent({
          id: "w1",
          source: "webhook",
          timestamp: new Date(),
          priority: "normal",
          payload: {},
          metadata: {},
        });
        // Channel
        yield* gw.processEvent({
          id: "c1",
          source: "channel",
          timestamp: new Date(),
          priority: "normal",
          payload: {},
          metadata: {},
        });
        // Cron
        yield* gw.processEvent({
          id: "cr1",
          source: "cron",
          timestamp: new Date(),
          priority: "normal",
          payload: {},
          metadata: {},
        });
        return yield* gw.status();
      }).pipe(Effect.provide(GatewayServiceLive({}))),
    );
    expect(result.stats.webhooksReceived).toBe(1);
    expect(result.stats.webhooksProcessed).toBe(1);
    expect(result.stats.channelMessages).toBe(1);
    expect(result.stats.cronsExecuted).toBe(1);
  });
});
