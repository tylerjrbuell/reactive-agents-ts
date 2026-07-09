// Lift gate (canonical evaluation system, layer Lg). @unstable.
export {
  DEFAULT_LIFT_POLICY,
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
