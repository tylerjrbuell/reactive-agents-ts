import { Effect } from "effect";
import type { SchedulingPolicy } from "../services/policy-engine.js";
import type { GatewayEvent, GatewayState, PolicyDecision, ChannelAccessConfig } from "../types.js";

/**
 * Access control policy — gate channel messages based on sender identity.
 *
 * Priority 5 (evaluated before all other policies).
 * Only applies to events with source === "channel".
 *
 * Modes:
 * - "allowlist" — only listed senders pass through
 * - "blocklist" — listed senders are blocked, all others pass
 * - "open"      — all senders pass (existing guardrails still apply)
 */
export const createAccessControlPolicy = (
  config: ChannelAccessConfig,
): SchedulingPolicy => ({
  _tag: "AccessControl",
  priority: 5,
  evaluate: (
    event: GatewayEvent,
    _state: GatewayState,
  ): Effect.Effect<PolicyDecision | null, never> =>
    Effect.sync(() => {
      if (event.source !== "channel") return null;

      const sender = String(event.metadata?.["sender"] ?? "");
      if (!sender) return null;

      switch (config.policy) {
        case "open":
          return null;

        case "allowlist": {
          const allowed = config.allowedSenders ?? [];
          if (allowed.includes(sender)) return null;
          const action = config.unknownSenderAction ?? "skip";
          return action === "escalate"
            ? { action: "escalate", reason: `Sender ${sender} not in allowlist` }
            : { action: "skip", reason: `Sender ${sender} not in allowlist` };
        }

        case "blocklist": {
          const blocked = config.blockedSenders ?? [];
          if (blocked.includes(sender)) {
            return { action: "skip", reason: `Sender ${sender} is blocklisted` };
          }
          return null;
        }

        default:
          return null;
      }
    }),
});
