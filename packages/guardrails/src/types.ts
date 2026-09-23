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
  /** Opt-in judgment battery (Task 11) — runs parallel to the regex detectors above on `check()`. Default off. */
  enableJudgmentBattery: Schema.optional(Schema.Boolean),
  /**
   * "additive" (default): the judgment battery can only ADD a violation or
   * escalate severity — regex-detected violations are never removed, so the
   * result stays a superset of today's regex-only behavior.
   * "jev-primary": the judgment battery's verdict is authoritative per
   * violation type and can also UNBLOCK a regex hit it disagrees with. Opt-in
   * only — document this loudly wherever it's set.
   */
  judgmentStrictness: Schema.optional(Schema.Literal("additive", "jev-primary")),
  /** Noul probability at/above which the judgment battery counts a type as a hit. Default 0.7. */
  judgmentActionThreshold: Schema.optional(Schema.Number),
  /** Noul probability at/above which (but below the action threshold) a review event fires without blocking. Default 0.4. */
  judgmentReviewThreshold: Schema.optional(Schema.Number),
  /** Opt-in output-side judgment screening (Task 11 Step 3) — observability only, never blocks. Default off. */
  screenOutputs: Schema.optional(Schema.Boolean),
});
export type GuardrailConfig = typeof GuardrailConfigSchema.Type;

export const defaultGuardrailConfig: GuardrailConfig = {
  enableInjectionDetection: true,
  enablePiiDetection: true,
  enableToxicityDetection: true,
};
