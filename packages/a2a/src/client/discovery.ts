/**
 * Agent discovery — resolve AgentCard from a remote A2A-compliant agent.
 */
import { Effect } from "effect";
import { assertPublicUrl } from "@reactive-agents/runtime-shim";
import type { AgentCard } from "../types.js";
import { DiscoveryError } from "../errors.js";
import { agentStrictEgressEnabled } from "../flags.js";

export interface AgentEgressConfig {
  readonly strictEgress?: boolean;
}

// F15: A2A discovery peers are operator-configured; local peers (loopback /
// RFC-1918) are legitimate, so private targets are allowed by default while
// cloud-metadata / link-local is always blocked. RA_AGENT_STRICT_EGRESS=1, or
// config.strictEgress, also refuses private targets.
export const agentEgressGuard = (config?: AgentEgressConfig) => ({
  allowPrivate: !(config?.strictEgress ?? agentStrictEgressEnabled()),
});

export const discoverAgent = (
  baseUrl: string,
  config?: AgentEgressConfig,
): Effect.Effect<AgentCard, DiscoveryError> =>
  Effect.tryPromise({
    try: async () => {
      const guard = agentEgressGuard(config);
      // Try .well-known/agent.json first (A2A standard)
      const wellKnownUrl = `${baseUrl.replace(/\/$/, "")}/.well-known/agent.json`;
      await assertPublicUrl(wellKnownUrl, guard);
      let response = await fetch(wellKnownUrl);

      if (!response.ok) {
        // Fallback to /agent/card
        const fallbackUrl = `${baseUrl.replace(/\/$/, "")}/agent/card`;
        await assertPublicUrl(fallbackUrl, guard);
        response = await fetch(fallbackUrl);
      }

      if (!response.ok) {
        throw new Error(`Agent discovery failed: HTTP ${response.status}`);
      }

      return (await response.json()) as AgentCard;
    },
    catch: (e) => new DiscoveryError({ message: String(e), url: baseUrl }),
  });

export const discoverMultipleAgents = (
  urls: string[],
  config?: AgentEgressConfig,
): Effect.Effect<AgentCard[], DiscoveryError> =>
  Effect.all(
    urls.map((url) => discoverAgent(url, config)),
    { concurrency: 5 },
  );
