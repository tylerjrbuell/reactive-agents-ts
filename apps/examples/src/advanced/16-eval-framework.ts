/**
 * Example 16: Evaluation Framework
 *
 * Demonstrates the eval framework for measuring agent quality:
 * - runCase(): evaluate a single response across multiple dimensions
 * - Dimensions: accuracy, relevance, completeness, safety, cost-efficiency
 * - EvalResult with per-dimension scores and overall pass/fail
 * - LLM-as-judge scoring (or heuristic fallback in test mode)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/16-eval-framework.ts
 *   bun run apps/examples/src/advanced/16-eval-framework.ts  # test mode
 */
import { Effect, Layer } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import {
  EvalService,
  EvalServiceLive,
} from "@reactive-agents/eval";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("\n=== Eval Framework Example ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  // ─── Part 1: Run an agent to get a response ────────────────────────────────

  console.log("Part 1: Running agent to get response");

  let b = ReactiveAgents.create().withName("eval-subject").withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  const agent = await b
    .withTestResponses({ "": "FINAL ANSWER: Paris is the capital of France." })
    .build();

  const agentResult = await agent.run("What is the capital of France?");
  console.log(`  Agent output: ${agentResult.output.slice(0, 80)}`);
  console.log(`  Steps: ${agentResult.metadata.stepsCount}, Tokens: ${agentResult.metadata.tokensUsed}`);

  // ─── Part 2: Evaluate with EvalService.runCase() ──────────────────────────

  console.log("\nPart 2: Evaluating response with EvalService");

  const evalProgram = Effect.gen(function* () {
    const evalSvc = yield* EvalService;

    const evalCase = {
      id: "capital-france-01",
      input: "What is the capital of France?",
      expectedOutput: "Paris",
      dimensions: ["accuracy", "relevance"],
    };

    console.log(`  Evaluating case: ${evalCase.id}`);
    console.log(`  Dimensions: ${evalCase.dimensions.join(", ")}`);

    const result = yield* evalSvc.runCase(
      evalCase,
      "test-agent",
      evalCase.dimensions,
      agentResult.output,
      {
        latencyMs: agentResult.metadata.durationMs ?? 0,
        tokensUsed: agentResult.metadata.tokensUsed,
      },
    );

    return result;
  });

  // EvalServiceLive requires LLMService for LLM-as-judge scoring
  // In test mode, provide TestLLMServiceLayer which returns deterministic responses
  const testLLMLayer = TestLLMServiceLayer({
    "accuracy": "SCORE: 0.9\nRATIONALE: The output correctly identifies Paris as the capital of France.",
    "relevance": "SCORE: 1.0\nRATIONALE: The answer is directly relevant to the question asked.",
    "": "SCORE: 0.85\nRATIONALE: Good response.",
  });
  const evalLayer = EvalServiceLive.pipe(Layer.provide(testLLMLayer));

  const evalResult = await Effect.runPromise(
    evalProgram.pipe(Effect.provide(evalLayer)),
  );

  console.log(`  Overall score: ${evalResult.overallScore.toFixed(3)}`);
  console.log(`  Passed: ${evalResult.passed}`);
  for (const dim of evalResult.scores ?? []) {
    console.log(`  [${dim.dimension}] score=${dim.score.toFixed(2)} details=${(dim.details ?? "").slice(0, 60)}`);
  }

  // ─── Part 3: Manual scoring for contrast ──────────────────────────────────

  console.log("\nPart 3: Manual scoring for contrast");
  const expected = "Paris";
  const manualScore = agentResult.output.toLowerCase().includes(expected.toLowerCase()) ? 1.0 : 0.0;
  console.log(`  Manual keyword match score: ${manualScore}`);
  console.log(`  EvalService overall score: ${evalResult.overallScore.toFixed(3)}`);

  // ─── Summary ───────────────────────────────────────────────────────────────

  const passed = agentResult.success && evalResult.overallScore > 0;
  const output = `eval_score=${evalResult.overallScore.toFixed(3)} passed=${evalResult.passed} | ${agentResult.output.slice(0, 60)}`;

  return {
    passed,
    output,
    steps: agentResult.metadata.stepsCount ?? 1,
    tokens: agentResult.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
