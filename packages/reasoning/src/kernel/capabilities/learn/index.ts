/**
 * learn/ — Compounding-intelligence capability barrel.
 *
 * Phase 1 (Issue #120): seam-only. Exports the LearningPipeline tag and the
 * NoopLearningPipelineLayer default. Phase 2 will add SkillStore /
 * CalibrationStore / MemoryStore writer layers from other warden dispatches.
 */
export {
  LearningPipeline,
  NoopLearningPipelineLayer,
  type LearningPipelineService,
  type LearningPipelineOutcome,
} from "./learning-pipeline.js";
