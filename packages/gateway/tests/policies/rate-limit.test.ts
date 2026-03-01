import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { createRateLimitPolicy } from "../../src/policies/rate-limit.js";
import { initialGatewayState } from "../../src/types.js";
import type { GatewayEvent, GatewayState } from "../../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeEvent = (overrides?: Partial<GatewayEvent>): GatewayEvent => ({
  id: "evt-001",
  source: "webhook",
  timestamp: new Date(),
  payload: { data: "test" },
  priority: "normal",
  metadata: {},
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("RateLimitPolicy", () => {
  test("allows events under rate limit", async () => {
    const policy = createRateLimitPolicy({ maxPerHour: 30 });
    const event = makeEvent();
    const state: GatewayState = {
      ...initialGatewayState(),
      actionsThisHour: 10, // under limit
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // pass through (allow)
  });

  test("queues events when rate limit exceeded", async () => {
    const policy = createRateLimitPolicy({ maxPerHour: 30 });
    const event = makeEvent();
    const state: GatewayState = {
      ...initialGatewayState(),
      actionsThisHour: 30, // at limit
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("queue");
    expect((decision as { reason: string }).reason).toContain("Rate limit exceeded");
    expect((decision as { reason: string }).reason).toContain("30/30");
  });

  test("critical priority bypasses rate limit", async () => {
    const policy = createRateLimitPolicy({ maxPerHour: 30 });
    const event = makeEvent({ priority: "critical" });
    const state: GatewayState = {
      ...initialGatewayState(),
      actionsThisHour: 100, // well over limit
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // critical bypasses
  });
});
