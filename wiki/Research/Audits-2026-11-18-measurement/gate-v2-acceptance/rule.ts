// Gate v2 reference implementation of the decision rule in ../04-gate-v2-spec.md.
// Pure, zero-token, no I/O. This is the SPEC executable, not production code: the
// production build (harness-warden) must reproduce its outputs on the fixtures in
// replay.ts / sim.ts. Imports spikes/stats.ts read-only (wilson, rng).
import { rng as makeRng, wilson } from "../../../../packages/benchmarks/src/spikes/stats.js";

// ---------------------------------------------------------------- types

/** One measured run of one arm on one task. */
export interface Run {
  readonly solved: boolean;
  /** Billed tokens (raw tokens on token-free tiers). Timed-out runs keep their tokens. */
  readonly tokens: number;
  readonly turns: number | null;
}

/** Task class from the FROZEN REFERENCE baseline (never from the arms under test). */
export type TaskClass = "disc" | "canary" | "floor";

/** Paired arms for one task on one tier. */
export interface TaskData {
  readonly taskId: string;
  readonly cls: TaskClass;
  readonly base: readonly Run[];
  readonly cand: readonly Run[];
}

/** One tier's data. */
export interface TierData {
  readonly tier: string;
  /** Token-free tier (local): COSTS blocks default-on but does not reject (owner ruling 2026-11-06). */
  readonly tokenFree: boolean;
  readonly tasks: readonly TaskData[];
}

export type Stage = "screen" | "confirm";

/** Pre-declared thresholds. Defaults are the ratified numbers. */
export interface RulePolicy {
  readonly niPointPp: number; // point estimate floor (-3)
  readonly niLowerPp: number; // lower bound floor (-10)
  readonly niZ: number; // one-sided 95% bound
  readonly superiorLowerPp: number; // +3
  readonly harmPointPp: number; // -5
  readonly harmZ: Readonly<Record<Stage, number>>; // two-sided: screen 99%, confirm 95%
  /** A tier in HARM state (its own interval upper bound < 0 and point <= this) blocks NI/SUPERIOR. */
  readonly tierGuardPp: number;
  /** Screen only: advance to confirm when the pooled disc point is >= this (noise-tolerant; confirm applies the real bar). */
  readonly screenAccFloorPp: number;
  readonly canaryAlpha: Readonly<Record<Stage, number>>;
  readonly canaryDropPp: number; // 3
  readonly vetoTriggerPp: number; // -40
  readonly vetoMinRuns: number; // 3
  readonly vetoRerunK: number; // 5
  readonly vetoRerunAlpha: number; // 0.05 one-sided Fisher on the rerun alone
  readonly savesRatio: number; // 0.90: the point estimate must show at least a 10% saving ("clearly cheaper")
  readonly savesNullRatio: number; // 0.95: the permutation test must reject "saving < 5%" (power: testing against 0.90 cannot resolve a true 15%)
  readonly costsRatio: number; // 1.15
  readonly permAlpha: Readonly<Record<Stage, number>>; // SAVES one-sided alpha
  readonly costsAlpha: Readonly<Record<Stage, number>>;
  readonly screenAdvanceRatio: number; // 0.95 point ratio per tier
  readonly conditionalRatio: number; // leave-heaviest-task-out ratio >= this => conditional
  readonly permB: number;
  readonly planRatio: number; // pre-registered predicted tokens-per-solved ratio for sizing
  readonly sizeInflation: number; // 1.2
  readonly conditionalAllowed: boolean; // pre-registration scopes the trigger tasks
  readonly minDiscStrata: number; // below this the accuracy axis is UNRESOLVED by construction
  readonly confirmMinRuns: number; // promotion needs at least this many runs in EVERY cell (12)
  /** ... and at least this many on discriminative tasks (30 ~ 1.2 N* at ~6 pooled strata; sim: NI type-I 3-4% vs 7% at 12). */
  readonly confirmMinDiscRuns: number;
}

export const DEFAULT_POLICY: RulePolicy = {
  niPointPp: -3,
  niLowerPp: -10,
  niZ: 1.645,
  superiorLowerPp: 3,
  harmPointPp: -5,
  harmZ: { screen: 2.576, confirm: 1.96 },
  tierGuardPp: -5,
  screenAccFloorPp: -20,
  canaryAlpha: { screen: 0.005, confirm: 0.01 },
  canaryDropPp: 3,
  vetoTriggerPp: -40,
  vetoMinRuns: 3,
  vetoRerunK: 5,
  vetoRerunAlpha: 0.05,
  savesRatio: 0.9,
  savesNullRatio: 0.95,
  costsRatio: 1.15,
  permAlpha: { screen: 0.05, confirm: 0.05 },
  costsAlpha: { screen: 0.01, confirm: 0.05 },
  screenAdvanceRatio: 0.95,
  conditionalRatio: 0.95,
  permB: 799,
  planRatio: 0.8,
  sizeInflation: 1.2,
  conditionalAllowed: true,
  minDiscStrata: 2,
  confirmMinRuns: 12,
  confirmMinDiscRuns: 30,
};

export type VerdictName =
  | "default-on"
  | "opt-in"
  | "reject"
  | "reject-cost"
  | "need-more-cells"
  | "veto-pending"
  | "screen-advance"
  | "screen-drop";

export type AccuracyState = "SUPERIOR" | "NON-INFERIOR" | "HARM" | "UNRESOLVED";
export type EfficiencyState = "SAVES" | "COSTS" | "NO-BENEFIT-SHOWN" | "UNKNOWN";

export interface TierEfficiency {
  readonly tier: string;
  readonly state: EfficiencyState;
  /** True when SAVES was judged on the pre-registered trigger scope only. */
  readonly scoped: boolean;
  /** Tokens per solved run, candidate / baseline (pooled over the judged tasks). */
  readonly tpsRatio: number;
  /** Tokens per run, candidate / baseline (drives the significance test). */
  readonly tprRatio: number;
  readonly savesP: number;
  readonly costsP: number;
  /** Ratio after dropping the task with the largest absolute token saving. */
  readonly leaveHeaviestOutRatio: number;
  readonly conditional: boolean;
  readonly turnRatio: number;
}

export interface AccuracyEvidence {
  readonly strata: number;
  readonly rdPp: number;
  readonly loPp: number;
  readonly hiPp: number;
  /** Cochran Q heterogeneity across strata (I^2, 0..1). */
  readonly i2: number;
  readonly state: AccuracyState;
  readonly tierPointsPp: Readonly<Record<string, number>>;
  readonly tierGuardOk: boolean;
}

export interface VetoItem {
  readonly tier: string;
  readonly taskId: string;
  readonly deltaPp: number;
  readonly status: "pending" | "confirmed" | "cleared";
}

export interface Evaluation {
  readonly stage: Stage;
  readonly verdict: VerdictName;
  readonly exitCode: 0 | 1 | 3;
  /** What the verdict means for the mechanism. */
  readonly meaning: "default-on" | "opt-in" | "reject" | "rerun";
  readonly path: string;
  readonly accuracy: AccuracyEvidence;
  readonly canaryHarm: boolean;
  readonly canaryDropPp: number;
  readonly veto: readonly VetoItem[];
  readonly efficiency: readonly TierEfficiency[];
  /** Runs per cell planned for the axis (1.2 N*), NaN when not computable. */
  readonly planNAccuracy: number;
  readonly planNEfficiency: number;
  readonly runsPerCell: number;
}

// ---------------------------------------------------------------- helpers

const mean = (xs: readonly number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

const LF: number[] = [0];
const lf = (n: number): number => {
  while (LF.length <= n) LF.push(LF[LF.length - 1]! + Math.log(LF.length));
  return LF[n]!;
};

/** One-sided Fisher exact p that the candidate is WORSE: P(X_c <= xc | margins). */
export function fisherWorseP(xb: number, nb: number, xc: number, nc: number): number {
  if (nb <= 0 || nc <= 0) return 1;
  const N = nb + nc;
  const K = xb + xc;
  let p = 0;
  for (let i = Math.max(0, K - nb); i <= xc; i++) {
    p += Math.exp(lf(K) - lf(i) - lf(K - i) + lf(N - K) - lf(nc - i) - lf(N - K - (nc - i)) - (lf(N) - lf(nc) - lf(N - nc)));
  }
  return Math.min(1, p);
}

interface Stratum {
  readonly nb: number;
  readonly xb: number;
  readonly nc: number;
  readonly xc: number;
}

const solvedCount = (rs: readonly Run[]): number => rs.filter((r) => r.solved).length;

/** CMH-weighted task-mean risk difference with a stratified Newcombe-Wilson hybrid interval (fixed suite, no df). */
export function stratifiedRD(
  strata: readonly Stratum[],
  zLo: number,
  zHi: number,
): { rd: number; lo: number; hi: number; i2: number } {
  if (strata.length === 0) return { rd: Number.NaN, lo: Number.NaN, hi: Number.NaN, i2: 0 };
  const neff = strata.map((s) => (s.nb * s.nc) / (s.nb + s.nc));
  const W = neff.reduce((a, b) => a + b, 0);
  const w = neff.map((x) => x / W);
  let rd = 0;
  const d: number[] = [];
  strata.forEach((s, i) => {
    const di = s.xc / s.nc - s.xb / s.nb;
    d.push(di);
    rd += w[i]! * di;
  });
  let lo2 = 0;
  let hi2 = 0;
  strata.forEach((s, i) => {
    const pb = s.xb / s.nb;
    const pc = s.xc / s.nc;
    const wl = wilson(s.xc, s.nc, zLo);
    const wlb = wilson(s.xb, s.nb, zLo);
    lo2 += w[i]! ** 2 * ((pc - wl.lo) ** 2 + (wlb.hi - pb) ** 2);
    const wh = wilson(s.xc, s.nc, zHi);
    const whb = wilson(s.xb, s.nb, zHi);
    hi2 += w[i]! ** 2 * ((wh.hi - pc) ** 2 + (pb - whb.lo) ** 2);
  });
  // Cochran Q on per-stratum RD with Wald variances (floored); I^2 = max(0,(Q-df)/Q).
  let q = 0;
  strata.forEach((s, i) => {
    const pb = s.xb / s.nb;
    const pc = s.xc / s.nc;
    const v = Math.max(0.01, (pb * (1 - pb)) / s.nb + (pc * (1 - pc)) / s.nc);
    q += (d[i]! - rd) ** 2 / v;
  });
  const df = strata.length - 1;
  const i2 = df > 0 && q > 0 ? Math.max(0, (q - df) / q) : 0;
  return { rd, lo: rd - Math.sqrt(lo2), hi: rd + Math.sqrt(hi2), i2 };
}

// ---------------------------------------------------------------- efficiency (shifted stratified permutation)

interface Pool {
  readonly tok: Float64Array; // base then cand per task block, candidate scaled by 1/shift
  readonly sol: Uint8Array;
  readonly start: Int32Array;
  readonly nb: Int32Array;
  readonly nc: Int32Array;
}

const buildPool = (tasks: readonly TaskData[], shift: number): Pool => {
  const total = tasks.reduce((a, t) => a + t.base.length + t.cand.length, 0);
  const tok = new Float64Array(total);
  const sol = new Uint8Array(total);
  const start = new Int32Array(tasks.length);
  const nb = new Int32Array(tasks.length);
  const nc = new Int32Array(tasks.length);
  let o = 0;
  tasks.forEach((t, i) => {
    start[i] = o;
    nb[i] = t.base.length;
    nc[i] = t.cand.length;
    for (const r of t.base) {
      tok[o] = r.tokens;
      sol[o++] = r.solved ? 1 : 0;
    }
    for (const r of t.cand) {
      tok[o] = r.tokens / shift;
      sol[o++] = r.solved ? 1 : 0;
    }
  });
  return { tok, sol, start, nb, nc };
};

const tpsRatio = (tb: number, sb: number, tc: number, sc: number): number =>
  sb === 0 ? Number.NaN : sc === 0 ? Number.POSITIVE_INFINITY : tc / sc / (tb / sb);

/** Efficiency statistic over arm sums: tokens, solved, and run counts (baseline, candidate). */
type Stat = (tb: number, sb: number, tc: number, sc: number, nb: number, nc: number) => number;
/** Tokens per solved run, candidate / baseline (the policy figure; noisy because the solved count is binomial). */
const STAT_TPS: Stat = (tb, sb, tc, sc) => tpsRatio(tb, sb, tc, sc);
/** Tokens per run, candidate / baseline (low-variance; used for the significance test of SAVES / COSTS). */
const STAT_TPR: Stat = (tb, _sb, tc, _sc, nb, nc) => (tb <= 0 || nb === 0 || nc === 0 ? Number.NaN : tc / nc / (tb / nb));

/** Observed ratio and permutation null draws (labels swapped within task). */
function permutation(pool: Pool, B: number, rand: () => number, stat: Stat): { obs: number; nulls: number[] } {
  const T = pool.nb.length;
  let NB = 0;
  let NC = 0;
  for (let i = 0; i < T; i++) {
    NB += pool.nb[i]!;
    NC += pool.nc[i]!;
  }
  let tb = 0;
  let sb = 0;
  let tc = 0;
  let sc = 0;
  for (let i = 0; i < T; i++) {
    const s = pool.start[i]!;
    for (let j = 0; j < pool.nb[i]!; j++) {
      tb += pool.tok[s + j]!;
      sb += pool.sol[s + j]!;
    }
    for (let j = 0; j < pool.nc[i]!; j++) {
      tc += pool.tok[s + pool.nb[i]! + j]!;
      sc += pool.sol[s + pool.nb[i]! + j]!;
    }
  }
  const obs = stat(tb, sb, tc, sc, NB, NC);
  const totalTok = tb + tc;
  const totalSol = sb + sc;
  const idx = new Int32Array(pool.tok.length);
  for (let i = 0; i < T; i++) for (let j = 0; j < pool.nb[i]! + pool.nc[i]!; j++) idx[pool.start[i]! + j] = pool.start[i]! + j;
  const nulls: number[] = [];
  for (let b = 0; b < B; b++) {
    let ct = 0;
    let cs = 0;
    for (let i = 0; i < T; i++) {
      const s = pool.start[i]!;
      const n = pool.nb[i]! + pool.nc[i]!;
      const m = pool.nc[i]!;
      for (let j = 0; j < m; j++) {
        const r = j + Math.floor(rand() * (n - j));
        const tmp = idx[s + j]!;
        idx[s + j] = idx[s + r]!;
        idx[s + r] = tmp;
        ct += pool.tok[idx[s + j]!]!;
        cs += pool.sol[idx[s + j]!]!;
      }
    }
    nulls.push(stat(totalTok - ct, totalSol - cs, ct, cs, NB, NC));
  }
  return { obs, nulls };
}

/** One-sided p for H0: ratio >= r0 against ratio < r0 (SAVES) or H0: ratio <= r0 against > r0 (COSTS). */
function shiftedP(tasks: readonly TaskData[], r0: number, side: "less" | "greater", B: number, rand: () => number, stat: Stat): number {
  const { obs, nulls } = permutation(buildPool(tasks, r0), B, rand, stat);
  if (Number.isNaN(obs)) return 1;
  let ge = 0;
  for (const x of nulls) {
    const hit = side === "less" ? x <= obs + 1e-12 : x >= obs - 1e-12;
    if (hit) ge++;
  }
  return (ge + 1) / (B + 1);
}

function tierTps(tasks: readonly TaskData[]): number {
  let tb = 0;
  let sb = 0;
  let tc = 0;
  let sc = 0;
  for (const t of tasks) {
    tb += t.base.reduce((a, r) => a + r.tokens, 0);
    sb += solvedCount(t.base);
    tc += t.cand.reduce((a, r) => a + r.tokens, 0);
    sc += solvedCount(t.cand);
  }
  return tpsRatio(tb, sb, tc, sc);
}

const tprOf = (tasks: readonly TaskData[]): number => {
  let tb = 0;
  let tc = 0;
  let nb = 0;
  let nc = 0;
  for (const t of tasks) {
    tb += t.base.reduce((a, r) => a + r.tokens, 0);
    tc += t.cand.reduce((a, r) => a + r.tokens, 0);
    nb += t.base.length;
    nc += t.cand.length;
  }
  return STAT_TPR(tb, 0, tc, 0, nb, nc);
};

/**
 * Efficiency state of one tier. SAVES is judged on the pre-registered trigger scope when one is given (a
 * trigger-conditioned mechanism does nothing elsewhere), COSTS always on every task of the tier.
 */
function efficiencyFor(
  tierAll: TierData,
  stage: Stage,
  p: RulePolicy,
  rand: () => number,
  needPerm: boolean,
  scope?: ReadonlySet<string>,
): TierEfficiency {
  const scoped = scope !== undefined && tierAll.tasks.some((t) => scope.has(t.taskId));
  const tier: TierData = scoped ? { ...tierAll, tasks: tierAll.tasks.filter((t) => scope.has(t.taskId)) } : tierAll;
  const ratioAll = tierTps(tierAll.tasks);
  const tprAll = tprOf(tierAll.tasks);
  const ratio = tierTps(tier.tasks);
  const turnsB = tier.tasks.flatMap((t) => t.base.flatMap((r) => (r.turns !== null ? [r.turns] : [])));
  const turnsC = tier.tasks.flatMap((t) => t.cand.flatMap((r) => (r.turns !== null ? [r.turns] : [])));
  const turnRatio = turnsB.length > 0 && turnsC.length > 0 ? mean(turnsC) / mean(turnsB) : Number.NaN;
  // Leave-heaviest-saver-out (token mass).
  const saving = tier.tasks.map((t) => mean(t.base.map((r) => r.tokens)) - mean(t.cand.map((r) => r.tokens)));
  let top = -1;
  let best = Number.NEGATIVE_INFINITY;
  saving.forEach((s, i) => {
    if (s > best) {
      best = s;
      top = i;
    }
  });
  const rest = tier.tasks.filter((_, i) => i !== top);
  const leave = rest.length > 0 ? tierTps(rest) : Number.NaN;
  const conditional = Number.isFinite(ratio) && ratio < p.savesRatio && !(leave < p.conditionalRatio);
  // Tokens per run: observed ratio, plus the shifted-permutation tests (SAVES vs 0.90, COSTS vs 1.15).
  const pooledTpr = tprOf(tier.tasks);
  let savesP = 1;
  let costsP = 1;
  if (needPerm || tprAll > p.costsRatio || ratioAll > p.costsRatio) {
    if (pooledTpr < 1) savesP = shiftedP(tier.tasks, p.savesNullRatio, "less", p.permB, rand, STAT_TPR);
    if (tprAll > p.costsRatio) costsP = Math.min(costsP, shiftedP(tierAll.tasks, p.costsRatio, "greater", p.permB, rand, STAT_TPR));
    if (ratioAll > p.costsRatio) costsP = Math.min(costsP, shiftedP(tierAll.tasks, p.costsRatio, "greater", p.permB, rand, STAT_TPS));
  }
  let state: EfficiencyState = "UNKNOWN";
  if (Number.isFinite(pooledTpr)) {
    // SAVES: tokens-per-run saving is significant AND tokens per SOLVED run did not rise (survivorship guard).
    if (savesP <= p.permAlpha[stage] && pooledTpr < p.savesRatio && (scoped || ratio <= p.screenAdvanceRatio) && ratioAll <= p.costsRatio) state = "SAVES";
    else if (costsP <= p.costsAlpha[stage]) state = "COSTS";
    else state = "NO-BENEFIT-SHOWN";
  }
  return { tier: tier.tier, state, scoped, tpsRatio: ratio, tprRatio: pooledTpr, savesP, costsP, leaveHeaviestOutRatio: leave, conditional, turnRatio };
}

// ---------------------------------------------------------------- sizing (Resolution N*, size at 1.2 N*)

const Z_ALPHA = 1.645;
const Z_BETA = 0.8416;

/** Runs per cell for accuracy NI at margin m, true diff assumed 0: n = 2 (za+zb)^2 mean(pq) / (S m^2), x inflation. */
export function planNAccuracy(strata: readonly Stratum[], marginPp: number, inflation: number): number {
  if (strata.length === 0) return Number.NaN;
  const pq = mean(
    strata.map((s) => {
      const pbar = (s.xb + s.xc) / (s.nb + s.nc);
      return pbar * (1 - pbar);
    }),
  );
  const m = marginPp / 100;
  const nStar = (2 * (Z_ALPHA + Z_BETA) ** 2 * Math.max(pq, 0.02)) / (strata.length * m * m);
  return Math.ceil(inflation * nStar);
}

/** Runs per cell for the efficiency claim: n = 2 (za+zb)^2 mean(sigma_log^2) / (T ln(r0/r_plan)^2), x inflation. */
export function planNEfficiency(tasks: readonly TaskData[], r0: number, rPlan: number, inflation: number): number {
  const vars: number[] = [];
  for (const t of tasks) {
    for (const arm of [t.base, t.cand]) {
      const l = arm.filter((r) => r.tokens > 0).map((r) => Math.log(r.tokens));
      if (l.length >= 2) {
        const m = mean(l);
        vars.push(l.reduce((a, x) => a + (x - m) ** 2, 0) / (l.length - 1));
      }
    }
  }
  if (vars.length === 0 || rPlan >= r0) return Number.NaN;
  const nStar = (2 * (Z_ALPHA + Z_BETA) ** 2 * mean(vars)) / (tasks.length * Math.log(r0 / rPlan) ** 2);
  return Math.ceil(inflation * nStar);
}

// ---------------------------------------------------------------- the evaluation

/** Fresh solo runs for a triggered task: both arms, k runs each. Absent in replay (=> veto-pending). */
export type RerunFn = (tier: string, taskId: string, k: number) => { base: readonly Run[]; cand: readonly Run[] } | undefined;

/**
 * Evaluate one stage of the gate-v2 rule.
 *
 * @param tiers Per-tier paired data of the stage's fresh runs.
 * @param stage "screen" (k=5, kill or advance) or "confirm" (k=12, may promote).
 * @param seed Seed for the permutation draws (fixed per evaluation).
 * @param rerun Automatic solo veto rerun (omit in retrospective replay).
 * @param policy Thresholds.
 */
export function evaluate(
  tiers: readonly TierData[],
  stage: Stage,
  seed: number,
  rerun?: RerunFn,
  policy: RulePolicy = DEFAULT_POLICY,
  scope?: ReadonlySet<string>,
): Evaluation {
  const p = policy;
  const rand = makeRng(seed);

  // 1. Per-task veto on EVERY task (all classes), automatic solo rerun.
  const veto: VetoItem[] = [];
  for (const tier of tiers) {
    for (const t of tier.tasks) {
      const nb = t.base.length;
      const nc = t.cand.length;
      if (nb < p.vetoMinRuns || nc < p.vetoMinRuns) continue;
      const delta = (solvedCount(t.cand) / nc - solvedCount(t.base) / nb) * 100;
      if (delta > p.vetoTriggerPp) continue;
      const rr = rerun?.(tier.tier, t.taskId, p.vetoRerunK);
      if (!rr) {
        veto.push({ tier: tier.tier, taskId: t.taskId, deltaPp: delta, status: "pending" });
        continue;
      }
      const pv = fisherWorseP(solvedCount(rr.base), rr.base.length, solvedCount(rr.cand), rr.cand.length);
      veto.push({ tier: tier.tier, taskId: t.taskId, deltaPp: delta, status: pv <= p.vetoRerunAlpha ? "confirmed" : "cleared" });
    }
  }

  // 2. Accuracy: disc strata pooled across tiers.
  const discStrata = (tier: TierData): Stratum[] =>
    tier.tasks
      .filter((t) => t.cls === "disc" && t.base.length > 0 && t.cand.length > 0)
      .map((t) => ({ nb: t.base.length, xb: solvedCount(t.base), nc: t.cand.length, xc: solvedCount(t.cand) }));
  const all = tiers.flatMap(discStrata);
  const ci = stratifiedRD(all, p.niZ, p.harmZ[stage]);
  const tierPointsPp: Record<string, number> = {};
  let tierGuardOk = true;
  for (const tier of tiers) {
    const s = discStrata(tier);
    if (s.length === 0) continue;
    const t = stratifiedRD(s, p.harmZ[stage], p.harmZ[stage]);
    tierPointsPp[tier.tier] = t.rd * 100;
    if (t.hi * 100 < 0 && t.rd * 100 <= p.tierGuardPp) tierGuardOk = false;
  }
  const rdPp = ci.rd * 100;
  const loPp = ci.lo * 100;
  const hiPp = ci.hi * 100;
  let accState: AccuracyState = "UNRESOLVED";
  if (all.length >= p.minDiscStrata) {
    if (loPp > p.superiorLowerPp && tierGuardOk) accState = "SUPERIOR";
    else if (rdPp >= p.niPointPp && loPp > p.niLowerPp && tierGuardOk) accState = "NON-INFERIOR";
    else if (hiPp < 0 && rdPp <= p.harmPointPp) accState = "HARM";
  } else if (all.length > 0 && hiPp < 0 && rdPp <= p.harmPointPp) accState = "HARM";
  const accuracy: AccuracyEvidence = { strata: all.length, rdPp, loPp, hiPp, i2: ci.i2, state: accState, tierPointsPp, tierGuardOk };

  // 3. Canary pool (saturated at reference): one-sided exact, pooled over tiers and tasks.
  let cxb = 0;
  let cnb = 0;
  let cxc = 0;
  let cnc = 0;
  for (const tier of tiers) {
    for (const t of tier.tasks.filter((x) => x.cls === "canary")) {
      cxb += solvedCount(t.base);
      cnb += t.base.length;
      cxc += solvedCount(t.cand);
      cnc += t.cand.length;
    }
  }
  const canaryDrop = cnb > 0 && cnc > 0 ? (cxb / cnb - cxc / cnc) * 100 : 0;
  const canaryHarm = cnb > 0 && cnc > 0 && fisherWorseP(cxb, cnb, cxc, cnc) <= p.canaryAlpha[stage] && canaryDrop >= p.canaryDropPp;

  // 4. Efficiency per tier (permutation tests only when the verdict could depend on them).
  const confirmedVeto = veto.some((v) => v.status === "confirmed");
  const pending = veto.some((v) => v.status === "pending");
  const earlyReject = confirmedVeto || accState === "HARM" || canaryHarm;
  const eff = tiers.map((tier) => efficiencyFor(tier, stage, p, rand, !earlyReject, scope));

  const runsPerCell = Math.min(...tiers.flatMap((t) => t.tasks.map((x) => Math.min(x.base.length, x.cand.length))));
  const planAcc = planNAccuracy(all, -p.niLowerPp, p.sizeInflation);
  const effPlans = tiers.map((t) => planNEfficiency(t.tasks, p.savesNullRatio, p.planRatio, p.sizeInflation)).filter(Number.isFinite);
  const planEff = effPlans.length > 0 ? Math.max(...effPlans) : Number.NaN;

  const out = (verdict: VerdictName, meaning: Evaluation["meaning"], path: string): Evaluation => ({
    stage,
    verdict,
    exitCode: meaning === "reject" ? 1 : meaning === "rerun" ? 3 : 0,
    meaning,
    path,
    accuracy,
    canaryHarm,
    canaryDropPp: canaryDrop,
    veto,
    efficiency: eff,
    planNAccuracy: planAcc,
    planNEfficiency: planEff,
    runsPerCell,
  });

  // Decision order. 1: harm evidence (all stages).
  if (confirmedVeto) return out("reject", "reject", "task-harm (replicated solo rerun)");
  if (accState === "HARM") return out("reject", "reject", "accuracy-harm (pooled disc interval)");
  if (canaryHarm) return out("reject", "reject", "canary-harm (saturated tasks dropped)");
  if (pending) return out("veto-pending", "rerun", "task delta <= -40pp: solo k=5 rerun required");
  const costs = eff.filter((e) => e.state === "COSTS");
  if (costs.length > 0 && accState !== "SUPERIOR") {
    return costs.every((e) => tiers.find((t) => t.tier === e.tier)?.tokenFree)
      ? out("opt-in", "opt-in", "token-free tier costs more tokens (blocks default-on, no reject)")
      : out("reject-cost", "reject", "tokens per solved run > +15%");
  }

  if (stage === "screen") {
    const advanceEff = eff.every((e) => Number.isFinite(e.tprRatio) && e.tprRatio <= p.screenAdvanceRatio);
    const advanceAcc = all.length === 0 || rdPp >= p.screenAccFloorPp;
    const advanceSup = all.length > 0 && rdPp >= p.superiorLowerPp;
    if ((advanceEff && advanceAcc && tierGuardOk) || (advanceSup && tierGuardOk)) return out("screen-advance", "rerun", "screen passed: run confirm k=12");
    return out("screen-drop", "opt-in", "no efficiency or accuracy signal at screen");
  }

  // Confirm.
  const effSaves = eff.every((e) => e.state === "SAVES");
  // Promotion only at the pre-declared final n (confirm: >= confirmMinRuns per cell on every task).
  const discRuns = tiers.flatMap((t) => t.tasks.filter((x) => x.cls === "disc").map((x) => Math.min(x.base.length, x.cand.length)));
  const underConfirmN = runsPerCell < p.confirmMinRuns || (discRuns.length > 0 && Math.min(...discRuns) < p.confirmMinDiscRuns);
  if (underConfirmN && (accState === "SUPERIOR" || (accState === "NON-INFERIOR" && effSaves))) {
    return out("need-more-cells", "rerun", `promotion needs >= ${p.confirmMinRuns} runs per cell and >= ${p.confirmMinDiscRuns} on discriminative tasks (have ${runsPerCell} min)`);
  }
  if (accState === "SUPERIOR") return out("default-on", "default-on", "accuracy win (pooled LB > +3pp)");
  if (accState === "NON-INFERIOR" && effSaves) {
    const cond = eff.some((e) => e.conditional);
    if (cond && !p.conditionalAllowed) return out("opt-in", "opt-in", "saving carried by one task; trigger scope not pre-registered");
    return out("default-on", "default-on", cond ? "efficiency win, task-conditional (scope pre-registered)" : "efficiency win");
  }
  const accDone = accState === "NON-INFERIOR" || (Number.isFinite(planAcc) && runsPerCell >= planAcc);
  const effDone = effSaves || (Number.isFinite(planEff) && runsPerCell >= planEff);
  if (accState === "NON-INFERIOR" && effDone) return out("opt-in", "opt-in", "non-inferior, no demonstrated benefit at planned n");
  if (!accDone || !effDone || accState === "UNRESOLVED") {
    if (!(accDone && effDone)) return out("need-more-cells", "rerun", `n=${runsPerCell}/cell < planned (acc ${planAcc}, eff ${planEff})`);
  }
  return out("opt-in", "opt-in", "claims not demonstrated at planned n (NOT evidence of equivalence)");
}

// ---------------------------------------------------------------- compatibility (void checks)

/** Provenance subset the compatibility check reads (names match RunProvenance). */
export interface Prov {
  readonly scorerVersion: number;
  readonly suiteHash: string | null;
  readonly reasoningDistHash: string | null;
  readonly raEnv: Readonly<Record<string, string>>;
  readonly cellTimeoutSec: number | null;
  readonly modelDigests: Readonly<Record<string, string | null>>;
  readonly contendedCellFraction: number;
  readonly interleaved: boolean;
}

/** Why two arms (or an arm and the frozen reference) must not be compared. Empty = compatible. */
export function voidReasons(a: Prov, b: Prov, mechanismEnvKeys: readonly string[]): readonly string[] {
  const r: string[] = [];
  if (a.scorerVersion !== b.scorerVersion) r.push(`scorerVersion ${a.scorerVersion} != ${b.scorerVersion}`);
  if (a.suiteHash !== b.suiteHash || a.suiteHash === null) r.push("suiteHash differs or missing");
  if (a.reasoningDistHash !== b.reasoningDistHash || a.reasoningDistHash === null) r.push("reasoning dist hash differs or missing");
  const keys = new Set([...Object.keys(a.raEnv), ...Object.keys(b.raEnv)]);
  for (const k of keys) if (a.raEnv[k] !== b.raEnv[k] && !mechanismEnvKeys.includes(k)) r.push(`RA flag ${k} differs outside the mechanism`);
  if (a.cellTimeoutSec !== b.cellTimeoutSec) r.push("cell timeout differs");
  for (const t of new Set([...Object.keys(a.modelDigests), ...Object.keys(b.modelDigests)])) {
    const x = a.modelDigests[t];
    const y = b.modelDigests[t];
    if (x == null || y == null || x !== y) r.push(`model digest ${t} differs or missing`);
  }
  if (a.contendedCellFraction > 0.05 || b.contendedCellFraction > 0.05) r.push("contended cells > 5%");
  if (!a.interleaved || !b.interleaved) r.push("arms not interleaved per (run, task)");
  return r;
}
