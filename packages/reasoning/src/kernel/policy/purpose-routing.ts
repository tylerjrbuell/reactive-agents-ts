// File: src/kernel/policy/purpose-routing.ts
//
// Purpose→tier model routing (meta-loop Phase 6 / task G2). The unwired seam of
// audit 05-#5: "gathering should run on a cheap/local model and synthesis on a
// strong one, but the routing seam is unwired".
//
// This module is the DETERMINISTIC purpose→tier mapping plus the two-model pool
// the LLM gateway consumes. It carries NO policy of its own beyond the mapping:
// WHICH tier a purpose belongs to (here) is separate from WHICH model each tier
// resolves to (the pool, resolved by the runtime from the existing
// `.withModelRouting()` cost-route machinery — not reinvented here).
//
// DAG law (binding): the gateway READS this mapping + the resolved pool that
// rides the ambient `CurrentModelRouting` FiberRef (set once at the
// reasoning-service boundary, gated on the adaptive plan). It never recomputes
// the pool and never mutates the ledger.

import type { ModelConfig } from "@reactive-agents/llm-provider";
import type { LlmPurpose } from "../llm-gateway.js";

/**
 * The two routing tiers G2 distinguishes. Deliberately coarse (cheap vs strong)
 * — the purpose→tier mapping is deterministic and the pool supplies only these
 * two concrete models. A finer ladder is a later-wave concern.
 */
export type RoutingTier = "cheap" | "strong";

/**
 * The resolved per-run model pool. `strong` is the run's configured model (what
 * runs today); `cheap` is the cheapest CAPABLE model for the provider, resolved
 * by the runtime via the existing cost-route capability rail. A bare string is a
 * model-name routing override; a `ModelConfig` pins provider+model.
 */
export interface ModelRoutingPool {
  readonly cheap: ModelConfig | string;
  readonly strong: ModelConfig | string;
}

/**
 * Purposes that run on the CHEAP tier — the "gathering" auxiliary calls: small
 * routing/labelling decisions (`classify`) and structured extraction from text
 * / observation summarisation (`extract`). Everything else — `think` (main-loop
 * reasoning), `plan`, `synthesize`, `verify` — is deliverable-shaping work that
 * stays on the STRONG tier.
 */
const CHEAP_PURPOSES: ReadonlySet<LlmPurpose> = new Set<LlmPurpose>([
  "classify",
  "extract",
]);

/** Deterministic purpose→tier mapping. Pure; same purpose → same tier. */
export function mapPurposeToTier(purpose: LlmPurpose): RoutingTier {
  return CHEAP_PURPOSES.has(purpose) ? "cheap" : "strong";
}

/** Pick the pool model for a purpose via {@link mapPurposeToTier}. */
export function resolveRoutedModel(
  pool: ModelRoutingPool,
  purpose: LlmPurpose,
): ModelConfig | string {
  return mapPurposeToTier(purpose) === "cheap" ? pool.cheap : pool.strong;
}
