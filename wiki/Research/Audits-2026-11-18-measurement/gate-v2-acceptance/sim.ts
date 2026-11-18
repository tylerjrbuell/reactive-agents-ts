// Gate v2 acceptance simulation (zero tokens, no model calls).
//   bun wiki/Research/Audits-2026-11-18-measurement/gate-v2-acceptance/sim.ts <part> [--reps N] [--point]
// parts: aa | harm | eff | collapse | power | all
// Per-task success rates and token distributions are resampled from the REAL saved H3 full-suite
// baseline arms (cogito:8b, qwen3:4b; 12 tasks each), so heterogeneity and saturation are realistic.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type SavedCell, billed, isMeasured, loadResults } from "../../../../packages/benchmarks/src/spikes/cells.js";
import { rng as makeRng } from "../../../../packages/benchmarks/src/spikes/stats.js";
import { DEFAULT_POLICY, type Evaluation, type Run, type TaskClass, type TaskData, type TierData, evaluate } from "./rule.js";

const ROOT = join(import.meta.dir, "../../../../wiki/Research");
const H = "Harness-Reports";
const FILES: readonly string[] = [
  "2026-11-03-h3-baseline",
  "2026-11-04-h3-baseline",
  "2026-11-04-d9-full-h3",
  "2026-11-05-a698-baseline-full-h3",
  "2026-11-05-77b6-phase1-close-full-h3",
  "2026-11-05-plan9-phase1-full-h3",
  "2026-11-06-6a6a-batch-full-h3",
].flatMap((d) => [`${H}/${d}/results-cogito-8b.json`, `${H}/${d}/results-qwen3-4b.json`])
  .concat(["final", "rerun"].flatMap((n) => [`${H}/2026-11-18-h3-v0.19-final/${n}-cogito-8b.json`, `${H}/2026-11-18-h3-v0.19-final/${n}-qwen3-4b.json`]));

interface TaskModel {
  readonly taskId: string;
  readonly x: number;
  readonly n: number;
  readonly mu: number; // mean of ln(billed tokens)
  readonly sd: number; // sd of ln(billed tokens)
  readonly meanTok: number;
}
interface TierModel {
  readonly tier: string;
  readonly tasks: readonly TaskModel[];
}

function loadModels(): readonly TierModel[] {
  const cells: SavedCell[] = [];
  for (const f of FILES) {
    const p = join(ROOT, f);
    const r = existsSync(p) ? loadResults(p) : undefined;
    if (r) cells.push(...r.cells.filter((c) => isMeasured(c) && billed(c) > 0));
  }
  const tiers = ["cogito:8b", "qwen3:4b"];
  return tiers.map((tier) => {
    const byTask = new Map<string, SavedCell[]>();
    for (const c of cells.filter((x) => x.tier === tier)) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);
    const tasks: TaskModel[] = [...byTask.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([taskId, cs]) => {
        const l = cs.map((c) => Math.log(billed(c)));
        const mu = l.reduce((a, b) => a + b, 0) / l.length;
        const sd = Math.sqrt(l.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, l.length - 1));
        return { taskId, x: cs.filter((c) => c.solved).length, n: cs.length, mu, sd, meanTok: cs.reduce((a, c) => a + billed(c), 0) / cs.length };
      });
    return { tier, tasks };
  });
}

// ---------------------------------------------------------------- scenario model

interface Scenario {
  readonly id: string;
  readonly desc: string;
  /** Candidate success probability from the baseline probability (tier index, task index). */
  readonly pCand: (p: number, tier: number, task: number, isDisc: boolean) => number;
  /** Candidate token multiplier (tier index, task index, task mass share, tier model). */
  readonly tokFactor: (tier: number, task: number, model: TierModel) => number;
  /** When set, "isDisc" means the FROZEN-REFERENCE class (what the gate pools), not the latent truth. */
  readonly byClass?: boolean;
  /** Pre-registered trigger scope = the heaviest task of each tier (the lever's carrying task). */
  readonly scoped?: boolean;
}

const scopeFor = (models: readonly TierModel[], s: Scenario): ReadonlySet<string> | undefined =>
  s.scoped ? new Set(models.map((m) => m.tasks[heavyIdx(m)]!.taskId)) : undefined;

const same: Scenario["pCand"] = (p) => p;
const noTok: Scenario["tokFactor"] = () => 1;
const heavyIdx = (m: TierModel): number => m.tasks.reduce((best, t, i, a) => (t.meanTok > a[best]!.meanTok ? i : best), 0);
/** Factor on the single heaviest task that yields `cut` total-token reduction (capped at 0.05). */
const heavyOnly = (cut: number): Scenario["tokFactor"] => (_ti, ki, m) => {
  const hi = heavyIdx(m);
  if (ki !== hi) return 1;
  const total = m.tasks.reduce((a, t) => a + t.meanTok, 0);
  return Math.max(0.05, 1 - (cut * total) / m.tasks[hi]!.meanTok);
};

const SCENARIOS: readonly Scenario[] = [
  { id: "AA", desc: "A/A: identical", pCand: same, tokFactor: noTok },
  { id: "H-10", desc: "accuracy -10pp on every task", pCand: (p) => Math.max(0, p - 0.1), tokFactor: noTok },
  { id: "H-20", desc: "accuracy -20pp on every task", pCand: (p) => Math.max(0, p - 0.2), tokFactor: noTok },
  { id: "Hd-10", desc: "accuracy -10pp on discriminative tasks only", pCand: (p, _t, _k, d) => (d ? Math.max(0, p - 0.1) : p), tokFactor: noTok },
  { id: "Hd-20", desc: "accuracy -20pp on discriminative tasks only", pCand: (p, _t, _k, d) => (d ? Math.max(0, p - 0.2) : p), tokFactor: noTok },
  { id: "H-10+T-30", desc: "accuracy -10pp AND tokens x0.70 per run (cheap because worse)", pCand: (p) => Math.max(0, p - 0.1), tokFactor: () => 0.7 },
  { id: "T-10", desc: "equal accuracy, tokens x0.90 (exactly the SAVES boundary: P(SAVES) must be <= 5%)", pCand: same, tokFactor: () => 0.9 },
  { id: "Hc-10", desc: "accuracy -10pp on every task the gate classifies discriminative (NI boundary calibration: false-NI must be <= 5%)", pCand: (p, _t, _k, d) => (d ? Math.max(0, p - 0.1) : p), tokFactor: noTok, byClass: true },
  { id: "Hc-10+T-30", desc: "as Hc-10 AND tokens x0.70 per run", pCand: (p, _t, _k, d) => (d ? Math.max(0, p - 0.1) : p), tokFactor: () => 0.7, byClass: true },
  { id: "Hc-20+T-30", desc: "as Hc-20 AND tokens x0.70 per run", pCand: (p, _t, _k, d) => (d ? Math.max(0, p - 0.2) : p), tokFactor: () => 0.7, byClass: true },
  { id: "T-5", desc: "equal accuracy, tokens x0.95 (the SAVES null boundary: P(SAVES) must be <= 5%)", pCand: same, tokFactor: () => 0.95 },
  { id: "Hd-5", desc: "accuracy -5pp on discriminative tasks only", pCand: (p, _t, _k, d) => (d ? Math.max(0, p - 0.05) : p), tokFactor: noTok },
  { id: "T-15", desc: "equal accuracy, tokens x0.85 every task", pCand: same, tokFactor: () => 0.85 },
  { id: "T-30", desc: "equal accuracy, tokens x0.70 every task", pCand: same, tokFactor: () => 0.7 },
  { id: "Tc-15", desc: "equal accuracy, -15% total tokens carried by the heaviest task only (pth-like)", pCand: same, tokFactor: heavyOnly(0.15) },
  { id: "Tc-30", desc: "equal accuracy, -30% total tokens carried by the heaviest task only", pCand: same, tokFactor: heavyOnly(0.3) },
  { id: "Tcs-15", desc: "as Tc-15 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it", pCand: same, tokFactor: heavyOnly(0.15), scoped: true },
  { id: "Tcs-30", desc: "as Tc-30 but the trigger scope (heaviest task) is pre-registered, SAVES judged on it", pCand: same, tokFactor: heavyOnly(0.3), scoped: true },
  { id: "C+30", desc: "equal accuracy, tokens x1.30", pCand: same, tokFactor: () => 1.3 },
  { id: "Col-100", desc: "one discriminative task collapses to 0, rest equal", pCand: (p, _t, k, d) => (d && k === 0 ? 0 : p), tokFactor: noTok },
  { id: "Col-50", desc: "one discriminative task halves, rest equal", pCand: (p, _t, k, d) => (d && k === 0 ? p / 2 : p), tokFactor: noTok },
  { id: "S+10", desc: "accuracy +10pp on discriminative tasks, tokens equal", pCand: (p, _t, _k, d) => (d ? Math.min(1, p + 0.1) : p), tokFactor: noTok },
];

// ---------------------------------------------------------------- draws

const normal = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const gammaInt = (a: number, r: () => number): number => {
  let s = 0;
  for (let i = 0; i < a; i++) s -= Math.log(1 - r());
  return s;
};
const beta = (a: number, b: number, r: () => number): number => {
  const x = gammaInt(a, r);
  return x / (x + gammaInt(b, r));
};

interface Truth {
  readonly p: number[][]; // [tier][task] baseline p
  readonly disc: boolean[][]; // TRUE discriminativeness at truth (used only for scenario planting)
}

function drawTruth(models: readonly TierModel[], r: () => number, point: boolean): Truth {
  const p = models.map((m) => m.tasks.map((t) => (point ? t.x / t.n : beta(t.x + 1, t.n - t.x + 1, r))));
  return { p, disc: p.map((row) => row.map((v) => v >= 0.1 && v < 0.9)) };
}

const genRuns = (pSolve: number, m: TaskModel, factor: number, k: number, r: () => number): Run[] =>
  Array.from({ length: k }, () => ({ solved: r() < pSolve, tokens: Math.exp(m.mu + m.sd * normal(r)) * factor, turns: null }));

const KREF = 15;

/** Frozen reference classification: KREF fresh baseline runs per task, never the arms under test. */
function classify(models: readonly TierModel[], truth: Truth, r: () => number): TaskClass[][] {
  return models.map((m, ti) =>
    m.tasks.map((_t, ki) => {
      let x = 0;
      for (let i = 0; i < KREF; i++) if (r() < truth.p[ti]![ki]!) x++;
      const ph = x / KREF;
      return ph >= 0.9 ? "canary" : ph < 0.1 ? "floor" : "disc";
    }),
  );
}

interface Draw {
  readonly tiers: TierData[];
  readonly rerun: (tier: string, taskId: string, k: number) => { base: Run[]; cand: Run[] };
}

let KDISC = 0;
/** Spec default (--kdisc 30) keeps confirmMinDiscRuns = 30; any other allocation relaxes it so the owner-literal uniform k can be measured. */
const POLICY = (): typeof DEFAULT_POLICY => (KDISC >= DEFAULT_POLICY.confirmMinDiscRuns ? DEFAULT_POLICY : { ...DEFAULT_POLICY, confirmMinDiscRuns: 0 });

/** Confirm-stage allocation: discriminative tasks are topped up to KDISC runs per cell; every other task keeps k. */
const kFor = (cls: TaskClass, k: number, topUp: boolean): number => (topUp && cls === "disc" && KDISC > k ? KDISC : k);
const countCells = (tiers: readonly TierData[]): number => tiers.reduce((a, t) => a + t.tasks.reduce((b, x) => b + x.base.length + x.cand.length, 0), 0);

function drawStage(models: readonly TierModel[], truth: Truth, classes: TaskClass[][], scn: Scenario, k: number, r: () => number, topUp = false): Draw {
  const pc = (ti: number, ki: number): number =>
    scn.pCand(truth.p[ti]![ki]!, ti, ki === truth.disc[ti]!.indexOf(true) ? 0 : ki + 1, scn.byClass ? classes[ti]![ki]! === "disc" : truth.disc[ti]![ki]!);
  const tiers: TierData[] = models.map((m, ti) => ({
    tier: m.tier,
    tokenFree: false,
    tasks: m.tasks.map((t, ki) => ({
      taskId: t.taskId,
      cls: classes[ti]![ki]!,
      base: genRuns(truth.p[ti]![ki]!, t, 1, kFor(classes[ti]![ki]!, k, topUp), r),
      cand: genRuns(pc(ti, ki), t, scn.tokFactor(ti, ki, m), kFor(classes[ti]![ki]!, k, topUp), r),
    })),
  }));
  return {
    tiers,
    rerun: (tier, taskId, kk) => {
      const ti = models.findIndex((m) => m.tier === tier);
      const ki = models[ti]!.tasks.findIndex((t) => t.taskId === taskId);
      const t = models[ti]!.tasks[ki]!;
      return { base: genRuns(truth.p[ti]![ki]!, t, 1, kk, r), cand: genRuns(pc(ti, ki), t, scn.tokFactor(ti, ki, models[ti]!), kk, r) };
    },
  };
}

// ---------------------------------------------------------------- runners

type Final = Evaluation["verdict"];
interface Outcome {
  readonly final: Final | "killed-at-screen" | "dropped-at-screen";
  readonly cells: number;
  readonly acc: string;
  readonly accNI: boolean;
  readonly effSaves: boolean;
  readonly planAcc: number;
  readonly planEff: number;
}

const nTasks = (m: readonly TierModel[]): number => m.reduce((a, t) => a + t.tasks.length, 0);

/** Two-stage pipeline: screen k=5 then confirm k=12 (fresh runs). */
function pipeline(models: readonly TierModel[], scn: Scenario, r: () => number, point: boolean, seed: number, kS = 5, kC = 12): Outcome {
  const truth = drawTruth(models, r, point);
  const classes = classify(models, truth, r);
  const S = drawStage(models, truth, classes, scn, kS, r);
  const es = evaluate(S.tiers, "screen", seed, S.rerun, POLICY(), scopeFor(models, scn));
  let cells = countCells(S.tiers) + es.veto.filter((v) => v.status !== "pending").length * 10;
  const ax = (e: Evaluation) => ({ accNI: e.accuracy.state === "NON-INFERIOR" || e.accuracy.state === "SUPERIOR", effSaves: e.efficiency.every((x) => x.state === "SAVES"), planAcc: e.planNAccuracy, planEff: e.planNEfficiency });
  if (es.verdict === "reject" || es.verdict === "reject-cost") return { final: "killed-at-screen", cells, acc: es.path, ...ax(es) };
  if (es.verdict !== "screen-advance") return { final: "dropped-at-screen", cells, acc: es.path, ...ax(es) };
  const C = drawStage(models, truth, classes, scn, kC, r, true);
  const ec = evaluate(C.tiers, "confirm", seed + 1, C.rerun, POLICY(), scopeFor(models, scn));
  cells += countCells(C.tiers) + ec.veto.filter((v) => v.status !== "pending").length * 10;
  return { final: ec.verdict, cells, acc: ec.path, ...ax(ec) };
}

/** Single-stage confirm-rule at fixed k (power curves). */
function fixedK(models: readonly TierModel[], scn: Scenario, k: number, r: () => number, point: boolean, seed: number): Outcome {
  const truth = drawTruth(models, r, point);
  const classes = classify(models, truth, r);
  const S = drawStage(models, truth, classes, scn, k, r, true);
  const e = evaluate(S.tiers, "confirm", seed, S.rerun, POLICY(), scopeFor(models, scn));
  return {
    final: e.verdict,
    cells: countCells(S.tiers) + e.veto.filter((v) => v.status !== "pending").length * 10,
    acc: e.path,
    accNI: e.accuracy.state === "NON-INFERIOR" || e.accuracy.state === "SUPERIOR",
    effSaves: e.efficiency.every((x) => x.state === "SAVES"),
    planAcc: e.planNAccuracy,
    planEff: e.planNEfficiency,
  };
}

const pct = (x: number, n: number): string => `${((100 * x) / n).toFixed(1)}`;

function tally(outs: readonly Outcome[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const o of outs) c[o.final] = (c[o.final] ?? 0) + 1;
  return c;
}

const REJECTS = new Set(["reject", "reject-cost", "killed-at-screen"]);
const row = (label: string, outs: readonly Outcome[]): string => {
  const t = tally(outs);
  const n = outs.length;
  const rej = outs.filter((o) => REJECTS.has(o.final)).length;
  const kill = t["killed-at-screen"] ?? 0;
  const prom = t["default-on"] ?? 0;
  const parts = Object.entries(t)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v, n)}`)
    .join(", ");
  const cells = outs.reduce((a, o) => a + o.cells, 0) / n;
  const ni = outs.filter((o) => o.accNI).length;
  const es = outs.filter((o) => o.effSaves).length;
  const med = (xs: number[]): string => {
    const f = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return f.length ? String(f[Math.floor(f.length / 2)]) : "-";
  };
  const plan = `N*1.2 acc ${med(outs.map((o) => o.planAcc))} eff ${med(outs.map((o) => o.planEff))}`;
  return `| ${label} | ${pct(prom, n)} | NI ${pct(ni, n)} / SAVES ${pct(es, n)}; ${plan} | ${pct(rej, n)} (screen ${pct(kill, n)}) | ${cells.toFixed(0)} | ${parts} |`;
};

// ---------------------------------------------------------------- main

const args = process.argv.slice(2);
const part = args[0] ?? "all";
const repsArg = args.indexOf("--reps");
const REPS = repsArg >= 0 ? Number(args[repsArg + 1]) : 500;
const point = args.includes("--point");
if (args.includes("--kdisc")) KDISC = Number(args[args.indexOf("--kdisc") + 1]);
const only = args.indexOf("--only");
const onlyIds = only >= 0 ? args[only + 1]!.split(",") : null;
const models = loadModels();
const scn = (id: string): Scenario => SCENARIOS.find((s) => s.id === id)!;

console.log(`# gate-v2 acceptance sim (${part}, reps=${REPS}, ${point ? "point p" : "Beta-resampled p"}, kRef=${KREF})`);
console.log(`Models: ${models.map((m) => `${m.tier}: ${m.tasks.length} tasks, baseline p ${m.tasks.map((t) => (t.x / t.n).toFixed(2)).join("/")}`).join(" ; ")}`);
console.log(`Policy: ${JSON.stringify({ ni: [DEFAULT_POLICY.niPointPp, DEFAULT_POLICY.niLowerPp], veto: DEFAULT_POLICY.vetoTriggerPp, savesRatio: DEFAULT_POLICY.savesRatio })}\n`);

const header = "| scenario | promote % | axis (last stage run) | reject % | mean cells | verdict mix (%) |\n| --- | --- | --- | --- | --- | --- |";

const run = (ids: readonly string[], f: (s: Scenario, i: number) => Outcome): void => {
  console.log(header);
  for (const id of ids) {
    if (onlyIds && !onlyIds.includes(id)) continue;
    const s = scn(id);
    const outs: Outcome[] = [];
    for (let i = 0; i < REPS; i++) outs.push(f(s, i));
    console.log(row(`${id}: ${s.desc}`, outs));
  }
  console.log();
};

const seedBase = 20261118;
if (part === "aa" || part === "all") {
  console.log("## A/A and false-promote (two-stage pipeline: screen k=5, confirm k=12)");
  run(["AA", "H-10", "H-20", "Hc-10", "Hc-10+T-30", "Hc-20+T-30", "H-10+T-30"], (s, i) => pipeline(models, s, makeRng(seedBase + i), point, seedBase + i));
}
if (part === "eff" || part === "all") {
  console.log("## Efficiency power at equal accuracy (two-stage pipeline)");
  run(["T-5", "T-10", "T-15", "T-30", "Tc-15", "Tc-30", "Tcs-15", "Tcs-30", "C+30", "S+10"], (s, i) => pipeline(models, s, makeRng(seedBase + 1000 + i), point, seedBase + 1000 + i));
}
if (part === "collapse" || part === "all") {
  console.log("## Task collapse (veto path)");
  run(["Col-100", "Col-50"], (s, i) => pipeline(models, s, makeRng(seedBase + 2000 + i), point, seedBase + 2000 + i));
}
if (part === "power") {
  const ks = (args.includes("--ks") ? args[args.indexOf("--ks") + 1]! : "5,12,20").split(",").map(Number);
  const ids = onlyIds ?? ["AA", "H-10", "T-15", "T-30", "Tc-30"];
  for (const k of ks) {
    console.log(`## Single-stage confirm rule at fixed k=${k} per cell (cells = ${nTasks(models)} tasks x ${k} x 2 arms = ${nTasks(models) * k * 2}, plus reruns)`);
    run(ids, (s, i) => fixedK(models, s, k, makeRng(seedBase + 3000 + k * 10 + i), point, seedBase + 3000 + i));
  }
}
