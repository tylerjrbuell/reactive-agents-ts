import { Data } from "effect";

/**
 * Thrown by `.withAgentTool(name, { parameters })` when `parameters` is a JSON
 * Schema the runtime cannot validate faithfully (an unsupported assertion
 * keyword, an unresolvable `$ref`) or is not an object schema. The message
 * names every problem. Raised when the tool is declared, never mid-run.
 */
export class SubAgentParametersError extends Data.TaggedError("SubAgentParametersError")<{
  /** Every problem found, joined. */
  readonly message: string;
  /** The sub-agent tool whose declaration is invalid. */
  readonly toolName: string;
}> {}

/**
 * The failure of a sub-agent tool call whose arguments do not satisfy the
 * tool's declared `parameters` JSON Schema. It fails the tool call (the parent
 * model sees the problems and can retry); no sub-agent runs.
 */
export class SubAgentInputError extends Data.TaggedError("SubAgentInputError")<{
  /** Every violation, joined (for example `$.prNumber: expected integer, got string`). */
  readonly message: string;
  /** The sub-agent tool that was called. */
  readonly toolName: string;
  /** One entry per violation. */
  readonly issues: ReadonlyArray<string>;
}> {}
