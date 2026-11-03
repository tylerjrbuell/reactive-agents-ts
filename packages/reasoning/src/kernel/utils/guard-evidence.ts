// File: src/kernel/utils/guard-evidence.ts
//
// Decision provenance for terminal-capable guards (trace-feedback item 4,
// audit 2026-11-03). A `guard-fired` record said THAT a guard ended the run, not
// whether it tripped narrowly or by a mile. Every terminal-capable guard now
// spreads `guardEvidence(counter, observed, threshold)` into its metadata:
// the NAME of the counter the guard reads, the value it OBSERVED, and the
// THRESHOLD it compared against (same units, taken from the live comparison
// operands — not recomputed).
//
// MEASUREMENT ONLY: pure data, no behavior; leaf module.

/** The uniform `{counter, observed, threshold}` evidence triple. */
export interface GuardEvidence {
  readonly counter: string;
  readonly observed: number;
  readonly threshold: number;
}

/** Build the evidence triple. */
export function guardEvidence(counter: string, observed: number, threshold: number): GuardEvidence {
  return { counter, observed, threshold };
}
