import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { createAdaptiveHeartbeatPolicy } from "../../src/policies/adaptive-heartbeat.js";
import { initialGatewayState } from "../../src/types.js";
import type { GatewayEvent, GatewayState } from "../../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeHeartbeatEvent = (overrides?: Partial<GatewayEvent>): GatewayEvent => ({
  id: "hb-001",
  source: "heartbeat",
  timestamp: new Date(),
  payload: null,
  priority: "normal",
  metadata: {},
  ...overrides,
});

const makeWebhookEvent = (): GatewayEvent => ({
  id: "wh-001",
  source: "webhook",
  timestamp: new Date(),
  payload: { action: "push" },
  priority: "normal",
  metadata: {},
});

const idleState = (): GatewayState => ({
  ...initialGatewayState(),
  lastExecutionAt: new Date(Date.now() - 60_000), // has executed before
  consecutiveHeartbeatSkips: 0,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AdaptiveHeartbeatPolicy", () => {
  test("skips heartbeat when no state change and policy is adaptive", async () => {
    const policy = createAdaptiveHeartbeatPolicy({ mode: "adaptive" });
    const event = makeHeartbeatEvent();
    const state = idleState(); // no pending events, has executed before

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("skip");
    expect((decision as { reason: string }).reason).toBe("no state change");
  });

  test("executes heartbeat when pending events exist", async () => {
    const policy = createAdaptiveHeartbeatPolicy({ mode: "adaptive" });
    const event = makeHeartbeatEvent();
    const pendingEvent = makeWebhookEvent();
    const state: GatewayState = {
      ...idleState(),
      pendingEvents: [pendingEvent],
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // null = pass through (allow execution)
  });

  test("forces execution after maxConsecutiveSkips", async () => {
    const policy = createAdaptiveHeartbeatPolicy({
      mode: "adaptive",
      maxConsecutiveSkips: 3,
    });
    const event = makeHeartbeatEvent();
    const state: GatewayState = {
      ...idleState(),
      consecutiveHeartbeatSkips: 3, // at the limit
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // forced through
  });

  test("passes through non-heartbeat events", async () => {
    const policy = createAdaptiveHeartbeatPolicy({ mode: "adaptive" });
    const event = makeWebhookEvent();
    const state = idleState();

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // not a heartbeat, pass through
  });

  test("always mode passes all heartbeats", async () => {
    const policy = createAdaptiveHeartbeatPolicy({ mode: "always" });
    const event = makeHeartbeatEvent();
    const state = idleState(); // idle, no pending events

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // always allows
  });
});
