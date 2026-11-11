/**
 * Apply the verification `onReject` outcome to the final result (F10).
 *
 * The verification quality gate sets a metadata flag when a response is still
 * rejected after retries; this reads that flag at result-assembly time so the
 * policy is a real enforcement point (not dead telemetry):
 *
 * - `verificationBlocked` → the answer is withheld (output `""`), the run
 *   fails, and the cause is on `error`.
 * - `verificationAnnotation` → the answer ships UNCHANGED; the verifier's note
 *   rides `note` (published as `AgentResult.metadata.verificationNote`).
 * - neither → unchanged (`onReject: "proceed"`, the default).
 *
 * No mode writes harness text into `output` (owner rule, 2026-11-10).
 */
export interface VerificationOutcome {
  readonly output: unknown;
  readonly success: boolean;
  readonly blocked: boolean;
  readonly error?: string;
  /** The verifier's note on a still-rejected answer (`onReject: "annotate"`); never part of `output`. */
  readonly note?: string;
}

export function applyVerificationOutcome(
  output: unknown,
  success: boolean,
  metadata: Record<string, unknown>,
): VerificationOutcome {
  const blocked = metadata["verificationBlocked"] as { reason?: string } | undefined;
  if (blocked) {
    const reason = blocked.reason ?? "response rejected by verification";
    // The withheld answer is not replaced with harness text: output is empty
    // and the cause rides `error` (owner decision 2026-11-10).
    return {
      output: "",
      success: false,
      blocked: true,
      error: `Verification rejected the response: ${reason}`,
    };
  }

  const annotation = metadata["verificationAnnotation"];
  if (typeof annotation === "string" && annotation.length > 0) {
    return { output, success, blocked: false, note: annotation };
  }

  return { output, success, blocked: false };
}
