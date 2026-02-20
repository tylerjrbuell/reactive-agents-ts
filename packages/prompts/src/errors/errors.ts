import { Data } from "effect";

export class PromptError extends Data.TaggedError("PromptError")<{
  readonly message: string;
  readonly templateId?: string;
  readonly cause?: unknown;
}> {}

export class TemplateNotFoundError extends Data.TaggedError(
  "TemplateNotFoundError",
)<{
  readonly templateId: string;
  readonly version?: number;
}> {}

export class VariableError extends Data.TaggedError("VariableError")<{
  readonly templateId: string;
  readonly variableName: string;
  readonly message: string;
}> {}

export type PromptErrors = PromptError | TemplateNotFoundError | VariableError;
