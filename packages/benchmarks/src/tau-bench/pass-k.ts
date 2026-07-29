/**
 * pass^k — the fraction of tasks for which ALL k trials succeeded.
 *
 * This is reliability, not accuracy. A harness that solves a task 80% of the
 * time has pass^8 = 0.8^8 = 0.168. 09 names reliability as the binding axis
 * precisely because that gap is where agent harnesses actually fail.
 *
 * Throws rather than truncating when k exceeds the recorded trials: scoring
 * pass^8 off 3 trials would overstate reliability, and a silent cap reads as
 * "we covered it" when we did not.
 */
export function passAtK(
  results: readonly (readonly boolean[])[],
  k: number,
): number {
  if (results.length === 0) return 0;
  for (const trials of results) {
    if (trials.length < k) {
      throw new Error(
        `pass^${k} requires at least ${k} trials per task; found ${trials.length}. ` +
          `Truncating would overstate reliability.`,
      );
    }
  }
  const allPassed = results.filter((trials) =>
    trials.slice(0, k).every(Boolean),
  ).length;
  return allPassed / results.length;
}
