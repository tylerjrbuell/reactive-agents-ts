import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { routeEvent, routeEventWithBus } from "../../src/services/input-router.js";
import type { SchedulingPolicy } from "../../src/services/policy-engine.js";
import type { GatewayEvent } from "../../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeEvent = (overrides?: Partial<GatewayEvent>): GatewayEvent => ({
  id: "evt-router-001",
  source: "webhook",
  timestamp: new Date(),
  payload: { data: "test" },
  priority: "normal",
  metadata: {},
  ...overrides,
});

const makeSkipPolicy = (reason: string): SchedulingPolicy => ({
  _tag: "SkipPolicy",
  priority: 10,
  evaluate: () => Effect.succeed({ action: "skip" as const, reason }),
});

// ─── routeEvent (pure) ─────────────────────────────────────────────────────

describe("routeEvent", () => {
  test("routes event through policy engine and returns execute decision by default", async () => {
    const event = makeEvent();
    const decision = await Effect.runPromise(routeEvent(event, []));
    expect(decision.action).toBe("execute");
    expect((decision as { taskDescription: string }).taskDescription).toContain("[webhook]");
  });
});

// ─── routeEventWithBus ─────────────────────────────────────────────────────

describe("routeEventWithBus", () => {
  test("publishes GatewayEventReceived to EventBus", async () => {
    const event = makeEvent({ agentId: "agent-001", source: "cron" });
    const collected: any[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.subscribe((e) =>
          Effect.sync(() => {
            collected.push(e);
          }),
        );
        yield* routeEventWithBus(event, [], bus);
      }).pipe(Effect.provide(EventBusLive)),
    );

    const received = collected.find((e) => e._tag === "GatewayEventReceived");
    expect(received).toBeDefined();
    expect(received.agentId).toBe("agent-001");
    expect(received.source).toBe("cron");
    expect(received.eventId).toBe("evt-router-001");
    expect(typeof received.timestamp).toBe("number");
  });

  test("publishes ProactiveActionSuppressed when policy skips", async () => {
    const event = makeEvent({ agentId: "agent-002", source: "heartbeat" });
    const skipPolicy = makeSkipPolicy("too many heartbeats");
    const collected: any[] = [];

    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.subscribe((e) =>
          Effect.sync(() => {
            collected.push(e);
          }),
        );
        return yield* routeEventWithBus(event, [skipPolicy], bus);
      }).pipe(Effect.provide(EventBusLive)),
    );

    expect(decision.action).toBe("skip");

    const suppressed = collected.find((e) => e._tag === "ProactiveActionSuppressed");
    expect(suppressed).toBeDefined();
    expect(suppressed.agentId).toBe("agent-002");
    expect(suppressed.source).toBe("heartbeat");
    expect(suppressed.reason).toBe("too many heartbeats");
    expect(suppressed.policy).toBe("policy-engine");
    expect(suppressed.eventId).toBe("evt-router-001");
    expect(typeof suppressed.timestamp).toBe("number");
  });
});
