// File: src/types.ts
/**
 * Benchmark types — task definitions, run results, and report shape.
 */

/** Complexity tier for benchmark tasks. */
export type Tier = "trivial" | "simple" | "moderate" | "complex" | "expert";

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
