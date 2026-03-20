// File: src/run.ts
/**
 * CLI entry point for running benchmarks.
 * Usage: bun run src/run.ts [--provider anthropic] [--model claude-haiku-4-5] [--tier simple,moderate] [--output report.json]
 */
import { runBenchmarks } from "./runner.js";
import type { MultiModelReport, Tier } from "./types.js";

const args = process.argv.slice(2);
const getArg = (flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
};

const provider = (getArg("--provider") ?? "anthropic") as "anthropic" | "openai" | "gemini" | "ollama" | "litellm" | "test";
const model = getArg("--model");
const tierArg = getArg("--tier");
const tiers = tierArg ? tierArg.split(",") as Tier[] : undefined;
const output = getArg("--output");
const timeoutArg = getArg("--timeout");
const timeoutMs = timeoutArg ? parseInt(timeoutArg, 10) * 1000 : undefined;

const report = await runBenchmarks({ provider, model, tiers, timeoutMs });

if (output) {
  // Upsert: keep other provider/model runs, replace the matching one
  let multiReport: MultiModelReport;
  try {
    const existing = JSON.parse(await Bun.file(output).text()) as MultiModelReport;
    const otherRuns = existing.runs.filter(
      (r) => !(r.provider === report.provider && r.model === report.model),
    );
    multiReport = {
      generatedAt: new Date().toISOString(),
      runs: [...otherRuns, report],
    };
  } catch {
    multiReport = { generatedAt: new Date().toISOString(), runs: [report] };
  }
  await Bun.write(output, JSON.stringify(multiReport, null, 2));
  console.log(`  Report saved to ${output}`);
}
