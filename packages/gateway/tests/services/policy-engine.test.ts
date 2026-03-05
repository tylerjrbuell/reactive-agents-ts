import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  evaluatePolicies,
  PolicyEngine,
  PolicyEngineLive,
} from "../../src/services/policy-engine.js";
import type { SchedulingPolicy } from "../../src/services/policy-engine.js";
import { initialGatewayState } from "../../src/types.js";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../../src/types.js";

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

const makePolicy = (
  tag: string,
  priority: number,
  result: PolicyDecision | null,
): SchedulingPolicy => ({
  _tag: tag,
  priority,
  evaluate: () => Effect.succeed(result),
});

// ─── evaluatePolicies (pure function) ───────────────────────────────────────

describe("evaluatePolicies", () => {
  const state = initialGatewayState();

  test("returns execute when no policies block", async () => {
    const event = makeEvent();
    const decision = await Effect.runPromise(evaluatePolicies([], event, state));
    expect(decision.action).toBe("execute");
    expect((decision as { taskDescription: string }).taskDescription).toContain("[webhook]");
  });

  test("first policy to return non-null wins", async () => {
    const event = makeEvent();
    const policies: SchedulingPolicy[] = [
      makePolicy("A", 10, { action: "skip", reason: "blocked by A" }),
      makePolicy("B", 20, { action: "queue", reason: "blocked by B" }),
    ];

    const decision = await Effect.runPromise(evaluatePolicies(policies, event, state));
    expect(decision.action).toBe("skip");
    expect((decision as { reason: string }).reason).toBe("blocked by A");
  });

  test("policies evaluate in priority order (lower number = earlier)", async () => {
    const event = makeEvent();
    // B has lower priority number, so it evaluates first despite being second in array
    const policies: SchedulingPolicy[] = [
      makePolicy("A", 20, { action: "skip", reason: "blocked by A" }),
      makePolicy("B", 5, { action: "queue", reason: "blocked by B" }),
    ];

    const decision = await Effect.runPromise(evaluatePolicies(policies, event, state));
    expect(decision.action).toBe("queue");
    expect((decision as { reason: string }).reason).toBe("blocked by B");
  });

  test("null-returning policies pass to next", async () => {
    const event = makeEvent();
    const policies: SchedulingPolicy[] = [
      makePolicy("PassThrough1", 10, null),
      makePolicy("PassThrough2", 20, null),
      makePolicy("Blocker", 30, { action: "escalate", reason: "escalated" }),
    ];

    const decision = await Effect.runPromise(evaluatePolicies(policies, event, state));
    expect(decision.action).toBe("escalate");
    expect((decision as { reason: string }).reason).toBe("escalated");
  });
});

// ─── PolicyEngine service ───────────────────────────────────────────────────

describe("PolicyEngine service", () => {
  test("addPolicy and getPolicies work together", async () => {
    const policy = makePolicy("Test", 10, null);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        yield* engine.addPolicy(policy);
        return yield* engine.getPolicies();
      }).pipe(Effect.provide(PolicyEngineLive())),
    );

    expect(result).toHaveLength(1);
    expect(result[0]._tag).toBe("Test");
  });

  test("evaluate delegates to evaluatePolicies", async () => {
    const policy = makePolicy("Blocker", 10, { action: "skip", reason: "nope" });
    const event = makeEvent();
    const state = initialGatewayState();

    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        return yield* engine.evaluate(event, state);
      }).pipe(Effect.provide(PolicyEngineLive([policy]))),
    );

    expect(decision.action).toBe("skip");
  });
});
