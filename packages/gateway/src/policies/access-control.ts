import { Effect } from "effect";
import type { SchedulingPolicy } from "../services/policy-engine.js";
import type { GatewayEvent, GatewayState, PolicyDecision, ChannelAccessConfig } from "../types.js";

/**
 * Canonical access-control key for a channel sender: `platform:userId`.
 *
 * Namespacing stops a Signal number and a Telegram id (or any two platforms)
 * from colliding. Allow/block list entries must use the same form, e.g.
 * `signal:+15551234567`, `telegram:123456789`. An event without a platform
 * keeps the bare sender (legacy producers only).
 */
export const channelSenderKey = (platform: unknown, sender: string): string => {
  const p = typeof platform === "string" ? platform.trim().toLowerCase() : "";
  return p ? `${p}:${sender}` : sender;
};

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

      const rawSender = String(event.metadata?.["sender"] ?? "").trim();
      // Fail closed: a channel event with no identifiable sender is never trusted,
      // even under "open" or "blocklist" (nothing to block on, nothing to attribute).
      if (!rawSender) {
        return { action: "skip", reason: "Channel event has no sender identity" };
      }
      const sender = channelSenderKey(event.metadata?.["platform"], rawSender);

      switch (config.policy) {
        case "open":
          return null;

        case "allowlist": {
          const allowed = config.allowedSenders ?? [];
          if (allowed.includes(sender)) return null;
          const action = config.unknownSenderAction ?? "skip";
          const reason = `Sender ${sender} not in allowlist`;
          return action === "escalate"
            ? { action: "escalate", reason, code: "unknown-sender" }
            : { action: "skip", reason, code: "unknown-sender" };
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
