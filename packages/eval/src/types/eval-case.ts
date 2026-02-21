import { Schema } from "effect";

export const EvalCaseSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  input: Schema.String,
  expectedOutput: Schema.optional(Schema.String),
  expectedBehavior: Schema.optional(
    Schema.Struct({
      shouldUseTool: Schema.optional(Schema.String),
      shouldAskUser: Schema.optional(Schema.Boolean),
      maxSteps: Schema.optional(Schema.Number),
      maxCost: Schema.optional(Schema.Number),
    }),
  ),
  tags: Schema.optional(Schema.Array(Schema.String)),
});
export type EvalCase = typeof EvalCaseSchema.Type;

export const EvalSuiteSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  cases: Schema.Array(EvalCaseSchema),
  dimensions: Schema.Array(Schema.String),
  config: Schema.optional(
    Schema.Struct({
      parallelism: Schema.optional(Schema.Number),
      timeoutMs: Schema.optional(Schema.Number),
      retries: Schema.optional(Schema.Number),
    }),
  ),
});
export type EvalSuite = typeof EvalSuiteSchema.Type;
