/**
 * Example: Dynamic Tool Registration
 *
 * Demonstrates adding and removing tools on a running agent:
 * - `agent.registerTool()` to add a custom tool at runtime
 * - `agent.unregisterTool()` to remove it when no longer needed
 *
 * Usage:
 *   bun run apps/examples/src/tools/dynamic-registration.ts
 */

import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  // Build an agent with tools enabled
  const agent = await ReactiveAgents.create()
    .withName("dynamic-tools-demo")
    .withProvider("test")
    .withReasoning()
    .withTools()
    .withTestScenario([
      { text: "I'll look that up for you." },
      { text: "Done with the custom tool." },
    ])
    .build();

  // Register a custom tool at runtime
  console.log("Registering custom_lookup tool...");
  await agent.registerTool(
    {
      name: "custom_lookup",
      description: "Look up data from an external service",
      parameters: [
        {
          name: "query",
          type: "string",
          description: "Search query",
          required: true,
        },
        {
          name: "limit",
          type: "number",
          description: "Max results to return",
          required: false,
        },
      ],
      riskLevel: "low",
      timeoutMs: 10_000,
      requiresApproval: false,
      source: "function",
    },
    (args: Record<string, unknown>) =>
      Effect.succeed(`Found 3 results for: ${args.query}`),
  );
  console.log("Tool registered.");

  // Run the agent — it now has access to the dynamically registered tool
  const result = await agent.run("Look up recent papers on transformers");
  console.log("Agent output:", result.output);

  // Remove the tool when no longer needed
  console.log("\nUnregistering custom_lookup tool...");
  await agent.unregisterTool("custom_lookup");
  console.log("Tool unregistered.");

  await agent.dispose();
  console.log("Agent disposed.");

  return {
    passed: result.success,
    output: result.output,
    steps: result.metadata?.stepsCount ?? 0,
    tokens: result.metadata?.tokensUsed ?? 0,
    durationMs: Date.now() - start,
  };
}

// Run directly
if (import.meta.main) {
  run()
    .then((r) => {
      console.log("\n---");
      console.log(r.passed ? "PASSED" : "FAILED", `(${r.durationMs}ms)`);
    })
    .catch(console.error);
}
