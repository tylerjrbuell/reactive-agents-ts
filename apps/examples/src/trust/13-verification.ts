/**
 * Example 13: Multi-Layer Verification
 *
 * Demonstrates the 5-layer hallucination verification system:
 * - Semantic entropy: checks consistency across response variations
 * - Fact decomposition: breaks output into atomic claims
 * - Multi-source: cross-references claims via LLM + optional Tavily search
 *
 * One of the 7 unique differentiators of Reactive Agents.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/trust/13-verification.ts
 *   bun run apps/examples/src/trust/13-verification.ts  # test mode
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

  console.log("\n=== Multi-Layer Verification Example ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  // ─── Part 1: Agent with verification enabled ──────────────────────────────
  //
  // .withVerification() enables the semantic entropy + fact decomposition
  // pipeline. After each response the verification layer assesses confidence
  // and flags uncertain outputs.
  //
  // For multi-source cross-referencing set TAVILY_API_KEY in the environment
  // (optional — the layer degrades gracefully when no search key is present).

  console.log("Part 1: Verified agent (semantic entropy + fact decomposition)");

  const mkBase = (name: string) => {
    let b = ReactiveAgents.create().withName(name).withProvider(provider);
    if (opts?.model) b = b.withModel(opts.model);
    return b;
  };

  const verifiedAgent = await mkBase("verified-agent")
    .withVerification()
    .withTestResponses({
      "": "FINAL ANSWER: The Eiffel Tower is 330 meters tall and located in Paris, France. It was completed in 1889 and was designed by Gustave Eiffel.",
    })
    .build();

  const verifiedResult = await verifiedAgent.run(
    "State three facts about the Eiffel Tower."
  );

  console.log(`  Output: ${verifiedResult.output.slice(0, 120)}`);
  console.log(`  Steps: ${verifiedResult.metadata.stepsCount}`);
  console.log(`  Success: ${verifiedResult.success}`);

  // ─── Part 2: Unverified agent for comparison ──────────────────────────────

  console.log("\nPart 2: Unverified agent (baseline, no verification layer)");

  const baselineAgent = await mkBase("baseline-agent")
    .withTestResponses({
      "": "FINAL ANSWER: The Eiffel Tower is in Paris. It is very tall and was built a long time ago.",
    })
    .build();

  const baselineResult = await baselineAgent.run(
    "State three facts about the Eiffel Tower."
  );

  console.log(`  Output: ${baselineResult.output.slice(0, 120)}`);
  console.log(`  Steps: ${baselineResult.metadata.stepsCount}`);
  console.log(`  Success: ${baselineResult.success}`);

  // ─── Summary ──────────────────────────────────────────────────────────────

  console.log("\n─── Summary ───");
  console.log(`  Verified agent success: ${verifiedResult.success}`);
  console.log(`  Baseline agent success: ${baselineResult.success}`);
  console.log(
    `  Note: .withVerification() enables semantic entropy + fact decomposition.`
  );
  console.log(
    `  For multi-source checking set TAVILY_API_KEY — the layer degrades gracefully without it.`
  );

  const passed = verifiedResult.success && baselineResult.success;
  const output = [
    `[verified] ${verifiedResult.output.slice(0, 80)}`,
    `[baseline] ${baselineResult.output.slice(0, 80)}`,
  ].join(" | ");

  return {
    passed,
    output,
    steps: verifiedResult.metadata.stepsCount + baselineResult.metadata.stepsCount,
    tokens: verifiedResult.metadata.tokensUsed + baselineResult.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
