/**
 * Example 19: Reasoning Strategies — Side-by-Side Comparison
 *
 * Runs the same task using 3 different reasoning strategies and compares
 * their step counts and outputs. All 5 strategies available:
 * - reactive:            ReAct loop (think → act → observe)
 * - plan-execute-reflect: Plan all steps first, then execute + reflect
 * - tree-of-thought:    Explore multiple reasoning branches
 * - reflexion:          Critique and improve previous response
 * - adaptive:           Auto-selects strategy based on task complexity
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/reasoning/19-reasoning-strategies.ts
 *   bun run apps/examples/src/reasoning/19-reasoning-strategies.ts  # test mode
 */
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

const PROVIDER = process.env.ANTHROPIC_API_KEY
  ? ("anthropic" as const)
  : ("test" as const);

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  console.log("\n=== Reasoning Strategies Comparison ===\n");
  console.log(`Mode: ${PROVIDER === "anthropic" ? "LIVE" : "TEST"}\n`);

  const TASK =
    "Explain in one sentence why agent memory is important for multi-turn conversations.";

  // Valid strategy names: "reactive" | "plan-execute-reflect" | "tree-of-thought" | "reflexion" | "adaptive"
  const strategies = [
    "reactive",
    "plan-execute-reflect",
    "adaptive",
  ] as const;

  const results: string[] = [];
  let totalSteps = 0;
  let totalTokens = 0;

  for (const strategy of strategies) {
    const agent = await ReactiveAgents.create()
      .withName(`strategy-${strategy}`)
      .withProvider(PROVIDER)
      .withReasoning({ defaultStrategy: strategy })
      .withMaxIterations(5)
      .withTestResponses({
        "": `FINAL ANSWER: [${strategy}] Agent memory enables persistent context across conversation turns, allowing coherent multi-turn interactions.`,
      })
      .build();

    const result = await agent.run(TASK);
    const summary = `${strategy}(${result.metadata.stepsCount}st): ${result.output.slice(0, 50)}`;
    results.push(summary);
    totalSteps += result.metadata.stepsCount;
    totalTokens += result.metadata.tokensUsed;

    console.log(
      `  [${strategy}] ${result.metadata.stepsCount} steps | ${result.output.slice(0, 60)}`,
    );
  }

  const passed = results.length === 3;
  const output = results.join(" | ");

  console.log(`\nTotal steps across 3 strategies: ${totalSteps}`);
  console.log(`Total tokens used: ${totalTokens}`);

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
