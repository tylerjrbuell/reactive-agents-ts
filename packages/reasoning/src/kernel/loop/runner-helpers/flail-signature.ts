// File: src/kernel/loop/runner-helpers/flail-signature.ts
//
// The FLAIL discriminator for the default-on zero-evidence stand-down
// (W4-live fix round 1). The stand-down's raw signal — "N iterations with no
// new evidence while work remains" — is ALSO true of a legitimate no-tool
// REASONING trajectory (a weak model deriving a multi-step answer across
// several turns: `health.iterationsSinceEvidence` equals the iteration index
// whenever there are no tools, so bare staleness cannot tell DERIVING from
// FLAILING). This pure predicate adds the missing signal using facts already on
// the trajectory: a flailing run either REFUSES (gives up — reusing the
// canonical `isGiveUpAnswer` detector, not a forked copy) or REPEATS itself
// (near-duplicate thought content across the stale window). A deriving run does
// neither: its thoughts change each pass and it does not declare incapability.
//
// Pure / synchronous / no Effect / no state — unit-testable in isolation.

import type { ReasoningStep } from "../../../types/step.js";
import { isGiveUpAnswer } from "../../capabilities/sense/give-up-answer.js";
import { normalizedLevenshtein } from "../../capabilities/decide/arbitrator.js";

/**
 * Near-duplicate threshold on `normalizedLevenshtein` (1 = identical). Set at
 * the content-stability evaluator's substantive threshold (0.85): the live
 * impossible-task apologies are near-identical (>0.9), while a deriving model's
 * successive derivations — which share scaffolding but advance the argument —
 * fall well below it.
 */
const NEAR_DUPLICATE_THRESHOLD = 0.85;

/** The flail verdict: is this a flailing trajectory, and why. */
export interface FlailSignature {
  /** True when EITHER signal fired — the stand-down requires this. */
  readonly flailing: boolean;
  /** The run declared incapability (reused canonical give-up detector). */
  readonly refusal: boolean;
  /** The recent thoughts are near-duplicates (non-novel / repeated). */
  readonly repetition: boolean;
}

/**
 * Detect a flail signature over the trailing thought window.
 *
 * @param steps    the run's step history
 * @param window   how many trailing thoughts to inspect (typically the
 *                 evidence-staleness count; floored at 2)
 */
export function detectFlailSignature(
  steps: readonly ReasoningStep[],
  window: number,
): FlailSignature {
  const thoughts = steps
    .filter((s) => s.type === "thought")
    .map((s) => s.content.trim());
  const recent = thoughts.slice(-Math.max(2, window));

  const refusal = recent.some((t) => isGiveUpAnswer(t));

  let repetition = false;
  if (recent.length >= 2) {
    const last = recent[recent.length - 1]!;
    for (let i = 0; i < recent.length - 1; i++) {
      const prior = recent[i]!;
      // Two empty thoughts are byte-identical — repetition (the live empty-thought
      // loop shape). Otherwise require a genuine near-duplicate.
      if (last.length === 0 && prior.length === 0) {
        repetition = true;
        break;
      }
      if (prior.length > 0 && normalizedLevenshtein(last, prior) > NEAR_DUPLICATE_THRESHOLD) {
        repetition = true;
        break;
      }
    }
  }

  return { flailing: refusal || repetition, refusal, repetition };
}
