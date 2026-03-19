/**
 * Example 05: Agent as Data (AgentConfig)
 *
 * Demonstrates JSON-serializable agent configuration:
 * - Extract config from a builder with `toConfig()`
 * - Serialize to JSON with `agentConfigToJSON()`
 * - Reconstruct a builder from JSON with `ReactiveAgents.fromJSON()`
 * - Reconstruct from a config object with `ReactiveAgents.fromConfig()`
 *
 * Usage:
 *   bun run apps/examples/src/foundations/05-agent-config.ts
 */

import {
  ReactiveAgents,
  agentConfigToJSON,
  agentConfigFromJSON,
  type AgentConfig,
} from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  // 1. Build an agent with various capabilities
  const builder = ReactiveAgents.create()
    .withName("research-assistant")
    .withProvider("test")
    .withModel("test-model")
    .withSystemPrompt("You are a helpful research assistant.")
    .withPersona({
      role: "Research Assistant",
      background: "Expert in scientific literature review",
      tone: "professional",
    })
    .withReasoning({ defaultStrategy: "reactive" })
    .withTools({ adaptive: true })
    .withMaxIterations(15);

  // 2. Extract config from builder state
  const config = builder.toConfig();
  console.log("Config name:", config.name);
  console.log("Config provider:", config.provider);
  console.log("Config model:", config.model);
  console.log("Config reasoning:", JSON.stringify(config.reasoning));
  console.log("Config persona:", JSON.stringify(config.persona));

  // 3. Serialize config to JSON string (portable, storable)
  const json = agentConfigToJSON(config);
  console.log("\nSerialized JSON length:", json.length, "bytes");

  // 4. Roundtrip: JSON → Config → verify fields preserved
  const parsed = agentConfigFromJSON(json);
  console.log("\nRoundtrip name:", parsed.name);
  console.log("Roundtrip provider:", parsed.provider);
  console.log("Roundtrip reasoning:", JSON.stringify(parsed.reasoning));

  // 5. Reconstruct builder from JSON and run an agent
  const restoredBuilder = await ReactiveAgents.fromJSON(json);
  const agent = await restoredBuilder
    .withTestScenario([{ text: "Research results from restored agent." }])
    .build();

  const result = await agent.run("Summarize recent AI research");
  console.log("\nRestored agent output:", result.output);
  await agent.dispose();

  // 6. Create from a minimal config object directly
  const minimalConfig: AgentConfig = {
    name: "minimal-agent",
    provider: "test",
  };
  const minimalBuilder = await ReactiveAgents.fromConfig(minimalConfig);
  const minimalAgent = await minimalBuilder
    .withTestScenario([{ text: "Minimal agent works." }])
    .build();
  const minimalResult = await minimalAgent.run("Hello");
  console.log("Minimal agent output:", minimalResult.output);
  await minimalAgent.dispose();

  const passed =
    config.name === "research-assistant" &&
    config.provider === "test" &&
    parsed.name === config.name &&
    result.output.includes("restored") &&
    minimalResult.output.includes("Minimal");

  return {
    passed,
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
