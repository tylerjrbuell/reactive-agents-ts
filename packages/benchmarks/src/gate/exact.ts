// File: src/gate/exact.ts — exact small-sample tests and the paired-by-task estimator.
//
// One home for the statistics the lift gate (`gate.ts`) and the H3 verdict
// (`h3/verdict.ts`) both read, so the quick verdict can never again disagree
// with the gate on the same data (audit 03 D1: the verdict used disjoint pooled
// Wilson intervals and printed NO-CHANGE for a lever the gate rejected).
//
// Pure, zero-dependency, no I/O.

/** Sum of ln(i) for i in 1..n, as a lookup array (n is a run count, so small). */
function logFactorials(n: number): readonly number[] {
  const out: number[] = [0];
  for (let i = 1; i <= n; i++) out.push((out[i - 1] ?? 0) + Math.log(i));
  return out;
}

/**
 * Two-sided Fisher exact p for two binomial arms: `a` of `n1` solved in the
 * baseline, `c` of `n2` solved in the candidate. Sums the hypergeometric
 * probability of every table (fixed margins) no more likely than the observed
 * one. Empty arm -> 1 (nothing to compare).
 */
export function fisherExactP(a: number, n1: number, c: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 1;
  const total = n1 + n2;
  const k = a + c;
  const lf = logFactorials(total);
  const lg = (n: number): number => lf[n] ?? 0;
  const logP = (x: number): number =>
    lg(n1) - lg(x) - lg(n1 - x) + lg(n2) - lg(k - x) - lg(n2 - (k - x)) - (lg(total) - lg(k) - lg(total - k));
  const lo = Math.max(0, k - n2);
  const hi = Math.min(k, n1);
  const observed = logP(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-9) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

/** Exact McNemar result over run-paired binary outcomes. */
export interface McNemar {
  /** Pairs measured in both arms. */
  readonly pairs: number;
  /** b: candidate solved, baseline did not (gains). */
  readonly b: number;
  /** c: baseline solved, candidate did not (losses). */
  readonly c: number;
  /** Two-sided exact binomial p on the discordant pairs (1 when b + c = 0). */
  readonly p: number;
}

/** Exact two-sided McNemar p from the discordant counts `b` (gains) and `c` (losses). */
export function mcnemarExactP(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const lf = logFactorials(n);
  const lg = (i: number): number => lf[i] ?? 0;
  const m = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= m; i++) tail += Math.exp(lg(n) - lg(i) - lg(n - i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

/** Holm-Bonferroni step-down adjusted p-values, returned in the input order. */
export function holmAdjust(ps: readonly number[]): readonly number[] {
  const order = ps.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const m = ps.length;
  const out = new Array<number>(m).fill(1);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    out[i] = running;
  });
  return out;
}

/**
 * Paired-by-task estimate of the mean lift D = mean_t(d_t), from per-task
 * differences `dPp` with standard errors `sePp` (points). SE(D) is the larger
 * of the within-cell term sqrt(sum se_t^2)/T and the between-task clustered
 * term sd(d_t)/sqrt(T): two tasks that disagree about an effect are evidence of
 * heterogeneity, not of precision. This is the gate's own estimator
 * (`gate.ts` delegates here).
 */
export function pairedLift(
  perTask: ReadonlyArray<{ readonly dPp: number; readonly sePp: number }>,
): { readonly liftPp: number; readonly stdErrPp: number } {
  const T = perTask.length;
  if (T === 0) return { liftPp: 0, stdErrPp: 0 };
  const dBar = perTask.reduce((a, p) => a + p.dPp / 100, 0) / T;
  const within = Math.sqrt(perTask.reduce((a, p) => a + (p.sePp / 100) ** 2, 0)) / T;
  const between =
    T >= 2
      ? Math.sqrt(perTask.reduce((a, p) => a + (p.dPp / 100 - dBar) ** 2, 0) / (T - 1)) / Math.sqrt(T)
      : 0;
  return { liftPp: dBar * 100, stdErrPp: Math.max(within, between) * 100 };
}

/** z for 80% power; with the promotion band's z-alpha it sizes `runsNeeded`. */
export const Z_POWER_80 = 0.8416;

/**
 * Runs per cell (per task, per arm) to resolve `minLiftPp` with 80% power on
 * the mean of `T` paired tasks: SE(D) = sd * sqrt(2 / (n T)), so
 * n = 2 (z_alpha + z_beta)^2 sd^2 / (T delta^2). The previous formula dropped
 * the 1/T (D is a mean of T tasks) and z_beta, overstating the need by ~T and
 * sizing for 50% power (audit 01 D6).
 */
export function runsNeededFor(sd: number, minLiftPp: number, tasks: number, zAlpha: number): number {
  const delta = minLiftPp / 100;
  if (delta <= 0) return 0;
  return Math.ceil((2 * (zAlpha + Z_POWER_80) ** 2 * sd ** 2) / (Math.max(1, tasks) * delta ** 2));
}

/**
 * Run-index-paired solved flags of one task: McNemar discordant counts. Arms
 * that interleave per (run, task) make run i of one arm the nominal partner of
 * run i of the other (host drift is shared); the runs are NOT seed-paired.
 */
export function pairByRun(
  base: ReadonlyArray<{ readonly index: number; readonly solved: boolean }>,
  cand: ReadonlyArray<{ readonly index: number; readonly solved: boolean }>,
): { readonly pairs: number; readonly b: number; readonly c: number } {
  const candByIndex = new Map(cand.map((r) => [r.index, r.solved]));
  let pairs = 0;
  let b = 0;
  let c = 0;
  for (const r of base) {
    const other = candByIndex.get(r.index);
    if (other === undefined) continue;
    pairs++;
    if (other && !r.solved) b++;
    if (!other && r.solved) c++;
  }
  return { pairs, b, c };
}

/** Sum run-paired discordant counts across tasks into one exact McNemar. */
export function mcnemarOf(parts: ReadonlyArray<{ readonly pairs: number; readonly b: number; readonly c: number }>): McNemar {
  const pairs = parts.reduce((a, x) => a + x.pairs, 0);
  const b = parts.reduce((a, x) => a + x.b, 0);
  const c = parts.reduce((a, x) => a + x.c, 0);
  return { pairs, b, c, p: mcnemarExactP(b, c) };
}
