/**
 * HarnessConfig — the typed, per-agent control surface for harness mechanisms.
 *
 * WHY THIS EXISTS. Every mechanism below was previously reachable ONLY through
 * a process-global environment variable read at the call site
 * (`harness-flags.ts`). That made the harness un-configurable from code, absent
 * from the 80-method builder surface, undocumented, and — the load-bearing
 * defect — process-global, so two agents in one process could not differ and a
 * sub-agent could not inherit anything.
 *
 * PRECEDENCE IS FIXED: explicit config > environment variable > built-in
 * default. An env var never overrides a programmatic choice; it only fills a
 * hole. The env layer is `harness-flags.ts`, which remains the ONLY place in
 * `packages/reasoning` that reads the RA-prefixed environment variables (gate:
 * scripts/check-ablatable.sh).
 *
 * ABSENT-FIELD DISCIPLINE. Fields whose "unset" state is meaningful
 * (`recencyBudgetChars`, `toolResultBudgetChars`, `toolIndexMaxEntries`,
 * `promptDumpPathPrefix`) are written with a conditional spread and are absent
 * — not `undefined` — when nothing sets them, so `"x" in resolved` still
 * distinguishes "no override" from "override of 0". Same rule as
 * `buildRunEnvelope`.
 */
import {
  lazyDisclosureEnabled,
  toolDiscoveryEnabled,
  toolIndexEnabled,
  toolIndexMaxEntriesFlag,
  verboseRulesEnabled,
  recencyBudgetCharsOverride,
  toolResultBudgetCharsOverride,
  rationaleAuditEnabled,
  treeOfThoughtExploreBudgetMs,
  assemblyDebugEnabled,
  promptDumpPathPrefix,
  actOrAnswerMode,
  actOrAnswerFlagUnset,
  inputCoverageEnabled,
  writeCoverageEnabled,
  stableToolListEnabled,
  compactCallConstraintsEnabled,
  budgetAnswerTurnEnabled,
  wrapUpReserveEnabled,
  todoWrapUpEnabled,
  leanThinkingEnabled,
  parallelToolHintMode,
  leanFinalTurnEnabled,
  computeOffloadEnabled,
  planToolCatalogEnabled,
  planBudgetEnabled,
  planReconEnabled,
  autoTickEnabled,
  bookkeepingRefundEnabled,
} from "./harness-flags.js";

/** User-facing shape: every field optional, absent means "do not decide". */
export interface HarnessConfig {
  /** Per-iteration lazy tool disclosure. Default ON. (`RA_LAZY_TOOLS=0`) */
  readonly lazyDisclosure?: boolean;
  /** Register the `discover-tools` meta-tool. Default follows `lazyDisclosure`. (`RA_TOOL_DISCOVERY`) */
  readonly toolDiscovery?: boolean;
  /** Render a cheap name+one-line index of the hidden tool set. Default OFF. (`RA_TOOL_INDEX`) */
  readonly toolIndex?: boolean;
  /** Cap on entries in that index. Unset ⇒ the tier profile decides. (`RA_TOOL_INDEX_MAX_ENTRIES`) */
  readonly toolIndexMaxEntries?: number;
  /**
   * The disclosure mode a caller named explicitly (set by `fromDisclosureMode`,
   * i.e. `.withTools({ disclosure })`). Read from the explicit config layer only,
   * never from a tier default. `"discover"` makes the surface strict: turn 1
   * offers meta + required tools, and a domain tool appears only once used or
   * discovered (tool-surface.ts).
   */
  readonly disclosureMode?: ToolDisclosureMode;
  /** Inject the verbose ReAct RULES block. Default OFF. (`RA_VERBOSE_RULES`) */
  readonly verboseRules?: boolean;
  /** Character budget for recent observations. Unset ⇒ derived from the window. (`RA_RECENCY_BUDGET_CHARS`) */
  readonly recencyBudgetChars?: number;
  /** Per-tool-result preservation cap. Unset ⇒ the tier table decides. (`RA_TOOL_RESULT_BUDGET_CHARS`) */
  readonly toolResultBudgetChars?: number;
  /** Emit a per-tool-call rationale block for audit. Default OFF — an AUDIT
   *  feature, measured as a pure speed/token tax. (`RA_RATIONALE_AUDIT`) */
  readonly auditRationale?: boolean;
  /** Tree-of-Thought exploration budget in milliseconds. Default 120000. (`RA_TOT_EXPLORE_BUDGET_MS`) */
  readonly treeOfThoughtExploreBudgetMs?: number;
  /** Verbose assembly-stage diagnostics. Debug only. (`RA_ASSEMBLY_DEBUG`) */
  readonly assemblyDebug?: boolean;
  /** Write each rendered prompt to `<prefix>-<n>.txt`. Debug only. (`RA_PROMPT_DUMP`) */
  readonly promptDumpPathPrefix?: string;
  /**
   * Ollama `num_ctx` allocation policy. Default `"fixed"` (today's behavior:
   * `capability.recommendedNumCtx`/`config.defaultNumCtx`, unchanged per-model
   * value). `"demand"` opts in to sizing `num_ctx` to the assembled prompt each
   * turn (D-2026-07-30-I `nextNumCtx`), monotone-growing within a run — Ollama
   * reloads the model whenever `num_ctx` changes, so it never shrinks. No env
   * flag: this is a config-only surface (avoids another `RA_*`), gated on
   * `providerName === "ollama"` at the wiring site (think.ts) since it has no
   * effect on any other provider. Ships opt-in pending cross-model measurement
   * (see wiki/Research/Harness-Reports/2026-09-15-num-ctx-demand.md).
   */
  readonly numCtxPolicy?: "fixed" | "demand";
  /**
   * Act-or-answer. When a think turn ends with no tool call while tool work is
   * still outstanding (a required tool not yet called, or an unmet
   * tool-satisfied delivery condition), ask the model once more in the same
   * turn with `toolChoice: "required"` over the turn's callable tools (plus
   * `final-answer` when it is offered). A call it returns runs as the turn's
   * call; otherwise the original reply is handled as before. One retry per
   * stall: the next retry waits until a tool has run. Native function calling
   * only. Default OFF. (`RA_ACT_OR_ANSWER`)
   *
   * `"proactive"`: when such a turn is known to expect an action before the
   * call (tool work outstanding, including a plan-execute step's declared tools
   * not yet called), its FIRST request already carries `toolChoice: "required"`,
   * so no prose turn is spent. Not forced right after a failed tool call (the
   * model may need to change approach), nor on Anthropic thinking-capable
   * models (a forced call turns extended thinking off there). The retry stays
   * as the fallback when the forced reply has no call. (`RA_ACT_OR_ANSWER=proactive`)
   *
   * `"auto"`: the mode is chosen per model at run start by
   * {@link resolveActOrAnswer}: the model's learned `calibration.actOrAnswer`
   * when present, else retry on Ollama (local tokens are free and it only fires
   * on a stall) and off on every other provider. (`RA_ACT_OR_ANSWER=auto`)
   */
  readonly actOrAnswer?: ActOrAnswerSetting;
  /**
   * Input coverage. Each input the task explicitly lists (a file path or URL
   * that is not a deliverable) becomes its own requirement, met by a call that
   * reads that input. Reading one listed file then no longer counts as having
   * read them all: the exit gate lists each unread input, and act-or-answer
   * counts it as outstanding tool work. Default OFF. (`RA_INPUT_COVERAGE=1`)
   */
  readonly inputCoverage?: boolean;
  /**
   * Write coverage. Each in-place edit target the task lists (an existing,
   * non-test file under a "fix the ... in place" style instruction) becomes its
   * own requirement, met only by a successful write of that path. One write then
   * no longer counts as having fixed every target: the exit gate lists each
   * unwritten target and act-or-answer counts it as outstanding tool work.
   * Default OFF. (`RA_WRITE_COVERAGE=1`)
   */
  readonly writeCoverage?: boolean;
  /**
   * Stable tool list. A kernel pass resolves its tool list on its first think
   * turn and keeps it for the rest of the pass: tools are only appended (a
   * `discover-tools` result, a tool the model used), never removed, so the tool
   * block at the head of the prompt stays byte-stable and the provider prompt
   * cache survives. A tool that is not ready yet (`recall` before anything is
   * stored, `discover-tools` with nothing left to load) stays listed and its
   * call is refused with what to do first. The head-truncation guard may drop
   * tools only on the first turn; later turns shrink history instead.
   * Distinct from the removed `RA_STABLE_TOOL_SURFACE`, which showed the full
   * permitted surface: this keeps the first turn's shortlist.
   * Default OFF. (`RA_STABLE_TOOL_LIST=1`)
   */
  readonly stableToolList?: boolean;
  /**
   * Compact call constraints. Compact tool profiles (`names-only`,
   * `names-and-types`, the local tier) drop description prose. With this on
   * they keep the sentences that limit a parameter's values ("type is one of
   * url, referrer, ...") in the prompt tool reference, the driver listing and
   * the wire description, and the compact reference lists enum values as
   * `a|b|c`. Full-detail profiles are unchanged.
   * Default OFF. (`RA_COMPACT_CALL_CONSTRAINTS=1`)
   */
  readonly compactCallConstraints?: boolean;
  /**
   * Budget answer turn. When the run holds validated tool evidence, no tool
   * work is outstanding and only the answer is missing, the last think call
   * the iteration budget allows ships with no tools, so the model writes the
   * answer instead of making a tool call nobody answers. A verified reply ends
   * the run as the model's own final answer. The harness never writes it.
   * Default OFF: ablation 2026-11-10 measured +1.9pp over 3 tiers (within
   * noise). (`RA_BUDGET_ANSWER_TURN=1`)
   */
  readonly budgetAnswerTurn?: boolean;
  /**
   * Wrap-up reserve. On a seeded (checklist) run with validated tool evidence,
   * the last think call the iteration budget allows ships with no tools, so
   * the model answers and names the unchecked steps instead of making a call
   * nobody answers. Default OFF until an ablation measures it.
   * (`RA_WRAPUP_RESERVE=1`)
   */
  readonly wrapUpReserve?: boolean;
  /**
   * Lean thinking. A tool-selection turn on a thinking-capable Ollama model
   * (native function calling, a domain tool on the wire, tool work outstanding,
   * the last tool result not a failure) is requested with `thinking: false`, so
   * the model picks its tool without a reasoning chain. Every other turn thinks
   * as before, and the thinking-runaway recovery is unchanged. Boolean only:
   * llm-provider has no per-turn thinking-token budget.
   * Default OFF pending a live ablation. (`RA_LEAN_THINKING=1`)
   */
  readonly leanThinking?: boolean;
  /**
   * Parallel tool hint. The system prompt gains one line inviting the model to
   * make independent tool calls together in one reply (the kernel already runs
   * every call of a reply before the next turn). `true` shows it only when the
   * model's calibration rates parallel calls `reliable`; `"always"` shows it
   * whatever the calibration says. Native function calling only; never on a
   * tools-withheld turn, under plan posture, or when parallel tool calls are
   * turned off (`nextMovesPlanning.enabled: false`).
   * Default OFF pending an ablation. (`RA_PARALLEL_TOOL_HINT=1` / `=always`)
   */
  readonly parallelToolHint?: boolean | "always";
  /**
   * Lean final turn. When the run contract declared tool work (a required
   * tool, a file, an action), all of it is done and only the answer is left,
   * the next think call ships with no tools, `thinking: false`, and the think
   * output budget without the thinking allowance. If that reply is not the
   * final answer, the following call has its tools again; the lean turn
   * applies again only after another tool call. Native function calling only.
   * Default OFF pending an ablation. (`RA_LEAN_FINAL_TURN=1`)
   */
  readonly leanFinalTurn?: boolean;
  /**
   * Compute offload. When the task text asks for a numeric aggregate over data
   * the run reads (an aggregate verb AND a data-source reference), `code-execute`
   * stays on the visible tool surface even if the task did not declare it (it
   * must be in the permitted catalog), and one advisory guidance line follows
   * once data was read without a successful `code-execute` call. Advisory only:
   * no veto, no exit-gate change.
   * Default OFF pending an ablation. (`RA_COMPUTE_OFFLOAD=1`)
   */
  readonly computeOffload?: boolean;
  /**
   * Plan tool catalog. Under plan posture the guidance gains one capped line
   * listing the tools the execute phase would have (names plus a one-line
   * description; "you cannot call these now; reference them in steps as
   * `tool: name`"). Advisory text only: the plan tool surface is unchanged.
   * Default ON (ablation pending); `false` or `RA_PLAN_TOOL_CATALOG=0` turns it
   * off. Execute posture never reads it.
   */
  readonly planToolCatalog?: boolean;
  /**
   * Plan budget. A run seeded with a plan checklist whose unchecked steps (plus
   * a reserve of max(2, 25%)) need more iterations than `maxIterations` gets the
   * bound raised once at run start, to at most min(60, 3x configured); recorded
   * as a `plan-budget` harness signal and a `plan_budget_raised` event. Unseeded
   * runs and plans that fit are unchanged. Cost, token and time limits are
   * untouched. Default OFF (opt-in: its ablation measured more tokens with no
   * success lift); `true` or `RA_PLAN_BUDGET=1` turns it on.
   */
  readonly planBudget?: boolean;
  /**
   * Seeded-plan auto-tick. A plan step whose tool hint names a tool that just
   * succeeded (and that no other unchecked step names) is marked done by the
   * harness, so the model spends no turn on the bookkeeping. Default ON;
   * `false` or `RA_AUTO_TICK=0` turns it off.
   */
  readonly autoTick?: boolean;
  /**
   * Bookkeeping refund. On a seeded plan run a round that only called `todo`
   * (or, with `planRecon`, only recon tools) does not count against
   * `maxIterations`; at most half the budget is refunded. Default ON; `false`
   * or `RA_BOOKKEEPING_REFUND=0` turns it off.
   */
  readonly bookkeepingRefund?: boolean;
  /**
   * Plan recon. Under plan posture the model may call tools whose schema
   * `effect` is `read` (a `write`, `unknown` or absent effect never is) to look
   * facts up, such as an id the plan needs. Bounded by a harness budget: 6
   * calls per run, 2 per tool. Each successful result is recorded as a
   * `plan-finding` ledger fact and seeds the execute run's context; once the
   * budget is spent (or on the last iteration) only `todo` / `final-answer`
   * remain so the plan reply is produced. Execute posture never reads it.
   * Default OFF pending an ablation; `true` or `RA_PLAN_RECON=1` turns it on.
   */
  readonly planRecon?: boolean;
  /**
   * LLM recovery budget: how many recoverable provider failures on think turns
   * one run may retry. A think call that fails with a recoverable error class
   * is retried in the same turn instead of ending the run: malformed model
   * output is resampled, a too-large request is compacted and re-sent once per
   * run, a rate limit / timeout / network / 5xx failure waits a bounded time
   * and re-sends. The same class is never retried three times in a row. Text
   * the failed attempt streamed is discarded (the `llm-recovery` signal says
   * so). Fatal classes (auth, quota, invalid request, ...) and an exhausted
   * budget still end the run with `llm_error`. `0` turns recovery off,
   * including the overflow compaction. Default 2. Config only (no env flag).
   */
  readonly llmRecoveryBudget?: number;
  /**
   * Repetition backstop: the hard cap on the repetition guard's distinct-arguments
   * pass. Past its review point a tool keeps running with new arguments while its
   * results still add information, until it has run this many times; then the
   * guard refuses the call however much it still yields. Raise it for
   * long-horizon tasks that query one tool many times.
   *
   * - `maxCalls`: the cap as a call count. A whole number >= 0 (fractions are
   *   floored, negatives become 0). When set, it replaces `iterationFraction`.
   * - `iterationFraction`: the cap as `ceil(maxIterations * fraction)`
   *   iterations' worth of calls (`maxBatchSize` calls per iteration for a
   *   parallel-safe tool, 1 otherwise). Clamped to 0..1. Default
   *   {@link DEFAULT_REPETITION_BACKSTOP_FRACTION} (0.75).
   *
   * The guard's review point (2 calls, or `maxBatchSize` for parallel-safe
   * tools, or the tool's required quantity) is always the floor: a lower cap
   * never refuses a call the review point lets through. Non-finite values are
   * ignored. Default: unset, which keeps 0.75 of `maxIterations`. Config only
   * (no env flag).
   */
  readonly repetitionBackstop?: RepetitionBackstop;
}

/** The two ways to set the repetition backstop (see `HarnessConfig.repetitionBackstop`). */
export interface RepetitionBackstop {
  /** Cap as a fraction of `maxIterations` (0..1). */
  readonly iterationFraction?: number;
  /** Cap as a call count (whole number >= 0); wins over `iterationFraction`. */
  readonly maxCalls?: number;
}

/** Default {@link RepetitionBackstop.iterationFraction}: 0.75 of the run's `maxIterations`. */
export const DEFAULT_REPETITION_BACKSTOP_FRACTION = 0.75;

/**
 * The repetition backstop as a call count for a run of `maxIterations`:
 * `maxCalls` when configured, else `ceil(maxIterations * iterationFraction)`
 * iterations (default fraction 0.75) times `callsPerIteration`, the calls one
 * iteration may batch for the tool (`maxBatchSize` for a parallel-safe tool, 1
 * otherwise). The fraction counts iterations: a model batching 3-4 distinct
 * calls per turn tripped a call-count cap after 2-3 turns (owner trace
 * 01M7SZPWPNY8, gemini-flash, maxIterations 16). The caller applies the
 * review-point floor.
 */
export function repetitionBackstopCalls(
  h: Pick<ResolvedHarness, "repetitionBackstop"> | undefined,
  maxIterations: number,
  callsPerIteration = 1,
): number {
  const configured = h?.repetitionBackstop;
  if (configured?.maxCalls !== undefined) return configured.maxCalls;
  const iterations = Math.ceil(maxIterations * (configured?.iterationFraction ?? DEFAULT_REPETITION_BACKSTOP_FRACTION));
  return iterations * Math.max(1, Math.floor(callsPerIteration));
}

/** Clamp a configured backstop: fraction to 0..1, maxCalls to a whole number >= 0; non-finite = unset. */
function clampRepetitionBackstop(b: RepetitionBackstop | undefined): RepetitionBackstop | undefined {
  if (b === undefined) return undefined;
  const fraction = b.iterationFraction !== undefined && Number.isFinite(b.iterationFraction)
    ? Math.min(1, Math.max(0, b.iterationFraction))
    : undefined;
  const maxCalls = b.maxCalls !== undefined && Number.isFinite(b.maxCalls)
    ? Math.max(0, Math.floor(b.maxCalls))
    : undefined;
  if (fraction === undefined && maxCalls === undefined) return undefined;
  return Object.freeze({
    ...(fraction !== undefined ? { iterationFraction: fraction } : {}),
    ...(maxCalls !== undefined ? { maxCalls } : {}),
  });
}

/** Default {@link HarnessConfig.llmRecoveryBudget}: recoveries per run. */
export const DEFAULT_LLM_RECOVERY_BUDGET = 2;

/** Upper bound on a configured recovery budget. */
const MAX_LLM_RECOVERY_BUDGET = 10;

/** `true` = forced retry after a no-call turn; `"proactive"` = force the first request, retry as fallback. */
export type ActOrAnswerMode = boolean | "proactive";

/** What a caller may configure: a concrete mode, or `"auto"` (resolved per model at run start). */
export type ActOrAnswerSetting = ActOrAnswerMode | "auto";

/** The learned per-model choice (`ModelCalibration.actOrAnswer` in llm-provider). */
export type ActOrAnswerCalibration = "proactive" | "retry" | "off";

/**
 * Where a resolved act-or-answer mode came from. `"default-off"` is the
 * never-configured OFF state (no config value, no `RA_ACT_OR_ANSWER`), distinct
 * from an `"explicit"` setting of `false`.
 */
export type ActOrAnswerSource = "explicit" | "calibration" | "default" | "default-off";

/**
 * `true` when nothing set act-or-answer: no `HarnessConfig.actOrAnswer` and no
 * `RA_ACT_OR_ANSWER`. Callers pass it as `resolveActOrAnswer`'s `unconfigured`.
 */
export function actOrAnswerIsDefault(config: { readonly actOrAnswer?: ActOrAnswerSetting } | undefined): boolean {
  return config?.actOrAnswer === undefined && actOrAnswerFlagUnset();
}

/** A resolved act-or-answer mode and where it came from. */
export interface ResolvedActOrAnswer {
  readonly mode: ActOrAnswerMode;
  readonly source: ActOrAnswerSource;
}

const FROM_CALIBRATION: Readonly<Record<ActOrAnswerCalibration, ActOrAnswerMode>> = {
  proactive: "proactive",
  retry: true,
  off: false,
};

/**
 * Resolve an act-or-answer setting to the mode a run uses. Pure.
 *
 * An explicit mode (`true` / `false` / `"proactive"`) wins. `"auto"` takes the
 * model's learned `calibration.actOrAnswer` when present; with none, Ollama
 * gets retry (local tokens are free, and retry only fires on a stall) and every
 * other provider gets off (paid tiers stay cost-optimized).
 */
export function resolveActOrAnswer(
  configured: ActOrAnswerSetting,
  calibration?: { readonly actOrAnswer?: ActOrAnswerCalibration },
  provider?: string,
  unconfigured?: boolean,
): ResolvedActOrAnswer {
  if (configured !== "auto") return { mode: configured, source: configured === false && unconfigured === true ? "default-off" : "explicit" };
  const learned = calibration?.actOrAnswer;
  if (learned !== undefined) return { mode: FROM_CALIBRATION[learned], source: "calibration" };
  return { mode: provider === "ollama", source: "default" };
}

/** The run-start inputs {@link resolveRunStartHarness} reads. */
export interface RunStartHarnessInput {
  readonly harness?: ResolvedHarness;
  readonly calibration?: { readonly actOrAnswer?: ActOrAnswerCalibration };
  readonly providerName?: string;
}

/**
 * Resolve an unresolved `actOrAnswer: "auto"` once, at the kernel's run start,
 * from the input's calibration and provider, so nothing below the run start
 * sees `"auto"`. Returns `input` itself when there is nothing to resolve. Pure.
 */
export function resolveRunStartHarness<I extends RunStartHarnessInput>(input: I): I {
  const harness = input.harness ?? resolveHarnessConfig();
  if (harness.actOrAnswer !== "auto") return input;
  const { mode } = resolveActOrAnswer("auto", input.calibration, input.providerName);
  return { ...input, harness: Object.freeze({ ...harness, actOrAnswer: mode }) };
}

/** Internal shape: booleans and always-defaulted numbers are present; genuinely
 *  optional overrides stay optional so "absent" survives the round trip. */
export interface ResolvedHarness {
  readonly lazyDisclosure: boolean;
  readonly toolDiscovery: boolean;
  readonly toolIndex: boolean;
  readonly toolIndexMaxEntries?: number;
  /** Explicit disclosure mode (config layer only; see `HarnessConfig.disclosureMode`). */
  readonly disclosureMode?: ToolDisclosureMode;
  readonly verboseRules: boolean;
  readonly recencyBudgetChars?: number;
  readonly toolResultBudgetChars?: number;
  readonly auditRationale: boolean;
  readonly treeOfThoughtExploreBudgetMs: number;
  readonly assemblyDebug: boolean;
  readonly promptDumpPathPrefix?: string;
  readonly numCtxPolicy: "fixed" | "demand";
  /**
   * Act-or-answer setting (see `HarnessConfig.actOrAnswer`); `false` = off.
   * May be `"auto"` only until the kernel's run start ({@link resolveRunStartHarness}).
   */
  readonly actOrAnswer: ActOrAnswerSetting;
  /** Input coverage (see `HarnessConfig.inputCoverage`). Present only when on. */
  readonly inputCoverage?: true;
  /** Write coverage (see `HarnessConfig.writeCoverage`). Present only when on. */
  readonly writeCoverage?: true;
  /** Stable tool list (see `HarnessConfig.stableToolList`). Present only when on. */
  readonly stableToolList?: true;
  /** Compact call constraints (see `HarnessConfig.compactCallConstraints`). Present only when on. */
  readonly compactCallConstraints?: true;
  /** Budget answer turn (see `HarnessConfig.budgetAnswerTurn`). Present only when on. */
  readonly budgetAnswerTurn?: true;
  /** Wrap-up reserve (see `HarnessConfig.wrapUpReserve`). Present only when on. */
  readonly wrapUpReserve?: true;
  /**
   * Todo wrap-up. When the model's final answer would be accepted while todo
   * rows it opened are still open, the harness holds the answer for one
   * bounded turn and names the open rows, so the model can close or explain
   * them. Never checks a row for the model. Costs one model call. Default OFF
   * until an ablation measures it; env-only for now (`RA_TODO_WRAPUP=1`), no
   * `HarnessConfig` field yet. Present only when on.
   */
  readonly todoWrapUp?: true;
  /** Lean thinking (see `HarnessConfig.leanThinking`). Present only when on. */
  readonly leanThinking?: true;
  /** Parallel tool hint (see `HarnessConfig.parallelToolHint`). Present only when on: `true` = calibration-gated, `"always"` = forced. */
  readonly parallelToolHint?: true | "always";
  /** Lean final turn (see `HarnessConfig.leanFinalTurn`). Present only when on. */
  readonly leanFinalTurn?: true;
  /** Compute offload (see `HarnessConfig.computeOffload`). Present only when on. */
  readonly computeOffload?: true;
  /** Plan tool catalog (see `HarnessConfig.planToolCatalog`). Present when on (the default). */
  readonly planToolCatalog?: true;
  /** Plan budget (see `HarnessConfig.planBudget`). Present only when on; absent = off (the default). */
  readonly planBudget?: true;
  /** Auto-tick (see `HarnessConfig.autoTick`). Present only when OFF (`false`); absent = on (the default). */
  readonly autoTick?: false;
  /** Bookkeeping refund (see `HarnessConfig.bookkeepingRefund`). Present only when OFF (`false`); absent = on (the default). */
  readonly bookkeepingRefund?: false;
  /** Plan recon (see `HarnessConfig.planRecon`). Present only when on. */
  readonly planRecon?: true;
  /**
   * LLM recovery budget (see `HarnessConfig.llmRecoveryBudget`), a whole number
   * in 0..10. Present only when configured; absent = {@link DEFAULT_LLM_RECOVERY_BUDGET}.
   */
  readonly llmRecoveryBudget?: number;
  /**
   * Repetition backstop (see `HarnessConfig.repetitionBackstop`), clamped.
   * Present only when configured with at least one valid field; absent = 0.75
   * of `maxIterations` ({@link repetitionBackstopCalls}).
   */
  readonly repetitionBackstop?: RepetitionBackstop;
}

/** The recovery budget a resolved harness grants per run. */
export function llmRecoveryBudgetOf(h: Pick<ResolvedHarness, "llmRecoveryBudget">): number {
  return h.llmRecoveryBudget ?? DEFAULT_LLM_RECOVERY_BUDGET;
}

/** Clamp a configured budget to a whole number in 0..10; non-finite = unset. */
function clampRecoveryBudget(n: number | undefined): number | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  return Math.min(MAX_LLM_RECOVERY_BUDGET, Math.max(0, Math.floor(n)));
}

/** `config ?? env ?? default`, for a field whose env layer already folds in its default. */
function pick(configured: boolean | undefined, fromEnv: boolean): boolean {
  return configured !== undefined ? configured : fromEnv;
}

/** `config ?? env`, for a field where ABSENT is a meaningful third state. */
function pickOptional<T>(configured: T | undefined, fromEnv: T | undefined): T | undefined {
  return configured !== undefined ? configured : fromEnv;
}

/**
 * Resolve the harness config ONCE per run. Call this at the runtime boundary,
 * never at a call site — a call site that re-resolves reintroduces the
 * process-global read this type exists to remove.
 *
 * `profileDefault` is a FOURTH, lowest-priority layer beneath env — a
 * `ContextProfile` tier's `toolDisclosureMode` shorthand (via
 * `fromDisclosureMode()`), so precedence is exactly what the module doc
 * promises: explicit config > environment variable > tier default > hardcoded
 * default. It only ever fills the hole an UNSET env var leaves — an explicit
 * `RA_LAZY_TOOLS=0` (or any other explicit flag) still wins, same as before
 * this parameter existed (F-4, re-wired 2026-09-03 after the 2026-08-24
 * amendment's `fromDisclosureMode()` was found to have zero production
 * callers — see run-envelope-config.ts).
 */
export function resolveHarnessConfig(
  config: HarnessConfig = {},
  profileDefault: HarnessConfig = {},
): ResolvedHarness {
  const toolIndexMaxEntries = pickOptional(config.toolIndexMaxEntries, toolIndexMaxEntriesFlag());
  const recencyBudgetChars = pickOptional(config.recencyBudgetChars, recencyBudgetCharsOverride());
  const toolResultBudgetChars = pickOptional(
    config.toolResultBudgetChars,
    toolResultBudgetCharsOverride(),
  );
  const promptDump = pickOptional(config.promptDumpPathPrefix, promptDumpPathPrefix());
  const llmRecoveryBudget = clampRecoveryBudget(config.llmRecoveryBudget);
  const repetitionBackstop = clampRepetitionBackstop(config.repetitionBackstop);
  // `false` = off; `true` = calibration-gated; `"always"` = forced; unset = env.
  const parallelHint =
    config.parallelToolHint === undefined ? parallelToolHintMode()
    : config.parallelToolHint === false ? undefined
    : config.parallelToolHint;

  // Finding 5 (harness-control-surface final fix wave): `harness-flags.ts`
  // couples `toolDiscovery`'s and `verboseRules`' env-layer DEFAULTS to
  // `RA_LAZY_TOOLS` (see toolDiscoveryEnabled()/verboseRulesEnabled() there),
  // but that coupling only fires when reading raw env — it does not follow a
  // caller's `resolveHarnessConfig({ lazyDisclosure: false })`. Reproduce the
  // coupling one level up: when the caller explicitly set `lazyDisclosure` in
  // config (and did NOT also explicitly set the derived field), derive the
  // derived field's fallback from the RESOLVED `lazyDisclosure` value instead
  // of a fresh env read. When the caller left `lazyDisclosure` unset, behavior
  // is unchanged — the env layer's own coupling already applies.
  const resolvedLazyDisclosure = pick(
    config.lazyDisclosure,
    lazyDisclosureEnabled(profileDefault.lazyDisclosure),
  );
  const toolDiscoveryFallback =
    config.lazyDisclosure !== undefined
      ? resolvedLazyDisclosure
      : toolDiscoveryEnabled(profileDefault.toolDiscovery);
  const verboseRulesFallback =
    config.lazyDisclosure !== undefined ? !resolvedLazyDisclosure : verboseRulesEnabled();

  return Object.freeze({
    lazyDisclosure: resolvedLazyDisclosure,
    toolDiscovery: pick(config.toolDiscovery, toolDiscoveryFallback),
    toolIndex: pick(config.toolIndex, toolIndexEnabled(profileDefault.toolIndex)),
    ...(toolIndexMaxEntries !== undefined ? { toolIndexMaxEntries } : {}),
    // Explicit layer only: a tier/profile default never makes discovery strict.
    ...(config.disclosureMode !== undefined ? { disclosureMode: config.disclosureMode } : {}),
    verboseRules: pick(config.verboseRules, verboseRulesFallback),
    ...(recencyBudgetChars !== undefined ? { recencyBudgetChars } : {}),
    ...(toolResultBudgetChars !== undefined ? { toolResultBudgetChars } : {}),
    auditRationale: pick(config.auditRationale, rationaleAuditEnabled()),
    treeOfThoughtExploreBudgetMs:
      config.treeOfThoughtExploreBudgetMs ?? treeOfThoughtExploreBudgetMs(),
    assemblyDebug: pick(config.assemblyDebug, assemblyDebugEnabled()),
    ...(promptDump !== undefined ? { promptDumpPathPrefix: promptDump } : {}),
    numCtxPolicy: config.numCtxPolicy ?? "fixed",
    actOrAnswer: config.actOrAnswer ?? actOrAnswerMode(),
    // Present only when on, so a resolved harness without it is unchanged.
    ...(pick(config.inputCoverage, inputCoverageEnabled()) ? { inputCoverage: true as const } : {}),
    ...(pick(config.writeCoverage, writeCoverageEnabled()) ? { writeCoverage: true as const } : {}),
    ...(pick(config.stableToolList, stableToolListEnabled()) ? { stableToolList: true as const } : {}),
    ...(pick(config.compactCallConstraints, compactCallConstraintsEnabled())
      ? { compactCallConstraints: true as const }
      : {}),
    ...(pick(config.budgetAnswerTurn, budgetAnswerTurnEnabled()) ? { budgetAnswerTurn: true as const } : {}),
    ...(pick(config.wrapUpReserve, wrapUpReserveEnabled()) ? { wrapUpReserve: true as const } : {}),
    ...(todoWrapUpEnabled() ? { todoWrapUp: true as const } : {}),
    ...(pick(config.leanThinking, leanThinkingEnabled()) ? { leanThinking: true as const } : {}),
    ...(parallelHint !== undefined ? { parallelToolHint: parallelHint } : {}),
    ...(pick(config.leanFinalTurn, leanFinalTurnEnabled()) ? { leanFinalTurn: true as const } : {}),
    ...(pick(config.computeOffload, computeOffloadEnabled()) ? { computeOffload: true as const } : {}),
    ...(pick(config.planToolCatalog, planToolCatalogEnabled()) ? { planToolCatalog: true as const } : {}),
    ...(pick(config.planBudget, planBudgetEnabled()) ? { planBudget: true as const } : {}),
    ...(pick(config.autoTick, autoTickEnabled()) ? {} : { autoTick: false as const }),
    ...(pick(config.bookkeepingRefund, bookkeepingRefundEnabled()) ? {} : { bookkeepingRefund: false as const }),
    ...(pick(config.planRecon, planReconEnabled()) ? { planRecon: true as const } : {}),
    ...(llmRecoveryBudget !== undefined ? { llmRecoveryBudget } : {}),
    ...(repetitionBackstop !== undefined ? { repetitionBackstop } : {}),
  });
}

/** The no-config resolution — byte-identical to today's env-only behaviour. */
export const defaultResolvedHarness = (): ResolvedHarness => resolveHarnessConfig();

/** The four disclosure postures a `ContextProfile` can name. */
export type ToolDisclosureMode = "full" | "discover" | "index" | "hybrid";

/**
 * Expand a profile's `toolDisclosureMode` into the three mechanism switches it
 * actually means. This is what makes `ContextProfile.toolDisclosureMode` a real
 * field rather than a declared-and-unread one (spec finding F-4).
 *
 * The result is a plain `HarnessConfig`, so a caller can spread it and then
 * override any single field — the mode is a shorthand, never a lock.
 */
export function fromDisclosureMode(mode: ToolDisclosureMode): HarnessConfig {
  switch (mode) {
    case "full":
      return { lazyDisclosure: false, toolDiscovery: false, toolIndex: false, disclosureMode: mode };
    case "discover":
      return { lazyDisclosure: true, toolDiscovery: true, toolIndex: false, disclosureMode: mode };
    case "index":
      return { lazyDisclosure: true, toolDiscovery: false, toolIndex: true, disclosureMode: mode };
    case "hybrid":
      return { lazyDisclosure: true, toolDiscovery: true, toolIndex: true, disclosureMode: mode };
  }
}
