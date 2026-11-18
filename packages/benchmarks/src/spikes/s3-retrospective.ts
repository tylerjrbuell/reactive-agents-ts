// Spike S3 CLI: retrospective validation of gate v2 on saved cells. Zero tokens.
//   bun packages/benchmarks/src/spikes/s3-retrospective.ts [--json]
// Prints markdown tables (comparisons, flips, clustering, pass^k, ICC, A/A).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type SavedCell, loadResults } from "./cells.js";
import { COMPARISONS, type ComparisonSpec } from "./comparisons.js";
import { aaSplit, armStats, clusterRows, mcnemar, medianFinite, rankTasks, v1Class, v2Class } from "./s3-analysis.js";
import { v1Evaluate } from "./v1-replay.js";
import { v2Evaluate } from "./gate-v2.js";

const ROOT = join(import.meta.dir, "../../../../wiki/Research");

const load = (files: readonly string[]): { cells: SavedCell[]; missing: string[] } => {
  const cells: SavedCell[] = [];
  const missing: string[] = [];
  for (const f of files) {
    const p = join(ROOT, f);
    const r = existsSync(p) ? loadResults(p) : undefined;
    if (r) cells.push(...r.cells);
    else missing.push(f);
  }
  return { cells, missing };
};

const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : "-");
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : "-");
const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/** Full-suite baseline arms (12 tasks x k=5 per tier): used for pass^k, ICC, task ranking. */
const H = "Harness-Reports";
const BASELINES: readonly { readonly id: string; readonly files: readonly string[] }[] = [
  { id: "11-03 baseline", files: [`${H}/2026-11-03-h3-baseline/results-cogito-8b.json`, `${H}/2026-11-03-h3-baseline/results-qwen3-4b.json`] },
  { id: "11-04 baseline", files: [`${H}/2026-11-04-h3-baseline/results-cogito-8b.json`, `${H}/2026-11-04-h3-baseline/results-qwen3-4b.json`] },
  { id: "11-04 d9", files: [`${H}/2026-11-04-d9-full-h3/results-cogito-8b.json`, `${H}/2026-11-04-d9-full-h3/results-qwen3-4b.json`] },
  { id: "11-05 a698", files: [`${H}/2026-11-05-a698-baseline-full-h3/results-cogito-8b.json`, `${H}/2026-11-05-a698-baseline-full-h3/results-qwen3-4b.json`] },
  { id: "11-05 77b6", files: [`${H}/2026-11-05-77b6-phase1-close-full-h3/results-cogito-8b.json`, `${H}/2026-11-05-77b6-phase1-close-full-h3/results-qwen3-4b.json`] },
  { id: "11-05 plan9", files: [`${H}/2026-11-05-plan9-phase1-full-h3/results-cogito-8b.json`, `${H}/2026-11-05-plan9-phase1-full-h3/results-qwen3-4b.json`] },
  { id: "11-06 6a6a", files: [`${H}/2026-11-06-6a6a-batch-full-h3/results-cogito-8b.json`, `${H}/2026-11-06-6a6a-batch-full-h3/results-qwen3-4b.json`] },
  { id: "11-18 final", files: [`${H}/2026-11-18-h3-v0.19-final/final-cogito-8b.json`, `${H}/2026-11-18-h3-v0.19-final/final-qwen3-4b.json`] },
  { id: "11-18 rerun", files: [`${H}/2026-11-18-h3-v0.19-final/rerun-cogito-8b.json`, `${H}/2026-11-18-h3-v0.19-final/rerun-qwen3-4b.json`] },
  { id: "11-10 stl base grok-4", files: ["Ablations/2026-11-10-stable-tool-list/results/base-h3-grok-4.json"] },
  { id: "11-06 bonsai-27b", files: [`${H}/2026-11-06-bonsai-27b-full-h3/results-bonsai-2-27b.json`] },
];

const out: string[] = [];
const say = (s = ""): number => out.push(s);

say("## A. Comparisons: v1 (real evaluateLiftGate) vs v2 (pre-registered rules)");
say();
say("| id | tiers | tasks | cells/arm | v1 | v1 lift pp | v1 tok% | v2 | v2 RD pp [CI] | disc tasks | eff: state, geo tok ratio [t-CI], tokens/solved ratio | b / c (McNemar p) | MDE pp | n/cell for NI | known | v1 | v2 |");
say("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
interface Row { id: string; v1: string; v2: string; v1c: string; v2c: string; known: string; reason: string }
const rows: Row[] = [];
const clusters: string[] = [];
for (const spec of COMPARISONS as readonly ComparisonSpec[]) {
  const b = load(spec.baseline);
  const c = load(spec.candidate);
  if (b.cells.length === 0 || c.cells.length === 0) {
    say(`| ${spec.id} | MISSING FILES | | | | | | | | | | | | | | | |`);
    continue;
  }
  const v1 = v1Evaluate(b.cells, c.cells);
  const v2 = v2Evaluate(b.cells, c.cells);
  const mc = mcnemar(b.cells, c.cells);
  const tiersN = v2.tiers.length;
  const disc = v2.tiers.map((t) => t.discriminativeTasks).join("/");
  const rd = v2.tiers.map((t) => `${f1(t.rdPp)} [${f1(t.ciLoPp)},${f1(t.ciHiPp)}]`).join("; ");
  const eff = v2.tiers.map((t) => `${t.efficiency[0]}${f2(t.tokenGeoRatio)} [${f2(t.tokenRatioLo)},${f2(t.tokenRatioHi)}] tps${f2(t.tokensPerSolvedRatio)}`).join("; ");
  const need = v2.tiers.map((t) => (Number.isFinite(t.needRunsPerCell) ? String(t.needRunsPerCell) : "-")).join("/");
  const nTasks = Math.max(0, ...v2.tiers.map((t) => t.tasks.length));
  const cellsArm = Math.round(b.cells.length / Math.max(1, tiersN));
  const known = spec.known ? `${spec.known.outcome} (${spec.known.confidence})` : "unlabelled";
  const v1c = v1Class(v1.decision);
  const v2c = v2Class(v2.verdict);
  say(`| ${spec.id} | ${tiersN} | ${nTasks} | ${cellsArm} | ${v1.decision} | ${f1(v1.aggregate.liftPp)} | ${f1(v1.aggregate.billedTokenOverheadPct)} | ${v2.verdict} | ${rd} | ${disc} | ${eff} | ${mc.b}/${mc.c} (p=${f2(mc.p)}) | ${f1(mc.mdePp)} | ${need} | ${known} | ${v1c} | ${v2c} |`);
  rows.push({ id: spec.id, v1: v1.decision, v2: v2.verdict, v1c, v2c, known, reason: v2.reason });
  for (const r of clusterRows(b.cells, c.cells)) {
    clusters.push(`| ${spec.id} | ${r.tier} | ${r.tasks} | ${r.cellsPerArm} | ${f1(r.naiveSePp)} | ${f1(r.pairedClusterSePp)} | ${f2(r.ratio)} |`);
  }
}

say();
say("### Concordance against known outcomes");
say();
say("| id | known | v1 decision | v2 verdict | v2 reason | v1 correct? | v2 correct? |");
say("| --- | --- | --- | --- | --- | --- | --- |");
const ok = (known: string, cls: string, spec: ComparisonSpec | undefined): string => {
  const o = spec?.known?.outcome;
  if (o === undefined) return "n/a";
  if (o === "HARMFUL") return cls === "reject" ? "yes" : "NO (missed)";
  if (o === "EFFICIENCY-ONLY") return cls === "reject" ? "NO (false reject)" : cls === "promote" ? "yes (credits efficiency)" : "partial (hold, no efficiency credit)";
  return cls === "reject" ? "NO (false reject)" : "yes";
};
for (const r of rows) {
  const spec = COMPARISONS.find((s) => s.id === r.id);
  if (!spec?.known) continue;
  say(`| ${r.id} | ${r.known} | ${r.v1} | ${r.v2} | ${r.reason} | ${ok(r.known, r.v1c, spec)} | ${ok(r.known, r.v2c, spec)} |`);
}
say();
say("### Every v1 vs v2 flip (coarse class: promote / reject / hold)");
say();
say("| id | v1 | v2 | v2 reason |");
say("| --- | --- | --- | --- |");
for (const r of rows.filter((x) => x.v1c !== x.v2c)) say(`| ${r.id} | ${r.v1} (${r.v1c}) | ${r.v2} (${r.v2c}) | ${r.reason} |`);
const resolved = rows.filter((r) => r.v2 !== "need-more-cells").length;
say();
say(`v2 resolved (not need-more-cells): ${resolved}/${rows.length}.`);

say();
say("## B. Clustering: naive unpaired SE of the pass-rate difference vs task-clustered paired SE");
say();
say("Cluster-robust SE = sd(task-level differences)/sqrt(T), task means as the unit (Miller 2411.00640 with runs averaged within task).");
say();
say("| comparison | tier | tasks | cells/arm | naive SE pp | clustered paired SE pp | ratio (clustered/naive) |");
say("| --- | --- | --- | --- | --- | --- | --- |");
for (const l of clusters) say(l);

say();
say("## C. Baseline arms: pass^k = mean over tasks of C(c,k)/C(n,k) (tau-bench), pass@k, ICC(1) one-way ANOVA form (MSB-MSW)/(MSB+(n0-1)MSW), SE inflation");
say();
say("| arm | tier | tasks | k | pass rate | pass^1 | pass^2 | pass^3 | pass^4 | pass^5 | pass@5 | ICC(1) | naive SE pp | clustered SE pp | inflation |");
say("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
const infl: number[] = [];
const ph5ratio: number[] = [];
const iccs: number[] = [];
const pooledByTier = new Map<string, SavedCell[]>();
for (const bl of BASELINES) {
  const l = load(bl.files);
  for (const s of armStats(l.cells)) {
    const ratio = s.clusteredSePp / s.naiveSePp;
    infl.push(ratio);
    iccs.push(s.icc);
    if (s.passHat.length >= 5 && s.passHat[0]! > 0) ph5ratio.push(s.passHat[4]! / s.passHat[0]!);
    say(`| ${bl.id} | ${s.tier} | ${s.tasks} | ${s.runsPerTask} | ${pct(s.passRate)} | ${s.passHat.map((x) => f2(x)).slice(0, 5).join(" | ")}${s.passHat.length < 5 ? " |".repeat(5 - s.passHat.length) : ""} | ${f2(s.passAt[Math.min(4, s.passAt.length - 1)]!)} | ${f2(s.icc)} | ${f1(s.naiveSePp)} | ${f1(s.clusteredSePp)} | ${f2(ratio)} |`);
  }
  if (bl.id.startsWith("11-")) for (const c of l.cells) pooledByTier.set(c.tier, [...(pooledByTier.get(c.tier) ?? []), c]);
}
say();
say(`Median SE inflation (clustered/naive) over ${infl.length} arms: ${f2(medianFinite(infl))}. Median ICC(1): ${f2(medianFinite(iccs))}. Median pass^5/pass^1: ${f2(medianFinite(ph5ratio))}.`);

say();
say("## D. Task discriminativeness (cells pooled over every baseline arm per tier; ranked by p(1-p))");
say();
for (const [tier, cells] of pooledByTier) {
  const ranked = rankTasks(cells);
  const nonDisc = ranked.filter((r) => r.cls !== "discriminative").length;
  const mid = ranked.filter((r) => r.p >= 0.1 && r.p <= 0.9).length;
  say(`**${tier}**: ${ranked.length} tasks; always-pass/always-fail ${nonDisc}; pass rate in [0.1,0.9] ${mid}.`);
  say();
  say("| task | n | pass rate | class | p(1-p) |");
  say("| --- | --- | --- | --- | --- |");
  for (const r of ranked) say(`| ${r.taskId} | ${r.n} | ${pct(r.p)} | ${r.cls} | ${f2(r.info)} |`);
  say();
}

say("## E. A/A splits (identical code halves; every reject is a false reject)");
say();
say("| source | half runs | v1 reject | v1 underpowered | v1 opt-in | v1 default-on | v1 reject @minRuns=2 | v2 reject (any) | v2 reject (no veto) | v2 need-more | v2 neutral | v2 promote |");
say("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
const AA: readonly { readonly id: string; readonly files: readonly string[] }[] = [
  ...BASELINES.filter((b) => ["11-18 final", "11-06 6a6a", "11-05 plan9", "11-10 stl base grok-4"].includes(b.id)),
  { id: "11-10 bat off matrix (k=6)", files: ["cogito_8b", "grok-4", "mimo-v2.6_16384"].map((t) => `Ablations/2026-11-10-budget-answer-turn/results/matrix/off-custom-${t}.json`) },
  { id: "11-05 switch k8 noswitch cogito", files: ["Ablations/2026-11-05-strategy-switching/k8-noswitch-cogito.json"] },
  { id: "11-18 speedups off (gemma k=5)", files: [`${"Ablations/2026-11-18-speedups/results"}/off-h3-gemma4_e4b.json`] },
];
const REPS = 300;
for (const a of AA) {
  const r = aaSplit(load(a.files).cells, REPS, 7);
  if (!r) {
    say(`| ${a.id} | too few runs/tasks | | | | | | | | | | |`);
    continue;
  }
  say(`| ${a.id} | ${r.halfRuns} | ${pct(r.v1Default.reject)} | ${pct(r.v1Default.underpowered)} | ${pct(r.v1Default.optIn)} | ${pct(r.v1Default.defaultOn)} | ${pct(r.v1MinRuns2Reject)} | ${pct(r.v2.reject)} | ${pct(r.v2.rejectNoVeto)} | ${pct(r.v2.needMore)} | ${pct(r.v2.neutral)} | ${pct(r.v2.promote)} |`);
}

console.log(out.join("\n"));
