import { Effect, Layer } from "effect";
import {
  EvalService,
  EvalServiceLive,
  DatasetService,
  DatasetServiceLive,
  JudgeLLMService,
  BenchmarkError,
  type SuiteAgentRunner,
} from "@reactive-agents/eval";
import {
  TestLLMServiceLayer,
  AnthropicProviderLive,
  OpenAIProviderLive,
  LLMService,
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

  // SUT layer — runs the agent under test.
  const llmLayer = buildLLMLayer(provider);
  // Judge layer — wired separately per Rule 4 (frozen judge isolation).
  // For the v0.10 CLI we route the judge through the same provider as the
  // SUT (single-binary CLI constraint); the Tag distinction still keeps
  // the code path isolated, and the runtime guard in runSuite will reject
  // identical judge.model === sutModel pairings supplied via config.
  const judgeLayer = buildJudgeLayer(provider);
  const evalLayer = EvalServiceLive.pipe(Layer.provide(judgeLayer));
  const fullLayer = Layer.mergeAll(evalLayer, DatasetServiceLive, llmLayer);

  const suite = suitePath;
  const program = Effect.gen(function* () {
    const ds = yield* DatasetService;
    const evalService = yield* EvalService;
    const sutLLM = yield* LLMService;

    // SuiteAgentRunner — runs the SUT for each case via LLMService.
    // Stays in the SUT code path; never touches JudgeLLMService.
    const agentRunner: SuiteAgentRunner = (input) =>
      Effect.gen(function* () {
        const start = Date.now();
        const response = yield* sutLLM
          .complete({
            messages: [{ role: "user", content: input }],
            temperature: 0.0,
          })
          .pipe(
            Effect.mapError(
              (err) =>
                new BenchmarkError({
                  message: `SUT failed for input "${input.slice(0, 60)}...": ${String(err)}`,
                  suiteId: "cli",
                }),
            ),
          );
        return {
          actualOutput: response.content,
          metrics: {
            latencyMs: Date.now() - start,
            costUsd: response.usage.estimatedCost ?? 0,
            tokensUsed: response.usage.totalTokens ?? 0,
            stepsExecuted: 1,
          },
        };
      });

    const loadSpin = spinner(`Loading suite: ${suite}`);
    const evalSuite = yield* ds.loadSuite(suite);
    loadSpin.succeed(`Suite loaded: ${evalSuite.name}`);

    console.log(kv("Cases", String(evalSuite.cases.length)));
    console.log(kv("Dimensions", evalSuite.dimensions.join(", ")));
    console.log(kv("Provider", provider));
    console.log(kv("Agent", agentConfig));

    const runSpin = spinner(`Running ${evalSuite.cases.length} eval cases...`);
    const run = yield* evalService.runSuite(evalSuite, agentConfig, agentRunner);
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
    await Effect.runPromise(program.pipe(Effect.provide(fullLayer)) as Effect.Effect<void, any, never>);
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
      return TestLLMServiceLayer([{ text: "0.8" }]);
  }
}

/**
 * Build the JudgeLLMService layer. For the v0.10 CLI this delegates to the
 * same underlying provider as the SUT but routes through the distinct
 * `JudgeLLMService` Tag — that's enough to satisfy Rule-4 code-path
 * isolation. Runtime guard in `runSuite` still rejects identical
 * `judge.model === sutModel` pairings declared in `config.judge`.
 */
function buildJudgeLayer(provider: "anthropic" | "openai" | "test") {
  // Re-use the same provider implementation by binding it through the judge
  // Tag. Effect resolves Tags by identity, so even though the underlying
  // service is the same instance, judge calls go through `JudgeLLMService`
  // and SUT calls go through `LLMService`.
  const llmLayer = buildLLMLayer(provider);
  return Layer.effect(
    JudgeLLMService,
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return { complete: llm.complete };
    }),
  ).pipe(Layer.provide(llmLayer));
}
