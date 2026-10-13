// File: src/kernel/loop/runner-helpers/flail-signature.ts
//
// The FLAIL discriminator for the default-on zero-evidence stand-down
// (W4-live fix rounds 1+2). The stand-down's raw signal — "N iterations with no
// new evidence while work remains" — is ALSO true of a legitimate no-tool
// REASONING trajectory (a weak model deriving a multi-step answer across
// several turns: `health.iterationsSinceEvidence` equals the iteration index
// whenever there are no tools, so bare staleness cannot tell DERIVING from
// FLAILING). This pure predicate adds the missing signal using facts already on
// the trajectory: a flailing run either REFUSES (declares it cannot do the task)
// or REPEATS itself (near-duplicate SUBSTANTIVE thought content). A deriving run
// does neither: its thoughts advance and it does not declare incapability.
//
// ROUND 2 precision (the round-1 discriminator still stood down deriving runs):
//   - REPETITION now requires BOTH thoughts to be SUBSTANTIVE (>= MIN length),
//     mirroring the sibling `contentStabilityEvaluator` (arbitrator.ts:441),
//     whose comment pins the exact hazard: short incrementing outputs like
//     "Step 1…"/"Step 2…" score >0.9 on normalizedLevenshtein yet are progress.
//   - REFUSAL no longer applies the OUTPUT-shaped `isGiveUpAnswer` verbatim to
//     intermediate thoughts. It composes that canonical detector with a
//     thought-appropriateness gate: an explicit task-level / no-capability
//     signal is REQUIRED, and step-scoped progress narration
//     ("I cannot complete step 3 until I compute step 2") is EXCLUDED.
//
// Pure / synchronous / no Effect / no state — unit-testable in isolation.

import type { ReasoningStep } from "../../../types/step.js";
import { isGiveUpAnswer } from "../../capabilities/sense/give-up-answer.js";
import { normalizedLevenshtein } from "../../capabilities/decide/arbitrator.js";

/**
 * Near-duplicate threshold on `normalizedLevenshtein` (1 = identical). Set at
 * the content-stability evaluator's substantive threshold (0.85).
 */
const NEAR_DUPLICATE_THRESHOLD = 0.85;

/**
 * Minimum thought length for the near-duplicate check — mirrors the sibling
 * `contentStabilityEvaluator`'s `current.length >= 100` guard (arbitrator.ts:441).
 * Below it, short terse increments ("Step 1: …" / "Step 2: …", "Let x …" /
 * "Let y …") score >0.9 yet are deriving progress, not repetition.
 */
const MIN_REPETITION_LENGTH = 100;

/**
 * Step-scoped PROGRESS narration that superficially resembles a refusal but is
 * a deriving model sequencing its own work ("I cannot complete step 3 until I
 * compute step 2"). Excluded from the refusal arm.
 */
const PROGRESS_NARRATION: RegExp =
  /\b(cannot|can'?t|could\s+not|couldn'?t|unable|not\s+able)\b[^.!?]{0,60}\b(step|stage|phase|part)\s*\d/i;

/**
 * Task-level / no-capability signals that make a thought a genuine REFUSAL
 * (the run cannot do the task), as opposed to sequencing narration. Curated
 * from the canonical `CAPABILITY_GIVEUP_PATTERNS` (give-up-answer.ts) — the
 * subset appropriate to a THOUGHT (not a final answer).
 */
const TASK_LEVEL_REFUSAL: ReadonlyArray<RegExp> = [
  /\bno\s+[\w-]*\s*tools?\b[^.!?]{0,40}\b(exists?|available|registered|configured|include[sd]?|provided?|present|supports?|can)\b/i,
  /\bnone\s+of\s+the\s+(available\s+|registered\s+|configured\s+|current\s+|usable\s+)?tools?\b/i,
  /\btools?\s+(do\s+not|don'?t|does\s+not|doesn'?t)\s+include\b/i,
  /\b(do\s+not|don'?t|does\s+not|doesn'?t)\s+have\s+(access|a\s+tool|any\s+tool|the\s+ability|the\s+capability)\b/i,
  /\bnot\s+support(ed)?\s+by\s+(the\s+)?(available\s+|current\s+|configured\s+)?tools?\b/i,
  /\bnot\s+(currently\s+)?(possible|available|supported)\s+(with|using|in)\s+the\s+(current|available|configured)\b/i,
  /\bbeyond\s+my\s+(capabilities|ability|capacity)\b/i,
  /\bi\s+lack\s+(the\s+(ability|access|tools|capability)\s+to|access\s+to)\b/i,
  /\b(?:cannot|can'?t|could\s+not|couldn'?t|unable|not\s+able)\s+to\s+complete\s+the\s+task\b/i,
  /\bthe\s+task\s+(?:cannot|can'?t|could\s+not|couldn'?t)\s+be\s+(?:completed?|fulfilled?|accomplished?|done)\b/i,
  // Capability-action refusals: the run cannot perform the requested ACTION.
  // Step sequencing ("cannot complete step N") is excluded above, so this only
  // fires on task-level incapability.
  /\b(?:cannot|can'?t|could\s+not|couldn'?t|unable|not\s+able)\s+to\s+(send|access|connect|reach|query|execute|perform|carry\s+out)\b/i,
];

/**
 * Is this intermediate THOUGHT a genuine refusal (the run cannot do the task)?
 * Composes the canonical give-up detector with a thought-appropriateness gate:
 * the thought must read as a give-up AND carry an explicit task-level /
 * no-capability signal, AND must not be step-scoped progress narration.
 */
function thoughtRefusal(text: string): boolean {
  if (PROGRESS_NARRATION.test(text)) return false;
  if (!isGiveUpAnswer(text)) return false;
  return TASK_LEVEL_REFUSAL.some((p) => p.test(text));
}

/** The flail verdict: is this a flailing trajectory, and why. */
export interface FlailSignature {
  /** True when EITHER signal fired — the stand-down requires this. */
  readonly flailing: boolean;
  /** The run declared incapability (canonical detector + thought gate). */
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

  const refusal = recent.some(thoughtRefusal);

  let repetition = false;
  if (recent.length >= 2) {
    const last = recent[recent.length - 1]!;
    for (let i = 0; i < recent.length - 1; i++) {
      const prior = recent[i]!;
      // Two empty thoughts are byte-identical — repetition (the live empty-thought
      // loop shape). Otherwise require SUBSTANTIVE (>= MIN length) near-duplicates
      // so short terse increments are not misread as repetition.
      if (last.length === 0 && prior.length === 0) {
        repetition = true;
        break;
      }
      if (
        last.length >= MIN_REPETITION_LENGTH &&
        prior.length >= MIN_REPETITION_LENGTH &&
        normalizedLevenshtein(last, prior) > NEAR_DUPLICATE_THRESHOLD
      ) {
        repetition = true;
        break;
      }
    }
  }

  return { flailing: refusal || repetition, refusal, repetition };
}
