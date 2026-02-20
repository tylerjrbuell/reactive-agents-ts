// ─── Types ───
export type {
  ViolationType,
  Severity,
  GuardrailResult,
  AgentContract,
  GuardrailConfig,
} from "./types.js";

export {
  ViolationType as ViolationTypeSchema,
  Severity as SeveritySchema,
  GuardrailResultSchema,
  AgentContractSchema,
  GuardrailConfigSchema,
  defaultGuardrailConfig,
} from "./types.js";

// ─── Errors ───
export { GuardrailError, ViolationError } from "./errors.js";

// ─── Detectors ───
export { detectInjection } from "./detectors/injection-detector.js";
export type { DetectionResult } from "./detectors/injection-detector.js";
export { detectPii } from "./detectors/pii-detector.js";
export { detectToxicity } from "./detectors/toxicity-detector.js";

// ─── Contracts ───
export { checkContract } from "./contracts/agent-contract.js";

// ─── Service ───
export { GuardrailService, GuardrailServiceLive } from "./guardrail-service.js";

// ─── Runtime ───
export { createGuardrailsLayer } from "./runtime.js";
