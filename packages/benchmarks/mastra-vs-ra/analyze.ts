// bench/mastra-vs-ra/analyze.ts
//
// Roll up one or more results/*.json into per-tier / per-task / per-axis tables.
// Useful for filling in the wiki report.
//
// Usage:
//   bun analyze.ts                              # latest single file
//   bun analyze.ts results/cells-A.json results/cells-B.json  # merge files

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

interface Cell {
  tier: string;
  framework: "ra" | "mastra";
  model: string;
  task: string;
  category: string;
  success: boolean;
  reason: string;
  outputLength: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  outputPreview: string;
  error?: string;
}

function loadCells(): Cell[] {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    return args.flatMap((p) => JSON.parse(readFileSync(p, "utf8")) as Cell[]);
  }
  const dir = resolve(__dirname, "results");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) throw new Error("no results/*.json found");
  return JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as Cell[];
}

function perTierSummary(cells: Cell[]) {
  const tiers = [...new Set(cells.map((c) => c.tier))];
  console.log("\n## Per-tier summary\n");
  console.log("| tier | framework | pass/N | tokens (in+out) | $cost | avg dur |");
  console.log("|---|---|---|---|---|---|");
  for (const tier of tiers) {
    for (const fw of ["ra", "mastra"] as const) {
      const sub = cells.filter((c) => c.tier === tier && c.framework === fw);
      if (sub.length === 0) continue;
      const pass = sub.filter((c) => c.success).length;
      const tok = sub.reduce((a, c) => a + c.tokens, 0);
      const inTok = sub.reduce((a, c) => a + c.inputTokens, 0);
      const outTok = sub.reduce((a, c) => a + c.outputTokens, 0);
      const cost = sub.reduce((a, c) => a + c.costUsd, 0);
      const avg = sub.reduce((a, c) => a + c.durationMs, 0) / sub.length;
      console.log(`| ${tier} | ${fw} | ${pass}/${sub.length} | ${tok} (${inTok}+${outTok}) | $${cost.toFixed(4)} | ${(avg / 1000).toFixed(1)}s |`);
    }
  }
}

function perTaskWinners(cells: Cell[]) {
  const tiers = [...new Set(cells.map((c) => c.tier))];
  const tasks = [...new Set(cells.map((c) => c.task))];
  console.log("\n## Per-task winners\n");
  for (const tier of tiers) {
    console.log(`\n### tier=${tier}\n`);
    console.log("| task | category | ra | mastra | winner |");
    console.log("|---|---|---|---|---|");
    for (const task of tasks) {
      const ra = cells.find((c) => c.tier === tier && c.task === task && c.framework === "ra");
      const mastra = cells.find((c) => c.tier === tier && c.task === task && c.framework === "mastra");
      if (!ra || !mastra) continue;
      const raStr = `${ra.success ? "✓" : "✗"} ${ra.tokens}tok ${(ra.durationMs / 1000).toFixed(1)}s`;
      const mStr = `${mastra.success ? "✓" : "✗"} ${mastra.tokens}tok ${(mastra.durationMs / 1000).toFixed(1)}s`;
      let winner = "tie";
      if (ra.success && !mastra.success) winner = "**RA**";
      else if (mastra.success && !ra.success) winner = "**Mastra**";
      else if (ra.success && mastra.success) {
        // Both pass — winner by cost+speed combo
        const raScore = ra.tokens / 1000 + ra.durationMs / 1000;
        const mScore = mastra.tokens / 1000 + mastra.durationMs / 1000;
        if (raScore < mScore * 0.8) winner = "RA (efficiency)";
        else if (mScore < raScore * 0.8) winner = "Mastra (efficiency)";
        else winner = "tie";
      }
      console.log(`| ${task} | ${ra.category} | ${raStr} | ${mStr} | ${winner} |`);
    }
  }
}

function perCategoryAggregate(cells: Cell[]) {
  const categories = [...new Set(cells.map((c) => c.category))];
  console.log("\n## Per-category aggregate (across all tiers)\n");
  console.log("| category | ra pass | mastra pass | ra avg tok | mastra avg tok | ratio (ra/mastra tok) |");
  console.log("|---|---|---|---|---|---|");
  for (const cat of categories) {
    const ra = cells.filter((c) => c.category === cat && c.framework === "ra");
    const mastra = cells.filter((c) => c.category === cat && c.framework === "mastra");
    if (ra.length === 0 || mastra.length === 0) continue;
    const raPass = ra.filter((c) => c.success).length;
    const mPass = mastra.filter((c) => c.success).length;
    const raAvgTok = Math.round(ra.reduce((a, c) => a + c.tokens, 0) / ra.length);
    const mAvgTok = Math.round(mastra.reduce((a, c) => a + c.tokens, 0) / mastra.length);
    const ratio = mAvgTok > 0 ? (raAvgTok / mAvgTok).toFixed(2) : "∞";
    console.log(`| ${cat} | ${raPass}/${ra.length} | ${mPass}/${mastra.length} | ${raAvgTok} | ${mAvgTok} | ${ratio}× |`);
  }
}

function failures(cells: Cell[]) {
  const fails = cells.filter((c) => !c.success);
  if (fails.length === 0) return;
  console.log("\n## Failures\n");
  console.log("| tier | framework | task | reason | error |");
  console.log("|---|---|---|---|---|");
  for (const c of fails) {
    const errStr = c.error ? ` — ${c.error.slice(0, 80)}` : "";
    console.log(`| ${c.tier} | ${c.framework} | ${c.task} | ${c.reason.slice(0, 60)} | ${errStr} |`);
  }
}

const cells = loadCells();
console.log(`Loaded ${cells.length} cells from ${process.argv.length > 2 ? process.argv.slice(2).join(", ") : "latest results"}`);
perTierSummary(cells);
perCategoryAggregate(cells);
perTaskWinners(cells);
failures(cells);
