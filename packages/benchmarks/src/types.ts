// File: src/types.ts
/**
 * Benchmark types — task definitions, run results, and report shape.
 */

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

export type QualityDimension =
  | "accuracy"
  | "reasoning"
  | "tool-mastery"
  | "memory-fidelity"
  | "loop-intelligence"
  | "resilience"
  | "efficiency"
  | "reliability"
  | "scope-discipline"
  | "honest-uncertainty"

export interface DimensionScore {
  readonly dimension: QualityDimension;
  /** Normalized score 0–1 (1.0 = excellent). */
  readonly score: number;
  readonly evidence?: string;
}

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
