// ─── Types ───
export type {
  ConfidenceScore,
  Claim,
  LayerResult,
  VerificationResult,
  VerificationConfig,
  VerificationLLM,
} from "./types.js";
export {
  RiskLevel,
  ConfidenceScoreSchema,
  ClaimSchema,
  LayerResultSchema,
  VerificationResultSchema,
  VerificationConfigSchema,
  defaultVerificationConfig,
} from "./types.js";

// ─── Errors ───
export { VerificationError, CalibrationError } from "./errors.js";

// ─── Layers ───
export { checkSemanticEntropy, checkSemanticEntropyLLM } from "./layers/semantic-entropy.js";
export { checkFactDecomposition, checkFactDecompositionLLM } from "./layers/fact-decomposition.js";
export { checkMultiSource, checkMultiSourceLLM } from "./layers/multi-source.js";
export { checkSelfConsistency } from "./layers/self-consistency.js";
export { checkNli } from "./layers/nli.js";

// ─── Service ───
export { VerificationService, VerificationServiceLive } from "./verification-service.js";

// ─── Runtime ───
export { createVerificationLayer } from "./runtime.js";
