/**
 * Merge probe measurements into an existing calibration JSON.
 *
 * The probe runner measures six behavioral fields. A committed calibration
 * file also carries fields the probes never measure (`actOrAnswer`, which has
 * its own A/B evidence; `classifierReliability`; learned alias maps). Writing
 * the runner output over the file would silently delete those, so `--commit`
 * merges instead: measured probe fields replace, everything else is kept.
 *
 * Partial measurements (a `--probes` subset, or probes that hit the per-probe
 * timeout) update only the fields they measured. The provenance stamp
 * (`probeVersion`, `calibratedAt`, `runsAveraged`) moves only when the full
 * probe set was measured, so a file is never labeled with a probe version that
 * some of its fields were not measured at.
 */
import type { ModelCalibration } from "./calibration.js";

/** The six fields the probe suite measures, one probe each. */
export interface ProbeResults {
  steeringCompliance: ModelCalibration["steeringCompliance"];
  parallelCallCapability: ModelCalibration["parallelCallCapability"];
  observationHandling: ModelCalibration["observationHandling"];
  systemPromptAttention: ModelCalibration["systemPromptAttention"];
  optimalToolResultChars: number;
  toolCallDialect: ModelCalibration["toolCallDialect"];
}

/** Name of one probe-measured field. */
export type ProbeField = keyof ProbeResults;

/** Probe-measured fields, in probe run order. */
export const PROBE_FIELDS: readonly ProbeField[] = [
  "steeringCompliance",
  "parallelCallCapability",
  "observationHandling",
  "systemPromptAttention",
  "optimalToolResultChars",
  "toolCallDialect",
];

/** Type guard: is `name` a probe-measured field? */
export function isProbeField(name: string): name is ProbeField {
  return (PROBE_FIELDS as readonly string[]).includes(name);
}

/** What one runner invocation measured. `fields` holds only the probes that produced a value. */
export interface MeasuredCalibration {
  readonly modelId: string;
  readonly calibratedAt: string;
  readonly probeVersion: number;
  readonly runsAveraged: number;
  readonly fields: Partial<ProbeResults>;
}

/** Outcome of {@link mergeProbeCalibration}. */
export type CalibrationMergeResult =
  | {
      readonly ok: true;
      readonly calibration: Record<string, unknown>;
      /** True when the full probe set was measured and the provenance stamp moved. */
      readonly stamped: boolean;
      /** Probe fields this invocation did not measure (kept from the existing file). */
      readonly kept: readonly ProbeField[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Merge a measurement into an existing calibration object.
 *
 * - Measured probe fields replace the existing values.
 * - Every other existing field (actOrAnswer, classifierReliability, alias
 *   maps, modelId) is kept as is.
 * - `probeVersion` / `calibratedAt` / `runsAveraged` move only when all six
 *   probe fields were measured.
 * - With no existing file, only a complete measurement can be written (a
 *   partial one would not satisfy the calibration schema).
 */
export function mergeProbeCalibration(
  existing: Readonly<Record<string, unknown>> | undefined,
  measured: MeasuredCalibration,
): CalibrationMergeResult {
  const kept = PROBE_FIELDS.filter((f) => measured.fields[f] === undefined);
  const complete = kept.length === 0;

  if (existing === undefined && !complete) {
    return {
      ok: false,
      reason: `no existing calibration for ${measured.modelId} and probes not measured: ${kept.join(", ")}`,
    };
  }

  const calibration: Record<string, unknown> = existing
    ? { ...existing }
    : { modelId: measured.modelId };
  if (complete) {
    calibration.calibratedAt = measured.calibratedAt;
    calibration.probeVersion = measured.probeVersion;
    calibration.runsAveraged = measured.runsAveraged;
  }
  for (const f of PROBE_FIELDS) {
    const v = measured.fields[f];
    if (v !== undefined) calibration[f] = v;
  }
  return { ok: true, calibration, stamped: complete, kept };
}
