import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";

const runWithBus = <A>(effect: Effect.Effect<A, any, EventBus>) =>
  Effect.runPromise(effect.pipe(Effect.provide(EventBusLive)));

// ─── Gateway Event Types via EventBus ────────────────────────────────────────

describe("Gateway EventBus Events", () => {
  test("GatewayStarted event is published and received via bus.on()", async () => {
    const received: Array<{
      agentId: string;
      sources: readonly string[];
      policies: readonly string[];
      timestamp: number;
    }> = [];

    await runWithBus(
      Effect.gen(function* () {
        const bus = yield* EventBus;

        yield* bus.on("GatewayStarted", (event) =>
          Effect.sync(() => received.push(event)),
        );

        yield* bus.publish({
          _tag: "GatewayStarted",
          agentId: "gateway-agent-1",
          sources: ["heartbeat", "cron", "webhook"],
          policies: ["daily-token-budget", "rate-limit"],
          timestamp: 1709100000000,
        });
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe("gateway-agent-1");
    expect(received[0].sources).toEqual(["heartbeat", "cron", "webhook"]);
    expect(received[0].policies).toEqual(["daily-token-budget", "rate-limit"]);
    expect(received[0].timestamp).toBe(1709100000000);
  });

  test("ProactiveActionSuppressed event is published and received via bus.on()", async () => {
    const received: Array<{
      agentId: string;
      source: string;
      reason: string;
      policy: string;
      eventId: string;
      timestamp: number;
    }> = [];

    await runWithBus(
      Effect.gen(function* () {
        const bus = yield* EventBus;

        yield* bus.on("ProactiveActionSuppressed", (event) =>
          Effect.sync(() => received.push(event)),
        );

        yield* bus.publish({
          _tag: "ProactiveActionSuppressed",
          agentId: "gateway-agent-2",
          source: "webhook",
          reason: "Daily token budget exceeded",
          policy: "daily-token-budget",
          eventId: "evt-suppress-001",
          timestamp: 1709100001000,
        });
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe("gateway-agent-2");
    expect(received[0].source).toBe("webhook");
    expect(received[0].reason).toBe("Daily token budget exceeded");
    expect(received[0].policy).toBe("daily-token-budget");
    expect(received[0].eventId).toBe("evt-suppress-001");
    expect(received[0].timestamp).toBe(1709100001000);
  });

  test("HeartbeatSkipped event is published and received via bus.on()", async () => {
    const received: Array<{
      agentId: string;
      reason: string;
      consecutiveSkips: number;
      timestamp: number;
    }> = [];

    await runWithBus(
      Effect.gen(function* () {
        const bus = yield* EventBus;

        yield* bus.on("HeartbeatSkipped", (event) =>
          Effect.sync(() => received.push(event)),
        );

        yield* bus.publish({
          _tag: "HeartbeatSkipped",
          agentId: "gateway-agent-3",
          reason: "no_changes",
          consecutiveSkips: 4,
          timestamp: 1709100002000,
        });
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe("gateway-agent-3");
    expect(received[0].reason).toBe("no_changes");
    expect(received[0].consecutiveSkips).toBe(4);
    expect(received[0].timestamp).toBe(1709100002000);
  });

  test("BudgetExhausted event is published and received via bus.on()", async () => {
    const received: Array<{
      agentId: string;
      budgetType: string;
      limit: number;
      used: number;
      timestamp: number;
    }> = [];

    await runWithBus(
      Effect.gen(function* () {
        const bus = yield* EventBus;

        yield* bus.on("BudgetExhausted", (event) =>
          Effect.sync(() => received.push(event)),
        );

        yield* bus.publish({
          _tag: "BudgetExhausted",
          agentId: "gateway-agent-4",
          budgetType: "daily-tokens",
          limit: 100_000,
          used: 100_150,
          timestamp: 1709100003000,
        });
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe("gateway-agent-4");
    expect(received[0].budgetType).toBe("daily-tokens");
    expect(received[0].limit).toBe(100_000);
    expect(received[0].used).toBe(100_150);
    expect(received[0].timestamp).toBe(1709100003000);
  });
});
