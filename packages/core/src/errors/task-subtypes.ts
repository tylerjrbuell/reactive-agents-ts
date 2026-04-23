import { Data } from "effect";

/**
 * Task verification failed. Carries the list of specific gaps and a
 * suggested recovery action for the verification rule pipeline to
 * consult. Member of the Task kind (see `TaskError`).
 *
 *   nudge               — append a short corrective system message and
 *                         continue the loop
 *   retry-with-guidance — re-run the task with the gaps injected as
 *                         explicit guidance
 *   abandon             — stop, the task as stated cannot be satisfied
 */
export class VerificationFailed extends Data.TaggedError("VerificationFailed")<{
  readonly gaps: readonly string[];
  readonly suggestedAction: "nudge" | "retry-with-guidance" | "abandon";
  readonly message: string;
}> {}
