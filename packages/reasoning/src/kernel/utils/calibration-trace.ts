/**
 * Calibration traceability (adaptive-harness audit 2026-11-19, G4/G5).
 *
 * A trace must say what a model calibration changed. Two additive events ride
 * the existing `guard-fired` path (outcome `pass`; no behavior change):
 *
 *  - `profile-overrides-applied`: one per context-profile field a calibration
 *    overrode, `metadata: { field, from, to, source }`.
 *  - `calibration-effect`: one per calibration-fed consumer branch that fired,
 *    `metadata: { field, value, consumer, effect }` (same shape the
 *    parallel-tool-hint signal records).
 */
import { Effect } from "effect";
import { describeCapabilityResolution, resolveCapability } from "@reactive-agents/llm-provider";
import { emitGuardFired } from "./diagnostics.js";

/** Guard name of the once-per-run capability resolution event. */
export const CAPABILITY_RESOLVED_GUARD = "capability-resolved";

/** `selectAdapter`'s 4th argument for a kernel input: "auto" unless the run asked "skip". */
export const adapterCalibrationArg = (input: { readonly calibrationMode?: "auto" | "skip" }): "auto" | "skip" =>
  input.calibrationMode ?? "auto";

/** Emit one `capability-resolved` event: how the model's capability was resolved. */
export const emitCapabilityResolved = (
  taskId: string,
  provider: string,
  model: string,
): Effect.Effect<void, never> => {
  const r = describeCapabilityResolution(resolveCapability(provider, model));
  return emitGuardFired({
    taskId,
    iteration: 0,
    guard: CAPABILITY_RESOLVED_GUARD,
    outcome: "pass",
    reason: `${r.provider}/${r.model}: source=${r.source} tier=${r.tier}`,
    metadata: { ...r },
  });
};

/** Guard name of the per-field profile override event. */
export const PROFILE_OVERRIDES_APPLIED_GUARD = "profile-overrides-applied";

/** Guard name of the per-consumer calibration effect event. */
export const CALIBRATION_EFFECT_GUARD = "calibration-effect";

/** One calibration-fed branch: which field, the value read, who read it, what changed. */
export interface CalibrationEffect {
  readonly field: string;
  readonly value: unknown;
  readonly consumer: string;
  readonly effect: string;
}

/** Emit one `calibration-effect` event. */
export const emitCalibrationEffect = (
  taskId: string,
  iteration: number,
  e: CalibrationEffect,
): Effect.Effect<void, never> =>
  emitGuardFired({
    taskId,
    iteration,
    guard: CALIBRATION_EFFECT_GUARD,
    outcome: "pass",
    reason: `${e.consumer}: ${e.field}=${String(e.value)} -> ${e.effect}`,
    metadata: { field: e.field, value: e.value, consumer: e.consumer, effect: e.effect },
  });

/** One overridden profile field: the base value, the applied value, the origin. */
export interface ProfileOverrideChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
  readonly source: string;
}

/**
 * The fields `overrides` changes on `base` (pure). A field set to its existing
 * value is not a change, so a no-op override emits nothing.
 */
export function profileOverrideChanges(
  base: object,
  overrides: object,
  source: string,
): ProfileOverrideChange[] {
  const out: ProfileOverrideChange[] = [];
  for (const [field, to] of Object.entries(overrides)) {
    const from: unknown = Reflect.get(base, field);
    if (to === undefined || Object.is(from, to)) continue;
    out.push({ field, from, to, source });
  }
  return out;
}

/** Emit one `profile-overrides-applied` event per change. */
export const emitProfileOverridesApplied = (
  taskId: string,
  changes: readonly ProfileOverrideChange[],
): Effect.Effect<void, never> =>
  Effect.forEach(
    changes,
    (c) =>
      emitGuardFired({
        taskId,
        iteration: 0,
        guard: PROFILE_OVERRIDES_APPLIED_GUARD,
        outcome: "pass",
        reason: `${c.field}: ${String(c.from)} -> ${String(c.to)} (${c.source})`,
        metadata: { field: c.field, from: c.from, to: c.to, source: c.source },
      }),
    { discard: true },
  );
