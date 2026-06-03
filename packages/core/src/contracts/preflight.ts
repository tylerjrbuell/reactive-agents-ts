/**
 * PreFlight — contract validation before a run is measured or committed.
 *
 * The canonical typed boundary from
 * `2026-06-02-canonical-contracts-and-invariants §2.5`: bugs should surface at
 * build time as structured violations, not mid-run as observable symptoms. Two
 * consumers share this contract so the decision lives in exactly one place:
 *
 *   - `agent.build()` (runtime) — a fallback capability is a build warning
 *     (error under strict validation); the user still RUNS but is not lied to.
 *   - bench `runInternal` (benchmarks) — a fallback capability makes the cell
 *     INCONCLUSIVE; the bench refuses to score a misconfigured-budget artifact.
 *
 * This module is the forward-value unification of the two ad-hoc gates shipped
 * 2026-06-02 (`benchmarks/src/preflight.ts` + `runtime/build-validation.ts`):
 * one type, one decision function, one message formatter.
 *
 * Layering: this lives in L1 `core` and depends on NOTHING above it. It defines
 * the TYPES + pure decision/format functions over an already-resolved
 * `Capability`. The act of RESOLVING a capability (which needs the L2
 * llm-provider resolver) stays at the consumer; the consumer feeds the resolved
 * facts into `capabilitySourcePreflight`.
 *
 * Anti-scaffold (North-Star §9): the violation union ships ONLY the variant
 * with a live emitter + consumer (`capability-source`). The spec's additional
 * planned variants — `capability-floor`, `tool-missing`, `task-contract`,
 * `deliverable-channel` — are deliberately NOT pre-listed here; each lands as a
 * union member in the same commit that wires its emitter, never before.
 */
import type { CapabilitySource } from "./capability.js";

/**
 * A structural reason a run cannot be honestly measured or committed.
 *
 * Discriminated on `kind`. Grows by adding a member WITH its emitter+consumer
 * (never a bare member). Today: one variant.
 */
export type PreFlightViolation = {
  readonly kind: "capability-source";
  readonly provider: string;
  readonly model: string;
  readonly source: CapabilitySource;
  readonly recommendedNumCtx: number;
  /** Actionable fix for the human. */
  readonly remedy: string;
  /** Full human-readable line (remedy embedded). */
  readonly message: string;
};

/** A non-blocking advisory. Same discriminator space as violations. */
export interface PreFlightWarning {
  readonly kind: PreFlightViolation["kind"];
  readonly message: string;
}

/** The report a preflight pass produces. Violations block; warnings inform. */
export interface PreFlightReport {
  readonly violations: readonly PreFlightViolation[];
  readonly warnings: readonly PreFlightWarning[];
}

/** The canonical empty report. */
export const emptyPreFlightReport: PreFlightReport = {
  violations: [],
  warnings: [],
};

/** Minimal resolved-capability facts the source preflight needs. */
export interface CapabilityFactsForPreflight {
  readonly provider: string;
  readonly model: string;
  readonly source: CapabilitySource;
  readonly recommendedNumCtx: number;
}

/**
 * THE single decision: a capability resolved from `source: "fallback"` (no
 * probe/cache/static-table entry) silently under-sizes every downstream context
 * budget, so any measurement under it is a misconfigured-budget artifact, not a
 * model result. Returns a violation in that case; `null` for any trusted source.
 *
 * Both `agent.build()` and the bench runner call this exact function.
 */
export function capabilitySourcePreflight(
  cap: CapabilityFactsForPreflight,
): PreFlightViolation | null {
  if (cap.source !== "fallback") return null;
  const remedy =
    `Add "${cap.model}" to STATIC_CAPABILITIES in @reactive-agents/llm-provider, ` +
    `or enable a live capability probe.`;
  return {
    kind: "capability-source",
    provider: cap.provider,
    model: cap.model,
    source: cap.source,
    recommendedNumCtx: cap.recommendedNumCtx,
    remedy,
    message:
      `Capability for ${cap.provider}/${cap.model} resolved from source="fallback" ` +
      `(no probe/cache/static-table entry) — running at a conservative ` +
      `${cap.recommendedNumCtx}-token context window, which silently under-sizes ` +
      `every context budget. ${remedy}`,
  };
}

/** Render a set of violations as one human-readable block. */
export function formatViolations(violations: readonly PreFlightViolation[]): string {
  return violations.map((v) => `  • ${v.message}`).join("\n");
}
