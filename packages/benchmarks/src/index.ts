// ─── v1 Benchmark Surface (stable in-repo) ───
// Package is `private: true` and never published. v1 surface is exercised by
// the regression-gate session and is considered stable for in-repo callers.
export type {
  BenchmarkTask,
  TaskResult,
  OverheadMeasurement,
  BenchmarkReport,
  MultiModelReport,
  Tier,
} from "./types.js"
export { BENCHMARK_TASKS, getTasksByTier } from "./task-registry.js"
export { runBenchmarks } from "./runner.js"
export type { RunnerOptions } from "./runner.js"

/**
 * ─── v2 Benchmark Surface ───
 * Session/ablation/drift APIs added on `refactor/overhaul`. Drives the v2
 * session runner (real-world tasks, dimensional rubrics, ablation matrix,
 * drift detection vs baselines).
 *
 * @unstable v2 surface is unvalidated outside in-repo sessions and the AUDIT
 * verdict for benchmarks is DEFER. Shape may change without notice in v0.10.x.
 * Package is `private: true`; the marker exists for in-repo consumers only.
 * See AUDIT-overhaul-2026.md §10.1 (benchmarks DEFER) and §11 #15.
 */
export type {
  QualityDimension,
  DimensionScore,
  RunScore,
  TaskVariantReport,
  AblationResult,
  SessionReport,
  DriftReport,
  HarnessVariant,
  InternalVariant,
  CompetitorVariant,
  HarnessConfig,
  ModelVariant,
  BenchmarkSession,
  DimensionRubric,
  TaskFixture,
  SuccessCriteria,
  TaskRunResult,
} from "./types.js"

/**
 * v2 task registry, session resolver, and ablation matrix helpers.
 * @unstable See v2 Benchmark Surface section above.
 */
export { REAL_WORLD_TASKS } from "./tasks/real-world.js"
export { ABLATION_VARIANTS, resolveTasks, mergeConfigs, getVariant } from "./session.js"

/**
 * v2 runner entry points: session execution, run aggregation, full ablation
 * sweep, and dimensional summarization.
 * @unstable See v2 Benchmark Surface section above.
 */
export { runSession, aggregateRuns, computeAllAblation, summarizeDimensions } from "./runner.js"

/**
 * v2 judge / scoring helpers.
 * @unstable See v2 Benchmark Surface section above.
 */
export { scoreTask, computeReliability, matchSuccessCriteria, parsePartialCreditScore } from "./judge.js"

/**
 * v2 CI drift detection — compares a `SessionReport` against a saved baseline
 * and computes per-dimension delta vs threshold.
 * @unstable See v2 Benchmark Surface section above.
 */
export { computeDrift, exceedsThreshold, saveBaseline, loadBaseline } from "./ci.js"

/**
 * v2 pre-built sessions (regression gate, real-world full sweep, competitor
 * comparison, local models matrix).
 * @unstable See v2 Benchmark Surface section above.
 */
export { regressionGateSession }      from "./sessions/regression-gate.js"
export { realWorldFullSession }        from "./sessions/real-world-full.js"
export { competitorComparisonSession } from "./sessions/competitor-comparison.js"
export { localModelsSession }          from "./sessions/local-models.js"

/**
 * v2 competitor runner port — adapter for non-harness baselines.
 * @unstable See v2 Benchmark Surface section above.
 */
export type { CompetitorRunner } from "./competitors/types.js"
export { COMPETITOR_RUNNERS }    from "./competitors/index.js"
