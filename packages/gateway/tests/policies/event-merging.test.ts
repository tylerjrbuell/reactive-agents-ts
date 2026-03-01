import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { createEventMergingPolicy } from "../../src/policies/event-merging.js";
import { initialGatewayState } from "../../src/types.js";
import type { GatewayEvent, GatewayState } from "../../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeEvent = (overrides?: Partial<GatewayEvent>): GatewayEvent => ({
  id: "evt-001",
  source: "webhook",
  timestamp: new Date(),
  payload: { data: "test" },
  priority: "normal",
  metadata: { category: "push" },
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("EventMergingPolicy", () => {
  test("passes through when no pending events of same category", async () => {
    const policy = createEventMergingPolicy();
    const event = makeEvent();
    const state = initialGatewayState(); // no pending events

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // pass through
  });

  test("merges when pending events share same category", async () => {
    const policy = createEventMergingPolicy();
    const event = makeEvent({ id: "evt-002", metadata: { category: "push" } });

    const pendingEvent = makeEvent({ id: "evt-001", metadata: { category: "push" } });
    const state: GatewayState = {
      ...initialGatewayState(),
      pendingEvents: [pendingEvent],
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("merge");
    expect((decision as { mergeKey: string }).mergeKey).toBe("webhook:push");
  });

  test("does not merge events of different categories", async () => {
    const policy = createEventMergingPolicy();
    const event = makeEvent({
      id: "evt-002",
      source: "webhook",
      metadata: { category: "push" },
    });

    const pendingEvent = makeEvent({
      id: "evt-001",
      source: "webhook",
      metadata: { category: "issue" },
    });
    const state: GatewayState = {
      ...initialGatewayState(),
      pendingEvents: [pendingEvent],
    };

    const decision = await Effect.runPromise(policy.evaluate(event, state));
    expect(decision).toBeNull(); // different categories, no merge
  });
});
