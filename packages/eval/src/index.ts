// Types
export type { EvalCase, EvalSuite } from "./types/eval-case.js";
export { EvalCaseSchema, EvalSuiteSchema } from "./types/eval-case.js";
export type { DimensionScore, EvalResult, EvalRun, EvalRunSummary } from "./types/eval-result.js";
export {
  DimensionScoreSchema,
  EvalResultSchema,
  EvalRunSchema,
  EvalRunSummarySchema,
} from "./types/eval-result.js";
export type { EvalConfig } from "./types/config.js";
export { EvalConfigSchema, DEFAULT_EVAL_CONFIG } from "./types/config.js";

// Errors
export { EvalError, BenchmarkError, DatasetError } from "./errors/errors.js";
export type { EvalErrors } from "./errors/errors.js";

// Dimension scorers (each takes an llm instance + params, returns Effect<DimensionScore, EvalError>)
export { scoreAccuracy } from "./dimensions/accuracy.js";
export { scoreRelevance } from "./dimensions/relevance.js";
export { scoreCompleteness } from "./dimensions/completeness.js";
export { scoreSafety } from "./dimensions/safety.js";
export { scoreCostEfficiency } from "./dimensions/cost-efficiency.js";

// Services
export { EvalService, EvalServiceLive } from "./services/eval-service.js";
export { DatasetService, DatasetServiceLive } from "./services/dataset-service.js";

// Runtime factory
export { createEvalLayer } from "./runtime.js";
