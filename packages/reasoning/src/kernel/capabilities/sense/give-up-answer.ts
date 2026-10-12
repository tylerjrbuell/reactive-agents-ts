// File: src/kernel/capabilities/sense/give-up-answer.ts
//
// Honest-success support: a run may only report success if it actually
// ANSWERED. Two holes let a give-up ship as `success:true`:
//
//   1. `resolveCompletionStatus` maps any non-failed `done` state to
//      `completed`. Harness give-up terminations (`loop_graceful`,
//      `low_delta_guard`, iteration exhaustion) leave status `done` with the
//      model's last text as output.
//   2. The terminal verifier's give-up gate (`output-not-shallow-giveup`,
//      verifier.ts Check 3d) requires UNUSED AVAILABLE DATA TOOLS. A run with
//      zero usable tools (`builtins: false`, only meta-tools) never trips it.
//
// `isGiveUpAnswer` is the missing content-shape signal (superset of
// `quality-utils.looksSubstantive`, adding capability give-ups such as "no tool
// exists" / "cannot be completed"); `hasGroundedEvidence` gates the flip so a
// run that DID ground (any successful non-meta tool) is never downgraded.
//
// The consumer (`finalize-result.ts`) only flips a COMPLETED result whose
// output is a give-up AND which grounded nothing: see that gate for the
// full rationale. Pure; no Effect; no state.

import type { ReasoningStep } from "../../../types/step.js";
import { HARNESS_PSEUDO_TOOLS, META_TOOLS } from "../../state/kernel-constants.js";
import { looksSubstantive } from "../verify/quality-utils.js";

/**
 * Capability give-up phrasings the narrower `looksSubstantive` list misses:
 * third-person / task-level statements that the agent lacked the means to act
 * ("the task cannot be completed", "no tool exists", "tools do not include …").
 * High-precision on purpose: paired with a no-grounding gate, so a false hit
 * still cannot flip a run that did real work.
 */
const CAPABILITY_GIVEUP_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(cannot|can't|could\s+not|couldn't|unable|not\s+able)\b.{0,40}\b(be\s+)?(completed?|fulfilled?|accomplished?|performed?|sent|executed?|carried\s+out|done)\b/i,
  /\bcannot\s+be\s+(completed?|fulfilled?|accomplished?|done)\b/i,
  /\bno\s+[\w-]*\s*tools?\b.{0,40}\b(exists?|available|registered|configured|include[sd]?|provided?|present|supports?|can)\b/i,
  /\bnone\s+of\s+the\s+(available\s+|registered\s+|configured\s+|current\s+|usable\s+)?tools?\b/i,
  /\btools?\s+(do\s+not|don'?t|does\s+not|doesn'?t)\s+include\b/i,
  /\bnot\s+support(ed)?\s+by\s+(the\s+)?(available\s+|current\s+|configured\s+)?tools?\b/i,
  /\b(do\s+not|don'?t|does\s+not|doesn'?t)\s+have\s+(access|a\s+tool|any\s+tool|the\s+ability|the\s+capability)\b/i,
  /\bnot\s+(currently\s+)?(possible|available|supported)\s+(with|using|in)\s+the\s+(current|available|configured)\b/i,
];

/**
 * Raw kernel terminals that mean the HARNESS (not the model) ended the run:
 * loop detection, iteration/budget exhaustion, early-stop vetoes. A run that
 * reaches `done` through one of these did not cleanly deliver an answer: it
 * was force-ended while stuck. Excludes the model's own terminals
 * (`end_turn`/`llm_end_turn`, `final_answer*`, `content_stable`,
 * `entropy_converged`) so a plain answered turn is never misread as a give-up.
 * This is the structural backstop for give-up phrasing the content detector
 * misses.
 */
const HARNESS_FORCED_TERMINALS: ReadonlySet<string> = new Set([
  "loop_graceful",
  "max_iterations",
  "low_delta_guard",
  "switching_exhausted",
  "loop_detected_with_veto",
  "controller_signal_veto",
  "budget_exceeded",
]);

/** True when the raw kernel terminal names a HARNESS-forced end. */
export function isHarnessForcedTerminal(rawTerminatedBy: string | undefined): boolean {
  if (rawTerminatedBy === undefined) return false;
  if (
    rawTerminatedBy.startsWith("controller_early_stop:") ||
    rawTerminatedBy.startsWith("loop_detected:")
  ) {
    return true;
  }
  return HARNESS_FORCED_TERMINALS.has(rawTerminatedBy);
}

/**
 * Does `text` read as a give-up / incapability statement rather than a real
 * answer? Non-empty only (empty output is handled by the exhausted-run gate).
 * Composes the canonical `looksSubstantive` detector with the capability
 * patterns above.
 */
export function isGiveUpAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (!looksSubstantive(trimmed)) return true;
  return CAPABILITY_GIVEUP_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Did the run ground ANYTHING in a real tool? True when at least one
 * observation reports `success: true` for a tool the run actually used to
 * gather evidence. Excluded (they are NOT evidence the task was done):
 *   - META_TOOLS (`recall`, `find`, `discover-tools`, …): framework helpers.
 *   - HARNESS_PSEUDO_TOOLS (`system`, `completion-guard`, …): harness feedback
 *     stamped as successful observations; the constant's own doc says grounding
 *     checks MUST ignore them (else a quality nudge masks an ungrounded run).
 */
export function hasGroundedEvidence(steps: readonly ReasoningStep[]): boolean {
  for (const s of steps) {
    if (s.type !== "observation") continue;
    const result = s.metadata?.observationResult;
    if (result?.success !== true) continue;
    const name = result.toolName;
    if (typeof name !== "string" || name.length === 0) continue;
    if (META_TOOLS.has(name) || HARNESS_PSEUDO_TOOLS.has(name)) continue;
    return true;
  }
  return false;
}
