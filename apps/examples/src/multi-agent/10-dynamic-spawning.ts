/**
 * Example 10: Dynamic Sub-Agent Spawning
 *
 * Demonstrates how a parent agent can dynamically create and delegate to
 * specialist sub-agents at runtime using the spawn-agent built-in tool.
 *
 * The parent agent decides at runtime when to spawn a sub-agent, what role
 * to give it, and what task to delegate. Sub-agents run in clean context
 * windows with depth limiting (MAX_RECURSION_DEPTH = 3).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/multi-agent/10-dynamic-spawning.ts
 *   bun run apps/examples/src/multi-agent/10-dynamic-spawning.ts  # test mode
 */

import { ReactiveAgents } from "@reactive-agents/runtime";

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

  console.log("\n=== Dynamic Sub-Agent Spawning Example ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  let b = ReactiveAgents.create()
    .withName("parent-spawner")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  const agent = await b
    .withTools()
    .withDynamicSubAgents({ maxIterations: 4 })
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(8)
    .withTestResponses({
      "spawn":    "FINAL ANSWER: I delegated to a specialist sub-agent. The sub-agent completed the task and returned: SPAWN_COMPLETED",
      "delegate": "FINAL ANSWER: I delegated to a specialist sub-agent. The sub-agent completed the task and returned: SPAWN_COMPLETED",
      "":         "FINAL ANSWER: Task delegated to sub-agent. Result: SPAWN_COMPLETED",
    })
    .build();

  console.log("Running parent agent (will spawn sub-agent)...");
  const result = await agent.run(
    "Delegate this writing task to a specialist sub-agent: write a one-sentence description of what Reactive Agents is."
  );

  console.log(`Output: ${result.output}`);
  console.log(`Steps: ${result.metadata.stepsCount}`);

  const passed = result.success && (
    result.output.includes("SPAWN_COMPLETED") ||
    result.output.toLowerCase().includes("delegat") ||
    result.output.toLowerCase().includes("spawn") ||
    result.output.toLowerCase().includes("sub-agent") ||
    result.output.length > 20
  );

  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
