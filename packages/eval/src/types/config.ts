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
  /**
   * Which engine scores the judged dimensions (accuracy/relevance/
   * completeness/safety). Default `"jev"` — calibrated, ~10x cheaper,
   * ~5x lower variance than the LLM-judge path (see
   * wiki/Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer.md
   * POC validation). `"llm"` is the original `JudgeLLMService` +
   * `parseFloat` path, kept as the secondary/keyless-fallback engine — never
   * deleted. Resolution at the eval-service boundary: `"jev"` requested but
   * no `JudgmentService` layer wired (no `TYPESAFE_API_KEY`, or the caller
   * simply didn't call `.withJudgment()`) silently degrades to `"llm"` —
   * this field never fails a run.
   */
  judgeEngine: Schema.optional(Schema.Literal("jev", "llm")),
  /**
   * How many times to re-score each case's SUT output (Task 6). Re-scores
   * the SAME `actualOutput` — this measures JUDGE variance, not the SUT's
   * own run-to-run variance (a different, already-documented concern — see
   * MEMORY: "bench cells are Bernoulli"). Default `1` (no variance data,
   * `checkRegression`/`compare` use the flat `regressionThreshold`
   * fallback). The `jev` engine's cost/latency (~$0.042/MTok in, ~150ms)
   * is what makes `repeats: 10-30` affordable where it wasn't for an
   * LLM judge (see the plan's POC validation).
   */
  repeats: Schema.optional(Schema.Number),
});
export type EvalConfig = typeof EvalConfigSchema.Type;

export const DEFAULT_EVAL_CONFIG: Required<Omit<EvalConfig, "judge">> = {
  passThreshold: 0.7,
  regressionThreshold: 0.05,
  defaultDimensions: ["accuracy", "relevance", "completeness", "safety"],
  parallelism: 3,
  timeoutMs: 30_000,
  retries: 1,
  judgeEngine: "jev",
  repeats: 1,
};
