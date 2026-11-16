/**
 * Agent discovery — resolve AgentCard from a remote A2A-compliant agent.
 */
import { Effect } from "effect";
import { fetchPinned } from "@reactive-agents/runtime-shim";
import type { AgentCard } from "../types.js";
import { DiscoveryError } from "../errors.js";
import { agentStrictEgressEnabled } from "../flags.js";

export interface AgentEgressConfig {
  readonly strictEgress?: boolean;
  /** Per-fetch time budget in ms for agent-card discovery (connect + headers + body). Default 10000. */
  readonly timeoutMs?: number;
}

export const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000;

// F15: A2A discovery peers are operator-configured; local peers (loopback /
// RFC-1918) are legitimate, so private targets are allowed by default while
// cloud-metadata / link-local is always blocked. RA_AGENT_STRICT_EGRESS=1, or
// config.strictEgress, also refuses private targets.
export const agentEgressGuard = (config?: AgentEgressConfig) => ({
  allowPrivate: !(config?.strictEgress ?? agentStrictEgressEnabled()),
});

/**
 * GET a JSON agent card through the SSRF-safe pinned fetch (DNS validated once and pinned),
 * bounded by a deadline. Redirects are refused, never followed. Returns the HTTP status and,
 * on 2xx, the parsed body.
 */
export const fetchCardJson = async (
  url: string,
  config?: AgentEgressConfig,
): Promise<{ readonly ok: boolean; readonly status: number; readonly card?: AgentCard }> => {
  const timeoutMs = config?.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Raced: the transport may not honour abort before headers arrive.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DiscoveryError({ message: `agent card fetch timed out after ${timeoutMs}ms`, url }));
    }, timeoutMs);
  });
  const work = async (): Promise<{ ok: boolean; status: number; card?: AgentCard }> => {
    const response = await fetchPinned(
      url,
      { method: "GET", signal: controller.signal },
      { allowPrivate: agentEgressGuard(config).allowPrivate, redirect: "manual" },
    );
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new DiscoveryError({ message: `redirect refused (HTTP ${response.status})`, url });
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel();
      return { ok: false, status: response.status };
    }
    return { ok: true, status: response.status, card: (await response.json()) as AgentCard };
  };
  const pending = work();
  pending.catch(() => undefined); // the race loser must not surface as unhandled
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

export const discoverAgent = (
  baseUrl: string,
  config?: AgentEgressConfig,
): Effect.Effect<AgentCard, DiscoveryError> =>
  Effect.tryPromise({
    try: async () => {
      // Try .well-known/agent.json first (A2A standard), then fall back to /agent/card
      const base = baseUrl.replace(/\/$/, "");
      let result = await fetchCardJson(`${base}/.well-known/agent.json`, config);
      if (!result.ok) result = await fetchCardJson(`${base}/agent/card`, config);
      if (!result.ok || !result.card) {
        throw new DiscoveryError({ message: `Agent discovery failed: HTTP ${result.status}`, url: baseUrl });
      }
      return result.card;
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
