// Spike S3 analysis functions (pure; the CLI is s3-retrospective.ts).
import { type SavedCell, groupByTierTask, isMeasured } from "./cells.js";
import { type V2Verdict, v2Evaluate } from "./gate-v2.js";
import { choose, clusteredSE, icc1, mean, median, naiveSE, passAtK, passHatK, rng, sd } from "./stats.js";
import { v1Evaluate } from "./v1-replay.js";

/** Coarse class used to compare v1 and v2 verdicts. */
export type VerdictClass = "promote" | "reject" | "hold";

/** Map a v1 decision to a coarse class. */
export const v1Class = (d: string): VerdictClass => (d === "default-on" ? "promote" : d === "reject" ? "reject" : "hold");

/** Map a v2 verdict to a coarse class. */
export const v2Class = (v: V2Verdict): VerdictClass =>
  v === "promote-accuracy" || v === "efficiency-win" ? "promote" : v === "reject" || v === "reject-veto-pending" || v === "reject-cost" ? "reject" : "hold";

/** Task-clustered vs naive standard errors for one tier of one comparison. */
export interface ClusterRow {
  readonly tier: string;
  readonly tasks: number;
  readonly cellsPerArm: number;
  readonly naiveSePp: number;
  readonly pairedClusterSePp: number;
  readonly ratio: number;
}

const rate = (cs: readonly SavedCell[]): number => (cs.length === 0 ? Number.NaN : cs.filter((c) => c.solved).length / cs.length);

/**
 * Naive unpaired SE of the pooled pass-rate difference vs the task-clustered paired SE
 * (SE of the mean per-task difference), per tier.
 */
export function clusterRows(base: readonly SavedCell[], cand: readonly SavedCell[]): readonly ClusterRow[] {
  const tiers = [...new Set(base.map((c) => c.tier))].filter((t) => cand.some((c) => c.tier === t));
  return tiers.flatMap((tier) => {
    const b = base.filter((c) => c.tier === tier && isMeasured(c));
    const c = cand.filter((x) => x.tier === tier && isMeasured(x));
    const tasks = [...new Set(b.map((x) => x.taskId))].filter((t) => c.some((x) => x.taskId === t));
    if (tasks.length < 2) return [];
    const bc = b.filter((x) => tasks.includes(x.taskId));
    const cc = c.filter((x) => tasks.includes(x.taskId));
    const pB = rate(bc);
    const pC = rate(cc);
    const naive = Math.sqrt((pB * (1 - pB)) / bc.length + (pC * (1 - pC)) / cc.length);
    const d = tasks.map((t) => rate(cc.filter((x) => x.taskId === t)) - rate(bc.filter((x) => x.taskId === t)));
    const clustered = sd(d) / Math.sqrt(d.length);
    return [{ tier, tasks: tasks.length, cellsPerArm: Math.round((bc.length + cc.length) / 2), naiveSePp: naive * 100, pairedClusterSePp: clustered * 100, ratio: naive === 0 ? Number.NaN : clustered / naive }];
  });
}

/** Per-arm reliability and task-structure statistics for one tier of one results arm. */
export interface ArmStats {
  readonly tier: string;
  readonly tasks: number;
  readonly runsPerTask: number;
  readonly passRate: number;
  /** pooled mean over tasks of unbiased pass^k, k = 1..runsPerTask */
  readonly passHat: readonly number[];
  readonly passAt: readonly number[];
  readonly icc: number;
  /** Naive binomial SE of the pooled pass rate, pp. */
  readonly naiveSePp: number;
  /** Task-clustered SE of the pooled pass rate, pp. */
  readonly clusteredSePp: number;
  readonly perTask: readonly { readonly taskId: string; readonly n: number; readonly passRate: number }[];
}

/**
 * Reliability (pass^k, pass@k), ICC(1) and clustering of one arm, per tier.
 *
 * @param cells Cells of one arm (measured cells only are used).
 * @returns One row per tier with at least 2 tasks of >= 2 runs.
 */
export function armStats(cells: readonly SavedCell[]): readonly ArmStats[] {
  const tiers = [...new Set(cells.map((c) => c.tier))];
  return tiers.flatMap((tier) => {
    const g = [...groupByTierTask(cells.filter((c) => c.tier === tier && isMeasured(c)))].map(([key, cs]) => ({ taskId: key.split("\u0000")[1]!, cs }));
    if (g.length < 2) return [];
    // Timeouts leave uneven n per task: pass^k averages over the tasks with n >= k.
    const k = Math.max(...g.map((x) => x.cs.length));
    if (k < 2) return [];
    const groups = g.map((x) => x.cs.map((c) => (c.solved ? 1 : 0)));
    const ks = Array.from({ length: k }, (_, i) => i + 1);
    const finiteMean = (xs: readonly number[]): number => mean(xs.filter((x) => Number.isFinite(x)));
    const passHat = ks.map((kk) => finiteMean(g.map((x) => passHatK(x.cs.length, x.cs.filter((c) => c.solved).length, kk))));
    const passAt = ks.map((kk) => finiteMean(g.map((x) => passAtK(x.cs.length, x.cs.filter((c) => c.solved).length, kk))));
    return [
      {
        tier,
        tasks: g.length,
        runsPerTask: k,
        passRate: mean(groups.flat()),
        passHat,
        passAt,
        icc: icc1(groups),
        naiveSePp: naiveSE(groups) * 100,
        clusteredSePp: clusteredSE(groups) * 100,
        perTask: g.map((x) => ({ taskId: x.taskId, n: x.cs.length, passRate: rate(x.cs) })),
      },
    ];
  });
}

/** Task class on a tier pooled across arms/files: always-pass, always-fail, or discriminative. */
export type TaskClass = "saturated" | "floor" | "discriminative";

/** Classify tasks from pooled outcomes; rank by Bernoulli variance p(1-p) (information per run). */
export function rankTasks(cells: readonly SavedCell[]): readonly { readonly taskId: string; readonly n: number; readonly p: number; readonly cls: TaskClass; readonly info: number }[] {
  const by = new Map<string, SavedCell[]>();
  for (const c of cells.filter(isMeasured)) by.set(c.taskId, [...(by.get(c.taskId) ?? []), c]);
  const rows = [...by].map(([taskId, cs]) => {
    const p = rate(cs);
    const cls: TaskClass = p === 1 ? "saturated" : p === 0 ? "floor" : "discriminative";
    return { taskId, n: cs.length, p, cls, info: p * (1 - p) };
  });
  return rows.sort((a, b) => b.info - a.info || a.taskId.localeCompare(b.taskId));
}

/** A/A result for one source: how often each gate mis-fires on a split of identical code. */
export interface AaResult {
  readonly reps: number;
  readonly halfRuns: number;
  readonly v1Default: { readonly reject: number; readonly underpowered: number; readonly optIn: number; readonly defaultOn: number };
  readonly v1MinRuns2Reject: number;
  readonly v2: { readonly reject: number; readonly rejectNoVeto: number; readonly needMore: number; readonly neutral: number; readonly promote: number };
}

/**
 * A/A: randomly split each (tier, task) cell set into two equal halves of identical code
 * and judge half B against half A. Every reject is a false reject by construction.
 */
export function aaSplit(cells: readonly SavedCell[], reps: number, seed: number): AaResult | undefined {
  const sets = [...groupByTierTask(cells)].map(([, cs]) => cs);
  const k = Math.min(...sets.map((s) => s.length));
  const half = Math.floor(k / 2);
  if (half < 2 || sets.length < 2) return undefined;
  const r = rng(seed);
  const tally = { v1r: 0, v1u: 0, v1o: 0, v1d: 0, v1m2: 0, v2r: 0, v2rn: 0, v2n: 0, v2neu: 0, v2p: 0 };
  for (let it = 0; it < reps; it++) {
    const A: SavedCell[] = [];
    const B: SavedCell[] = [];
    for (const s of sets) {
      const idx = s.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [idx[i], idx[j]] = [idx[j]!, idx[i]!];
      }
      idx.slice(0, half).forEach((i) => A.push(s[i]!));
      idx.slice(half, 2 * half).forEach((i) => B.push(s[i]!));
    }
    const d = v1Evaluate(A, B).decision;
    if (d === "reject") tally.v1r++;
    else if (d === "underpowered") tally.v1u++;
    else if (d === "opt-in") tally.v1o++;
    else tally.v1d++;
    if (v1Evaluate(A, B, { ...v1Policy2 }).decision === "reject") tally.v1m2++;
    const v = v2Evaluate(A, B);
    const cl = v2Class(v.verdict);
    if (cl === "reject") tally.v2r++;
    if (v.verdict === "reject" || v.verdict === "reject-cost") tally.v2rn++;
    if (v.verdict === "need-more-cells") tally.v2n++;
    if (v.verdict === "neutral") tally.v2neu++;
    if (cl === "promote") tally.v2p++;
  }
  const f = (n: number): number => n / reps;
  return {
    reps,
    halfRuns: half,
    v1Default: { reject: f(tally.v1r), underpowered: f(tally.v1u), optIn: f(tally.v1o), defaultOn: f(tally.v1d) },
    v1MinRuns2Reject: f(tally.v1m2),
    v2: { reject: f(tally.v2r), rejectNoVeto: f(tally.v2rn), needMore: f(tally.v2n), neutral: f(tally.v2neu), promote: f(tally.v2p) },
  };
}

import { DEFAULT_LIFT_POLICY, type LiftPolicy } from "../gate/types.js";
const v1Policy2: LiftPolicy = { ...DEFAULT_LIFT_POLICY, minRuns: 2 };

/** Discordance of run-index-paired outcomes (McNemar) and the MDE it implies. */
export interface McNemar {
  /** Measured (tier, task, run) pairs present in both arms. */
  readonly pairs: number;
  /** Baseline solved, candidate not. */
  readonly b: number;
  /** Candidate solved, baseline not. */
  readonly c: number;
  /** Exact two-sided sign-test p on the discordant pairs (1 when none). */
  readonly p: number;
  /** MDE in pp at the observed discordance: (z_.975 + z_.8) * sigma_D / sqrt(pairs). NaN without pairs. */
  readonly mdePp: number;
}

/**
 * Exact McNemar on pairs matched by (tier, task, run index). Runs are NOT seed-paired, so the
 * pairing is arbitrary and the test is a descriptive discordance count, not a variance reduction.
 */
export function mcnemar(base: readonly SavedCell[], cand: readonly SavedCell[]): McNemar {
  const key = (c: SavedCell): string => `${c.tier}\u0000${c.taskId}\u0000${c.run}`;
  const bm = new Map(base.filter(isMeasured).map((c) => [key(c), c.solved] as const));
  let pairs = 0;
  let b = 0;
  let c = 0;
  for (const x of cand.filter(isMeasured)) {
    const s = bm.get(key(x));
    if (s === undefined) continue;
    pairs++;
    if (s && !x.solved) b++;
    else if (!s && x.solved) c++;
  }
  const m = b + c;
  let p = 1;
  if (m > 0) {
    const lo = Math.min(b, c);
    let tail = 0;
    for (let i = 0; i <= lo; i++) tail += choose(m, i);
    p = Math.min(1, (2 * tail) / 2 ** m);
  }
  const sigma2 = pairs === 0 ? Number.NaN : m / pairs - ((c - b) / pairs) ** 2;
  return { pairs, b, c, p, mdePp: pairs === 0 ? Number.NaN : ((1.96 + 0.84) * Math.sqrt(sigma2) * 100) / Math.sqrt(pairs) };
}

/** Median of the finite values. */
export const medianFinite = (xs: readonly number[]): number => median(xs.filter((x) => Number.isFinite(x)));
