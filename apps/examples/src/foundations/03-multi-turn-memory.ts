/**
 * Example 03: Multi-Turn Conversational Agent
 *
 * Demonstrates:
 * - Running multiple sequential queries
 * - Memory persistence between turns (SQLite-backed)
 * - Using the Effect-based API (runEffect) for composition
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/foundations/03-multi-turn-memory.ts
 *
 * Or with test mode:
 *   bun run apps/examples/src/foundations/03-multi-turn-memory.ts
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

  console.log("=== Reactive Agents: Multi-Turn Conversation Example ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // ─── Build the agent ───

  let b = ReactiveAgents.create()
    .withName("conversational")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  const agent = await b
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
  let lastResult: Awaited<ReturnType<typeof agent.run>> | null = null;

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
    lastResult = result;
  }

  // ─── Summary ───

  console.log("─── Conversation Summary ───");
  console.log(`Turns: ${questions.length}`);
  console.log(`Total steps: ${totalSteps}`);
  console.log(`Total cost: $${totalCost.toFixed(6)}`);
  console.log(`\nDone.`);

  const passed = lastResult !== null && lastResult.success && lastResult.output.length > 10;
  return {
    passed,
    output: lastResult?.output ?? "",
    steps: totalSteps,
    tokens: lastResult?.metadata.tokensUsed ?? 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
