/**
 * Capability — single source of model truth, source-tagged.
 *
 * Today (pre-Sprint-1-B3): six entry points to capability resolution
 * (`CONTEXT_PROFILES`, `STATIC_CAPABILITIES`, two `resolveCapability`
 * functions in two packages, `applyCapabilityMaxTokens`, `tierFromModelName`)
 * drift independently. Phase-A 2026-06-02 surfaced two instances of the
 * silent-fallback class: qwen3.5:latest and claude-haiku-4-5 both fell to
 * the conservative `recommendedNumCtx=2048` because their alias forms missed
 * the static-table key, and downstream assembly under-sized its budgets.
 *
 * This contract collapses the resolver surface. One `Capability` shape,
 * one `CapabilityResolver` interface, one `source` discriminator exposing
 * provenance. Existing entry points become re-export shims in Sprint-1 B3
 * Phase α (this commit lands the type only; the consolidation migration
 * happens incrementally without behavior change).
 *
 * Companion spec: [[2026-06-02-canonical-contracts-and-invariants]] §2.2.
 * Third contract in the Sprint-1 typed-contract foundation (north-star §6.5).
 */

/**
 * Source of the capability information. The trust signal: probe is highest,
 * fallback is lowest. Bench + preflight refuse to score / fail-build when
 * source === "fallback" unless explicit override.
 */
export type CapabilitySource =
  | "probe"
  | "cache"
  | "static-table"
  | "fallback";

export type Tier = "local" | "mid" | "large" | "frontier";

export interface CapabilitySupports {
  readonly thinking: boolean;
  readonly streamingToolCalls: boolean;
  readonly promptCaching: boolean;
  readonly vision: boolean;
}

/**
 * The canonical capability shape. ALL budgets downstream derive from this.
 *
 *  - `effectiveWindowChars` — ~65% of the model's claimed window per Chroma
 *    Context Rot + NVIDIA RULER. Budgets are %-of-effective, not %-of-claimed.
 *  - `recommendedNumCtx` — what to set provider `num_ctx`/`max_tokens` to.
 *  - `toolResultPreserveBudget` — per-result preservation cap (tier-aware).
 *    Mirrors the legacy `CONTEXT_PROFILES.toolResultMaxChars` table.
 *  - `source` — provenance. The bench preflight refuses to score cells when
 *    `source === "fallback"` (capability-source-fallback PreFlightViolation).
 */
export interface Capability {
  readonly provider: string;
  readonly model: string;
  readonly effectiveWindowChars: number;
  readonly recommendedNumCtx: number;
  readonly tier: Tier;
  readonly dialect: "native-fc" | "text-parse" | "none";
  readonly toolResultPreserveBudget: number;
  readonly maxOutputTokens: number;
  readonly supports: CapabilitySupports;
  readonly source: CapabilitySource;
}

/**
 * Minimal cache contract. A `CalibrationStore` from
 * `@reactive-agents/reactive-intelligence` satisfies this structurally — no
 * circular dependency between core and RI.
 */
export interface CapabilityCache {
  readonly get: (provider: string, model: string) => Capability | undefined;
  readonly put: (cap: Capability) => void;
}

/**
 * Live model probe. Probe-on-first-use implementation lives in the provider
 * package (`local-probe.ts` for ollama). When configured, the resolver tries
 * probe → cache → static-table → fallback, in order.
 */
export interface CapabilityProbe {
  readonly probe: (
    provider: string,
    model: string,
  ) => Promise<Capability | undefined>;
}

export interface CapabilityResolveOptions {
  readonly cache?: CapabilityCache;
  readonly probe?: CapabilityProbe;
  /**
   * Called when the resolver hits the fallback path (no probe, no cache,
   * no static-table entry). Sprint-2 PreFlight uses this to turn fallbacks
   * into structured violations rather than silent degradations.
   */
  readonly onFallback?: (provider: string, model: string) => void;
}

/**
 * The contract every capability resolver must satisfy. Sprint-1 B3 will
 * land the canonical implementation; until then existing resolvers become
 * adapters returning the same `Capability` shape.
 */
export interface CapabilityResolver {
  resolve(
    provider: string,
    model: string,
    opts?: CapabilityResolveOptions,
  ): Capability;
}

/**
 * Tier-aware default per-result preservation budget (chars). Mirrors the
 * legacy `CONTEXT_PROFILES[tier].toolResultMaxChars` empirical table.
 * Exposed for callers building capabilities from probe/cache data.
 */
export const TIER_TOOL_RESULT_PRESERVE: Record<Tier, number> = {
  local: 4000,
  mid: 1200,
  large: 800,
  frontier: 600,
};

/**
 * Conservative fallback Capability. Mirrors today's silent-fallback behavior
 * but exposes `source: "fallback"` so it's loud, not silent.
 */
export function fallbackCapability(
  provider: string,
  model: string,
): Capability {
  return {
    provider,
    model,
    effectiveWindowChars: 2048 * 4, // ~8K chars worth of context
    recommendedNumCtx: 2048,
    tier: "mid",
    dialect: "none",
    toolResultPreserveBudget: TIER_TOOL_RESULT_PRESERVE.mid,
    maxOutputTokens: 1024,
    supports: {
      thinking: false,
      streamingToolCalls: false,
      promptCaching: false,
      vision: false,
    },
    source: "fallback",
  };
}

/**
 * Compute the effective context window in chars given a claimed-window
 * token count. ~65% of claimed × 4 chars/token. Used by future probe/
 * static-table consumers building Capability values.
 *
 * Source: Chroma `Context Rot` + NVIDIA `RULER` (both 2024-Q4). Models
 * consistently degrade beyond ~65% of claimed window in long-context
 * benchmarks; budgets derived from this stay honest.
 */
export function effectiveWindowFromClaimedTokens(claimedTokens: number): number {
  return Math.floor(claimedTokens * 0.65 * 4);
}
