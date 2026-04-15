/**
 * Per-run observation — a bounded summary the harness emits after kernel exit.
 * Only counts and categoricals, never task content or tool arguments.
 */
export interface RunObservation {
  readonly at: string; // ISO timestamp
  readonly parallelTurnCount: number; // turns with ≥2 tool calls in one response
  readonly totalTurnCount: number;
  readonly dialect: "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";
  readonly classifierRequired: readonly string[]; // what classifier said was required
  readonly classifierActuallyCalled: readonly string[]; // what the run actually called
  readonly subagentInvoked: number;
  readonly subagentSucceeded: number;
  readonly argValidityRate: number; // 0..1, fraction of well-formed arg dicts
}

export interface ModelObservations {
  readonly schemaVersion: number;
  readonly modelId: string;
  readonly sampleCount: number;
  readonly runs: readonly RunObservation[];
}

export const OBSERVATIONS_SCHEMA_VERSION = 1;
/** Keep only the most recent N observations to bound disk growth. */
export const OBSERVATIONS_WINDOW = 50;

export function emptyObservations(modelId: string): ModelObservations {
  return {
    schemaVersion: OBSERVATIONS_SCHEMA_VERSION,
    modelId,
    sampleCount: 0,
    runs: [],
  };
}
