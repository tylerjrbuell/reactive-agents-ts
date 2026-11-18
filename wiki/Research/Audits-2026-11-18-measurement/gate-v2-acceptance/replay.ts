// Replay of the S3 comparison dataset through the gate-v2 spec rule (zero tokens).
//   bun wiki/Research/Audits-2026-11-18-measurement/gate-v2-acceptance/replay.ts
// Deviations from the spec, forced by retrospective data (printed in the output header):
//  - no frozen reference baseline exists for these runs, so task class comes from the POOLED arms of the
//    comparison itself (pooled-marginal selection is unbiased under H0 but is not the spec's independent reference);
//  - no automatic veto rerun exists, so a triggered veto is `veto-pending`, never `reject`;
//  - no pre-registration exists, so default-on rows are labelled "statistical verdict, prereg absent".
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type SavedCell, billed, isMeasured, loadResults } from "../../../../packages/benchmarks/src/spikes/cells.js";
import { COMPARISONS } from "../../../../packages/benchmarks/src/spikes/comparisons.js";
import { type Run, type TaskClass, type TierData, evaluate } from "./rule.js";

const ROOT = join(import.meta.dir, "../../../../wiki/Research");
const load = (files: readonly string[]): SavedCell[] =>
  files.flatMap((f) => {
    const p = join(ROOT, f);
    const r = existsSync(p) ? loadResults(p) : undefined;
    return r ? [...r.cells] : [];
  });

const TOKEN_FREE = /cogito|qwen|gemma|llama|bonsai/;
const toRun = (c: SavedCell): Run => ({ solved: c.solved, tokens: billed(c), turns: c.iterations });

function tiersOf(base: readonly SavedCell[], cand: readonly SavedCell[]): TierData[] {
  const tiers = [...new Set(base.map((c) => c.tier))].filter((t) => cand.some((c) => c.tier === t)).sort();
  return tiers.flatMap((tier) => {
    const b = base.filter((c) => c.tier === tier && isMeasured(c));
    const c = cand.filter((x) => x.tier === tier && isMeasured(x));
    const taskIds = [...new Set(b.map((x) => x.taskId))].filter((t) => c.some((x) => x.taskId === t)).sort();
    if (taskIds.length === 0) return [];
    return [
      {
        tier,
        tokenFree: TOKEN_FREE.test(tier),
        tasks: taskIds.map((taskId) => {
          const bb = b.filter((x) => x.taskId === taskId);
          const cc = c.filter((x) => x.taskId === taskId);
          const solved = bb.filter((x) => x.solved).length + cc.filter((x) => x.solved).length;
          const n = bb.length + cc.length;
          const cls: TaskClass = solved === 0 ? "floor" : solved === n ? "canary" : "disc";
          return { taskId, cls, base: bb.map(toRun), cand: cc.map(toRun) };
        }),
      },
    ];
  });
}

const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : "-");
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : "-");

console.log("## Gate v2 spec rule replayed on the S3 dataset (24 comparisons)\n");
console.log("| id | tiers | k/cell (max) | stage | verdict (exit) | path | disc strata | RD pp [lo, hi] | canary drop pp | veto | efficiency per tier: state tpr / tps (p save, p cost) | plan N acc / eff | known |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");

const run = (id: string, label: string, base: readonly SavedCell[], cand: readonly SavedCell[], known: string, scope?: ReadonlySet<string>): void => {
  const tiers = tiersOf(base, cand);
  if (tiers.length === 0) {
    console.log(`| ${label} | no common measured cells | | | | | | | | | | | ${known} |`);
    return;
  }
  const k = Math.max(...tiers.flatMap((t) => t.tasks.map((x) => Math.max(x.base.length, x.cand.length))));
  const stage = k >= 8 ? "confirm" : "screen";
  const e = evaluate(tiers, stage, 11, undefined, undefined, scope);
  const veto = e.veto.map((v) => `${v.tier}:${v.taskId} ${f1(v.deltaPp)}pp ${v.status}`).join("; ") || "-";
  const eff = e.efficiency.map((x) => `${x.state}${x.scoped ? "(scoped)" : ""} ${f2(x.tprRatio)}/${f2(x.tpsRatio)} (${f2(x.savesP)}, ${f2(x.costsP)})`).join("; ");
  console.log(
    `| ${label} | ${tiers.length} | ${k} | ${stage} | ${e.verdict} (${e.exitCode}) | ${e.path} | ${e.accuracy.strata} | ${f1(e.accuracy.rdPp)} [${f1(e.accuracy.loPp)}, ${f1(e.accuracy.hiPp)}] ${e.accuracy.state} | ${f1(e.canaryDropPp)}${e.canaryHarm ? " HARM" : ""} | ${veto} | ${eff} | ${f1(e.planNAccuracy)} / ${f1(e.planNEfficiency)} | ${known} |`,
  );
};

for (const spec of COMPARISONS) {
  const base = load(spec.baseline);
  const cand = load(spec.candidate);
  const known = spec.known ? `${spec.known.outcome} (${spec.known.confidence})` : "unlabelled";
  if (base.length === 0 || cand.length === 0) {
    console.log(`| ${spec.id} | MISSING FILES | | | | | | | | | | | ${known} |`);
    continue;
  }
  run(spec.id, spec.id, base, cand, known);
  if (spec.id === "pth") run(spec.id, "pth + prereg scope {h3-todo-heavy}", base, cand, known, new Set(["h3-todo-heavy"]));
}
