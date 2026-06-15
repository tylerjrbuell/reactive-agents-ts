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
}> {}
