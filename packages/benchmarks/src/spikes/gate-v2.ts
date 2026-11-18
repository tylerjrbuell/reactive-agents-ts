// Spike S3: a SPIKE-GRADE gate v2 verdict, exactly the rules pre-registered in
// wiki/Research/Spikes-2026-11-18-measurement/PREDICTIONS.md. Not the production gate:
// it exists to replay saved cells and measure how v2 would have judged them.
import { type SavedCell, billed, isMeasured } from "./cells.js";
import { mean, newcombeDiff, signFlipP, tInterval } from "./stats.js";

/** Pre-declared v2 thresholds (see PREDICTIONS.md). */
export const V2 = {
  niPointPp: -3,
  niLowerPp: -10,
  harmPointPp: -5,
  superiorLowerPp: 3,
  vetoPp: -40,
  vetoMinRuns: 3,
  savesRatio: 0.95,
  costsRatio: 1.15,
} as const;

/** Accuracy state per tier. */
export type AccuracyState = "SUPERIOR" | "NON-INFERIOR" | "HARM" | "UNRESOLVED";
/** Efficiency state per tier. */
export type EfficiencyState = "SAVES" | "COSTS" | "FLAT" | "UNKNOWN";
/** Combined v2 verdict. */
export type V2Verdict =
  | "reject"
  | "reject-veto-pending"
  | "reject-cost"
  | "promote-accuracy"
  | "efficiency-win"
  | "neutral"
  | "need-more-cells";

/** Per-task counts for one tier. */
export interface TaskCounts {
  readonly taskId: string;
  readonly nBase: number;
  readonly xBase: number;
  readonly nCand: number;
  readonly xCand: number;
  readonly discriminative: boolean;
  /** Candidate minus baseline pass rate, in percentage points. */
  readonly deltaPp: number;
  /** ln(mean billed tokens cand / base); NaN when either arm has no token data. */
  readonly logTokenRatio: number;
  /** ln(mean iterations cand / base); NaN when missing. */
  readonly logTurnRatio: number;
}

/** v2 evidence for one tier. */
export interface V2Tier {
  readonly tier: string;
  readonly tasks: readonly TaskCounts[];
  readonly discriminativeTasks: number;
  readonly accuracy: AccuracyState;
  /** Stratified (CMH-weighted) risk difference over discriminative tasks, in pp. NaN when none. */
  readonly rdPp: number;
  readonly ciLoPp: number;
  readonly ciHiPp: number;
  readonly vetoTasks: readonly string[];
  readonly efficiency: EfficiencyState;
  readonly tokenGeoRatio: number;
  readonly tokenRatioLo: number;
  readonly tokenRatioHi: number;
  readonly tokenPermP: number;
  readonly turnGeoRatio: number;
  /** Billed tokens per solved run, candidate / baseline (guards fail-fast survivorship). */
  readonly tokensPerSolvedRatio: number;
  /** Runs per cell needed for non-inferiority at the 10pp margin, 80% power. NaN when not computable. */
  readonly needRunsPerCell: number;
}

/** v2 result for one baseline-vs-candidate comparison. */
export interface V2Result {
  readonly verdict: V2Verdict;
  readonly tiers: readonly V2Tier[];
  readonly reason: string;
}

const logRatio = (num: readonly number[], den: readonly number[]): number => {
  const a = mean(num);
  const b = mean(den);
  return a > 0 && b > 0 ? Math.log(a / b) : Number.NaN;
};

/**
 * Build the per-tier v2 evidence.
 *
 * @param tier The tier id.
 * @param base Baseline-arm cells of this tier.
 * @param cand Candidate-arm cells of this tier.
 * @returns Tier evidence, or undefined when no task has measured cells in both arms.
 */
export function v2Tier(tier: string, base: readonly SavedCell[], cand: readonly SavedCell[]): V2Tier | undefined {
  const bm = base.filter(isMeasured);
  const cm = cand.filter(isMeasured);
  const taskIds = [...new Set(bm.map((c) => c.taskId))].filter((t) => cm.some((c) => c.taskId === t));
  if (taskIds.length === 0) return undefined;
  const tasks: TaskCounts[] = taskIds.map((taskId) => {
    const b = bm.filter((c) => c.taskId === taskId);
    const c = cm.filter((x) => x.taskId === taskId);
    const xB = b.filter((x) => x.solved).length;
    const xC = c.filter((x) => x.solved).length;
    const tokB = b.filter((x) => billed(x) > 0).map(billed);
    const tokC = c.filter((x) => billed(x) > 0).map(billed);
    const itB = b.flatMap((x) => (x.iterations !== null ? [x.iterations] : []));
    const itC = c.flatMap((x) => (x.iterations !== null ? [x.iterations] : []));
    const pooledX = xB + xC;
    const pooledN = b.length + c.length;
    return {
      taskId,
      nBase: b.length,
      xBase: xB,
      nCand: c.length,
      xCand: xC,
      discriminative: pooledX > 0 && pooledX < pooledN,
      deltaPp: (xC / c.length - xB / b.length) * 100,
      logTokenRatio: logRatio(tokC, tokB),
      logTurnRatio: logRatio(itC, itB),
    };
  });
  const disc = tasks.filter((t) => t.discriminative);

  // Accuracy axis (discriminative tasks only).
  let accuracy: AccuracyState = "UNRESOLVED";
  let rdPp = Number.NaN;
  let ciLoPp = Number.NaN;
  let ciHiPp = Number.NaN;
  let needRunsPerCell = Number.NaN;
  if (disc.length > 0) {
    let wSum = 0;
    let rd = 0;
    for (const t of disc) {
      const w = (t.nBase * t.nCand) / (t.nBase + t.nCand);
      wSum += w;
      rd += w * (t.xCand / t.nCand - t.xBase / t.nBase);
    }
    rd /= wSum;
    const xC = disc.reduce((a, t) => a + t.xCand, 0);
    const nC = disc.reduce((a, t) => a + t.nCand, 0);
    const xB = disc.reduce((a, t) => a + t.xBase, 0);
    const nB = disc.reduce((a, t) => a + t.nBase, 0);
    const nc = newcombeDiff(xC, nC, xB, nB);
    const cl = tInterval(disc.map((t) => t.deltaPp / 100));
    // Wider of the two intervals, each centred on its own estimate but reported around the CMH point.
    const lo = Math.min(rd - (nc.diff - nc.lo), rd - (cl.mean - cl.lo));
    const hi = Math.max(rd + (nc.hi - nc.diff), rd + (cl.hi - cl.mean));
    rdPp = rd * 100;
    ciLoPp = lo * 100;
    ciHiPp = hi * 100;
    if (ciLoPp > V2.superiorLowerPp) accuracy = "SUPERIOR";
    else if (rdPp >= V2.niPointPp && ciLoPp > V2.niLowerPp) accuracy = "NON-INFERIOR";
    else if (ciHiPp < 0 && rdPp <= V2.harmPointPp) accuracy = "HARM";
    const pbar = (xC + xB) / (nC + nB);
    needRunsPerCell = Math.ceil((2 * pbar * (1 - pbar) * (1.645 + 0.84) ** 2) / (disc.length * 0.1 ** 2));
  }

  const vetoTasks = tasks
    .filter((t) => t.nBase >= V2.vetoMinRuns && t.nCand >= V2.vetoMinRuns && t.deltaPp <= V2.vetoPp)
    .map((t) => t.taskId);

  // Efficiency axis (all common tasks).
  const logTok = tasks.map((t) => t.logTokenRatio).filter((x) => !Number.isNaN(x));
  const logTurn = tasks.map((t) => t.logTurnRatio).filter((x) => !Number.isNaN(x));
  const ti = tInterval(logTok);
  const solvedC = cm.filter((c) => taskIds.includes(c.taskId) && c.solved);
  const solvedB = bm.filter((c) => taskIds.includes(c.taskId) && c.solved);
  const tokSum = (cs: readonly SavedCell[]): number => cs.filter((c) => taskIds.includes(c.taskId)).reduce((a, c) => a + billed(c), 0);
  const tps = solvedC.length > 0 && solvedB.length > 0 ? tokSum(cm) / solvedC.length / (tokSum(bm) / solvedB.length) : Number.NaN;
  let efficiency: EfficiencyState = "UNKNOWN";
  if (logTok.length >= 2) {
    if (ti.hi < Math.log(V2.savesRatio) && !(tps > 1)) efficiency = "SAVES";
    else if (ti.lo > Math.log(V2.costsRatio)) efficiency = "COSTS";
    else efficiency = "FLAT";
  }
  return {
    tier,
    tasks,
    discriminativeTasks: disc.length,
    accuracy,
    rdPp,
    ciLoPp,
    ciHiPp,
    vetoTasks,
    efficiency,
    tokenGeoRatio: Math.exp(ti.mean),
    tokenRatioLo: Math.exp(ti.lo),
    tokenRatioHi: Math.exp(ti.hi),
    tokenPermP: signFlipP(logTok),
    turnGeoRatio: logTurn.length > 0 ? Math.exp(mean(logTurn)) : Number.NaN,
    tokensPerSolvedRatio: tps,
    needRunsPerCell,
  };
}

/**
 * Replay a baseline-vs-candidate comparison under the pre-registered v2 rules.
 *
 * @param base All baseline cells (any tiers).
 * @param cand All candidate cells (any tiers).
 * @returns The per-tier evidence and the combined verdict (worst tier wins).
 */
export function v2Evaluate(base: readonly SavedCell[], cand: readonly SavedCell[]): V2Result {
  const tiers = [...new Set(base.map((c) => c.tier))].filter((t) => cand.some((c) => c.tier === t)).sort();
  const evidence = tiers.flatMap((t) => {
    const e = v2Tier(
      t,
      base.filter((c) => c.tier === t),
      cand.filter((c) => c.tier === t),
    );
    return e ? [e] : [];
  });
  if (evidence.length === 0) return { verdict: "need-more-cells", tiers: [], reason: "no tier has measured cells in both arms" };
  const harm = evidence.filter((e) => e.accuracy === "HARM");
  if (harm.length > 0) return { verdict: "reject", tiers: evidence, reason: `accuracy HARM on ${harm.map((e) => e.tier).join(", ")}` };
  const veto = evidence.filter((e) => e.vetoTasks.length > 0);
  if (veto.length > 0) {
    return {
      verdict: "reject-veto-pending",
      tiers: evidence,
      reason: `task delta <= ${V2.vetoPp}pp: ${veto.map((e) => `${e.tier}:${e.vetoTasks.join("+")}`).join(", ")} (rerun to confirm)`,
    };
  }
  const costs = evidence.filter((e) => e.efficiency === "COSTS" && e.accuracy !== "SUPERIOR");
  if (costs.length > 0) return { verdict: "reject-cost", tiers: evidence, reason: `tokens > +15% on ${costs.map((e) => e.tier).join(", ")}` };
  if (evidence.every((e) => e.accuracy === "SUPERIOR")) return { verdict: "promote-accuracy", tiers: evidence, reason: "all tiers SUPERIOR" };
  const allNi = evidence.every((e) => e.accuracy === "SUPERIOR" || e.accuracy === "NON-INFERIOR");
  if (allNi) {
    return evidence.every((e) => e.efficiency === "SAVES")
      ? { verdict: "efficiency-win", tiers: evidence, reason: "non-inferior accuracy, tokens saved on every tier" }
      : { verdict: "neutral", tiers: evidence, reason: "non-inferior accuracy, no demonstrated benefit" };
  }
  const un = evidence.filter((e) => e.accuracy === "UNRESOLVED");
  return {
    verdict: "need-more-cells",
    tiers: evidence,
    reason: `accuracy unresolved on ${un.map((e) => `${e.tier}(disc=${e.discriminativeTasks})`).join(", ")}`,
  };
}
