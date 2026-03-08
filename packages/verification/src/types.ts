import { Schema } from "effect";

// ─── Risk Level ───

export const RiskLevel = Schema.Literal("low", "medium", "high", "critical");
export type RiskLevel = typeof RiskLevel.Type;

// ─── Confidence Score ───

export const ConfidenceScoreSchema = Schema.Struct({
  score: Schema.Number, // 0-1
  calibrated: Schema.Boolean,
  layerScores: Schema.Record({ key: Schema.String, value: Schema.Number }),
});
export type ConfidenceScore = typeof ConfidenceScoreSchema.Type;

// ─── Claim ───

export const ClaimSchema = Schema.Struct({
  text: Schema.String,
  confidence: Schema.Number,
  source: Schema.optional(Schema.String),
});
export type Claim = typeof ClaimSchema.Type;

// ─── Verification Layer Result ───

export const LayerResultSchema = Schema.Struct({
  layerName: Schema.String,
  score: Schema.Number, // 0-1
  passed: Schema.Boolean,
  details: Schema.optional(Schema.String),
  claims: Schema.optional(Schema.Array(ClaimSchema)),
});
export type LayerResult = typeof LayerResultSchema.Type;

// ─── Verification Result ───

export const VerificationResultSchema = Schema.Struct({
  overallScore: Schema.Number, // 0-1
  passed: Schema.Boolean,
  riskLevel: RiskLevel,
  layerResults: Schema.Array(LayerResultSchema),
  recommendation: Schema.Literal("accept", "review", "reject"),
  verifiedAt: Schema.DateFromSelf,
});
export type VerificationResult = typeof VerificationResultSchema.Type;

// ─── Hallucination Claim ───

export interface HallucinationClaim {
  text: string;
  confidence: "certain" | "likely" | "uncertain";
  verified: boolean;
  source?: string;
}

// ─── Verification Config ───

export const VerificationConfigSchema = Schema.Struct({
  enableSemanticEntropy: Schema.Boolean,
  enableFactDecomposition: Schema.Boolean,
  enableMultiSource: Schema.Boolean,
  enableSelfConsistency: Schema.Boolean,
  enableNli: Schema.Boolean,
  enableHallucinationDetection: Schema.optional(Schema.Boolean),
  hallucinationThreshold: Schema.optional(Schema.Number),
  passThreshold: Schema.Number, // Default: 0.7
  riskThreshold: Schema.Number, // Default: 0.5
  /** When true and llm is provided, use LLM-based semantic entropy and fact decomposition. */
  useLLMTier: Schema.optional(Schema.Boolean),
});
export type VerificationConfig = typeof VerificationConfigSchema.Type;

/** LLM interface for tier-2 verification layers. Decoupled from @reactive-agents/llm-provider. */
export type VerificationLLM = {
  complete: (req: any) => import("effect").Effect.Effect<{ content: string; usage?: { totalTokens?: number } }, any>;
  embed: (texts: readonly string[], model?: string) => import("effect").Effect.Effect<readonly (readonly number[])[], any>;
};

export const defaultVerificationConfig: VerificationConfig = {
  enableSemanticEntropy: true,
  enableFactDecomposition: true,
  enableMultiSource: false, // placeholder in Tier 1
  enableSelfConsistency: true,
  enableNli: true,
  enableHallucinationDetection: false,
  hallucinationThreshold: 0.10,
  passThreshold: 0.7,
  riskThreshold: 0.5,
};
