/**
 * Example 20: Model-Adaptive Context Profiles
 *
 * Demonstrates context profiles that adapt agent behavior to the model's
 * capability tier. 4 tiers are available:
 * - local:    Small/local models — aggressive compaction, tighter context windows,
 *             simpler prompts, conservative tool schemas
 * - mid:      Mid-range models — balanced compaction and context budgets
 * - large:    Large hosted models — full context, detailed prompts
 * - frontier: GPT-4o, Claude 3.5+ — maximum context budget, rich tool schemas,
 *             verbose prompts, full multi-step reasoning
 *
 * This example runs entirely offline — no API key required.
 *
 * Usage:
 *   bun run apps/examples/src/reasoning/20-context-profiles.ts
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

  console.log("\n=== Context Profiles Example ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "OFFLINE (test provider)"}\n`);

  // ─── Part 1: Build local-tier and frontier-tier agents in parallel ─────────

  console.log("Part 1: Comparing local vs frontier context profiles\n");

  const mkAgent = (name: string, tier: "local" | "frontier" | "mid" | "large", text: string) => {
    let b = ReactiveAgents.create()
      .withName(name)
      .withProvider(provider);
    if (opts?.model) b = b.withModel(opts.model);
    if (provider === "test") {
      b = b.withTestScenario([{ text }]);
    }
    return b.withContextProfile({ tier });
  };

  const [localAgent, frontierAgent] = await Promise.all([
    mkAgent("local-tier-agent", "local", "FINAL ANSWER: 42 (local tier — compact context, minimal prompt)").build(),
    mkAgent("frontier-tier-agent", "frontier", "FINAL ANSWER: 42 (frontier tier — full context budget, rich schema)").build(),
  ]);

  const [r1, r2] = await Promise.all([
    localAgent.run("Compute 6 × 7."),
    frontierAgent.run("Compute 6 × 7."),
  ]);

  console.log(`  local tier:    ${r1.output.slice(0, 70)}`);
  console.log(`  frontier tier: ${r2.output.slice(0, 70)}`);

  // ─── Part 2: Mid and large tiers ──────────────────────────────────────────

  console.log("\nPart 2: Mid and large tiers\n");

  const [midAgent, largeAgent] = await Promise.all([
    mkAgent("mid-tier-agent", "mid", "FINAL ANSWER: mid tier response with balanced context budget").build(),
    mkAgent("large-tier-agent", "large", "FINAL ANSWER: large tier response with extended context window").build(),
  ]);

  const [r3, r4] = await Promise.all([
    midAgent.run("What is 12 + 30?"),
    largeAgent.run("What is 12 + 30?"),
  ]);

  console.log(`  mid tier:   ${r3.output.slice(0, 70)}`);
  console.log(`  large tier: ${r4.output.slice(0, 70)}`);

  // ─── Summary ──────────────────────────────────────────────────────────────

  const allSucceeded = r1.success && r2.success && r3.success && r4.success;
  const totalSteps =
    r1.metadata.stepsCount +
    r2.metadata.stepsCount +
    r3.metadata.stepsCount +
    r4.metadata.stepsCount;
  const totalTokens =
    r1.metadata.tokensUsed +
    r2.metadata.tokensUsed +
    r3.metadata.tokensUsed +
    r4.metadata.tokensUsed;

  console.log(`\nAll 4 tiers ran successfully: ${allSucceeded}`);

  return {
    passed: allSucceeded,
    output: `local: ${r1.output.slice(0, 30)} | frontier: ${r2.output.slice(0, 30)}`,
    steps: totalSteps,
    tokens: totalTokens,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
