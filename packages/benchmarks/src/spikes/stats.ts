// Spikes S3/S4: small, pure statistics helpers (no dependencies, deterministic).

/** Arithmetic mean (NaN on empty input). */
export const mean = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Sample standard deviation (n-1); 0 for fewer than two values. */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Median (NaN on empty input). */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const T975: readonly number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101,
  2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** Two-sided 95% Student t critical value for `df` degrees of freedom. */
export function tCrit975(df: number): number {
  if (df < 1) return Number.POSITIVE_INFINITY;
  if (df <= 30) return T975[df - 1]!;
  return 1.96 + 2.4 / df;
}

/** Wilson score interval for x successes of n. */
export function wilson(x: number, n: number, z = 1.96): { readonly lo: number; readonly hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = x / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Newcombe hybrid-score 95% interval for p1 - p0 (valid at 0 and 1). */
export function newcombeDiff(
  x1: number,
  n1: number,
  x0: number,
  n0: number,
  z = 1.96,
): { readonly diff: number; readonly lo: number; readonly hi: number } {
  const p1 = n1 === 0 ? 0 : x1 / n1;
  const p0 = n0 === 0 ? 0 : x0 / n0;
  const w1 = wilson(x1, n1, z);
  const w0 = wilson(x0, n0, z);
  const diff = p1 - p0;
  return {
    diff,
    lo: diff - Math.sqrt((p1 - w1.lo) ** 2 + (w0.hi - p0) ** 2),
    hi: diff + Math.sqrt((w1.hi - p1) ** 2 + (p0 - w0.lo) ** 2),
  };
}

/** Mean with a two-sided 95% t-interval over per-cluster values (cluster = task). */
export function tInterval(xs: readonly number[]): { readonly mean: number; readonly lo: number; readonly hi: number } {
  const m = mean(xs);
  if (xs.length < 2) return { mean: m, lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY };
  const h = tCrit975(xs.length - 1) * (sd(xs) / Math.sqrt(xs.length));
  return { mean: m, lo: m - h, hi: m + h };
}

/** Deterministic PRNG (mulberry32) so permutation results are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Two-sided sign-flip permutation p-value for H0: the mean of `xs` is 0.
 * Exact enumeration for up to 16 values, otherwise 20,000 seeded flips.
 */
export function signFlipP(xs: readonly number[], seed = 1): number {
  const n = xs.length;
  if (n === 0) return 1;
  const obs = Math.abs(mean(xs));
  const eps = 1e-12;
  if (n <= 16) {
    let ge = 0;
    const total = 2 ** n;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += (mask >> i) & 1 ? xs[i]! : -xs[i]!;
      if (Math.abs(s / n) >= obs - eps) ge++;
    }
    return ge / total;
  }
  const r = rng(seed);
  const iters = 20000;
  let ge = 0;
  for (let it = 0; it < iters; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += r() < 0.5 ? xs[i]! : -xs[i]!;
    if (Math.abs(s / n) >= obs - eps) ge++;
  }
  return (ge + 1) / (iters + 1);
}

/** Binomial coefficient as a float (exact enough for n <= 60). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Unbiased pass^k (all k independent draws pass) from c successes of n: C(c,k)/C(n,k). */
export const passHatK = (n: number, c: number, k: number): number => (k > n ? Number.NaN : choose(c, k) / choose(n, k));

/** Unbiased pass@k (at least one of k passes): 1 - C(n-c,k)/C(n,k). */
export const passAtK = (n: number, c: number, k: number): number => (k > n ? Number.NaN : 1 - choose(n - c, k) / choose(n, k));

/** One-way ICC(1) from per-group outcome arrays (unbalanced-safe). NaN when undefined. */
export function icc1(groups: readonly (readonly number[])[]): number {
  const g = groups.filter((x) => x.length > 0);
  const k = g.length;
  const N = g.reduce((a, x) => a + x.length, 0);
  if (k < 2 || N <= k) return Number.NaN;
  const grand = g.reduce((a, x) => a + x.reduce((s, v) => s + v, 0), 0) / N;
  let ssb = 0;
  let ssw = 0;
  for (const x of g) {
    const m = mean(x);
    ssb += x.length * (m - grand) ** 2;
    for (const v of x) ssw += (v - m) ** 2;
  }
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  const n0 = (N - g.reduce((a, x) => a + x.length ** 2, 0) / N) / (k - 1);
  const denom = msb + (n0 - 1) * msw;
  return denom === 0 ? Number.NaN : (msb - msw) / denom;
}

/**
 * Standard error of a pooled proportion with tasks as clusters (ratio estimator, CR1).
 * `groups` holds the 0/1 outcomes of each task.
 */
export function clusteredSE(groups: readonly (readonly number[])[]): number {
  const g = groups.filter((x) => x.length > 0);
  const k = g.length;
  const N = g.reduce((a, x) => a + x.length, 0);
  if (k < 2 || N === 0) return Number.NaN;
  const p = g.reduce((a, x) => a + x.reduce((s, v) => s + v, 0), 0) / N;
  const ss = g.reduce((a, x) => a + (x.reduce((s, v) => s + v, 0) - p * x.length) ** 2, 0);
  return Math.sqrt((k / (k - 1)) * ss) / N;
}

/** Naive binomial SE of a pooled proportion (cells treated as independent). */
export function naiveSE(groups: readonly (readonly number[])[]): number {
  const all = groups.flat();
  if (all.length === 0) return Number.NaN;
  const p = mean(all);
  return Math.sqrt((p * (1 - p)) / all.length);
}
