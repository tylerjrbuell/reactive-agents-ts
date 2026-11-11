import { Data } from "effect";
import type { StructuredOutputReport } from "@reactive-agents/core";

/**
 * Thrown when structured output parsing fails and `.withOutputSchema()` was
 * configured with `onParseFail: "throw"`.
 *
 * In `degrade` mode (default), `AgentResult.objectError` is populated instead
 * and `object` is undefined — this error is never raised.
 */
export class StructuredOutputError extends Data.TaggedError(
  "StructuredOutputError",
)<{
  /** The raw text that could not be parsed into the expected schema. */
  readonly rawText: string;
  /** Human-readable list of parse/validation failures. */
  readonly issues: ReadonlyArray<string>;
  /**
   * How the extraction failed (attempts, repairs, field errors), when the
   * extraction pipeline ran. Same value as `AgentResult.objectReport` in
   * `degrade` mode. Absent for the grounded engine.
   */
  readonly report?: StructuredOutputReport;
}> {
  /**
   * The parse failure, named. Without it the message is empty and Effect's
   * run boundary renders the generic "An error has occurred" instead.
   */
  override get message(): string {
    const issues = this.issues.length > 0 ? this.issues.join("; ") : "no details";
    return `Structured output did not match the schema: ${issues}`;
  }
}

/**
 * Thrown by `.withOutputSchema()` (and `runStream(task, { outputSchema })`)
 * for a JSON Schema the runtime cannot validate faithfully: an unsupported
 * assertion keyword, an unresolvable `$ref`, or a malformed keyword value.
 * The message names every problem and where it is.
 */
export class OutputSchemaError extends Data.TaggedError("OutputSchemaError")<{
  /** Every problem found, joined. */
  readonly message: string;
}> {}
