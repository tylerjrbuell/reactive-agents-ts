/**
 * Structured-output provenance: how one structured-output extraction got its
 * value, or why it did not.
 *
 * Lives in `core` because several packages read it: `reasoning` produces it
 * (`extractStructuredOutput()`), the `StructuredOutputReported` event carries
 * it, and trace, Cortex and calibration consume it. Everything in the report
 * is computed from what the pipeline observed (no model judgement), so the
 * same responses always produce the same report.
 */

/**
 * The layer that produced the value, named by the furthest fallback the
 * extraction needed (precedence: native, then retried, repaired, coerced,
 * prompt). Flags such as `repairs` and `coerced` stay set on the report even
 * when a later layer names the outcome.
 *
 * - `native`: the provider's schema-constrained call (`completeStructured`).
 * - `prompt`: prompt-mode JSON that validated as returned.
 * - `repaired`: prompt-mode JSON that validated only after extraction/repair.
 * - `coerced`: the validator returned a value that differs from the parsed
 *   JSON (type coercion, defaults, transforms, stripped keys).
 * - `retried`: a prompt-mode retry with error feedback produced the value.
 */
export type StructuredOutputLayer = "native" | "prompt" | "repaired" | "coerced" | "retried";

/** One deterministic text repair applied to model output before parsing. */
export type JsonRepairStep =
  | "extract-json-block"
  | "strip-comments"
  | "single-quotes"
  | "python-literals"
  | "non-finite"
  | "unescaped-newlines"
  | "trailing-commas"
  | "close-unclosed";

/** What happened to the provider-native attempt (Layer 0). */
export type NativeOutcome = "not-attempted" | "succeeded" | "failed" | "contract-rejected";

/** One validation failure at a field. */
export type StructuredFieldError = {
  /** RFC 6901 JSON Pointer to the failing field (`""` = the root value). */
  readonly path: string;
  /** Validator message for this field. */
  readonly message: string;
};

/** Why a failed extraction failed. */
export type StructuredOutputFailureKind =
  /** The last response held no parseable JSON, even after repair. */
  | "invalid-json"
  /** JSON parsed but did not match the schema (see `fieldErrors`). */
  | "schema-mismatch"
  /** The response was empty twice: the output budget ran out before any JSON. */
  | "empty-output"
  /** The LLM call itself failed. */
  | "llm-error";

/** How one structured-output extraction succeeded or failed. */
export type StructuredOutputReport = {
  /** Whether the extraction produced a schema-valid value. */
  readonly outcome: "success" | "failure";
  /** The layer that produced the value; `null` on failure. */
  readonly layer: StructuredOutputLayer | null;
  /** What happened to the provider-native attempt. */
  readonly native: NativeOutcome;
  /** Model requests made: native attempts plus prompt-mode attempts. */
  readonly attempts: number;
  /** Prompt-mode requests made (0 when the native layer answered). */
  readonly promptAttempts: number;
  /** Repairs applied to the deciding response (the winner, or the last failure), in order. */
  readonly repairs: readonly JsonRepairStep[];
  /** True when the validator transformed the parsed value. */
  readonly coerced: boolean;
  /** True when an empty response made the pipeline double its output budget. */
  readonly budgetEscalated: boolean;
  /** Field-level errors of the last failed validation; empty on success. */
  readonly fieldErrors: readonly StructuredFieldError[];
  /** Why the extraction failed. Set on failure only; absent on success. */
  readonly failure?: {
    /** Failure class. */
    readonly kind: StructuredOutputFailureKind;
    /** The pipeline's failure text. */
    readonly message: string;
  };
};
