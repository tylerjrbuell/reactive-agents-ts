// File: src/strategies/code-action/code-action-reflect.ts
//
// Reflect phase helpers: decide whether to terminate or continue the
// plan→execute→observe loop based on verifier verdict and iteration count.

export type VerifierVerdict = "PASS" | "FAIL";

export interface ReflectInput {
  verdict: VerifierVerdict;
  iteration: number;
  maxIterations: number;
}

/**
 * Returns true if the strategy should stop the plan→execute loop.
 * Terminates on PASS verdict or when max iterations are exhausted.
 */
export function shouldTerminate(input: ReflectInput): boolean {
  if (input.verdict === "PASS") return true;
  if (input.iteration >= input.maxIterations) return true;
  return false;
}
