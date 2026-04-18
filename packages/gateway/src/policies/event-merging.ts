import { Effect } from "effect";
import type { SchedulingPolicy } from "../services/policy-engine.js";
import type { GatewayEvent, GatewayState, PolicyDecision } from "../types.js";

/**
 * Event merging policy — batch events of the same category.
 *
 * If pending events share the same merge key as the incoming event,
 * return a merge decision so they can be batched together.
 * Default merge key: `${event.source}:${event.metadata.category ?? "default"}`
 */
export const createEventMergingPolicy = (
  options?: {
    mergeKey?: (event: GatewayEvent) => string;
  },
): SchedulingPolicy => {
  const getMergeKey =
    options?.mergeKey ??
    ((event: GatewayEvent): string => {
      const category =
        typeof event.metadata["category"] === "string"
          ? event.metadata["category"]
          : "default";
      return `${event.source}:${category}`;
    });

  return {
    _tag: "EventMerging",
    priority: 50,
    evaluate: (
      event: GatewayEvent,
      state: GatewayState,
    ): Effect.Effect<PolicyDecision | null, never> =>
      Effect.sync(() => {
        if (state.pendingEvents.length === 0) {
          return null;
        }

        const incomingKey = getMergeKey(event);

        // Check if any pending event shares the same merge key
        const hasMergeable = state.pendingEvents.some(
          (pending) => getMergeKey(pending) === incomingKey,
        );

        if (hasMergeable) {
          return {
            action: "merge" as const,
            mergeKey: incomingKey,
          };
        }

        return null;
      }),
  };
};
