/**
 * runner-forced-abstention-inputs.ts — §7.5 input derivation, decomposed
 * VERBATIM from runner.ts (quality program Task 9 / GH #222, formerly lines
 * 983-998 + 1000-1055). Pure: reads KernelState + the run's current input/
 * options and returns the named facts the §7.5 site feeds to
 * `decideForcedAbstention` (which, per the control-plane grandfathering, is
 * CALLED only in runner.ts itself).
 */
import type {
  KernelState,
  KernelInput,
  KernelRunOptions,
} from "../../kernel/state/kernel-state.js";
import {
  TERMINAL_ANSWER_REASONS,
  hasSuccessfulRequiredToolCall,
} from "./runner-helpers/grounded-terminal.js";
import {
  countDeliverableCandidates,
  countArtifacts,
} from "./runner-helpers/deliverable.js";

// Input derivation (conservative fallbacks documented inline):
//   requiredToolUnavailable: a declared required tool absent from the registered
//     schema set. False when allKnownTools is empty (no schema provided = unknown).
//   missingRequiredTools: unsatisfied required-tool names (empty array fallback).
//   ungroundedSynthesisRejections: synthesisRetryCount + groundingBlockRetry
//     (same counters Task 5's legitimacy gate reads). Fallback: 0.
//   iterationsRemaining: maxIterations − state.iteration clamped ≥ 0.
//     Special case: when a required tool is structurally unavailable AND the
//     pre-loop guard fired (iteration=0, status=failed), treat as 0 —
//     no iterations can fix a missing tool. Deviation documented in Task 6 report.
//   hasDeliverable: countDeliverableCandidates(state) > 0 — never overrides a genuine deliverable.
//
// Route through terminate() (the single-owner gateway) so terminatedBy +
// output are set via the canonical path. The post-condition gate in terminate()
// passes "abstained" through (added in Task 6) — an abstained run cannot
// honestly meet post-conditions when grounding was structurally impossible.

export interface ForcedAbstentionInputs {
  readonly requiredToolUnavailable: boolean;
  readonly unavailableRequired: readonly string[];
  readonly iterationsRemainingForAbstain: number;
  readonly secondUngroundedTerminal: boolean;
  readonly ungroundedSynthesisRejections: number;
  readonly hasDeliverableForAbstain: boolean;
}

/** Derive the §7.5 forced-abstention inputs from live kernel state (pure). */
export function deriveForcedAbstentionInputs(args: {
  readonly state: KernelState;
  readonly currentInput: KernelInput;
  readonly currentOptions: KernelRunOptions;
  readonly requiredTools: readonly string[];
}): ForcedAbstentionInputs {
  const { state, currentInput, currentOptions, requiredTools } = args;

  const allKnownToolsForAbstain = (
    currentInput.allToolSchemas ?? currentInput.availableToolSchemas ?? []
  ).map((t) => t.name);
  const knownToolSetForAbstain = new Set(allKnownToolsForAbstain);
  const unavailableRequired = requiredTools.filter((t) => !knownToolSetForAbstain.has(t));
  const requiredToolUnavailable =
    allKnownToolsForAbstain.length > 0 && unavailableRequired.length > 0;
  // Conservative: structurally-unavailable tool at iteration=0 → treat as
  // exhausted (the pre-loop guard fired; no iterations could have helped).
  const iterationsRemainingForAbstain =
    requiredToolUnavailable && state.iteration === 0
      ? 0
      : Math.max(0, currentOptions.maxIterations - state.iteration);
  // F1 — grounded-terminal invariant (2026-07-02): when the Arbitrator's
  // grounded-terminal gate already spent its ONE grounding redirect
  // (meta.groundingRedirectCount ≥ 1), the loop exited via a terminal
  // final answer (TERMINAL_ANSWER_REASONS), and STILL no substantive tool
  // call has succeeded — this is the SECOND ungrounded terminal attempt.
  // Count the redirect + this attempt toward the ≥2 ungrounded-synthesis
  // threshold (which the redirect made reachable) so the accepted-but-
  // ungrounded terminal converts to an honest `abstained` here. Grounded
  // runs (any successful call) and non-answer terminals contribute 0 —
  // pre-F1 arithmetic byte-identical.
  const groundingRedirects = state.meta.groundingRedirectCount ?? 0;
  // Grounding is measured against the DECLARED REQUIRED tools (2026-07-22).
  // Previously this asked "did ANY non-pseudo tool succeed", so a run whose
  // required `file-read` failed 3× was still deemed grounded because
  // `list-directory` returned ok — see hasSuccessfulRequiredToolCall's
  // docstring for the trace. Falls back to the substantive predicate when
  // the task declares no required tools (behavior unchanged there).
  const groundedOnRequired = hasSuccessfulRequiredToolCall(state.steps, requiredTools);
  const secondUngroundedTerminal =
    groundingRedirects > 0 &&
    TERMINAL_ANSWER_REASONS.has(String(state.meta.terminatedBy ?? "")) &&
    !groundedOnRequired;
  const ungroundedSynthesisRejections =
    (state.meta.synthesisRetryCount ?? 0) +
    (state.meta.groundingBlockRetry ?? 0) +
    (secondUngroundedTerminal ? groundingRedirects + 1 : 0);
  // Deliverable-truth (Wave C / C2, audit 01-F1 item 7): a REAL file
  // artifact (tool-declared ledger entry) is now an authoritative "we have a
  // deliverable" signal, so abstention never forces over one — even a
  // code-execute / shell write the old any-success heuristic would have
  // recognized only via its observation. Evidence candidates remain the
  // fallback so non-artifact tasks (research answers, no file) stay sane:
  // the union is a superset of the prior signal, so no run that was
  // previously protected loses protection (behavior pinned).
  // A REAL artifact always protects. Evidence candidates only protect a run
  // that actually GROUNDED on its required tools: otherwise a single
  // successful adjacent call (`list-directory` on a `file-read` task)
  // satisfies this predicate, and since `hasDeliverable` is the FIRST
  // short-circuit in decideForcedAbstention, honest abstention could never
  // fire on exactly the ungrounded shape it exists for (2026-07-22).
  const hasDeliverableForAbstain =
    countArtifacts(state) > 0 ||
    (groundedOnRequired && countDeliverableCandidates(state) > 0);

  return {
    requiredToolUnavailable,
    unavailableRequired,
    iterationsRemainingForAbstain,
    secondUngroundedTerminal,
    ungroundedSynthesisRejections,
    hasDeliverableForAbstain,
  };
}
