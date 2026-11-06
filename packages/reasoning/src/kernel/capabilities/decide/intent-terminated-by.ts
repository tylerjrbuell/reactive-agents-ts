/**
 * decide/intent-terminated-by.ts — the `terminatedBy` a model-answer intent
 * ends the run with, in ONE place.
 *
 * The Arbitrator stamps it on the run when it accepts the answer, and the exit
 * gate (`decide/model-exit-proposal.ts`) records it on the gate step and event
 * while it disposes the claim. One mapping keeps the two from naming different
 * reasons for the same answer (they did: the gate recorded `content_stable`
 * where the run ended `llm_end_turn`).
 *
 * The Arbitrator's context-dependent rewrites (veto, the final-answer tool's
 * semantic-abstention reclassification) stay in `arbitrator.ts`; this is the
 * success-path name only.
 */
import type { RawTerminatedBy } from "../../loop/terminate-reason.js";
import type { TerminationIntent } from "./arbitration-types.js";

/** The intents a model-written answer carries into the Arbitrator. */
export type ModelAnswerIntent = Extract<
  TerminationIntent,
  | { readonly kind: "agent-final-answer" }
  | { readonly kind: "fast-path-completed" }
  | { readonly kind: "oracle-decision" }
>;

/**
 * The terminatedBy an accepted model answer ends with. The final-answer `via`
 * picks the legacy names; an oracle exit passes its evaluator reason through,
 * except the stability exits (`content_stable`, `entropy_converged*`), which
 * end as `llm_end_turn`.
 */
export function terminatedByOfIntent(intent: ModelAnswerIntent): RawTerminatedBy {
  if (intent.kind === "fast-path-completed") return "end_turn";
  if (intent.kind === "agent-final-answer") {
    return intent.via === "tool" ? "final_answer_tool" : intent.via === "regex" ? "final_answer" : "end_turn";
  }
  const reason = intent.decision.reason;
  // Documented narrow cast (Phase 3 vocabulary closure): the evaluator
  // exit-reason vocabulary is closed over RawTerminatedBy — producers are
  // entropyConvergenceEvaluator ("entropy_converged"),
  // contentStabilityEvaluator ("content_stable"),
  // reactiveControllerEarlyStopEvaluator ("controller_early_stop: …"),
  // llmEndTurnEvaluator ("llm_end_turn"), finalAnswerRegexEvaluator
  // ("final_answer_regex") — all members of the union or its templates.
  return (
    reason === "content_stable" || reason.startsWith("entropy_converged") ? "llm_end_turn" : reason
  ) as RawTerminatedBy;
}
