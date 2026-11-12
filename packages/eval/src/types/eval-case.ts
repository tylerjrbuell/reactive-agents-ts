import { Schema } from "effect";
import { RubricSchema } from "./rubric.js";
import { StructuredExpectationSchema } from "./structured-expectation.js";

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
  /**
   * Deterministic expectations for a typed result. A case with `structured`
   * is graded field by field with no LLM call: the suite's judge dimensions
   * are not scored for it, and its score is recorded under the `structured`
   * dimension. The graded value is the runner's `structuredOutput`, or
   * `actualOutput` parsed as JSON.
   */
  structured: Schema.optional(StructuredExpectationSchema),
  /**
   * A calibrated judgment question for what data cannot decide (a
   * `JudgmentService` Noul, Choice or Score with a pass rule). With
   * `structured` too, the structured checks run first and the rubric is
   * asked only if they pass. A judge that errors or is not confident enough
   * makes the case `inconclusive`, never a pass. The suite's judge
   * dimensions are not scored for a rubric case.
   */
  rubric: Schema.optional(RubricSchema),
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
