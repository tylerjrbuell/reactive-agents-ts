/**
 * Decision rationale — structured "why" capture for any agent decision.
 *
 * Lives in @reactive-agents/core so trace, tools, reasoning, and runtime can
 * share the shape without cross-package coupling.
 *
 * Optional in v1 everywhere it appears; models that don't emit it still
 * produce valid traces.
 */
export type Rationale = {
  /** Short natural-language justification (≤280 chars). */
  readonly why: string;
  /** References to observation/scratchpad keys (e.g. "obs:1", "scratch:goal"). */
  readonly refs?: readonly string[];
  /** Alternatives considered and rejected. */
  readonly alternatives?: readonly {
    readonly option: string;
    readonly rejectedBecause: string;
  }[];
  /** Self-reported confidence in [0,1]. */
  readonly confidence?: number;
};
