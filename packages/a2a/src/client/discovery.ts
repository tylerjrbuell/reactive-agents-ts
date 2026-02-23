/**
 * Agent discovery — resolve AgentCard from a remote A2A-compliant agent.
 */
import { Effect } from "effect";
import type { AgentCard } from "../types.js";
import { DiscoveryError } from "../errors.js";

export const discoverAgent = (baseUrl: string): Effect.Effect<AgentCard, DiscoveryError> =>
  Effect.tryPromise({
    try: async () => {
      // Try .well-known/agent.json first (A2A standard)
      const wellKnownUrl = `${baseUrl.replace(/\/$/, "")}/.well-known/agent.json`;
      let response = await fetch(wellKnownUrl);

      if (!response.ok) {
        // Fallback to /agent/card
        const fallbackUrl = `${baseUrl.replace(/\/$/, "")}/agent/card`;
        response = await fetch(fallbackUrl);
      }

      if (!response.ok) {
        throw new Error(`Agent discovery failed: HTTP ${response.status}`);
      }

      return (await response.json()) as AgentCard;
    },
    catch: (e) => new DiscoveryError({ message: String(e), url: baseUrl }),
  });

export const discoverMultipleAgents = (urls: string[]): Effect.Effect<AgentCard[], DiscoveryError> =>
  Effect.all(urls.map(discoverAgent), { concurrency: 5 });
