import { Effect } from "effect";
import type { SchedulingPolicy } from "../services/policy-engine.js";
import type { GatewayEvent, GatewayState, PolicyDecision, HeartbeatPolicy } from "../types.js";

/**
 * Adaptive heartbeat policy — skip heartbeat ticks when agent state hasn't changed.
 *
 * Only applies to events with source === "heartbeat". Three modes:
 * - "always"       — never skip heartbeats
 * - "adaptive"     — skip when idle (no pending events, has executed before)
 * - "conservative" — only fire when pending events exist
 *
 * Force execution after maxConsecutiveSkips regardless of mode.
 */
export const createAdaptiveHeartbeatPolicy = (
  options?: {
    mode?: HeartbeatPolicy;
    maxConsecutiveSkips?: number;
  },
): SchedulingPolicy => {
  const mode = options?.mode ?? "adaptive";
  const maxSkips = options?.maxConsecutiveSkips ?? 6;

  return {
    _tag: "AdaptiveHeartbeat",
    priority: 10,
    evaluate: (
      event: GatewayEvent,
      state: GatewayState,
    ): Effect.Effect<PolicyDecision | null, never> =>
      Effect.sync(() => {
        // Only applies to heartbeat events
        if (event.source !== "heartbeat") {
          return null;
        }

        // "always" mode — never skip
        if (mode === "always") {
          return null;
        }

        // Force execution after maxConsecutiveSkips
        if (state.consecutiveHeartbeatSkips >= maxSkips) {
          return null;
        }

        const hasPendingEvents = state.pendingEvents.length > 0;
        const hasNeverExecuted = state.lastExecutionAt === null;

        // Allow execution if there are pending events or agent has never run
        if (hasPendingEvents || hasNeverExecuted) {
          return null;
        }

        // "conservative" mode — only fire when pending events exist (already checked above)
        // "adaptive" mode — skip when idle
        return {
          action: "skip" as const,
          reason: "no state change",
        };
      }),
  };
};
