// File: src/strategies/substrate/answer-pass-error.ts
/**
 * A strategy answer whose answering pass ended on a provider error.
 *
 * A multi-pass strategy can carry an earlier draft through a pass whose model
 * call failed: reflexion's improve pass 400'd after an UNSATISFIED critique,
 * `improvePass.output || s.response` kept the rejected draft, and the run
 * shipped it (truncated, with fabricated values) while its trace said
 * `llm_error` and the result said `end_turn` (QA N3, 2026-11-19,
 * run 01M7T4DTX245N6AYNV59TMQ7J5). The substrate owns that ending for every
 * strategy, not each strategy's body:
 *
 * - The strategy's own check accepted the draft (`answerAccepted`): it ships,
 *   and the claim names the error (see {@link answerPassErrorClaim}).
 * - Otherwise nothing the run holds was accepted: the run fails honestly, with
 *   output "" and the cause on `error` (owner decision 2026-11-10: a failed run
 *   ships no harness-kept answer).
 *
 * Pure functions, no services.
 */
import type { PassResult } from "../../kernel/loop/run-pass.js";
import { deriveTerminatedBy } from "../../kernel/loop/terminate-reason.js";

/** True when the pass's run ended on a provider (LLM) error. */
export function passEndedInLlmError(pass: PassResult | undefined): boolean {
  return pass !== undefined && deriveTerminatedBy(pass.state).terminatedBy === "llm_error";
}

/** The `Result` fields this rule reads and may rewrite. */
interface AnsweredEnd {
  readonly output: string | null;
  readonly status: "completed" | "partial" | "failed";
  readonly error?: string | null;
  readonly basedOn?: PassResult;
  readonly answerAccepted?: boolean;
}

/**
 * Fail a strategy `Result` whose answering pass (`basedOn`) ended on a provider
 * error while the strategy's own check never accepted the answer it holds.
 * Every other `Result` is returned unchanged.
 */
export function applyAnswerPassError<E extends AnsweredEnd>(end: E): E {
  if (end.answerAccepted === true || end.status === "failed" || !passEndedInLlmError(end.basedOn)) return end;
  const cause = end.basedOn?.state.error;
  return {
    ...end,
    output: "",
    status: "failed",
    error: `The final model call failed${cause ? ` (${cause})` : ""}, and no answer the run holds was accepted, so none is shipped.`,
  };
}

/**
 * The terminatedBy claim for a `Result`: `final_answer` iff the capped status
 * is `completed`; else `llm_error` when the answering pass ended on a provider
 * error (the result agrees with the trace); else `end_turn`.
 */
export function answerPassErrorClaim(status: string, basedOn: PassResult | undefined): "final_answer" | "llm_error" | "end_turn" {
  if (status === "completed") return "final_answer";
  return passEndedInLlmError(basedOn) ? "llm_error" : "end_turn";
}
