// File: src/h3/stats.ts — pure statistics for the H3 report.

/** Wilson score interval for a binomial proportion (z=1.96 -> 95%). n=0 -> [0,1]. */
export function wilson(successes: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 }
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

/**
 * pass^k from n draws with c solves, tau-bench definition: P(k i.i.d. draws all
 * solve) estimated as C(c,k)/C(n,k). Undefined when n < k.
 */
export function passHatK(n: number, c: number, k: number): number | undefined {
  if (n < k || k < 1) return undefined
  if (c < k) return 0
  let p = 1
  for (let i = 0; i < k; i++) p *= (c - i) / (n - i)
  return p
}

/**
 * Smallest gap between two cells' pass rates that is not noise at this n:
 * the two Wilson intervals must be disjoint. Used to enforce "no claim under
 * 26pp gap at n=5 per cell" mechanically.
 */
export function intervalsDisjoint(a: { lo: number; hi: number }, b: { lo: number; hi: number }): boolean {
  return a.hi < b.lo || b.hi < a.lo
}
