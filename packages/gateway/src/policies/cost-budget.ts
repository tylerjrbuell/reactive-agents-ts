import { Effect } from "effect";
import type { SchedulingPolicy } from "../services/policy-engine.js";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../types.js";

/**
 * Cost budget policy — block events when daily token budget is exhausted.
 *
 * Critical priority events bypass the budget check entirely.
 * When budget is exhausted, the configurable `onExhausted` action determines
 * whether events are queued, skipped, or escalated.
 */
export const createCostBudgetPolicy = (
  options: {
    dailyTokenBudget: number;
    onExhausted?: "queue" | "skip" | "escalate";
  },
): SchedulingPolicy => {
  const budget = options.dailyTokenBudget;
  const onExhausted = options.onExhausted ?? "queue";

  return {
    _tag: "CostBudget",
    priority: 20,
    evaluate: (
      event: GatewayEvent,
      state: GatewayState,
    ): Effect.Effect<PolicyDecision | null, never> =>
      Effect.sync(() => {
        // Critical priority bypasses budget
        if (event.priority === "critical") {
          return null;
        }

        // Under budget — allow
        if (state.tokensUsedToday < budget) {
          return null;
        }

        // Budget exhausted — apply configured action
        const reason = `Daily token budget exhausted (${state.tokensUsedToday}/${budget})`;

        switch (onExhausted) {
          case "skip":
            return { action: "skip" as const, reason };
          case "escalate":
            return { action: "escalate" as const, reason };
          case "queue":
          default:
            return { action: "queue" as const, reason };
        }
      }),
  };
};
