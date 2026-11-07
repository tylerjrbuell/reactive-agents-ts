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
  // ── Act-or-answer outcomes (optional: observation files written before 2026-11-06 lack them) ──
  /** Unforced turns that ended with no tool call while tool work was outstanding. */
  readonly noCallStallTurns?: number;
  /** Turns whose request was not forced, sent while tool work was outstanding (the stall-rate denominator). */
  readonly unforcedToolWorkTurns?: number;
  /** Requests sent with a required tool call (retry or proactive). */
  readonly forcedCalls?: number;
  /** Forced replies that contained a domain tool call. */
  readonly forcedCallsCalled?: number;
  /** Of those, replies whose every call ran and succeeded. */
  readonly forcedCallsSucceeded?: number;
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
