// File: src/gate/types.ts
// Lift-gate verdict types (canonical evaluation system, layer Lg).
import type { QualityDimension } from "../types.js";

export type GateDecision = "default-on" | "opt-in" | "reject";

/**
 * Task class for the per-task-class lift gate (audit 06 — the long-horizon
 * anti-gathering disease). A candidate mechanism is judged against a
 * class-appropriate cost rule:
 *
 * - `short` — the historical rule: token overhead ≤ `maxTokenOverheadPct`.
 * - `long-horizon` — cost-per-verified-deliverable (tokens ÷ deliverable-check
 *   pass-rate) replaces the raw-token cap. Long-horizon gathering legitimately
 *   spends many more tokens; the gate rewards deliverable-completion per token
 *   and refuses to penalize raw token growth that actually banks deliverables.
 */
export type TaskClass = "short" | "long-horizon";

/**
 * Optional inputs threaded into the gate so it can classify each task WITHOUT
 * the report shape carrying task metadata. The caller (which already holds the
 * `BenchmarkTask[]`) passes minimal task descriptors; the gate derives the
 * class from the `horizon:long` tag — no task IDs are hardcoded here.
 */
export interface LiftGateOptions {
  /**
   * Minimal task descriptors keyed by `id`. A task whose `tags` include the
   * long-horizon discriminator tag is classified `long-horizon`; every other
   * task (and any report whose `taskId` is absent from this list) is `short`.
   * When omitted, EVERY task is `short` → the gate is byte-identical to the
   * pre-amendment behavior.
   */
  readonly tasks?: ReadonlyArray<{
    readonly id: string;
    readonly tags?: ReadonlyArray<string>;
  }>;
}

/** A per-class sub-verdict, exposed on `GateVerdict.byClass` when classes split. */
export interface ClassVerdict {
  readonly taskClass: TaskClass;
  readonly decision: GateDecision;
  readonly perTier: readonly TierEvidence[];
  readonly aggregate: {
    readonly liftPp: number;
    readonly tokenOverheadPct: number;
    readonly tiersCovered: number;
  };
  readonly partial: boolean;
}

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
  /**
   * The task class this evidence row was judged under. OMITTED on `short` rows
   * so the pre-amendment output is structurally identical; set to
   * `"long-horizon"` only on rows that took the cost-per-verified-deliverable
   * path.
   */
  readonly taskClass?: TaskClass;
  /**
   * Candidate cost-per-verified-deliverable = candidate mean tokens ÷ candidate
   * deliverable-check pass-rate (the partial-credit metric score, 0..1). Present
   * ONLY on `long-horizon` rows. `Infinity` when the candidate banked zero
   * verified deliverables — an explicit FAIL (no lift banked on zero delivery).
   */
  readonly costPerDeliverable?: number;
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
  /**
   * Per-task-class breakdown. Present ONLY when a long-horizon classification
   * was supplied AND the covered tasks actually span the long-horizon class —
   * otherwise omitted, keeping the verdict byte-identical to today. Each entry
   * is the class judged in isolation (long-horizon on cost-per-verified-
   * deliverable; short on the historical token-overhead rule).
   */
  readonly byClass?: readonly ClassVerdict[];
}
