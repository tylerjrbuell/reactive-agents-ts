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
   * Budget answer turn. Default on: when the run holds validated tool
   * evidence, no tool work is outstanding and only the answer is missing, the
   * last think call the iteration budget allows ships with no tools, so the
   * model writes the answer instead of a tool call nobody answers. A verified
   * reply ends the run as the model's own final answer; the harness never
   * writes it. Default on since 2026-11-19 (owner decision; the ablation
   * measured +1.9pp over 3 tiers, within noise). Set `false` (or
   * `RA_BUDGET_ANSWER_TURN=0`) to turn it off.
   */
  budgetAnswerTurn: Schema.optional(Schema.Boolean),
  wrapUpReserve: Schema.optional(Schema.Boolean),
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
   * tools the execute phase would have, by name (MCP tools grouped). Advisory
   * text only; default ON (ablation pending). `false` or `RA_PLAN_TOOL_CATALOG=0`
   * turns it off.
   */
  planToolCatalog: Schema.optional(Schema.Boolean),
  /**
   * Plan budget: a run seeded with a plan checklist gets its iteration bound
   * raised once at run start to fit the unchecked steps plus a reserve, capped
   * at min(60, 3x configured). Default OFF (opt-in): the 2026-11-16 plan-posture
   * ablation measured +15-36% tokens with no accuracy lift. `true` or
   * `RA_PLAN_BUDGET=1` turns it on; explicit config beats the env.
   */
  planBudget: Schema.optional(Schema.Boolean),
  /**
   * Auto-tick: the harness marks todo rows done from tool evidence, so the
   * model spends no turn on the bookkeeping. On a seeded-plan run, a step whose
   * tool hint names a tool that just succeeded (and that no other unchecked
   * step names) is marked done. On a list the model wrote itself, each
   * successful call ticks one open row whose hint names that tool (the
   * in-progress row first, else the earliest). At the end of the run, rows the
   * ledger evidences are closed with provenance. Default ON; `false` or
   * `RA_AUTO_TICK=0` turns it off.
   */
  autoTick: Schema.optional(Schema.Boolean),
  /**
   * Bookkeeping refund: a round that only called `todo` (or, in plan posture
   * with `planRecon`, only recon tools) does not count against
   * `maxIterations`. Seeded-plan runs: at most half the budget is refunded. A
   * list the model wrote itself: at most 2 refunds per pass and 4 per run.
   * Default ON; `false` or `RA_BOOKKEEPING_REFUND=0` turns it off.
   */
  bookkeepingRefund: Schema.optional(Schema.Boolean),
  /**
   * Plan recon: under plan posture the model may call tools whose effect is
   * `read` (bounded: 6 calls per run, 2 per tool) to look up facts the plan
   * needs. Each successful result is recorded as a plan finding (`Plan.findings`)
   * and seeds the execute run. Default OFF pending an ablation; `true` or
   * `RA_PLAN_RECON=1` turns it on.
   */
  planRecon: Schema.optional(Schema.Boolean),
  /**
   * Parallel tool hint: a short prompt line telling the model it may make
   * independent tool calls together in one reply. `true` shows it only when
   * the model's calibration rates parallel calls `reliable`; `"always"` shows
   * it whatever the calibration says; `false` turns it off. Default ON
   * (calibration-gated, as `true`) since v0.19.0: owner decision on efficiency
   * evidence (equal pass rate, about 37% fewer turns, 33-39% fewer billed
   * tokens on the 2026-11-18 speedups ablation). Env:
   * `RA_PARALLEL_TOOL_HINT=0` (or `off`) turns it off, `=always` forces it.
   */
  parallelToolHint: Schema.optional(Schema.Union(Schema.Boolean, Schema.Literal("always"))),
  /**
   * Lean final turn: once the run's declared tool work is done and only the
   * answer is left, the next think call ships with no tools and no thinking
   * allowance. Opt-in, default OFF: the 2026-11-18 ablation rejected it
   * (significant accuracy loss on a small local model, where the turn fired
   * before all named inputs were read). It stays off until a re-ablation
   * clears it. Env: `RA_LEAN_FINAL_TURN=1`.
   */
  leanFinalTurn: Schema.optional(Schema.Boolean),
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
  /**
   * Repetition backstop: the hard cap on how many times the repetition guard
   * lets one tool run with new arguments while its results still add
   * information. `maxCalls` sets the cap as a plain call count (whole number
   * >= 0) and wins over `iterationFraction`, which counts iterations' worth of
   * calls: `ceil(maxIterations * fraction)` iterations (fraction clamped to
   * 0..1) times the calls one iteration may batch for the tool (`maxBatchSize`
   * for a parallel-safe tool, 1 otherwise). The guard's review point is always
   * the floor. Default: 0.75 of `maxIterations`. Raise it for long-horizon
   * tasks that query one tool many times. Config only (no env var).
   */
  repetitionBackstop: Schema.optional(
    Schema.Struct({
      iterationFraction: Schema.optional(Schema.Number),
      maxCalls: Schema.optional(Schema.Number),
    }),
  ),
});

export type HarnessConfigEncoded = typeof HarnessConfigSchema.Type;
