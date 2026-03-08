// File: src/run.ts
/**
 * CLI entry point for running benchmarks.
 * Usage: bun run src/run.ts [--provider openai] [--model gpt-4o] [--tier simple,moderate] [--output report.json]
 */
import { runBenchmarks } from "./runner.js";
import type { Tier } from "./types.js";

const args = process.argv.slice(2);
const getArg = (flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
};

const provider = (getArg("--provider") ?? "test") as "anthropic" | "openai" | "gemini" | "ollama" | "litellm" | "test";
const model = getArg("--model");
const tierArg = getArg("--tier");
const tiers = tierArg ? tierArg.split(",") as Tier[] : undefined;
const output = getArg("--output");

const report = await runBenchmarks({ provider, model, tiers });

console.log(`\n  ── Summary ──`);
console.log(`  Total: ${report.summary.totalTasks} | Pass: ${report.summary.passed} | Fail: ${report.summary.failed} | Errors: ${report.summary.errors}`);
console.log(`  Duration: ${report.summary.totalDurationMs.toFixed(0)}ms | Avg: ${report.summary.avgLatencyMs.toFixed(1)}ms`);
console.log(`  Tokens: ${report.summary.totalTokens} | Cost: $${report.summary.totalCost.toFixed(4)}`);

if (output) {
  await Bun.write(output, JSON.stringify(report, null, 2));
  console.log(`  Report saved to ${output}`);
}
