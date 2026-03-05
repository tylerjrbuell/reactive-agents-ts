import { Effect } from "effect";
import type { SchedulingPolicy } from "../services/policy-engine.js";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../types.js";

/**
 * Rate limit policy — cap autonomous executions per hour.
 *
 * Critical priority events bypass the rate limit.
 * When the limit is exceeded, events are queued.
 */
export const createRateLimitPolicy = (
  options: {
    maxPerHour: number;
  },
): SchedulingPolicy => {
  const maxPerHour = options.maxPerHour;

  return {
    _tag: "RateLimit",
    priority: 30,
    evaluate: (
      event: GatewayEvent,
      state: GatewayState,
    ): Effect.Effect<PolicyDecision | null, never> =>
      Effect.sync(() => {
        // Critical priority bypasses rate limit
        if (event.priority === "critical") {
          return null;
        }

        // Under rate limit — allow
        if (state.actionsThisHour < maxPerHour) {
          return null;
        }

        // Rate limit exceeded
        return {
          action: "queue" as const,
          reason: `Rate limit exceeded (${state.actionsThisHour}/${maxPerHour} per hour)`,
        };
      }),
  };
};
