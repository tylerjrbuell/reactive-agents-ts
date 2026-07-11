// File: src/kernel/state/completion-envelope.ts
//
// CompletionEnvelope — the signal-boundary primitive (north-star spec 2026-07-11
// §1b, task #40). ONE typed record that MUST cross every strategy/sub-kernel
// boundary, so completion honesty cannot die inside a sub-run.
//
// THE DISEASE. `ReactKernelResult` carried output/steps/tokens but dropped
// `meta.harnessAuthoredOutput` / `budgetTerminalPartial` / `verificationWarning`.
// Consequence: H5 honest completion (resolveCompletionStatus +
// honestPartialMetadata) reached only strategies whose terminal is a raw
// KernelState (reactive, direct, tree-of-thought, adaptive by inheritance).
// plan-execute, reflexion, blueprint and code-action derive completion from a
// DIFFERENT authority — quality gate, critique verdict, worker success, code
// exec — all of which judge OUTPUT PRESENCE. A sub-kernel that shipped a
// harness-authored or budget-terminal partial rode out of those strategies as
// `completed`, and `success === true` downstream.
//
// THE LAW (spec §1). Any boundary that cannot produce an honest envelope must
// degrade `completionStatus` to `partial` — never silently upgrade. A strategy's
// own authority may DOWNGRADE past the envelope (completed → partial/failed);
// it may never UPGRADE past it.
//
// THE JOIN RULE (single home — do not re-derive per strategy). When a strategy
// runs MULTIPLE sub-runs (plan-execute steps, blueprint workers, reflexion
// generate+improve passes), the aggregate envelope is the WORST-OF its
// contributing members: any partial / abstained / failed member degrades the
// aggregate; unverified-ship markers OR together; warnings and outstanding
// criteria union. "Contributing" means the member's output was accepted into
// the strategy's deliverable or its evidence — a failed attempt that was fully
// replaced by a later successful retry does not join (the retry does).

import type { KernelState } from "./kernel-state.js";
import {
  honestPartialMetadata,
  resolveCompletionStatus,
} from "./completion-status.js";

// ─── Type ────────────────────────────────────────────────────────────────────

/** Model's honest decline — mirrors `KernelState["meta"]["abstention"]`. */
export type EnvelopeAbstention = {
  readonly reason: string;
  readonly missing: readonly string[];
};

/**
 * The completion authority's verdict for one (sub-)run, in the shape that must
 * cross every strategy boundary. Optional fields are OMITTED (never `undefined`)
 * on clean runs so spread-based consumers stay unpolluted.
 */
export interface CompletionEnvelope {
  /** What the run's terminal evidence supports claiming. */
  readonly completionStatus: "completed" | "partial" | "abstained" | "failed";
  /** The harness synthesized the deliverable — the model never authored it. */
  readonly harnessAuthoredOutput?: boolean;
  /** Terminated by budget, not by evidence (requirements still outstanding). */
  readonly budgetTerminalPartial?: boolean;
  /** Advisory warning naming what stayed unmet (matches `meta.verificationWarning`). */
  readonly verificationWarning?: string;
  /** Present when the run honestly abstained (O3). */
  readonly abstention?: EnvelopeAbstention;
  /** Contract requirements still unmet at terminal (outstanding + blocked ids). */
  readonly outstandingCriteria?: readonly string[];
  /** Requirement ids the contract's evidence ledger marked satisfied. */
  readonly evidenceRefs?: readonly string[];
}

// ─── Derivation from a terminal KernelState ──────────────────────────────────

/**
 * Derive the envelope from a terminal kernel state. Wraps the H5 authorities —
 * `resolveCompletionStatus` (status law) and the meta honesty markers — rather
 * than forking their logic. `abstained` is layered on top: an abstention meta
 * (O3) refines a non-failed terminal into the honest-decline status.
 */
export function envelopeFromKernelState(state: KernelState): CompletionEnvelope {
  const base = resolveCompletionStatus(state);
  const completionStatus: CompletionEnvelope["completionStatus"] =
    base !== "failed" && state.meta.abstention !== undefined ? "abstained" : base;

  const requirements = state.meta.assessment?.requirements;
  const outstanding = requirements
    ? [...requirements.outstanding, ...requirements.blocked]
    : [];

  return {
    completionStatus,
    ...(state.meta.harnessAuthoredOutput === true
      ? { harnessAuthoredOutput: true }
      : {}),
    ...(state.meta.budgetTerminalPartial === true
      ? { budgetTerminalPartial: true }
      : {}),
    ...(state.meta.verificationWarning !== undefined
      ? { verificationWarning: state.meta.verificationWarning }
      : {}),
    ...(state.meta.abstention !== undefined
      ? { abstention: state.meta.abstention }
      : {}),
    ...(outstanding.length > 0 ? { outstandingCriteria: outstanding } : {}),
    ...(requirements && requirements.satisfied.length > 0
      ? { evidenceRefs: requirements.satisfied }
      : {}),
  };
}

// ─── Worst-of join (THE aggregate rule — single home) ────────────────────────

/** Severity order for the worst-of join. Higher = worse. */
const SEVERITY: Record<CompletionEnvelope["completionStatus"], number> = {
  completed: 0,
  partial: 1,
  abstained: 2,
  failed: 3,
};

/**
 * Join the envelopes of a strategy's CONTRIBUTING sub-runs into the aggregate
 * envelope (worst-of — see module header for the rule and the definition of
 * "contributing"). Empty input joins to a clean `completed` envelope: with no
 * sub-run evidence to the contrary, the caller's own authority governs alone.
 */
export function joinEnvelopes(
  members: readonly CompletionEnvelope[],
): CompletionEnvelope {
  let completionStatus: CompletionEnvelope["completionStatus"] = "completed";
  let harnessAuthoredOutput = false;
  let budgetTerminalPartial = false;
  const warnings: string[] = [];
  let abstention: EnvelopeAbstention | undefined;
  const outstanding: string[] = [];
  const evidence: string[] = [];

  for (const m of members) {
    if (SEVERITY[m.completionStatus] > SEVERITY[completionStatus]) {
      completionStatus = m.completionStatus;
    }
    if (m.harnessAuthoredOutput === true) harnessAuthoredOutput = true;
    if (m.budgetTerminalPartial === true) budgetTerminalPartial = true;
    if (m.verificationWarning !== undefined && !warnings.includes(m.verificationWarning)) {
      warnings.push(m.verificationWarning);
    }
    if (abstention === undefined && m.abstention !== undefined) {
      abstention = m.abstention;
    }
    for (const c of m.outstandingCriteria ?? []) {
      if (!outstanding.includes(c)) outstanding.push(c);
    }
    for (const e of m.evidenceRefs ?? []) {
      if (!evidence.includes(e)) evidence.push(e);
    }
  }

  // Unverified-ship markers force the aggregate below `completed` even when
  // every member's own status survived (mirror of `shippedUnverified`).
  if (
    completionStatus === "completed" &&
    (harnessAuthoredOutput || budgetTerminalPartial)
  ) {
    completionStatus = "partial";
  }

  return {
    completionStatus,
    ...(harnessAuthoredOutput ? { harnessAuthoredOutput: true } : {}),
    ...(budgetTerminalPartial ? { budgetTerminalPartial: true } : {}),
    ...(warnings.length > 0 ? { verificationWarning: warnings.join(" | ") } : {}),
    ...(abstention !== undefined ? { abstention } : {}),
    ...(outstanding.length > 0 ? { outstandingCriteria: outstanding } : {}),
    ...(evidence.length > 0 ? { evidenceRefs: evidence } : {}),
  };
}

// ─── Result-boundary cap ─────────────────────────────────────────────────────

/**
 * Join a strategy's OWN completion authority with the (aggregate) sub-run
 * envelope, in the `ReasoningResult.status` domain:
 *
 *   - own `failed` is absorbing — the envelope never upgrades a failure;
 *   - a `completed` envelope defers entirely to the strategy's own authority
 *     (which may still downgrade);
 *   - any non-completed envelope (partial / abstained / failed) CAPS the result
 *     at `partial`. `abstained`/`failed` map to `partial` rather than `failed`
 *     here because the strategy's own authority accepted a real deliverable —
 *     the envelope's job is to stop the OVER-claim ("completed"), not to
 *     discard shipped work; the markers carried via
 *     {@link honestEnvelopeMetadata} preserve the exact provenance.
 */
export function capStatusToEnvelope(
  own: "completed" | "partial" | "failed",
  envelope: CompletionEnvelope,
): "completed" | "partial" | "failed" {
  if (own === "failed") return "failed";
  if (envelope.completionStatus === "completed") return own;
  return "partial";
}

/**
 * The envelope honesty fields that must cross into a strategy result's
 * `extraMetadata` — the envelope-sourced twin of `honestPartialMetadata`
 * (which reads a raw KernelState meta). Empty for a clean envelope, so the
 * default result shape is unchanged.
 */
export function honestEnvelopeMetadata(
  envelope: CompletionEnvelope,
): Record<string, unknown> {
  return {
    ...(envelope.verificationWarning !== undefined
      ? { verificationWarning: envelope.verificationWarning }
      : {}),
    ...(envelope.harnessAuthoredOutput === true
      ? { harnessAuthoredOutput: true }
      : {}),
    ...(envelope.budgetTerminalPartial === true
      ? { budgetTerminalPartial: true }
      : {}),
    ...(envelope.abstention !== undefined
      ? { abstention: envelope.abstention }
      : {}),
    ...(envelope.outstandingCriteria !== undefined
      ? { outstandingCriteria: envelope.outstandingCriteria }
      : {}),
  };
}

// Re-exported so envelope consumers see the whole H5 surface from one import.
export { honestPartialMetadata, resolveCompletionStatus };
