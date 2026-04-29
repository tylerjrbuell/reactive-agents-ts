import { Schema } from "effect";

/**
 * Judge metadata. Required for any benchmark claim per Rule 4 of
 * 00-RESEARCH-DISCIPLINE.md (frozen judge: fixed model, fixed prompt, fixed
 * code SHA, code-path isolated from SUT). The eval-service guards at runtime
 * that `judge.model !== sutModel`.
 */
export const JudgeConfigSchema = Schema.Struct({
  /** Model used by the judge (e.g. "claude-haiku-4-5", "gpt-4o-mini"). */
  model: Schema.String,
  /** Provider for the judge (e.g. "anthropic", "openai"). */
  provider: Schema.String,
  /** Code SHA pin for reproducibility. Recommend the framework's git SHA at run time. */
  codeSha: Schema.optional(Schema.String),
});
export type JudgeConfig = typeof JudgeConfigSchema.Type;

export const EvalConfigSchema = Schema.Struct({
  passThreshold: Schema.optional(Schema.Number),
  regressionThreshold: Schema.optional(Schema.Number),
  defaultDimensions: Schema.optional(Schema.Array(Schema.String)),
  parallelism: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
  retries: Schema.optional(Schema.Number),
  /**
   * Judge configuration. When omitted, the eval framework still runs but
   * emits a "judge-not-configured" warning at every score (per Rule 4 a
   * configured judge is required for any benchmark claim). Future versions
   * may make this field required.
   */
  judge: Schema.optional(JudgeConfigSchema),
});
export type EvalConfig = typeof EvalConfigSchema.Type;

export const DEFAULT_EVAL_CONFIG: Required<Omit<EvalConfig, "judge">> = {
  passThreshold: 0.7,
  regressionThreshold: 0.05,
  defaultDimensions: ["accuracy", "relevance", "completeness", "safety"],
  parallelism: 3,
  timeoutMs: 30_000,
  retries: 1,
};
