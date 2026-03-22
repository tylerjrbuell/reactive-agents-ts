// File: apps/cli/src/commands/bench.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { info } from "../ui.js";

export async function runBench(argv: string[]) {
  const getArg = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };

  let benchmarks: typeof import("@reactive-agents/benchmarks");
  try {
    benchmarks = await import("@reactive-agents/benchmarks");
  } catch {
    console.error("rax bench requires @reactive-agents/benchmarks, which is only available inside the reactive-agents-ts repo.");
    process.exit(1);
  }
  const { runBenchmarks } = benchmarks;

  const provider = (getArg("--provider") ?? "test") as
    | "anthropic" | "openai" | "gemini" | "ollama" | "litellm" | "test";
  const model = getArg("--model");
  const tierArg = getArg("--tier");
  const tiers = tierArg ? (tierArg.split(",") as any[]) : undefined;
  const output = getArg("--output");
  const timeoutArg = getArg("--timeout");
  const timeoutMs = timeoutArg ? parseInt(timeoutArg, 10) * 1000 : undefined;

  const report = await runBenchmarks({ provider, model, tiers, timeoutMs });

  if (output) {
    let finalData: any = { runs: [report] };
    
    try {
      if (existsSync(output)) {
        const existingData = JSON.parse(readFileSync(output, "utf-8"));
        // Extract array of previous runs
        const runs = Array.isArray(existingData.runs) 
          ? existingData.runs 
          : (existingData.timestamp ? [existingData] : []);
          
        // Overwrite if same model/provider, else append
        const existingIdx = runs.findIndex(
          (r: any) => r.provider === provider && r.model === model
        );
        
        if (existingIdx >= 0) {
          runs[existingIdx] = report;
        } else {
          runs.push(report);
        }
        
        finalData = { runs };
      }
    } catch (err) {
      // Ignore read/parse errors, just write as new
    }

    writeFileSync(output, JSON.stringify(finalData, null, 2));
    console.log(info(`Report merged and saved to ${output} (Multi-run format)`));
  }
}
