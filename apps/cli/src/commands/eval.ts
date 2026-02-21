import { Effect, Layer } from "effect";
import {
  EvalService,
  EvalServiceLive,
  DatasetService,
  DatasetServiceLive,
} from "@reactive-agents/eval";
import {
  LLMService,
  TestLLMServiceLayer,
  AnthropicProviderLive,
  OpenAIProviderLive,
} from "@reactive-agents/llm-provider";

const USAGE =
  "Usage: rax eval run --suite <path> [--provider anthropic|openai|test] [--agent <name>]";

export async function runEval(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "run") {
    console.error(USAGE);
    process.exit(1);
  }

  let suitePath: string | undefined;
  let provider: "anthropic" | "openai" | "test" = "test";
  let agentConfig = "default";

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--suite" && args[i + 1]) suitePath = args[++i];
    else if (args[i] === "--provider" && args[i + 1])
      provider = args[++i] as typeof provider;
    else if (args[i] === "--agent" && args[i + 1]) agentConfig = args[++i];
  }

  if (!suitePath) {
    console.error(USAGE);
    process.exit(1);
  }

  const llmLayer = buildLLMLayer(provider);
  const evalLayer = EvalServiceLive.pipe(Layer.provide(llmLayer));
  const fullLayer = Layer.mergeAll(evalLayer, DatasetServiceLive, llmLayer);

  const suite = suitePath;
  const program = Effect.gen(function* () {
    const ds = yield* DatasetService;
    const evalService = yield* EvalService;

    console.log(`Loading suite: ${suite}`);
    const evalSuite = yield* ds.loadSuite(suite);
    console.log(
      `Suite: "${evalSuite.name}" — ${evalSuite.cases.length} cases, dimensions: ${evalSuite.dimensions.join(", ")}`,
    );
    console.log(`Provider: ${provider}  Agent: ${agentConfig}\n`);

    const run = yield* evalService.runSuite(evalSuite, agentConfig);
    const s = run.summary;

    console.log("─── Summary ───");
    console.log(
      `  Pass: ${s.passed}/${s.totalCases}   Avg Score: ${(s.avgScore * 100).toFixed(1)}%   Cost: $${s.totalCostUsd.toFixed(5)}`,
    );

    console.log("\n─── Dimension Scores ───");
    for (const [dim, avg] of Object.entries(s.dimensionAverages)) {
      const bar = "█".repeat(Math.round(avg * 20)).padEnd(20, "░");
      console.log(`  ${dim.padEnd(16)} ${bar} ${(avg * 100).toFixed(1)}%`);
    }

    console.log("\n─── Case Results ───");
    for (const r of run.results) {
      const icon = r.passed ? "✓" : "✗";
      console.log(`  ${icon} ${r.caseId.padEnd(24)} ${(r.overallScore * 100).toFixed(1)}%`);
    }

    if (s.failed > 0) {
      console.log(`\n${s.failed} case(s) failed.`);
      process.exit(1);
    }
  });

  try {
    await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));
  } catch (err) {
    console.error("Eval error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function buildLLMLayer(provider: "anthropic" | "openai" | "test") {
  switch (provider) {
    case "anthropic":
      return AnthropicProviderLive;
    case "openai":
      return OpenAIProviderLive;
    case "test":
    default:
      return TestLLMServiceLayer({ default: "0.8" });
  }
}
