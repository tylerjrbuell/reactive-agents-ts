// Lift gate (canonical evaluation system, layer Lg). @unstable.
export {
  DEFAULT_LIFT_POLICY,
  type GateDecision,
  type GateVerdict,
  type LiftPolicy,
  type TierEvidence,
} from "./types.js";
export { evaluateLiftGate, projectTierEvidence } from "./gate.js";
export { formatGateReceipt } from "./receipt.js";
