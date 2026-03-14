/**
 * Example 18: Cross-Task Self-Improvement
 *
 * Demonstrates how agents learn from past tasks via episodic memory.
 * The self-improvement layer records strategy outcomes per task type
 * and biases future strategy selection toward higher success rates.
 *
 * Run 1: Solves a math task (baseline — no prior experience)
 * Run 2: Same agent name (with shared memory) benefits from past strategy outcomes
 *
 * One of the 7 unique differentiators — no other framework has this.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/18-self-improvement.ts
 *   bun run apps/examples/src/advanced/18-self-improvement.ts  # test mode
 */
import { ReactiveAgents } from "reactive-agents";

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

  console.log("\n=== Cross-Task Self-Improvement Example ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  const mkBase = (name: string) => {
    let b = ReactiveAgents.create().withName(name).withProvider(provider);
    if (opts?.model) b = b.withModel(opts.model);
    return b;
  };

  // ─── Run 1: Baseline ───────────────────────────────────────────────────────

  console.log("Run 1 (baseline — no prior episodic context)...");

  const agent1 = await mkBase("self-improve-demo")
    .withMemory("1")
    .withSelfImprovement()
    .withMaxIterations(5)
    .withTestScenario([
      { match: "9", text: "FINAL ANSWER: 9 × 8 = 72" },
      { text: "FINAL ANSWER: 72" },
    ])
    .build();

  const run1 = await agent1.run("What is 9 × 8?");
  console.log(`  Steps: ${run1.metadata.stepsCount ?? 1}`);
  console.log(`  Tokens: ${run1.metadata.tokensUsed}`);
  console.log(`  Output: ${run1.output.slice(0, 60)}`);
  console.log(`  Success: ${run1.success}`);

  // ─── Run 2: With episodic learning ────────────────────────────────────────

  console.log("\nRun 2 (with episodic learning from run 1)...");

  const agent2 = await mkBase("self-improve-demo")
    .withMemory("1")
    .withSelfImprovement()
    .withMaxIterations(5)
    .withTestScenario([
      { match: "6", text: "FINAL ANSWER: 6 × 7 = 42" },
      { text: "FINAL ANSWER: 42" },
    ])
    .build();

  const run2 = await agent2.run("What is 6 × 7?");
  console.log(`  Steps: ${run2.metadata.stepsCount ?? 1}`);
  console.log(`  Tokens: ${run2.metadata.tokensUsed}`);
  console.log(`  Output: ${run2.output.slice(0, 60)}`);
  console.log(`  Success: ${run2.success}`);

  // ─── Run 3: Different task type — factual question ─────────────────────────

  console.log("\nRun 3 (different task — factual knowledge)...");

  const agent3 = await mkBase("self-improve-demo")
    .withMemory("1")
    .withSelfImprovement()
    .withMaxIterations(5)
    .withTestScenario([
      { match: "capital", text: "FINAL ANSWER: Paris is the capital of France." },
      { text: "FINAL ANSWER: Paris" },
    ])
    .build();

  const run3 = await agent3.run("What is the capital of France?");
  console.log(`  Steps: ${run3.metadata.stepsCount ?? 1}`);
  console.log(`  Output: ${run3.output.slice(0, 60)}`);

  // ─── Summary ───────────────────────────────────────────────────────────────

  const run1HasExpected = run1.output.includes("72") || run1.output.includes("FINAL ANSWER");
  const run2HasExpected = run2.output.includes("42") || run2.output.includes("FINAL ANSWER");
  const run3HasExpected = run3.output.includes("Paris") || run3.output.includes("FINAL ANSWER");

  const passed = run1.success && run2.success && run3.success &&
    run1HasExpected && run2HasExpected && run3HasExpected;

  const output = [
    `run1: ${run1.metadata.stepsCount ?? 1}st→${run1.output.slice(0, 25)}`,
    `run2: ${run2.metadata.stepsCount ?? 1}st→${run2.output.slice(0, 25)}`,
    `run3: ${run3.metadata.stepsCount ?? 1}st→${run3.output.slice(0, 25)}`,
  ].join(" | ");

  const totalSteps =
    (run1.metadata.stepsCount ?? 1) +
    (run2.metadata.stepsCount ?? 1) +
    (run3.metadata.stepsCount ?? 1);
  const totalTokens =
    run1.metadata.tokensUsed +
    run2.metadata.tokensUsed +
    run3.metadata.tokensUsed;

  return {
    passed,
    output,
    steps: totalSteps,
    tokens: totalTokens,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
