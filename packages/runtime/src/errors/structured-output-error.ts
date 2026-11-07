import { Data } from "effect";

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
