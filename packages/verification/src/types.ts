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

// ─── Verification Config ───

export const VerificationConfigSchema = Schema.Struct({
  enableSemanticEntropy: Schema.Boolean,
  enableFactDecomposition: Schema.Boolean,
  enableMultiSource: Schema.Boolean,
  enableSelfConsistency: Schema.Boolean,
  enableNli: Schema.Boolean,
  passThreshold: Schema.Number, // Default: 0.7
  riskThreshold: Schema.Number, // Default: 0.5
});
export type VerificationConfig = typeof VerificationConfigSchema.Type;

export const defaultVerificationConfig: VerificationConfig = {
  enableSemanticEntropy: true,
  enableFactDecomposition: true,
  enableMultiSource: false, // placeholder in Tier 1
  enableSelfConsistency: true,
  enableNli: true,
  passThreshold: 0.7,
  riskThreshold: 0.5,
};
