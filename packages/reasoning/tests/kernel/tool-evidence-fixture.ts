/**
 * Test fixture: the tool evidence a run holds for a set of steps.
 *
 * A live KernelState gets `evidence` from `transitionState` (steps -> ledger
 * projection -> fold). Hand-built fixtures (ArbitrationContext literals, states
 * spread with `steps`) skip that chokepoint, so they derive it with the same
 * fold (`evidenceOfSteps`) instead of inventing a second definition of a
 * successful call.
 */
import type { ReasoningStep } from "../../src/types/index.js";
import type { ToolEvidence } from "../../src/kernel/capabilities/verify/requirement-state.js";
import { evidenceOfSteps } from "../../src/kernel/ledger/step-projection.js";

/** The evidence `transitionState` derives for these steps. */
export function evidenceOf(steps: readonly ReasoningStep[]): ToolEvidence {
  // Some fixtures hand-build partial steps without `content`; content never
  // affects evidence, so normalize it rather than crash the projection.
  return evidenceOfSteps(steps.map((s) => ({ ...s, content: s.content ?? "" })));
}

/** A hand-built state/context with `evidence` re-derived from its own `steps`. */
export function withEvidence<T extends { readonly steps: readonly ReasoningStep[] }>(
  value: T,
): T & { readonly evidence: ToolEvidence } {
  return { ...value, evidence: evidenceOf(value.steps) };
}
