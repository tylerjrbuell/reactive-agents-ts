/**
 * Capability-source preflight gate (Sprint-2 measurement honesty).
 *
 * The bench refuses to score a cell whose model capability resolved from
 * `source === "fallback"`. Fallback means the canonical resolver found no
 * probe, no cache, and no static-table entry, and silently substituted a
 * conservative 2048-ctx default (see `core/contracts/capability.ts`
 * `fallbackCapability`). A score produced under a fallback capability is a
 * misconfigured-budget artifact, not a model result — it under-sizes every
 * downstream context budget. The 2026-06-02 cross-tier baseline's mid-tier
 * regression (claude-haiku-4-5) was exactly this class: an alias miss dropped
 * the model to fallback 2048 ctx, and the cell scored a number that looked
 * like a haiku result.
 *
 * This gate turns that silent degradation into a loud refusal, mirroring the
 * Rule-4 judge guard in `runner.ts:runSession`.
 *
 * Companion contract: `core/contracts/capability.ts` (the `CapabilitySource`
 * discriminator + the doc note "Bench + preflight refuse to score when
 * source === 'fallback'").
 */
import type { CapabilitySource } from "@reactive-agents/core";
import { resolveCanonical } from "@reactive-agents/llm-provider";

export interface PreFlightViolation {
  readonly kind: "capability-source-fallback";
  readonly provider: string;
  readonly model: string;
  readonly source: CapabilitySource;
  readonly message: string;
}

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
 * every model whose source is "fallback". Pure: no IO beyond the synchronous
 * static-table/fallback resolver path (no live probe).
 */
export function checkCapabilitySourcePreflight(
  models: ReadonlyArray<{ readonly provider: string; readonly model: string }>,
  opts: PreflightOptions = {},
): readonly PreFlightViolation[] {
  if (opts.allowFallback) return [];

  const violations: PreFlightViolation[] = [];
  for (const m of models) {
    const cap = resolveCanonical(m.provider, m.model);
    if (cap.source === "fallback") {
      violations.push({
        kind: "capability-source-fallback",
        provider: m.provider,
        model: m.model,
        source: cap.source,
        message:
          `Capability for ${m.provider}/${m.model} resolved from source="fallback" ` +
          `(no probe, no cache, no static-table entry). The bench refuses to score ` +
          `this cell: a fallback capability silently under-sizes every context budget ` +
          `(2048 ctx), so the score would be a misconfigured-budget artifact, not a ` +
          `model result. Fix: add ${m.model} to STATIC_CAPABILITIES in ` +
          `@reactive-agents/llm-provider, or run a live capability probe. ` +
          `Override with RA_BENCH_ALLOW_FALLBACK=1 only for intentional fallback probes.`,
      });
    }
  }
  return violations;
}

/**
 * Format a set of violations into a single throwable error message for the
 * `runSession` preflight gate.
 */
export function formatPreflightViolations(
  violations: readonly PreFlightViolation[],
): string {
  return (
    `Capability-source preflight failed: ${violations.length} model(s) resolved to ` +
    `source="fallback". Refusing to score (Sprint-2 measurement-honesty gate).\n` +
    violations.map((v) => `  • ${v.message}`).join("\n")
  );
}
