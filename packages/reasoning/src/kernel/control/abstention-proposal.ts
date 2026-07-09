// File: src/kernel/control/abstention-proposal.ts
//
// The IN-LOOP abstain signal for the control plane (F1 / the P5 fix). The runner
// §7.5 forced-abstention block runs POST-loop, after the while loop exhausts;
// the strategy-switch seam runs IN-loop. Before F1 nothing reconciled them, so a
// run that qualified for abstention could still take a strategy switch first (and
// burn a whole strategy's budget only to abstain later) — the P5 race.
//
// This helper computes whether forced abstention qualifies FROM in-loop state
// (reusing the SAME `decideForcedAbstention` decision the post-loop block uses),
// so the switch seam can offer an `abstain` proposal that the resolver ranks
// ABOVE the switch. It is the in-loop SUBSET of the §7.5 derivation: the
// terminal-answer / second-ungrounded-terminal arithmetic is deliberately absent
// because the state is NOT terminal at the switch seam (status "evaluating") — so
// `ungroundedSynthesisRejections` is just the two live counters.
//
// DAG-safe: a pure READ of state (no mutation, no ledger append). The winning
// action re-enters via the existing terminate() abstain path at the call site.

import type { KernelState, KernelInput } from "../state/kernel-state.js";
import {
  decideForcedAbstention,
  type ForcedAbstention,
} from "../loop/runner-helpers/force-abstention.js";
import { countArtifacts, countDeliverableCandidates } from "../loop/runner-helpers/deliverable.js";
import { proposeFromForcedAbstention } from "./emitters.js";
import type { ControlProposal } from "./control-plane.js";

/**
 * Derive the in-loop forced-abstention decision (or null when it does not
 * qualify). Mirrors the runner §7.5 input derivation for the non-terminal case.
 */
export function deriveInLoopForcedAbstention(
  state: KernelState,
  input: KernelInput,
  requiredTools: readonly string[],
  maxIterations: number,
): ForcedAbstention | null {
  const allKnownTools = (input.allToolSchemas ?? input.availableToolSchemas ?? []).map((t) => t.name);
  const knownToolSet = new Set(allKnownTools);
  const unavailableRequired = requiredTools.filter((t) => !knownToolSet.has(t));
  const requiredToolUnavailable = allKnownTools.length > 0 && unavailableRequired.length > 0;

  const iterationsRemaining =
    requiredToolUnavailable && state.iteration === 0
      ? 0
      : Math.max(0, maxIterations - state.iteration);

  const ungroundedSynthesisRejections =
    (state.meta.synthesisRetryCount ?? 0) + (state.meta.groundingBlockRetry ?? 0);

  const hasDeliverable = countArtifacts(state) > 0 || countDeliverableCandidates(state) > 0;

  return decideForcedAbstention({
    requiredToolUnavailable,
    missingRequiredTools: unavailableRequired,
    ungroundedSynthesisRejections,
    iterationsRemaining,
    hasDeliverable,
  });
}

/**
 * Convenience: the in-loop abstain `ControlProposal` (or null). Used at the
 * strategy-switch seam so the resolver can rank abstain above the switch (P5).
 */
export function inLoopAbstentionProposal(
  state: KernelState,
  input: KernelInput,
  requiredTools: readonly string[],
  maxIterations: number,
): { readonly proposal: ControlProposal | null; readonly forced: ForcedAbstention | null } {
  const forced = deriveInLoopForcedAbstention(state, input, requiredTools, maxIterations);
  return { proposal: proposeFromForcedAbstention(forced), forced };
}
