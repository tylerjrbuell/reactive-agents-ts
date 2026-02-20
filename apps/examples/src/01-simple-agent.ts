/**
 * Example 01: Simple Agent
 *
 * Demonstrates the most basic usage of Reactive Agents:
 * - Create an agent with ReactiveAgents.create()
 * - Run a single query
 * - Inspect the result
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/01-simple-agent.ts
 *
 * Or with test mode (no API key needed):
 *   bun run apps/examples/src/01-simple-agent.ts
 */

import { ReactiveAgents } from "@reactive-agents/runtime";

const useRealLLM = Boolean(process.env.ANTHROPIC_API_KEY);

console.log("=== Reactive Agents: Simple Agent Example ===\n");
console.log(`Mode: ${useRealLLM ? "LIVE (Anthropic)" : "TEST (deterministic)"}\n`);

// ─── Build the agent ───

const agent = await ReactiveAgents.create()
  .withName("simple-qa")
  .withProvider(useRealLLM ? "anthropic" : "test")
  .withTestResponses({
    // Test responses used only in test mode
    "": "The capital of France is Paris. It has been the capital since the 10th century and is known for landmarks like the Eiffel Tower, the Louvre, and Notre-Dame Cathedral.",
  })
  .withMaxIterations(3)
  .build();

console.log(`Agent ID: ${agent.agentId}\n`);

// ─── Run a query ───

const question = "What is the capital of France and what is it known for?";
console.log(`Question: ${question}\n`);
console.log("Running...\n");

const startTime = Date.now();
const result = await agent.run(question);
const elapsed = Date.now() - startTime;

// ─── Display results ───

console.log("─── Result ───");
console.log(`Success: ${result.success}`);
console.log(`Output: ${result.output}`);
console.log(`\n─── Metadata ───`);
console.log(`Duration: ${elapsed}ms`);
console.log(`Steps: ${result.metadata.stepsCount}`);
console.log(`Strategy: ${result.metadata.strategyUsed ?? "default"}`);
console.log(`Cost: $${result.metadata.cost.toFixed(6)}`);
console.log(`Task ID: ${result.taskId}`);
console.log(`\nDone.`);
