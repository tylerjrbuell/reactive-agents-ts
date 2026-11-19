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

/**
 * True when a sandbox failure repeats the previous iteration's failure
 * message exactly: the repair call did not move the run, so another
 * regeneration is spend with no new evidence. Compares messages only, not
 * code: a model that rewrites the code around the same broken call still
 * fails identically (Cortex run 01M7SZFGGV6W2K8R4V2H873NPM repeated one
 * error on all 10 iterations with regenerated code).
 *
 * @param previous - the previous iteration's sandbox error, or null if it did not fail
 * @param current - this iteration's sandbox error
 */
export function isRepeatedSandboxFailure(previous: string | null, current: string): boolean {
  return previous !== null && previous === current;
}
