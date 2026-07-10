// File: src/gate/types.ts
// Lift-gate verdict types (canonical evaluation system, layer Lg).
import type { QualityDimension } from "../types.js";

/**
 * `underpowered` is NOT a synonym for "no effect". It means the comparison did
 * not carry enough samples to distinguish an effect from noise at the policy's
 * `minLiftPp`. Before it existed, an under-sampled run silently reported
 * `opt-in` ("we looked, nothing there") or — at n=1, where the old stddev noise
 * bar collapsed to 0pp — `default-on` ("noise promoted to law").
 */
export type GateDecision = "default-on" | "opt-in" | "reject" | "underpowered";

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
  /**
   * Significance multiplier: |liftPp| must exceed `significanceK × standardError
   * (×100)` to count. The standard error is of the DIFFERENCE of the two arms'
   * means, so this is a z-multiplier: 1 ≈ 68%, 1.96 ≈ 95%.
   *
   * NOTE: this used to multiply a standard DEVIATION, which is not an
   * uncertainty about a mean — it never shrank with n, and collapsed to exactly
   * 0 at n=1. See `gate-significance.test.ts`.
   */
  readonly significanceK: number;
  /**
   * Significance multiplier for the PROMOTION path (a tier's `passes`, hence
   * `default-on`). Defaults to 1.96 (95%) when omitted. `significanceK`
   * (default 1 ≈ 68%) keeps the exploratory read — the `significant` flag,
   * `regresses`, and the rationale text — so a 1σ regression still rejects and
   * a 1σ effect still shows up as "we saw something", but PROMOTING a
   * mechanism to default-on demands the 95% band. A 68% band promotes a coin
   * flip roughly one time in three (instrument audit 2026-07-10).
   */
  readonly promotionSignificanceK?: number;
  /**
   * Minimum runs per cell before a tier may be judged at all. Below this the
   * tier is `underpowered` and can neither pass nor regress — "we did not look
   * hard enough" is reported as itself, not as "no effect".
   */
  readonly minRuns: number;
}

export const DEFAULT_LIFT_POLICY: LiftPolicy = {
  metric: "accuracy",
  minLiftPp: 3,
  maxTokenOverheadPct: 15,
  minTiers: 2,
  significanceK: 1,
  promotionSignificanceK: 1.96,
  minRuns: 3,
};

/** The promotion band used when a policy omits `promotionSignificanceK`. */
export const DEFAULT_PROMOTION_SIGNIFICANCE_K = 1.96;

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
  /**
   * Max stddev (0..1 score units) across the cells for this tier. RETAINED for
   * receipts/back-compat only — it is NOT the noise floor any more, because a
   * standard deviation does not shrink with n. Use `noisePp`.
   */
  readonly variance: number;
  /** The EXPLORATORY significance bar in points: `significanceK × SE(D̄) × 100`. */
  readonly noisePp: number;
  /**
   * The PROMOTION bar in points: `promotionSignificanceK × SE(D̄) × 100`.
   * `passes` (and therefore `default-on`) requires |liftPp| to clear THIS bar;
   * `noisePp` only feeds the exploratory `significant` flag.
   */
  readonly promotionNoisePp: number;
  /**
   * Standard error of the PAIRED per-task mean difference D̄, in points:
   * max( √(Σ se_t²)/T , sd(d_t)/√T ) — the within-cell term and the
   * between-task clustered term, whichever is LARGER. Two tasks that disagree
   * hard about an effect are evidence of heterogeneity, not of precision.
   */
  readonly stdErrPp: number;
  /**
   * The paired per-task differences this tier's estimate is built from
   * (arXiv:2411.00640): d_t = p̂_cand,t − p̂_base,t in points, with
   * se_t = √(se_base,t² + se_cand,t²). `liftPp` is the mean of `dPp`.
   */
  readonly perTask: ReadonlyArray<{
    readonly taskId: string;
    readonly dPp: number;
    readonly sePp: number;
  }>;
  /**
   * Tasks measured in exactly ONE arm (e.g. errored in the other). EXCLUDED
   * from the paired estimate — comparing arms over different task sets makes
   * the lift an artifact of composition — and reported here so the exclusion
   * is never silent.
   */
  readonly unpairedTaskIds: ReadonlyArray<string>;
  /**
   * pass^8 reliability comparison (tau-bench), present ONLY when every paired
   * cell in BOTH arms carries n ≥ 8. `nonRegression` = candidate pass^8 ≥
   * baseline pass^8 − 1pp; when false the tier cannot pass (a mean lift that
   * guts run-to-run consistency is not a win). Absent → noted as
   * "passK: underpowered" in the receipt and NEVER blocks.
   */
  readonly passK?: {
    readonly k: number;
    readonly baseline: number;
    readonly candidate: number;
    readonly nonRegression: boolean;
  };
  /** Fewest runs observed in any contributing cell of this tier. */
  readonly minRunsObserved: number;
  /** `minRunsObserved < policy.minRuns` → this tier cannot pass OR regress. */
  readonly underpowered: boolean;
  /** Approx runs/arm needed to resolve `policy.minLiftPp` at this spread. */
  readonly runsNeeded: number;
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
