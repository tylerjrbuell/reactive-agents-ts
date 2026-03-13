import { Effect, Layer } from "effect";
import {
  EvalService,
  EvalServiceLive,
  DatasetService,
  DatasetServiceLive,
} from "@reactive-agents/eval";
import {
  TestLLMServiceLayer,
  AnthropicProviderLive,
  OpenAIProviderLive,
} from "@reactive-agents/llm-provider";
import { section, info, success, fail, kv, spinner, muted } from "../ui.js";

const USAGE =
  "Usage: rax eval run --suite <path> [--provider anthropic|openai|test] [--agent <name>]";

export async function runEval(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "run") {
    console.error(fail(USAGE));
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
    console.error(fail(USAGE));
    process.exit(1);
  }

  const llmLayer = buildLLMLayer(provider);
  const evalLayer = EvalServiceLive.pipe(Layer.provide(llmLayer));
  const fullLayer = Layer.mergeAll(evalLayer, DatasetServiceLive, llmLayer);

  const suite = suitePath;
  const program = Effect.gen(function* () {
    const ds = yield* DatasetService;
    const evalService = yield* EvalService;

    const loadSpin = spinner(`Loading suite: ${suite}`);
    const evalSuite = yield* ds.loadSuite(suite);
    loadSpin.succeed(`Suite loaded: ${evalSuite.name}`);

    console.log(kv("Cases", String(evalSuite.cases.length)));
    console.log(kv("Dimensions", evalSuite.dimensions.join(", ")));
    console.log(kv("Provider", provider));
    console.log(kv("Agent", agentConfig));

    const runSpin = spinner(`Running ${evalSuite.cases.length} eval cases...`);
    const run = yield* evalService.runSuite(evalSuite, agentConfig);
    runSpin.succeed("Eval complete");

    const s = run.summary;

    console.log(section("Summary"));
    console.log(kv("Pass", `${s.passed}/${s.totalCases}`));
    console.log(kv("Avg Score", `${(s.avgScore * 100).toFixed(1)}%`));
    console.log(kv("Cost", `$${s.totalCostUsd.toFixed(5)}`));

    console.log(section("Dimension Scores"));
    for (const [dim, avg] of Object.entries(s.dimensionAverages)) {
      const bar = "█".repeat(Math.round(avg * 20)).padEnd(20, "░");
      const pct = `${(avg * 100).toFixed(1)}%`;
      console.log(`  ${dim.padEnd(16)} ${muted(bar)} ${pct}`);
    }

    console.log(section("Case Results"));
    for (const r of run.results) {
      const score = `${(r.overallScore * 100).toFixed(1)}%`;
      const label = r.caseId.padEnd(24);
      console.log(
        r.passed ? success(`${label} ${score}`) : fail(`${label} ${score}`),
      );
    }

    if (s.failed > 0) {
      console.log(`\n${fail(`${s.failed} case(s) failed.`)}`);
      process.exit(1);
    } else {
      console.log(`\n${success("All cases passed.")}`);
    }
  });

  try {
    await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));
  } catch (err) {
    console.error(fail(`Eval error: ${err instanceof Error ? err.message : String(err)}`));
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
