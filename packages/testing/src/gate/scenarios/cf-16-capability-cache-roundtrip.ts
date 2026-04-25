// packages/testing/src/gate/scenarios/cf-16-capability-cache-roundtrip.ts
//
// Targeted weakness: G-1 / Capability port resolver-cache contract.
// Closing commit: 0601ba8c (Phase 1 S1.3) — resolver consults cache before
// static table. The SQLite-backed CalibrationStore satisfies this contract
// structurally; covered separately by capability-persistence.test.ts in
// reactive-intelligence. This scenario pins the *contract* itself: any
// CapabilityCache implementation that returns a value from loadCapability
// wins over the static table.
//
// Regression triggered when: resolveCapability stops checking the cache
// before the static table, OR the CapabilityCache interface drifts in a
// way that would break structural compatibility.
//
// Hand-rolled in-memory cache (Map-backed) used here so the testing
// package does NOT need a dep on reactive-intelligence. Real CalibrationStore
// satisfies the same interface — the structural contract is what's pinned.

import {
  resolveCapability,
  type Capability,
  type CapabilityCache,
} from "@reactive-agents/llm-provider";
import type { ScenarioModule } from "../types.js";

function makeMemoryCache(): CapabilityCache {
  const m = new Map<string, Capability>();
  return {
    loadCapability: (provider, model) => m.get(`${provider}/${model}`) ?? null,
    saveCapability: (cap) => {
      m.set(`${cap.provider}/${cap.model}`, cap);
    },
  };
}

export const scenario: ScenarioModule = {
  id: "cf-16-capability-cache-roundtrip",
  targetedWeakness: "G-1",
  closingCommit: "0601ba8c",
  description:
    "Confirms the CapabilityCache contract: resolveCapability checks the cache before the static table, returning a probed value when present even when the static table also has an entry. This is what lets builders cache probed capabilities across runs without re-probing. Pins the structural contract — any cache implementation matching the interface (CalibrationStore included) gets the same treatment.",
  config: {
    name: "cf-16-capability-cache-roundtrip",
    task: "ok",
    testTurns: [{ text: "ok" }],
    maxIterations: 2,
  },
  customAssertions: () => {
    const cache = makeMemoryCache();

    const probedCap: Capability = {
      provider: "ollama",
      model: "cogito:14b",
      tier: "local",
      maxContextTokens: 32_768,
      recommendedNumCtx: 16_384, // intentionally != static table's 8192
      maxOutputTokens: 4096,
      tokenizerFamily: "llama",
      supportsPromptCaching: false,
      supportsVision: false,
      supportsThinkingMode: false,
      supportsStreamingToolCalls: true,
      toolCallDialect: "native-fc",
      source: "probe",
    };

    cache.saveCapability(probedCap);

    const fromCache = resolveCapability("ollama", "cogito:14b", { cache });
    const fromStaticTable = resolveCapability("ollama", "cogito:14b"); // no cache

    return {
      "cache.recommendedNumCtx": fromCache.recommendedNumCtx,
      "cache.source": fromCache.source,
      "noCache.recommendedNumCtx": fromStaticTable.recommendedNumCtx,
      "noCache.source": fromStaticTable.source,
    };
  },
};
