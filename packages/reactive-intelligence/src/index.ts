// @reactive-agents/reactive-intelligence
// Phase 1: Entropy Sensor

// ── Types ──
export type {
  TokenLogprob,
  TokenEntropy,
  StructuralEntropy,
  SemanticEntropy,
  BehavioralEntropy,
  ContextSection,
  ContextPressure,
  EntropyTrajectoryShape,
  EntropyTrajectory,
  EntropyScore,
  ModelCalibration,
  EntropyMeta,
  ModelRegistryEntry,
  ReactiveIntelligenceConfig,
  ControllerDecision,
  ReactiveControllerConfig,
  ControllerEvalParams,
} from "./types.js";
export { defaultReactiveIntelligenceConfig } from "./types.js";

export type {
  EntropyScored,
  ContextWindowWarning,
  CalibrationDrift,
  ReactiveDecision,
} from "./events.js";

// ── Sensor modules ──
export { computeTokenEntropy } from "./sensor/token-entropy.js";
export { computeStructuralEntropy } from "./sensor/structural-entropy.js";
export { computeSemanticEntropy, updateCentroid } from "./sensor/semantic-entropy.js";
export { computeBehavioralEntropy } from "./sensor/behavioral-entropy.js";
export { computeContextPressure } from "./sensor/context-pressure.js";
export { computeCompositeEntropy } from "./sensor/composite.js";
export { computeEntropyTrajectory, iterationWeight, classifyTrajectoryShape } from "./sensor/entropy-trajectory.js";
export { cosineSimilarity } from "./sensor/math-utils.js";

// ── Calibration ──
export { lookupModel, MODEL_REGISTRY } from "./calibration/model-registry.js";
export { computeConformalThreshold, computeCalibration } from "./calibration/conformal.js";
export { CalibrationStore } from "./calibration/calibration-store.js";

// ── Service ──
export {
  EntropySensorServiceLive,
  meanStructural,
  meanBehavioral,
  fallbackScore,
  uncalibratedDefault,
} from "./sensor/entropy-sensor-service.js";

// ── Controller ──
export { ReactiveControllerService, ReactiveControllerServiceLive } from "./controller/controller-service.js";

// ── Telemetry ──
export { getOrCreateInstallId } from "./telemetry/install-id.js";
export { signPayload } from "./telemetry/signing.js";
export type { RunReport, SkillFragment } from "./telemetry/types.js";
export { TelemetryClient } from "./telemetry/telemetry-client.js";

// ── Learning ──
export { classifyTaskCategory } from "./learning/task-classifier.js";
export { BanditStore } from "./learning/bandit-store.js";
export type { ArmStats } from "./learning/bandit-store.js";
export { selectArm, updateArm } from "./learning/bandit.js";
export { shouldSynthesizeSkill, extractSkillFragment } from "./learning/skill-synthesis.js";
export { LearningEngineService, LearningEngineServiceLive } from "./learning/learning-engine.js";
export type { RunCompletedData, LearningResult } from "./learning/learning-engine.js";

// ── Event Subscriber ──
export { subscribeEntropyScoring } from "./sensor/entropy-event-subscriber.js";

// ── Runtime ──
export { createReactiveIntelligenceLayer } from "./runtime.js";
