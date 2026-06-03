/**
 * Capability-source preflight gate (Sprint-2 measurement honesty) — bench consumer.
 *
 * The bench refuses to score a cell whose model capability resolved from
 * `source === "fallback"`. Fallback means the canonical resolver found no
 * probe, no cache, and no static-table entry, and silently substituted a
 * conservative 2048-ctx default. A score produced under a fallback capability
 * is a misconfigured-budget artifact, not a model result — it under-sizes every
 * downstream context budget. The 2026-06-02 cross-tier baseline's mid-tier
 * regression (claude-haiku-4-5) was exactly this class.
 *
 * This module is the BENCH CONSUMER of the canonical PreFlight contract
 * (`@reactive-agents/core` `contracts/preflight.ts`). It resolves the canonical
 * Capability per model (the L2 resolver call) and feeds the facts into the
 * shared `capabilitySourcePreflight` decision — so "fallback = violation" lives
 * in exactly one place, shared with the runtime `agent.build()` gate.
 */
import {
  capabilitySourcePreflight,
  type PreFlightViolation,
} from "@reactive-agents/core";
import { resolveCanonical } from "@reactive-agents/llm-provider";

export type { PreFlightViolation } from "@reactive-agents/core";

export interface PreflightOptions {
  /**
   * Explicit opt-out. When true, fallback-source models are allowed and no
   * violations are emitted. Wired to `RA_BENCH_ALLOW_FALLBACK=1` at the
   * `runSession` call site. Use only for intentional fallback-behavior probes.
   */
  readonly allowFallback?: boolean;
}

/**
 * Resolve the canonical Capability for each model and collect a violation for
 * every model whose source is "fallback". Pure beyond the synchronous
 * static-table/fallback resolver path (no live probe). Delegates the
 * fallback decision to the shared core contract.
 */
export function checkCapabilitySourcePreflight(
  models: ReadonlyArray<{ readonly provider: string; readonly model: string }>,
  opts: PreflightOptions = {},
): readonly PreFlightViolation[] {
  if (opts.allowFallback) return [];

  const violations: PreFlightViolation[] = [];
  for (const m of models) {
    const cap = resolveCanonical(m.provider, m.model);
    const v = capabilitySourcePreflight({
      provider: m.provider,
      model: m.model,
      source: cap.source,
      recommendedNumCtx: cap.recommendedNumCtx,
    });
    if (v) violations.push(v);
  }
  return violations;
}
