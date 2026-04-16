/**
 * Compare what the classifier said was required against what the run actually called.
 * - False positive: classifier required X, but X was never called → classifier over-required
 * - False negative: tool Y was called ≥2 times but classifier didn't list it → classifier missed it
 *   (We require ≥2 calls to exclude single incidental invocations.)
 */
export function diffClassifierAccuracy(
  classifierRequired: readonly string[],
  actuallyCalledLog: readonly string[],
): { readonly falsePositives: readonly string[]; readonly falseNegatives: readonly string[] } {
  const callCounts = new Map<string, number>();
  for (const name of actuallyCalledLog) {
    callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
  }
  const requiredSet = new Set(classifierRequired);

  const falsePositives = classifierRequired.filter((name) => !callCounts.has(name));
  const falseNegatives = [...callCounts.entries()]
    .filter(([name, count]) => count >= 2 && !requiredSet.has(name))
    .map(([name]) => name);

  return { falsePositives, falseNegatives };
}
