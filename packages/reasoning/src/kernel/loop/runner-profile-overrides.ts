/**
 * Calibration-aware profile overrides, applied once at run start (extracted
 * from runner.ts so the pinned shell does not grow). `selectAdapter` may return
 * `profileOverrides` sourced from a ModelCalibration (e.g. `optimalToolResultChars`);
 * every phase then sees the calibrated values via `KernelContext.profile`.
 * Each changed field is recorded as a `profile-overrides-applied` event.
 */
import { Effect } from "effect";
import { selectAdapter } from "@reactive-agents/llm-provider";
import type { ContextProfile } from "../../context/context-profile.js";
import { emitProfileOverridesApplied, profileOverrideChanges } from "../utils/calibration-trace.js";

/** `base` with the model calibration's profile overrides merged in (traced). */
export function applyCalibrationProfileOverrides(
  base: ContextProfile,
  modelId: string | undefined,
  taskId: string,
): Effect.Effect<ContextProfile, never> {
  return Effect.gen(function* () {
    const { profileOverrides } = selectAdapter({ supportsToolCalling: true }, base.tier, modelId);
    if (!profileOverrides) return base;
    yield* emitProfileOverridesApplied(taskId, profileOverrideChanges(base, profileOverrides, "calibration"));
    return { ...base, ...profileOverrides } as ContextProfile;
  });
}
