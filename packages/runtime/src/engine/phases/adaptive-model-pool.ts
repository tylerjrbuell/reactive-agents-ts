/**
 * Adaptive purpose→tier model pool resolution (meta-loop Phase 6 / task G2).
 *
 * The unwired seam of audit 05-#5: gathering purposes should run on a cheap/local
 * model and synthesis on the strong one. G2 chooses WHICH tier per request (in
 * the reasoning gateway); THIS module resolves WHICH concrete models the two
 * tiers map to for a run — reusing the exact `@reactive-agents/cost` capability
 * rail that `.withModelRouting()` / cost-route already use (not reinvented).
 *
 * Three-way gate (all required, else `undefined` → no routing, byte-identical):
 *   (a) the run is adaptive (`.withAdaptiveHarness()`),
 *   (b) a multi-model pool is configured (`.withModelRouting()`),
 *   (c) the provider is routable (has a tier table in cost's PROVIDER_CONFIGS).
 *
 * `strong` is the run's configured model (what runs today); `cheap` is the
 * cheapest CAPABLE model for the provider (window-gated by `selectCapableModel`,
 * honouring any per-tier overrides). When the cheapest capable model IS the
 * configured model, there is nothing to route → returns `undefined` so the run
 * stays byte-identical.
 */
import {
  selectCapableModel,
  TIER_ORDER,
  isRoutableProvider,
} from "@reactive-agents/cost";
import type { ModelTier } from "@reactive-agents/cost";
import type { ModelRoutingPool } from "@reactive-agents/reasoning";

export interface AdaptiveModelPoolInputs {
  /** True when `.withAdaptiveHarness()` is on. */
  readonly adaptiveHarness: boolean | undefined;
  /** The `.withModelRouting()` config (tier overrides). Absent → gate (b) fails. */
  readonly modelRouting:
    | {
        readonly tierModels?: Partial<Record<"haiku" | "sonnet" | "opus", string>>;
        readonly minTier?: "haiku" | "sonnet" | "opus";
      }
    | undefined;
  /** The configured provider name (e.g. "anthropic"). */
  readonly provider: string | undefined;
  /** The run's configured model — the STRONG tier. */
  readonly strongModel: string;
  /** Estimated prompt tokens for the window check (same heuristic as cost-route). */
  readonly estimatedPromptTokens: number;
}

/**
 * Resolve the per-run cheap/strong model pool, or `undefined` when routing must
 * not activate (any gate fails, or there is no cheaper capable model).
 */
export function resolveAdaptiveModelPool(
  inputs: AdaptiveModelPoolInputs,
): ModelRoutingPool | undefined {
  // Gate (a): adaptive.
  if (inputs.adaptiveHarness !== true) return undefined;
  // Gate (b): a configured multi-model pool.
  if (inputs.modelRouting === undefined) return undefined;
  // Gate (c): a routable provider (narrows `provider` to Provider).
  if (!isRoutableProvider(inputs.provider)) return undefined;
  const provider = inputs.provider;

  const cheapestTier = TIER_ORDER[0] as ModelTier;
  const cheap = selectCapableModel(
    provider,
    cheapestTier,
    inputs.estimatedPromptTokens,
    inputs.modelRouting.tierModels,
  );

  // Nothing cheaper to route to → keep the run byte-identical.
  if (cheap === inputs.strongModel) return undefined;

  return { cheap, strong: inputs.strongModel };
}
