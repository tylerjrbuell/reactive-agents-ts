// Spike S3: catalog of saved baseline-vs-candidate comparisons (paths relative to wiki/Research).
// Labels are FIXED in wiki/Research/Spikes-2026-11-18-measurement/PREDICTIONS.md before analysis.
// The v1 ledger decision is the gate's OUTPUT and is never used as a label.

/** Known outcome of a comparison, when one is established independently of the gate. */
export type KnownOutcome = "HARMFUL" | "EFFICIENCY-ONLY" | "NEUTRAL";

/** One baseline-vs-candidate comparison over saved results files. */
export interface ComparisonSpec {
  readonly id: string;
  readonly mechanism: string;
  readonly baseline: readonly string[];
  readonly candidate: readonly string[];
  readonly known?: { readonly outcome: KnownOutcome; readonly confidence: "high" | "medium" | "low"; readonly basis: string };
}

const sp = "Ablations/2026-11-18-speedups/results";
const arms = (dir: string, base: string, cand: string, tiers: readonly string[], ext = ".json"): Pick<ComparisonSpec, "baseline" | "candidate"> => ({
  baseline: tiers.map((t) => `${dir}/${base}${t}${ext}`),
  candidate: tiers.map((t) => `${dir}/${cand}${t}${ext}`),
});
const local5 = ["cogito-8b", "gemma4-e4b", "llama3.2-3b", "qwen3-14b", "qwen3-4b"];
const bat = "Ablations/2026-11-10-budget-answer-turn/results/matrix";
const stl = "Ablations/2026-11-10-stable-tool-list/results";
const fam = "Ablations/2026-11-10-family-disclosure-compact-facts/results";
const cal = "Ablations/2026-11-11-calibration-v3-priors/results/matrix";
const rd = "Harness-Reports/2026-11-13-recent-default-harness-ablation";
const pae = "Ablations/2026-11-06-progress-aware-exit";

/** The retrospective dataset. Ordered by confidence of the known outcome, then by date. */
export const COMPARISONS: readonly ComparisonSpec[] = [
  {
    id: "lft",
    mechanism: "leanFinalTurn vs off (2026-11-18)",
    ...arms(sp, "off-h3-", "lft-h3-", ["cogito_14b", "gemma4_e4b"]),
    known: { outcome: "HARMFUL", confidence: "high", basis: "gemma h3-exact-value 0/5 vs 5/5, root-caused to the lft input gate defect; later reverted" },
  },
  {
    id: "pth",
    mechanism: "parallelToolHint vs off (2026-11-18)",
    ...arms(sp, "off-h3-", "pth-h3-", ["cogito_14b", "gemma4_e4b"]),
    known: { outcome: "EFFICIENCY-ONLY", confidence: "high", basis: "41/48 solved both arms; turns -37%, billed tokens -33% (receipt table.md)" },
  },
  {
    id: "aoa-gpt4omini",
    mechanism: "actOrAnswer on vs off, gpt-4o-mini (2026-11-07)",
    baseline: ["Ablations/2026-11-07-act-or-answer-auto/off-lh-gpt-4o-mini.json"],
    candidate: ["Ablations/2026-11-07-act-or-answer-auto/on-lh-gpt-4o-mini.json"],
    known: { outcome: "HARMFUL", confidence: "medium", basis: "forcing retry on a frontier tier; ledger -29.6pp, k=3, 2 tasks (weak basis)" },
  },
  {
    id: "calib-v3",
    mechanism: "calibration v3 priors vs committed (2026-11-11)",
    ...arms(cal, "committed-h3-", "candidate-h3-", ["cogito_8b", "qwen3_4b"]),
    known: { outcome: "NEUTRAL", confidence: "medium", basis: "ablation doc: neither tier lifts, both within noise; no live reader moved" },
  },
  {
    id: "v019-rerun",
    mechanism: "v0.19 final vs rerun on the same suite (2026-11-18)",
    baseline: ["Harness-Reports/2026-11-18-h3-v0.19-final/final-cogito-8b.json", "Harness-Reports/2026-11-18-h3-v0.19-final/final-qwen3-4b.json"],
    candidate: ["Harness-Reports/2026-11-18-h3-v0.19-final/rerun-cogito-8b.json", "Harness-Reports/2026-11-18-h3-v0.19-final/rerun-qwen3-4b.json"],
    known: { outcome: "NEUTRAL", confidence: "medium", basis: "commit 741ded31c: rerun after d3e8b8b50 dist, no regression (qwen 44/60, cogito 32/60 vs final)" },
  },
  {
    id: "v019-vs-v018",
    mechanism: "dev vs v0.18 regression check (2026-11-18)",
    baseline: ["Harness-Reports/2026-11-18-v0.19-regression-check/v018-cogito-8b.json", "Harness-Reports/2026-11-18-v0.19-regression-check/v018-qwen3-4b.json"],
    candidate: ["Harness-Reports/2026-11-18-v0.19-regression-check/dev-cogito-8b.json", "Harness-Reports/2026-11-18-v0.19-regression-check/dev-qwen3-4b.json"],
  },
  {
    id: "recent-head",
    mechanism: "recent default harness: head vs base (2026-11-13)",
    baseline: [`${rd}/base.json`],
    candidate: [`${rd}/head.json`],
    known: { outcome: "NEUTRAL", confidence: "low", basis: "ledger note: head bundle shows no regression on H3; retrieval-skip defect was in a separate arm" },
  },
  { id: "recent-fixhead", mechanism: "recent default harness: fix-head vs base", baseline: [`${rd}/base.json`], candidate: [`${rd}/fix-head.json`] },
  { id: "recent-fix2", mechanism: "recent default harness: fix2-head vs base", baseline: [`${rd}/base.json`], candidate: [`${rd}/fix2-head.json`] },
  {
    id: "strat-switch",
    mechanism: "strategy switching default vs noswitch (2026-11-05)",
    baseline: ["Ablations/2026-11-05-strategy-switching/noswitch-cogito_8b.json", "Ablations/2026-11-05-strategy-switching/noswitch-qwen3_4b.json"],
    candidate: ["Ablations/2026-11-05-strategy-switching/default-cogito_8b.json", "Ablations/2026-11-05-strategy-switching/default-qwen3_4b.json"],
  },
  {
    id: "strat-switch-k8",
    mechanism: "strategy switching k=8 follow-up, cogito",
    baseline: ["Ablations/2026-11-05-strategy-switching/k8-noswitch-cogito.json"],
    candidate: ["Ablations/2026-11-05-strategy-switching/k8-default-cogito.json"],
  },
  {
    id: "2f-lh",
    mechanism: "loopProgressAware (2f) a1 vs a0, long-horizon (2026-11-05)",
    baseline: ["Ablations/2026-11-05-loop-progress-aware/results-cogito_8b-a0.json", "Ablations/2026-11-05-loop-progress-aware/results-qwen3_4b-a0.json"],
    candidate: ["Ablations/2026-11-05-loop-progress-aware/results-cogito_8b-a1.json", "Ablations/2026-11-05-loop-progress-aware/results-qwen3_4b-a1.json"],
  },
  {
    id: "pae-a1",
    mechanism: "loopProgressAware vs a0, long-horizon (2026-11-06)",
    baseline: [`${pae}/results-lh-cogito_8b-a0.json`, `${pae}/results-lh-qwen3_4b-a0.json`],
    candidate: [`${pae}/results-lh-cogito_8b-a1.json`, `${pae}/results-lh-qwen3_4b-a1.json`],
  },
  {
    id: "pae-a2",
    mechanism: "progressAwareExit vs a0, long-horizon (2026-11-06)",
    baseline: [`${pae}/results-lh-cogito_8b-a0.json`, `${pae}/results-lh-qwen3_4b-a0.json`],
    candidate: [`${pae}/results-lh-cogito_8b-a2.json`, `${pae}/results-lh-qwen3_4b-a2.json`],
  },
  {
    id: "pae-a3",
    mechanism: "loopProgressAware + progressAwareExit vs a0 (2026-11-06)",
    baseline: [`${pae}/results-lh-cogito_8b-a0.json`, `${pae}/results-lh-qwen3_4b-a0.json`],
    candidate: [`${pae}/results-lh-cogito_8b-a3.json`, `${pae}/results-lh-qwen3_4b-a3.json`],
  },
  {
    id: "aoa-local",
    mechanism: "actOrAnswer auto vs off, 5 local tiers, long-horizon (2026-11-07)",
    ...arms("Ablations/2026-11-07-act-or-answer-auto", "off-lh-", "auto-lh-", local5),
  },
  {
    id: "ic",
    mechanism: "inputCoverage vs auto, long-horizon (2026-11-07)",
    ...arms("Ablations/2026-11-07-input-coverage", "auto-lh-", "ic-lh-", ["cogito-8b", "qwen3-14b", "qwen3-4b"]),
  },
  {
    id: "wc",
    mechanism: "writeCoverage vs base (2026-11-09)",
    ...arms("Ablations/2026-11-09-write-coverage", "base-ab-", "wc-ab-", ["cogito-8b", "qwen3-14b", "qwen3-4b"]),
  },
  {
    id: "bat-custom",
    mechanism: "budgetAnswerTurn on vs off, custom tasks (2026-11-10)",
    ...arms(bat, "off-custom-", "on-custom-", ["cogito_8b", "grok-4", "mimo-v2.6_16384"]),
  },
  {
    id: "bat-h3mi2",
    mechanism: "budgetAnswerTurn on vs off, h3mi2 tasks (2026-11-10)",
    ...arms(bat, "off-h3mi2-", "on-h3mi2-", ["cogito_8b", "grok-4", "mimo-v2.6_16384"]),
  },
  {
    id: "stl-h3",
    mechanism: "stableToolList vs base, H3 (2026-11-10)",
    ...arms(stl, "base-h3-", "stl-h3-", ["grok-4", "mimo-v2.6_16384"]),
  },
  {
    id: "stl-wide",
    mechanism: "stableToolList vs base, wide-surface (2026-11-10)",
    ...arms(stl, "base-wide-", "stl-wide-", ["grok-4", "mimo-v2.6_16384", "mimo-v2.6_8192"]),
  },
  {
    id: "fam-nofam",
    mechanism: "named-family disclosure on (base) vs off (nofam), wide-surface (2026-11-10)",
    ...arms(fam, "nofam-wide-", "base-wide-", ["grok-4", "mimo-v2.6_16384", "mimo-v2.6_8192"]),
  },
  {
    id: "fam-nocon",
    mechanism: "call-constraint notes on (base) vs off (nocon), wide-surface (2026-11-10)",
    ...arms(fam, "nocon-wide-", "base-wide-", ["mimo-v2.6_16384", "mimo-v2.6_8192"]),
  },
];
