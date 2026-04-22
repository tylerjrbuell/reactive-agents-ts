// File: apps/cli/src/commands/bench.ts
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

  const sessionId = getArg("--session");
  const logLevel = (getArg("--log-level") ?? "progress") as "silent" | "progress" | "verbose";
  const output = getArg("--output");

  let report: any;

  if (sessionId) {
    // V2 API: Run a session
    const { runSession, regressionGateSession, realWorldFullSession, localModelsSession, competitorComparisonSession } = benchmarks;
    const sessions: Record<string, any> = {
      "regression-gate": regressionGateSession,
      "real-world-full": realWorldFullSession,
      "local-models": localModelsSession,
      "competitor-comparison": competitorComparisonSession,
    };

    const session = sessions[sessionId];
    if (!session) {
      console.error(`Unknown session: ${sessionId}`);
      console.error(`Available: ${Object.keys(sessions).join(", ")}`);
      process.exit(1);
    }

    report = await runSession({ ...session, logLevel }, output);
  } else {
    // V1 API: Run benchmarks with provider/model
    const { runBenchmarks } = benchmarks;
    const provider = (getArg("--provider") ?? "test") as
      | "anthropic" | "openai" | "gemini" | "ollama" | "litellm" | "test";
    const model = getArg("--model");
    const tierArg = getArg("--tier");
    const tiers = tierArg ? (tierArg.split(",") as any[]) : undefined;
    const timeoutArg = getArg("--timeout");
    const timeoutMs = timeoutArg ? parseInt(timeoutArg, 10) * 1000 : undefined;

    report = await runBenchmarks({ provider, model, tiers, timeoutMs, logLevel });
  }

  if (output) {
    await Bun.write(output, JSON.stringify(report, null, 2));
    console.log(info(`Report saved to ${output}`));
  }
}
