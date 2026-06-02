/**
 * Canonical capability resolver — Sprint-1 B3β.
 *
 * Adapter that wraps the existing `resolveCapability(provider, model, opts)`
 * (capability-resolver.ts) and returns a `Capability` value matching the
 * canonical shape defined in `@reactive-agents/core/contracts/capability`.
 *
 * This is the SINGLE function consumers should call when they need model
 * capability information. Today the six pre-existing entry points still
 * work — this adapter is the strangler-fig forward path. Sprint-1 final
 * deletion (or Sprint-3 mechanism completion) will collapse the old
 * entry points into re-export shims pointing here.
 *
 * Spec: [[2026-06-02-canonical-contracts-and-invariants]] §2.2.
 */
import {
  type ContractCapability,
  type CapabilityResolveOptions,
  type CapabilityCache,
  TIER_TOOL_RESULT_PRESERVE,
  effectiveWindowFromClaimedTokens,
} from "@reactive-agents/core";
import {
  resolveCapability as resolveProviderCapability,
  warnCapabilityFallback,
} from "./capability-resolver.js";
import type { Capability as ProviderCapability } from "./capability.js";

/**
 * Translate the provider-layer `Capability` shape to the canonical contract.
 *
 *  - `effectiveWindowChars` derives from `maxContextTokens` via the ~65%×4
 *    formula (Chroma Context Rot + NVIDIA RULER).
 *  - `toolResultPreserveBudget` is the tier-aware empirical table the
 *    legacy `CONTEXT_PROFILES.toolResultMaxChars` enforces.
 *  - `supports` collapses the 4 boolean fields into the contract sub-struct.
 *  - `source` passes through unchanged; fallback paths remain LOUD.
 */
function toCanonical(c: ProviderCapability): ContractCapability {
  return {
    provider: c.provider,
    model: c.model,
    effectiveWindowChars: effectiveWindowFromClaimedTokens(c.maxContextTokens),
    recommendedNumCtx: c.recommendedNumCtx,
    tier: c.tier,
    dialect: c.toolCallDialect,
    toolResultPreserveBudget: TIER_TOOL_RESULT_PRESERVE[c.tier],
    maxOutputTokens: c.maxOutputTokens,
    supports: {
      thinking: c.supportsThinkingMode,
      streamingToolCalls: c.supportsStreamingToolCalls,
      promptCaching: c.supportsPromptCaching,
      vision: c.supportsVision,
    },
    source: c.source,
  };
}

/**
 * Adapter from the canonical {@link CapabilityCache} contract to the
 * llm-provider-layer `CapabilityCache` (different `loadCapability` /
 * `saveCapability` method names). Allows callers to pass a CalibrationStore
 * or any canonical-cache without reshape.
 */
function adaptCache(cache: CapabilityCache | undefined) {
  if (!cache) return undefined;
  return {
    loadCapability: (provider: string, model: string) => {
      const c = cache.get(provider, model);
      if (!c) return null;
      // Round-trip the canonical shape back to provider shape for the
      // existing resolver tier-1 path.
      return {
        provider: c.provider,
        model: c.model,
        tier: c.tier,
        maxContextTokens: Math.floor(c.effectiveWindowChars / 4 / 0.65),
        recommendedNumCtx: c.recommendedNumCtx,
        maxOutputTokens: c.maxOutputTokens,
        tokenizerFamily: "unknown" as const,
        supportsPromptCaching: c.supports.promptCaching,
        supportsVision: c.supports.vision,
        supportsThinkingMode: c.supports.thinking,
        supportsStreamingToolCalls: c.supports.streamingToolCalls,
        toolCallDialect: c.dialect,
        source: c.source === "cache" ? "probe" : c.source,
      };
    },
    saveCapability: (_cap: ProviderCapability) => {
      /* canonical cache writes happen at the resolveCanonical seam */
    },
  };
}

/**
 * Resolve a Capability for (provider, model).
 *
 * Resolution order:
 *  1. `opts.cache` (probed previously)         → `source: "cache"`
 *  2. (Sprint-2) live probe via `opts.probe`   → `source: "probe"`
 *  3. STATIC_CAPABILITIES table                → `source: "static-table"`
 *  4. Conservative fallback                    → `source: "fallback"` (LOUD)
 *
 * When `source === "fallback"`, `opts.onFallback` fires for telemetry —
 * Sprint-2 PreFlight gates measurement on this signal.
 */
export function resolveCanonical(
  provider: string,
  model: string,
  opts: CapabilityResolveOptions = {},
): ContractCapability {
  const providerCap = resolveProviderCapability(provider, model, {
    cache: adaptCache(opts.cache),
    onProbeFailed: opts.onFallback
      ? (args) => opts.onFallback?.(args.provider, args.model)
      : undefined,
  });
  return toCanonical(providerCap);
}

export { warnCapabilityFallback };
