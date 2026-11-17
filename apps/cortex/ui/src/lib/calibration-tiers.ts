/**
 * The opt-in calibration tiers as the builder's two switches. The framework's
 * `.withCalibration("auto", { learned, community })` is `AgentConfig.calibration`
 * (`{ mode, learned?, community? }`; `mode` is required by the schema, so a
 * lone `{ learned: true }` would fail to decode and the run would not start).
 * Both tiers default off. Cortex carries the value as `rawConfig.calibration`
 * and never defaults a tier itself. Pure; pinned by `calibration-tiers.test.ts`
 * and, for the decode, `server/tests/calibration-config.test.ts`.
 */

/** The two opt-in tiers. */
export type CalibrationTier = "learned" | "community";

/** The tier settings in a `rawConfig` (absent = off, the framework default). */
export function calibrationTiersOn(rawConfig?: Record<string, unknown>): Record<CalibrationTier, boolean> {
  const c = rawConfig?.["calibration"];
  const o = c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
  return { learned: o["learned"] === true, community: o["community"] === true };
}

/**
 * `rawConfig` after flipping one tier. Turning a tier on writes
 * `calibration: { mode: "auto", ... }` (an existing `mode` is kept); turning
 * the last tier off removes `calibration` when it was only tiers, so the
 * agent runs the framework default. `mode: "skip"` is left to All framework
 * options and kept untouched.
 */
export function rawConfigForCalibrationTier(
  rawConfig: Record<string, unknown>,
  tier: CalibrationTier,
  on: boolean,
): Record<string, unknown> {
  const { calibration: prev, ...rest } = rawConfig;
  const base = prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...base };
  if (on) next[tier] = true;
  else delete next[tier];
  const mode = base["mode"] === "skip" ? "skip" : "auto";
  const tiers = { learned: next["learned"] === true, community: next["community"] === true };
  if (!tiers.learned && !tiers.community && mode === "auto") return rest;
  return {
    ...rest,
    calibration: {
      mode,
      ...(tiers.learned ? { learned: true } : {}),
      ...(tiers.community ? { community: true } : {}),
    },
  };
}

/** The hint under the switches. */
export function calibrationTierHint(rawConfig?: Record<string, unknown>): string {
  const c = rawConfig?.["calibration"];
  if (c && typeof c === "object" && (c as Record<string, unknown>)["mode"] === "skip") {
    return "Calibration is skipped (set in All framework options), so these tiers do nothing.";
  }
  return "Off by default. Run observations are always recorded locally, so turning Learned on later uses the history you already have. Community also needs telemetry allowed (DO_NOT_TRACK / REACTIVE_AGENTS_TELEMETRY=0 block it).";
}
