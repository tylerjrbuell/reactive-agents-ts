/**
 * Apply the verification `onReject` outcome to the final result (F10).
 *
 * The verification quality gate sets a metadata flag when a response is still
 * rejected after retries; this reads that flag at result-assembly time so the
 * policy is a real enforcement point (not dead telemetry):
 *
 * - `verificationBlocked` → the answer is withheld and the run fails.
 * - `verificationAnnotation` → the answer ships with a visible warning prepended.
 * - neither → unchanged (`onReject: "proceed"`, the default).
 */
export interface VerificationOutcome {
  readonly output: unknown;
  readonly success: boolean;
  readonly blocked: boolean;
  readonly error?: string;
}

export function applyVerificationOutcome(
  output: unknown,
  success: boolean,
  metadata: Record<string, unknown>,
): VerificationOutcome {
  const blocked = metadata["verificationBlocked"] as { reason?: string } | undefined;
  if (blocked) {
    const reason = blocked.reason ?? "response rejected by verification";
    return {
      output: `[verification blocked] The response was withheld because it failed verification: ${reason}.`,
      success: false,
      blocked: true,
      error: `Verification rejected the response: ${reason}`,
    };
  }

  const annotation = metadata["verificationAnnotation"] as string | undefined;
  if (annotation && typeof output === "string") {
    return { output: `${annotation}\n\n${output}`, success, blocked: false };
  }

  return { output, success, blocked: false };
}
