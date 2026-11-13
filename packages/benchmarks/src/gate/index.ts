// Lift gate (canonical evaluation system, layer Lg). @unstable.
export {
  DEFAULT_LIFT_POLICY,
  DEFAULT_PROMOTION_SIGNIFICANCE_K,
  DEFAULT_STATUS_REGRESSION_PP,
  DEFAULT_STATUS_REGRESSION_RUNS,
  type ClassVerdict,
  type GateDecision,
  type GateVerdict,
  type LiftGateOptions,
  type LiftPolicy,
  type TaskClass,
  type TierEvidence,
} from "./types.js";
export { evaluateLiftGate, LONG_HORIZON_TAG, projectTierEvidence } from "./gate.js";
export { formatGateReceipt } from "./receipt.js";
export {
  gateReceiptFor,
  minRunsInReport,
  powerWarningFor,
  variantIdsIn,
} from "./on-path.js";
