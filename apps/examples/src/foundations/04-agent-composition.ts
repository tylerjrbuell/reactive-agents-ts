/**
 * Example 05: Agent Composition (Agent-as-Tool)
 *
 * Demonstrates the agent-as-tool pattern:
 * - A "specialist" agent is registered as a tool on a "coordinator" agent
 * - The coordinator can delegate subtasks to the specialist
 * - Uses the builder's .withAgentTool() method
 *
 * Usage:
 *   bun run apps/examples/src/05-agent-composition.ts
 */

import { ReactiveAgents } from "@reactive-agents/runtime";

console.log("=== Reactive Agents: Agent Composition Example ===\n");

// ─── Step 1: Build a specialist agent ───

const researcher = await ReactiveAgents.create()
  .withName("researcher")
  .withProvider("test")
  .withTestResponses({
    "": "Based on my research, quantum computing uses qubits which can exist in superposition, enabling parallel computation of multiple states simultaneously.",
  })
  .withMaxIterations(3)
  .build();

console.log("Built researcher agent.\n");

// ─── Step 2: Build a coordinator that uses the researcher as a tool ───
// The .withAgentTool() method registers a local agent as a callable tool

const coordinator = await ReactiveAgents.create()
  .withName("coordinator")
  .withProvider("test")
  .withTestResponses({
    "": "I'll coordinate the research task. The researcher agent found that quantum computing uses qubits in superposition for parallel computation.",
  })
  .withAgentTool("research-delegate", {
    name: "researcher",
    description: "Delegates research tasks to a specialist researcher agent",
  })
  .withMaxIterations(3)
  .build();

console.log("Built coordinator agent with researcher as tool.\n");

// ─── Step 3: Run the coordinator ───

const question = "Explain quantum computing in simple terms";
console.log(`Task: "${question}"\n`);
console.log("Running coordinator (which can delegate to researcher)...\n");

const result = await coordinator.run(question);

// ─── Display results ───

console.log("--- Coordinator Result ---");
console.log(`Success: ${result.success}`);
console.log(`Output: ${result.output}`);
console.log(`Steps: ${result.metadata.stepsCount}`);
console.log("\nDone.");
