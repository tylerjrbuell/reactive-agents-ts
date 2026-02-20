import { Schema } from "effect";

// ─── Violation Type ───

export const ViolationType = Schema.Literal(
  "prompt-injection",
  "pii-detected",
  "toxicity",
  "scope-violation",
  "contract-violation",
);
export type ViolationType = typeof ViolationType.Type;

// ─── Severity ───

export const Severity = Schema.Literal("low", "medium", "high", "critical");
export type Severity = typeof Severity.Type;

// ─── Guardrail Result ───

export const GuardrailResultSchema = Schema.Struct({
  passed: Schema.Boolean,
  violations: Schema.Array(
    Schema.Struct({
      type: ViolationType,
      severity: Severity,
      message: Schema.String,
      details: Schema.optional(Schema.String),
    }),
  ),
  score: Schema.Number, // 0-1, 1 = fully safe
  checkedAt: Schema.DateFromSelf,
});
export type GuardrailResult = typeof GuardrailResultSchema.Type;

// ─── Agent Contract ───

export const AgentContractSchema = Schema.Struct({
  allowedTopics: Schema.Array(Schema.String),
  deniedTopics: Schema.Array(Schema.String),
  allowedActions: Schema.Array(Schema.String),
  deniedActions: Schema.Array(Schema.String),
  maxOutputLength: Schema.optional(Schema.Number),
  requireDisclosure: Schema.optional(Schema.Boolean),
});
export type AgentContract = typeof AgentContractSchema.Type;

// ─── Guardrail Config ───

export const GuardrailConfigSchema = Schema.Struct({
  enableInjectionDetection: Schema.Boolean,
  enablePiiDetection: Schema.Boolean,
  enableToxicityDetection: Schema.Boolean,
  contract: Schema.optional(AgentContractSchema),
  customBlocklist: Schema.optional(Schema.Array(Schema.String)),
});
export type GuardrailConfig = typeof GuardrailConfigSchema.Type;

export const defaultGuardrailConfig: GuardrailConfig = {
  enableInjectionDetection: true,
  enablePiiDetection: true,
  enableToxicityDetection: true,
};
