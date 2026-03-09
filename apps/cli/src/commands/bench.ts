// File: apps/cli/src/commands/bench.ts
import { info } from "../ui.js";
import type { Tier } from "@reactive-agents/benchmarks";

export async function runBench(argv: string[]) {
  const getArg = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };

  const provider = (getArg("--provider") ?? "test") as
    | "anthropic" | "openai" | "gemini" | "ollama" | "litellm" | "test";
  const model = getArg("--model");
  const tierArg = getArg("--tier");
  const tiers = tierArg ? (tierArg.split(",") as Tier[]) : undefined;
  const output = getArg("--output");

  const { runBenchmarks } = await import("@reactive-agents/benchmarks");

  const report = await runBenchmarks({ provider, model, tiers });

  if (output) {
    await Bun.write(output, JSON.stringify(report, null, 2));
    console.log(info(`Report saved to ${output}`));
  }
}
