// File: src/gate/types.ts
// Lift-gate verdict types (canonical evaluation system, layer Lg).
import type { QualityDimension } from "../types.js";

export type GateDecision = "default-on" | "opt-in" | "reject";

/** The codified project lift rule. */
export interface LiftPolicy {
  /** The success metric dimension (must be present in each variant's meanScores). */
  readonly metric: QualityDimension;
  /** Minimum aggregate lift in percentage POINTS to promote. */
  readonly minLiftPp: number;
  /** Maximum tolerated token overhead, percent. */
  readonly maxTokenOverheadPct: number;
  /** Minimum distinct model tiers that must be covered by both variants. */
  readonly minTiers: number;
  /** Significance multiplier: |liftPp| must exceed significanceK × stddev(×100) to count. */
  readonly significanceK: number;
}

export const DEFAULT_LIFT_POLICY: LiftPolicy = {
  metric: "accuracy",
  minLiftPp: 3,
  maxTokenOverheadPct: 15,
  minTiers: 2,
  significanceK: 1,
};

/** Per-model-tier evidence: baseline vs candidate on the success metric. */
export interface TierEvidence {
  /** The model variant id this evidence is for (a measurement tier). */
  readonly tier: string;
  /** Baseline variant mean score on `metric`, 0..1. */
  readonly baselineMetric: number;
  /** Candidate variant mean score on `metric`, 0..1. */
  readonly candidateMetric: number;
  /** (candidate − baseline) × 100, in points. */
  readonly liftPp: number;
  /** (candidateTokens − baselineTokens) / baselineTokens × 100. */
  readonly tokenOverheadPct: number;
  /** Max stddev (0..1 score units) across the cells for this tier — the noise floor. */
  readonly variance: number;
  /** |liftPp| exceeds the noise floor. */
  readonly significant: boolean;
  /** A cell was preflight-violated or the metric was missing → cannot judge this tier. */
  readonly inconclusive: boolean;
  /** This tier meets the bar (lift ≥ min, overhead ≤ max, significant, not inconclusive). */
  readonly passes: boolean;
  /** This tier significantly regresses (significant negative lift). */
  readonly regresses: boolean;
}

export interface GateVerdict {
  readonly decision: GateDecision;
  readonly perTier: readonly TierEvidence[];
  readonly aggregate: {
    readonly liftPp: number;
    readonly tokenOverheadPct: number;
    readonly tiersCovered: number;
  };
  /** True if any covered tier is inconclusive — blocks `default-on`. */
  readonly partial: boolean;
  /** Human-readable one-line receipt summary. */
  readonly rationale: string;
  readonly baselineVariantId: string;
  readonly candidateVariantId: string;
}
