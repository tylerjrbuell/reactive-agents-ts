import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { createCostBudgetPolicy } from "../../src/policies/cost-budget.js";
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

describe("CostBudgetPolicy", () => {
  test("allows events under budget", async () => {
    const policy = createCostBudgetPolicy({ dailyTokenBudget: 100_000 });
    const event = makeEvent();
    const state: GatewayState = {
      ...initialGatewayState(),
      tokensUsedToday: 50_000, // under budget
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // pass through (allow)
  });

  test("queues events when budget exhausted (default onExhausted)", async () => {
    const policy = createCostBudgetPolicy({ dailyTokenBudget: 100_000 });
    const event = makeEvent();
    const state: GatewayState = {
      ...initialGatewayState(),
      tokensUsedToday: 100_000, // at budget limit
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("queue");
    expect((decision as { reason: string }).reason).toContain("budget exhausted");
  });

  test("critical priority bypasses budget", async () => {
    const policy = createCostBudgetPolicy({ dailyTokenBudget: 100_000 });
    const event = makeEvent({ priority: "critical" });
    const state: GatewayState = {
      ...initialGatewayState(),
      tokensUsedToday: 200_000, // well over budget
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // critical bypasses
  });
});
