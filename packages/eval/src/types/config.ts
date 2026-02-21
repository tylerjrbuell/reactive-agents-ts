import { Schema } from "effect";

export const EvalConfigSchema = Schema.Struct({
  passThreshold: Schema.optional(Schema.Number),
  regressionThreshold: Schema.optional(Schema.Number),
  defaultDimensions: Schema.optional(Schema.Array(Schema.String)),
  parallelism: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
  retries: Schema.optional(Schema.Number),
});
export type EvalConfig = typeof EvalConfigSchema.Type;

export const DEFAULT_EVAL_CONFIG: Required<EvalConfig> = {
  passThreshold: 0.7,
  regressionThreshold: 0.05,
  defaultDimensions: ["accuracy", "relevance", "completeness", "safety"],
  parallelism: 3,
  timeoutMs: 30_000,
  retries: 1,
};
