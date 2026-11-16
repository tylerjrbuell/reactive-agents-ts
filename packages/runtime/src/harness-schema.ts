/**
 * JSON-serialisable mirror of `HarnessConfig` (packages/reasoning). Kept in
 * runtime for the same reason `reasoning-options-schema.ts` is: the Effect
 * Schema row is the AgentConfig persistence contract, and reasoning must not
 * depend on runtime.
 *
 * Every field optional — absent means "do not decide", which is what lets
 * config beat the environment-variable layer beat the built-in default (see
 * `packages/reasoning/src/harness-config.ts` for the full precedence note).
 */
import { Schema } from "effect";

export const HarnessConfigSchema = Schema.Struct({
  lazyDisclosure: Schema.optional(Schema.Boolean),
  toolDiscovery: Schema.optional(Schema.Boolean),
  toolIndex: Schema.optional(Schema.Boolean),
  toolIndexMaxEntries: Schema.optional(Schema.Number),
  verboseRules: Schema.optional(Schema.Boolean),
  recencyBudgetChars: Schema.optional(Schema.Number),
  toolResultBudgetChars: Schema.optional(Schema.Number),
  auditRationale: Schema.optional(Schema.Boolean),
  treeOfThoughtExploreBudgetMs: Schema.optional(Schema.Number),
  assemblyDebug: Schema.optional(Schema.Boolean),
  promptDumpPathPrefix: Schema.optional(Schema.String),
  numCtxPolicy: Schema.optional(Schema.Literal("fixed", "demand")),
  /**
   * Act-or-answer forced retry. Off by default; experimental — default changes go through ablation.
   * `"auto"` = per-model choice from calibration (see reasoning `resolveActOrAnswer`).
   */
  actOrAnswer: Schema.optional(Schema.Union(Schema.Boolean, Schema.Literal("proactive", "auto"))),
  /**
   * Input coverage. Opt-in: each input the task lists must be read before the
   * run may finish. Off by default pending ablation. (`RA_INPUT_COVERAGE=1`)
   */
  inputCoverage: Schema.optional(Schema.Boolean),
  /**
   * Write coverage. Opt-in: each in-place edit target the task lists must be
   * written before the run may finish. Off by default pending ablation.
   * (`RA_WRITE_COVERAGE=1`)
   */
  writeCoverage: Schema.optional(Schema.Boolean),
  /**
   * Stable tool list. Opt-in: a kernel pass picks its tool list on the first
   * think turn and keeps it, only appending tools (via `discover-tools` or a
   * tool the model uses). The tool block at the head of the prompt stays the
   * same between turns, so the provider prompt cache keeps working. A listed
   * tool that is not ready yet is refused when called, with a note saying what
   * to do first. Off by default pending ablation. (`RA_STABLE_TOOL_LIST=1`)
   */
  stableToolList: Schema.optional(Schema.Boolean),
  /**
   * Compact call constraints. Opt-in: compact tool profiles (`names-only`,
   * `names-and-types`, the local tier) drop description prose. With this on
   * they keep the sentences that limit a parameter's values ("type is one of
   * url, referrer, ...") in the prompt tool reference, the driver listing and
   * the wire description, and the compact reference shows enum values as
   * `a|b|c`. Full-detail profiles are unchanged. Off by default: the ablation
   * verdict was OPT-IN, not default-on. (`RA_COMPACT_CALL_CONSTRAINTS=1`)
   */
  compactCallConstraints: Schema.optional(Schema.Boolean),
  /**
   * Budget answer turn. Opt-in: when the run holds validated tool evidence, no
   * tool work is outstanding and only the answer is missing, the last think
   * call the iteration budget allows ships with no tools, so the model writes
   * the answer instead of a tool call nobody answers. A verified reply ends
   * the run as the model's own final answer; the harness never writes it. Off
   * by default: the ablation verdict was OPT-IN (+1.9pp over 3 tiers, within
   * noise). (`RA_BUDGET_ANSWER_TURN=1`)
   */
  budgetAnswerTurn: Schema.optional(Schema.Boolean),
  /**
   * Lean thinking. Opt-in: on a thinking model, a tool-selection turn (tools
   * on the wire, last tool result not a failure) is requested with
   * `thinking: false`, so the model picks its tool without a reasoning chain.
   * Every other turn thinks as before. Off by default pending a live ablation.
   * (`RA_LEAN_THINKING=1`)
   */
  leanThinking: Schema.optional(Schema.Boolean),
  computeOffload: Schema.optional(Schema.Boolean),
  /**
   * Plan tool catalog: plan-posture guidance gains one capped line naming the
   * tools the execute phase would have. Advisory text only; default off.
   * (`RA_PLAN_TOOL_CATALOG=1`)
   */
  planToolCatalog: Schema.optional(Schema.Boolean),
  /**
   * LLM recovery budget: how many recoverable provider failures on think
   * turns one run may retry instead of ending with `llm_error`. Malformed
   * model output is resampled; a request over the context window or the
   * per-minute token budget is shrunk and re-sent; a rate limit, timeout,
   * network or 5xx failure backs off and re-sends. Fatal classes (auth,
   * quota, invalid request) still end the run. Whole number, clamped to
   * 0..10. Default 2. `0` turns recovery off, overflow compaction included.
   * Config only (no env var).
   */
  llmRecoveryBudget: Schema.optional(Schema.Number),
});

export type HarnessConfigEncoded = typeof HarnessConfigSchema.Type;
