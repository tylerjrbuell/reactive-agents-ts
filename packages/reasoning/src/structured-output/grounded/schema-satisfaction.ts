import type {
  VerificationCheck,
  VerificationSeverity,
} from "../../kernel/capabilities/verify/verifier.js";

export interface SchemaSatisfactionInput {
  readonly missingRequired: ReadonlyArray<string>;
  readonly lowConfidenceFields: ReadonlyArray<string>;
}

/**
 * Produces a {@link VerificationCheck} capturing schema-satisfaction state
 * for the grounded structured-output engine.
 *
 * Severity precedence: reject > escalate > pass
 *   - `reject`   — one or more required fields are absent; the output is
 *                  structurally incomplete and must be repaired before use.
 *   - `escalate` — all required fields present but one or more carry low
 *                  confidence; the orchestrator should abstain or hand off
 *                  to human-in-loop rather than retry in place.
 *   - `pass`     — all required fields present and fully grounded.
 */
export function schemaSatisfactionCheck(
  input: SchemaSatisfactionInput,
): VerificationCheck {
  const { missingRequired, lowConfidenceFields } = input;

  if (missingRequired.length > 0) {
    const severity: VerificationSeverity = "reject";
    return {
      name: "schema-satisfaction",
      passed: false,
      severity,
      reason: `missing required field${missingRequired.length === 1 ? "" : "s"}: ${missingRequired.join(", ")}`,
    };
  }

  if (lowConfidenceFields.length > 0) {
    const severity: VerificationSeverity = "escalate";
    return {
      name: "schema-satisfaction",
      passed: false,
      severity,
      reason: `low-confidence field${lowConfidenceFields.length === 1 ? "" : "s"}: ${lowConfidenceFields.join(", ")}`,
    };
  }

  return {
    name: "schema-satisfaction",
    passed: true,
    severity: "pass",
  };
}
