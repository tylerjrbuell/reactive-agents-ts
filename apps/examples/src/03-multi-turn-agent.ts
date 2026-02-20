/**
 * Example 03: Multi-Turn Conversational Agent
 *
 * Demonstrates:
 * - Running multiple sequential queries
 * - Memory persistence between turns (SQLite-backed)
 * - Using the Effect-based API (runEffect) for composition
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/03-multi-turn-agent.ts
 *
 * Or with test mode:
 *   bun run apps/examples/src/03-multi-turn-agent.ts
 */

import { ReactiveAgents } from "@reactive-agents/runtime";

const useRealLLM = Boolean(process.env.ANTHROPIC_API_KEY);

console.log("=== Reactive Agents: Multi-Turn Conversation Example ===\n");
console.log(`Mode: ${useRealLLM ? "LIVE (Anthropic)" : "TEST (deterministic)"}\n`);

// ─── Build the agent ───

const agent = await ReactiveAgents.create()
  .withName("conversational")
  .withProvider(useRealLLM ? "anthropic" : "test")
  .withTestResponses({
    "complement each other": "TypeScript provides the type system foundation, while Effect-TS builds on it to add runtime safety guarantees. Together, they enable fully type-safe applications with managed side effects, structured error handling, and automatic dependency injection.",
    "Effect-TS": "Effect-TS is a powerful TypeScript library for building robust, type-safe applications. It provides algebraic effects, dependency injection via Context/Layer, structured errors, and composable concurrency primitives.",
    "TypeScript": "TypeScript is a strongly-typed superset of JavaScript developed by Microsoft. It adds static types, interfaces, and compilation to JavaScript, making it easier to build and maintain large applications.",
  })
  .withMemory("1")
  .withMaxIterations(3)
  .build();

console.log(`Agent ID: ${agent.agentId}\n`);

// ─── Conversation turns ───

const questions = [
  "What is TypeScript and why is it useful?",
  "What is Effect-TS and what problems does it solve?",
  "How do TypeScript and Effect-TS compare and complement each other?",
];

let totalCost = 0;
let totalSteps = 0;

for (let i = 0; i < questions.length; i++) {
  const q = questions[i]!;
  console.log(`─── Turn ${i + 1} ───`);
  console.log(`Q: ${q}\n`);

  const startTime = Date.now();
  const result = await agent.run(q);
  const elapsed = Date.now() - startTime;

  console.log(`A: ${result.output.slice(0, 300)}${result.output.length > 300 ? "..." : ""}`);
  console.log(`   [${elapsed}ms | ${result.metadata.stepsCount} steps | $${result.metadata.cost.toFixed(6)}]\n`);

  totalCost += result.metadata.cost;
  totalSteps += result.metadata.stepsCount;
}

// ─── Summary ───

console.log("─── Conversation Summary ───");
console.log(`Turns: ${questions.length}`);
console.log(`Total steps: ${totalSteps}`);
console.log(`Total cost: $${totalCost.toFixed(6)}`);
console.log(`\nDone.`);
