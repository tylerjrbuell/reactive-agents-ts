/**
 * runner-helpers/tier-guards.ts — Tier-aware kernel guard thresholds.
 *
 * Extracted from `kernel/loop/runner.ts` in WS-6 Phase 2. Defines the
 * per-tier threshold table that the runner consults for:
 *
 *   - Token-delta progress gate (`shouldExitOnLowDelta`)
 *   - Pulse-oracle force-exit gate (`shouldForceOracleExit`)
 *   - Loop-detector same-tool window (`resolveMaxSameTool`)
 *
 * All three functions are tier-pure (no KernelState dependency) so they
 * extract cleanly. `runner.ts` re-exports these for caller stability —
 * tests like `tier-guard-config.test.ts` and `token-delta-guard.test.ts`
 * continue importing from `kernel/loop/runner.js` unchanged.
 */

// ── Tier-aware guard thresholds ───────────────────────────────────────────────

/** Per-tier thresholds for kernel guards. */
export interface TierGuardConfig {
  /** Token delta below which an iteration is considered "low progress". */
  readonly tokenDeltaThreshold: number;
  /** Default max same-tool calls before loop detection fires. */
  readonly maxSameToolDefault: number;
  /** Number of ignored oracle nudges before force-exit. */
  readonly oracleNudgeLimit: number;
}

/** Tier-specific guard thresholds — local is strict, frontier is lenient. */
export const TIER_GUARD_THRESHOLDS: Record<string, TierGuardConfig> = {
  // M3 Pivot B (2026-05-06): local-tier oracleNudgeLimit raised from 1 → 2.
  // Empirical evidence (cogito:14b T4 baseline trace 01KQZFH4YSJX6X4BJA94PEZXWG):
  // model called `pulse` instead of `final-answer`, oracle injected one
  // mandatory nudge, model ignored it, oracle force-terminated with empty
  // output (outputLen=0, status=failed). One nudge wasn't enough for cogito
  // to translate "you should answer" into an actual final-answer tool call —
  // the second nudge gives the model a structurally different signal
  // (verbatim re-injection after seeing the first didn't terminate the run)
  // that it can recognize as a behavioral imperative.
  local:    { tokenDeltaThreshold: 300,  maxSameToolDefault: 2, oracleNudgeLimit: 2 },
  mid:      { tokenDeltaThreshold: 500,  maxSameToolDefault: 3, oracleNudgeLimit: 2 },
  large:    { tokenDeltaThreshold: 700,  maxSameToolDefault: 4, oracleNudgeLimit: 3 },
  frontier: { tokenDeltaThreshold: 1000, maxSameToolDefault: 5, oracleNudgeLimit: 3 },
};

// ── Token-delta guard ─────────────────────────────────────────────────────────

/**
 * Guard: exit when model stops making progress (2 consecutive low-delta iterations).
 *
 * Conditions that must ALL be true to trigger early exit:
 * - iteration >= 3 (give the model at least a few steps before judging)
 * - tokenDelta < threshold (tier-specific, defaults to mid=500)
 * - consecutiveLowDeltaCount >= 2 (two consecutive low-delta iterations in a row)
 */
export function shouldExitOnLowDelta(opts: {
  iteration: number
  tokenDelta: number
  consecutiveLowDeltaCount: number
  tier?: string
}): boolean {
  const { iteration, tokenDelta, consecutiveLowDeltaCount, tier } = opts
  const threshold = (TIER_GUARD_THRESHOLDS[tier ?? "mid"] ?? TIER_GUARD_THRESHOLDS["mid"]).tokenDeltaThreshold;
  return iteration >= 3 && tokenDelta < threshold && consecutiveLowDeltaCount >= 2
}

// ── Oracle hard gate ──────────────────────────────────────────────────────────

/**
 * Guard: force exit when the pulse oracle has said readyToAnswer=true but the
 * model has ignored it for N consecutive iterations (tier-dependent).
 *
 * Stage 1 (nudgeCount < limit): caller should inject a mandatory steering nudge and
 * increment readyToAnswerNudgeCount.
 * Stage 2 (nudgeCount >= limit): return true → caller terminates with "oracle_forced".
 */
export function shouldForceOracleExit(opts: {
  oracleReady: boolean
  readyToAnswerNudgeCount: number
  tier?: string
  /**
   * A2 — resolved oracle nudge limit override. When provided (long-horizon
   * profile: tier limit + scaled bonus) it replaces the tier lookup so the
   * force-exit gate and the nudge builder share one limit. Absent → tier limit.
   */
  nudgeLimitOverride?: number
}): boolean {
  const nudgeLimit =
    opts.nudgeLimitOverride ??
    (TIER_GUARD_THRESHOLDS[opts.tier ?? "mid"] ?? TIER_GUARD_THRESHOLDS["mid"]).oracleNudgeLimit;
  return opts.oracleReady && opts.readyToAnswerNudgeCount >= nudgeLimit
}

/**
 * Resolve the effective maxSameTool loop-detection window.
 *
 * In parallel mode, adaptive classification may require N calls of the same tool
 * (e.g. `web-search×4` for four entities). The loop detector fires when the last
 * `maxSameTool` actions all have identical content — if the window is smaller than N,
 * it can fire prematurely before the required quota is met.
 *
 * This function raises the base tier default to at least the highest required-tool
 * quantity, capped at 20 as a safety net against runaway same-tool loops.
 */
export function resolveMaxSameTool(
  baseMax: number,
  requiredToolQuantities?: Readonly<Record<string, number>>,
): number {
  if (!requiredToolQuantities) return baseMax;
  const values = Object.values(requiredToolQuantities);
  if (values.length === 0) return baseMax;
  const maxRequired = Math.max(...values);
  return Math.min(20, Math.max(baseMax, maxRequired));
}
