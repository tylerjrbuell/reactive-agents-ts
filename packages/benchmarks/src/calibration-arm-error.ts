// File: src/calibration-arm-error.ts
import { Data } from "effect"

/** Misconfigured calibration lift arm (bad RA_BENCH_CALIBRATION value or unknown swap source). */
export class CalibrationArmError extends Data.TaggedError("CalibrationArmError")<{
  readonly message: string
}> {}
