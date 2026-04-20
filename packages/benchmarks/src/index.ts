// Public API — v1 exports (unchanged)
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

// Public API — v2 additions
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

export { REAL_WORLD_TASKS } from "./tasks/real-world.js"
export { ABLATION_VARIANTS, resolveTasks, mergeConfigs, getVariant } from "./session.js"
export { runSession, aggregateRuns, computeAllAblation, summarizeDimensions } from "./runner.js"
export { scoreTask, computeReliability, matchSuccessCriteria, parsePartialCreditScore } from "./judge.js"
export { computeDrift, exceedsThreshold, saveBaseline, loadBaseline } from "./ci.js"

export { regressionGateSession }      from "./sessions/regression-gate.js"
export { realWorldFullSession }        from "./sessions/real-world-full.js"
export { competitorComparisonSession } from "./sessions/competitor-comparison.js"
export { localModelsSession }          from "./sessions/local-models.js"

export type { CompetitorRunner } from "./competitors/types.js"
export { COMPETITOR_RUNNERS }    from "./competitors/index.js"
