// File: src/types.ts
/**
 * Benchmark types — task definitions, run results, and report shape.
 */
import type { ToolRequirement, PreFlightViolation, QualityDimension, DimensionScore } from "@reactive-agents/core";

// Canonical quality taxonomy now lives in @reactive-agents/core (2026-06-25 unification).
export type { QualityDimension, DimensionScore };

/** Complexity tier for benchmark tasks. */
export type Tier = "trivial" | "simple" | "moderate" | "complex" | "expert" | "real-world";

/** A benchmark task definition. */
export interface BenchmarkTask {
  readonly id: string;
  readonly tier: Tier;
  readonly name: string;
  readonly prompt: string;
  /** Optional expected output pattern (regex or substring with | separators). */
  readonly expected?: string;
  /** Reasoning strategy to test (undefined = single-shot). */
  readonly strategy?: "react" | "plan-execute" | "tree-of-thought";
  /** Industry benchmark this task is aligned with. */
  readonly benchmark?: string;
  /** Whether tools are required. */
  readonly requiresTools?: boolean;
  /**
   * Sprint-1 TaskContract bridge: explicit tool requirements. When present,
   * the bench runner uses `toolsToExpose()` from `@reactive-agents/core` to
   * drive `.withTools({builtins: [...]})` exposure. Coexists with the legacy
   * `requiresTools: true` boolean during migration. Defaults: when omitted,
   * runner falls back to the fixtures-heuristic (any task with fixtures
   * exposes file-read/file-write).
   */
  readonly tools?: ReadonlyArray<ToolRequirement>;
  /** Whether security guardrails are required. */
  readonly requiresGuardrails?: boolean;
  /** Whether dynamic sub-agent spawning is required (spawn-agent tool). */
  readonly requiresDynamicSubAgents?: boolean;
  /** Override max iterations for this task (default: 30 for strategy tasks, 5 for single-shot). */
  readonly maxIterations?: number;
  readonly successCriteria?: SuccessCriteria;
  readonly dimensionRubrics?: ReadonlyArray<DimensionRubric>;
  readonly fixtures?: ReadonlyArray<TaskFixture>;
  readonly optimalHarnessConfig?: HarnessConfig;
  readonly primaryDimensions?: ReadonlyArray<QualityDimension>;
  readonly domain?: string;
  readonly tags?: ReadonlyArray<string>;
}

/** Result of running a single benchmark task. */
export interface TaskResult {
  readonly taskId: string;
  readonly tier: Tier;
  readonly strategy: string;
  readonly status: "pass" | "fail" | "error";
  readonly durationMs: number;
  readonly tokensUsed: number;
  readonly estimatedCost: number;
  readonly iterations: number;
  readonly output: string;
  readonly error?: string;
}

/** Overhead measurement for framework internals. */
export interface OverheadMeasurement {
  readonly label: string;
  readonly durationMs: number;
  readonly samples: number;
}

/** Full benchmark report. */
export interface BenchmarkReport {
  readonly timestamp: string;
  readonly provider: string;
  readonly model: string;
  readonly tasks: readonly TaskResult[];
  readonly overhead: readonly OverheadMeasurement[];
  readonly summary: {
    readonly totalTasks: number;
    readonly passed: number;
    readonly failed: number;
    readonly errors: number;
    readonly totalDurationMs: number;
    readonly totalTokens: number;
    readonly totalCost: number;
    readonly avgLatencyMs: number;
    readonly byTier: Record<Tier, { passed: number; total: number; avgMs: number }>;
  };
}

/** Multi-model benchmark report — contains results from multiple provider/model runs. */
export interface MultiModelReport {
  readonly generatedAt: string;
  readonly runs: readonly BenchmarkReport[];
}

// ── v2: Multi-dimensional scoring + session types ─────────────────────────────

export interface RunScore {
  readonly runIndex: number;
  readonly dimensions: ReadonlyArray<DimensionScore>;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly status: "pass" | "fail" | "error";
  readonly output: string;
  readonly traceId?: string;
}

export interface TaskVariantReport {
  readonly taskId: string;
  readonly modelVariantId: string;
  readonly variantId: string;
  readonly variantLabel: string;
  readonly runs: ReadonlyArray<RunScore>;
  readonly meanScores: ReadonlyArray<DimensionScore>;
  readonly variance: number;
  readonly meanTokens: number;
  readonly meanDurationMs: number;
  readonly passRate: number;
  /**
   * Set when the cell was NOT measured because a preflight contract was
   * violated (today: capability source=fallback). An inconclusive cell carries
   * `runs: []` and zeroed scores — it is excluded from aggregation, ablation,
   * and equal-or-better verdicts. `BenchCellOutcome` per canonical-contracts §6.
   */
  readonly inconclusive?: PreFlightViolation;
}

export interface AblationResult {
  readonly taskId: string;
  readonly taskName: string;
  readonly modelVariantId: string;
  readonly variants: ReadonlyArray<TaskVariantReport>;
  readonly harnessLift: number;
  readonly perDimensionLift: ReadonlyArray<DimensionLift>;
  readonly bestVariantId: string;
  readonly baselineVariantId: string;
}

/**
 * Reproducibility metadata attached to every SessionReport (Phase 0 Task 10).
 *
 * Per docs/spec/docs/00-RESEARCH-DISCIPLINE.md Rule 4 + the post-2025
 * reproducibility crisis literature: published bench numbers MUST include
 * enough metadata to replay the run from frozen artifacts. External readers
 * use these fields to verify a published score was produced by a specific
 * frozen judge (judgeModelSha + judgeCodeSha) and a specific bench code path.
 *
 * When no judge URL is configured (judge SHAs unavailable), the SHA fields
 * carry the sentinel `"unknown-no-judge-configured"` so absence of Rule-4
 * enforcement is explicit rather than silently null.
 */
export interface SessionReproducibility {
  /** SHA of the judge model used (from judge-server /version). */
  readonly judgeModelSha: string;
  /** SHA of the judge-server code used (from judge-server /version). */
  readonly judgeCodeSha: string;
  /** Unique identifier for this runSession invocation; shared by every judge call within the run. */
  readonly runId: string;
  /**
   * Bash command that re-runs this session **as registered**. Includes
   * `--session ${id}`, `--run-id ${runId}`, and (when set) `--judge-url`.
   *
   * Fidelity caveat: the command resolves through the session registry — it
   * does not materialize the full session config (provider, model, runs,
   * timeout, harness variants, log level) into the command line. If the
   * session definition file changes between recording and replay, the replay
   * will use the new definition. For exact-replay guarantees, archive the
   * full SessionReport alongside this command.
   */
  readonly replayCommand: string;
}

export interface SessionReport extends MultiModelReport {
  readonly sessionId: string;
  readonly sessionVersion: string;
  readonly gitSha: string;
  readonly ablation?: ReadonlyArray<AblationResult>;
  /**
   * Per-(task × model × variant) reports. Always populated alongside `ablation`.
   * Distinct from `ablation`, which only emits entries when a session contains
   * both a `bare-llm` baseline and `ra-full` variant — single-variant sessions
   * (regression-gate, frontier-spot-checks) need this field for breakdown.
   */
  readonly taskReports?: ReadonlyArray<TaskVariantReport>;
  readonly dimensionSummary?: ReadonlyArray<{
    readonly dimension: QualityDimension;
    readonly byVariant: ReadonlyArray<{ readonly variantId: string; readonly meanScore: number }>;
  }>;
  readonly drift?: DriftReport;
  /**
   * Reproducibility metadata (Phase 0 Task 10). Always populated.
   * See `SessionReproducibility` for the contract.
   */
  readonly reproducibility: SessionReproducibility;
  /**
   * Cells skipped because a preflight contract was violated (canonical-contracts
   * §6). Each entry names the (task × model × variant) cell + the reason. When
   * non-empty, `partialMeasurement` is true and the equal-or-better invariant
   * cannot be evaluated until every cell is conclusive.
   */
  readonly inconclusiveCells?: ReadonlyArray<{
    readonly taskId: string;
    readonly modelVariantId: string;
    readonly variantId: string;
    readonly reason: PreFlightViolation;
  }>;
  /** True iff any cell is inconclusive. A report with this set is PARTIAL. */
  readonly partialMeasurement?: boolean;
}

export interface DriftReport {
  readonly baselineGitSha: string;
  readonly regressions: ReadonlyArray<ScoreDelta>;
  readonly improvements: ReadonlyArray<ScoreDelta>;
  readonly hasRegressions: boolean;
  readonly maxRegressionDelta: number;
}

export interface HarnessConfig {
  readonly tools?: boolean;
  readonly reasoning?: boolean;
  readonly reactiveIntelligence?: boolean;
  readonly memory?: boolean;
  readonly guardrails?: boolean;
  readonly strategy?: "react" | "plan-execute" | "tree-of-thought" | "adaptive";
  /**
   * Verifier override for ablation runs. `"noop"` swaps the terminal §9.0
   * verifier gate inside the kernel for `noopVerifier`, which approves every
   * response unconditionally. Used by the M3 ablation to measure the
   * verifier's contribution to end-task accuracy. Undefined (default) preserves
   * production behavior (defaultVerifier).
   */
  readonly verifier?: "default" | "noop";
  /**
   * Arbitrary env vars to set for the duration of this variant's run (set before
   * agent build, restored in finally). Used for env-gated arms like the context
   * assembly A/B (`{ RA_ASSEMBLY: "0" }`). Generalizes the verifier:"noop" pattern.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export interface InternalVariant {
  readonly type: "internal";
  readonly id: string;
  readonly label: string;
  readonly config: HarnessConfig;
}

export interface CompetitorVariant {
  readonly type: "competitor";
  readonly id: string;
  readonly label: string;
  readonly framework: "langchain" | "vercel-ai" | "openai-agents" | "mastra" | "llamaindex";
  readonly frameworkVersion?: string;
  readonly frameworkConfig?: Record<string, unknown>;
}

export type HarnessVariant = InternalVariant | CompetitorVariant

export interface ModelVariant {
  readonly id: string;
  readonly provider: "anthropic" | "openai" | "gemini" | "ollama" | "litellm";
  readonly model: string;
  readonly contextTier?: "local" | "standard" | "large" | "frontier";
}

export interface BenchmarkSession {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly taskIds?: ReadonlyArray<string>;
  readonly tiers?: ReadonlyArray<Tier>;
  readonly tags?: ReadonlyArray<string>;
  readonly models: ReadonlyArray<ModelVariant>;
  readonly harnessVariants: ReadonlyArray<HarnessVariant>;
  readonly runs?: number;
  readonly traceDir?: string;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  /** Log level: "silent" = no output; "progress" = header + progress only; "verbose" = full details (default: "progress"). */
  readonly logLevel?: "silent" | "progress" | "verbose";
  /**
   * URL of the judge-server RPC endpoint. When set (or `JUDGE_URL` env var),
   * `runSession` enforces Rule 4 (judge model MUST differ from SUT model) by
   * probing `${judgeUrl}/version` before any task execution.
   * See docs/spec/docs/00-RESEARCH-DISCIPLINE.md Rule 4.
   */
  readonly judgeUrl?: string;
}

export interface DimensionRubric {
  readonly dimension: QualityDimension;
  readonly rubric: string;
  readonly weight?: number;
}

export interface ScoreDelta {
  readonly taskId: string;
  readonly variantId: string;
  readonly dimension: QualityDimension;
  readonly baselineScore: number;
  readonly currentScore: number;
  readonly delta: number;
}

export interface DimensionLift {
  readonly dimension: QualityDimension;
  readonly lift: number;
}

export interface TaskFixture {
  readonly path: string;
  readonly content: string;
}

export type SuccessCriteria =
  | { readonly type: "regex"; readonly pattern: string }
  | { readonly type: "verifiable"; readonly command: string; readonly partialCredit?: boolean }
  | { readonly type: "llm-judge"; readonly rubric: string; readonly passThreshold?: number }
  | { readonly type: "schema"; readonly schema: Record<string, unknown> }

export interface TaskRunResult {
  readonly output: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly iterations: number;
  readonly status: "pass" | "fail" | "error";
  readonly error?: string;
  readonly traceId?: string;
}
