import { Effect } from "effect";
import type { EventBusLike, GatewayEvent, PolicyDecision } from "../types.js";
import type { SchedulingPolicy } from "./policy-engine.js";
import { evaluatePolicies } from "./policy-engine.js";
import { initialGatewayState } from "../types.js";

// ─── Pure routing ──────────────────────────────────────────────────────────

/**
 * Route a gateway event through the policy chain and return the decision.
 * Pure function — no side effects, no EventBus publishing.
 */
export const routeEvent = (
  event: GatewayEvent,
  policies: readonly SchedulingPolicy[],
): Effect.Effect<PolicyDecision, never> =>
  evaluatePolicies(policies, event, initialGatewayState());

// ─── Routing with EventBus integration ─────────────────────────────────────

/**
 * Route a gateway event through the policy chain, publishing EventBus events
 * for observability:
 *   - `GatewayEventReceived` on receipt
 *   - `ProactiveActionSuppressed` when policy decides to skip
 */
export const routeEventWithBus = (
  event: GatewayEvent,
  policies: readonly SchedulingPolicy[],
  bus: EventBusLike,
): Effect.Effect<PolicyDecision, never> =>
  Effect.gen(function* () {
    // Publish receipt event
    yield* bus.publish({
      _tag: "GatewayEventReceived",
      agentId: event.agentId ?? "unknown",
      source: event.source,
      eventId: event.id,
      timestamp: Date.now(),
    });

    const decision = yield* evaluatePolicies(policies, event, initialGatewayState());

    // Publish suppression event if skipped
    if (decision.action === "skip") {
      yield* bus.publish({
        _tag: "ProactiveActionSuppressed",
        agentId: event.agentId ?? "unknown",
        source: event.source,
        reason: (decision as { reason: string }).reason,
        policy: "policy-engine",
        eventId: event.id,
        timestamp: Date.now(),
      });
    }

    return decision;
  });
