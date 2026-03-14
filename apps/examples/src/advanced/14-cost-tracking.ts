/**
 * Example 14: Cost Tracking & Budget Enforcement
 *
 * Demonstrates per-task cost tracking, budget limits, and model routing.
 * The cost layer tracks token usage and converts it to estimated USD cost.
 * Agents can be configured with cost tracking enabled — execution records
 * token consumption and estimates USD cost for each run.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/14-cost-tracking.ts
 *   bun run apps/examples/src/advanced/14-cost-tracking.ts  # test mode
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

  console.log("\n=== Cost Tracking Example ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  const mkBase = (name: string) => {
    let b = ReactiveAgents.create().withName(name).withProvider(provider);
    if (opts?.model) b = b.withModel(opts.model);
    return b;
  };

  // ─── Part 1: Basic cost tracking ──────────────────────────────────────────

  console.log("Part 1: Basic cost tracking with .withCostTracking()");

  const agent = await mkBase("cost-tracked-agent")
    .withCostTracking()
    .withTestScenario([{ text: "FINAL ANSWER: The answer is 42. Task completed within budget." }])
    .build();

  const result = await agent.run("What is 6 × 7?");

  const cost = result.metadata.cost ?? 0;
  const tokens = result.metadata.tokensUsed ?? 0;
  console.log(`  Output: ${result.output.slice(0, 80)}`);
  console.log(`  Tokens: ${tokens}`);
  console.log(`  Estimated cost: $${cost.toFixed(6)}`);

  // ─── Part 2: Cost tracking on multiple runs ────────────────────────────────

  console.log("\nPart 2: Cost accumulation across multiple runs");

  const agent2 = await mkBase("multi-run-agent")
    .withCostTracking()
    .withTestScenario([
      { match: "France", text: "FINAL ANSWER: Paris is the capital of France." },
      { text: "FINAL ANSWER: Tokyo is the capital of Japan." },
    ])
    .build();

  const run1 = await agent2.run("What is the capital of France?");
  const run2 = await agent2.run("What is the capital of Japan?");

  const totalTokens = (run1.metadata.tokensUsed ?? 0) + (run2.metadata.tokensUsed ?? 0);
  const totalCost = (run1.metadata.cost ?? 0) + (run2.metadata.cost ?? 0);
  console.log(`  Run 1 tokens: ${run1.metadata.tokensUsed}, cost: $${(run1.metadata.cost ?? 0).toFixed(6)}`);
  console.log(`  Run 2 tokens: ${run2.metadata.tokensUsed}, cost: $${(run2.metadata.cost ?? 0).toFixed(6)}`);
  console.log(`  Total tokens: ${totalTokens}, total cost: $${totalCost.toFixed(6)}`);

  // ─── Summary ───────────────────────────────────────────────────────────────

  const passed = result.success && cost >= 0 && run1.success && run2.success;
  const output = `cost=$${cost.toFixed(6)} tokens=${tokens} | ${result.output.slice(0, 60)}`;

  return {
    passed,
    output,
    steps: result.metadata.stepsCount ?? 1,
    tokens,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
