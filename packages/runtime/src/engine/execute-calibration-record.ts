/**
 * The resolved calibration as a trace record: what the run actually used, per
 * field, and where each value came from. Recorded in `run-started.config` so a
 * trace answers "what was measured, what was set, and why" (the config string
 * `builder.calibration` only says `"auto"`). Observability only; nothing reads
 * it to change behavior.
 */
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { CalibrationProvenance, CalibrationSource } from "../calibration-resolver.js";

/** How the run's calibration was requested/resolved. */
export type CalibrationResolutionMode =
  /** `calibration: "skip"` or absent: nothing applied. */
  | "skip"
  /** `"auto"` resolved to a calibration (shipped / community / learned / default). */
  | "auto"
  /** `"auto"` but no shipped calibration, community profile or enough observations: nothing applied. */
  | "unresolved"
  /** The caller passed a full calibration object. */
  | "custom";

/** Source label of one recorded field. */
export type CalibrationFieldSource = CalibrationSource | "custom";

/** One calibration field: the value the run used and where it came from. */
export interface CalibrationFieldRecord {
  readonly value: string | number | boolean;
  readonly source: CalibrationFieldSource;
}

/** The calibration the run resolved, as stamped into `run-started.config.calibration`. */
export interface CalibrationResolution {
  readonly mode: CalibrationResolutionMode;
  /** Distinct sources that contributed at least one field (empty for skip/unresolved). */
  readonly tiers: readonly CalibrationFieldSource[];
  readonly modelId?: string;
  /** Probe suite version the shipped values were measured at (0 = framework defaults). */
  readonly probeVersion?: number;
  readonly calibratedAt?: string;
  readonly runsAveraged?: number;
  /** Scalar calibration fields with the value used and its source. */
  readonly fields: Readonly<Record<string, CalibrationFieldRecord>>;
}

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** Stamp fields (scalar values only) with sources; absent provenance means `fallback`. */
export function describeCalibration(
  mode: CalibrationResolutionMode,
  calibration: ModelCalibration | undefined,
  provenance: CalibrationProvenance | undefined,
  fallback: CalibrationFieldSource,
): CalibrationResolution {
  if (calibration === undefined) return { mode, tiers: [], fields: {} };
  const fields: Record<string, CalibrationFieldRecord> = {};
  const tiers = new Set<CalibrationFieldSource>();
  for (const [key, value] of Object.entries(calibration)) {
    if (!isScalar(value)) continue;
    const source: CalibrationFieldSource = provenance?.[key as keyof ModelCalibration] ?? fallback;
    fields[key] = { value, source };
    tiers.add(source);
  }
  return {
    mode,
    tiers: [...tiers],
    modelId: calibration.modelId,
    probeVersion: calibration.probeVersion,
    calibratedAt: calibration.calibratedAt,
    runsAveraged: calibration.runsAveraged,
    fields,
  };
}
