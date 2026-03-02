import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { GatewayService, GatewayServiceLive } from "../../src/services/gateway-service.js";
import type { GatewayEvent } from "../../src/types.js";

describe("GatewayService observability", () => {
  const makeHeartbeatEvent = (id = "hb-test-1"): GatewayEvent => ({
    id,
    source: "heartbeat",
    timestamp: new Date(),
    agentId: "test-agent",
    priority: "low",
    payload: {},
    metadata: { instruction: "Check for work" },
  });

  const makeWebhookEvent = (id = "wh-test-1"): GatewayEvent => ({
    id,
    source: "webhook",
    timestamp: new Date(),
    agentId: "test-agent",
    priority: "normal",
    payload: { data: "test" },
    metadata: {},
  });

  test("publishes GatewayEventReceived when EventBus provided", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };
    const layer = GatewayServiceLive({}, bus);
    await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent(makeHeartbeatEvent());
      }).pipe(Effect.provide(layer)),
    );
    const received = published.find((e) => e._tag === "GatewayEventReceived");
    expect(received).toBeDefined();
    expect(received.source).toBe("heartbeat");
    expect(received.eventId).toBe("hb-test-1");
    expect(received.agentId).toBe("test-agent");
    expect(typeof received.timestamp).toBe("number");
  });

  test("publishes GatewayEventReceived for webhook events", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };
    const layer = GatewayServiceLive({}, bus);
    await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent(makeWebhookEvent());
      }).pipe(Effect.provide(layer)),
    );
    const received = published.find((e) => e._tag === "GatewayEventReceived");
    expect(received).toBeDefined();
    expect(received.source).toBe("webhook");
    expect(received.eventId).toBe("wh-test-1");
  });

  test("publishes ProactiveActionSuppressed when policy skips", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };
    // Adaptive policy: first heartbeat executes (lastExecutionAt is null),
    // second heartbeat skips (lastExecutionAt is set, no pending events)
    const layer = GatewayServiceLive(
      { policies: { heartbeatPolicy: "adaptive" } },
      bus,
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent(makeHeartbeatEvent("hb-1")); // Executes (never ran)
        yield* gw.processEvent(makeHeartbeatEvent("hb-2")); // Should skip
      }).pipe(Effect.provide(layer)),
    );
    const suppressed = published.find(
      (e) => e._tag === "ProactiveActionSuppressed",
    );
    expect(suppressed).toBeDefined();
    expect(suppressed.source).toBe("heartbeat");
    expect(suppressed.reason).toBe("no state change");
    expect(suppressed.eventId).toBe("hb-2");
  });

  test("publishes HeartbeatSkipped when adaptive policy skips heartbeat", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };
    const layer = GatewayServiceLive(
      { policies: { heartbeatPolicy: "adaptive" } },
      bus,
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent(makeHeartbeatEvent("hb-1")); // Executes (never ran)
        yield* gw.processEvent(makeHeartbeatEvent("hb-2")); // Skips
        yield* gw.processEvent(makeHeartbeatEvent("hb-3")); // Skips again
      }).pipe(Effect.provide(layer)),
    );
    const skipped = published.filter((e) => e._tag === "HeartbeatSkipped");
    expect(skipped.length).toBe(2);
    expect(skipped[0].consecutiveSkips).toBe(1);
    expect(skipped[1].consecutiveSkips).toBe(2);
    expect(skipped[0].agentId).toBe("test-agent");
    expect(skipped[0].reason).toBe("no state change");
  });

  test("does not publish HeartbeatSkipped for non-heartbeat skips", async () => {
    const published: any[] = [];
    const bus = {
      publish: (event: any) => {
        published.push(event);
        return Effect.void;
      },
    };
    // Rate limit policy will skip non-heartbeat events after max actions
    const layer = GatewayServiceLive(
      { policies: { maxActionsPerHour: 1 } },
      bus,
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent(makeWebhookEvent("wh-1")); // Executes (first action)
        yield* gw.processEvent(makeWebhookEvent("wh-2")); // Should be rate-limited
      }).pipe(Effect.provide(layer)),
    );
    const heartbeatSkipped = published.filter(
      (e) => e._tag === "HeartbeatSkipped",
    );
    expect(heartbeatSkipped.length).toBe(0);
    // But should still get suppressed events for the rate-limited one
    const received = published.filter(
      (e) => e._tag === "GatewayEventReceived",
    );
    expect(received.length).toBe(2); // Both events received
  });

  test("works silently when no EventBus provided", async () => {
    const layer = GatewayServiceLive({});
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        return yield* gw.processEvent(makeHeartbeatEvent());
      }).pipe(Effect.provide(layer)),
    );
    // Should still return a valid decision
    expect(result.action).toBeDefined();
  });

  test("backward compatible — all existing methods work without bus", async () => {
    const layer = GatewayServiceLive({
      heartbeat: { intervalMs: 60000, policy: "adaptive" },
      policies: { dailyTokenBudget: 50000 },
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        yield* gw.processEvent(makeHeartbeatEvent());
        yield* gw.updateTokensUsed(100);
        return yield* gw.status();
      }).pipe(Effect.provide(layer)),
    );
    expect(result.stats.heartbeatsFired).toBe(1);
    expect(result.stats.totalTokensUsed).toBe(100);
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });
});
