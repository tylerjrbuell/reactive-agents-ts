/**
 * Example 02: Lifecycle Hooks
 *
 * Demonstrates the ExecutionEngine's lifecycle hook system:
 * - Register before/after hooks on specific phases
 * - Observe the agent loop's internal execution flow
 * - Modify execution context via hooks
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/02-lifecycle-hooks.ts
 *
 * Or with test mode:
 *   bun run apps/examples/src/02-lifecycle-hooks.ts
 */

import { Effect } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import type { LifecycleHook, ExecutionContext } from "@reactive-agents/runtime";

const useRealLLM = Boolean(process.env.ANTHROPIC_API_KEY);

console.log("=== Reactive Agents: Lifecycle Hooks Example ===\n");
console.log(`Mode: ${useRealLLM ? "LIVE (Anthropic)" : "TEST (deterministic)"}\n`);

// ─── Define hooks ───

const phaseTimings: Array<{ phase: string; timing: string; timestamp: number }> = [];

const logPhaseHook = (
  phase: string,
  timing: "before" | "after",
): LifecycleHook => ({
  phase: phase as any,
  timing,
  handler: (ctx: ExecutionContext) => {
    const elapsed = Date.now() - ctx.startedAt.getTime();
    phaseTimings.push({ phase, timing, timestamp: elapsed });
    console.log(`  [${timing.toUpperCase().padEnd(6)}] Phase: ${phase.padEnd(16)} (${elapsed}ms)`);
    return Effect.succeed(ctx);
  },
});

// Track all major phases
const phases = ["bootstrap", "strategy-select", "think", "memory-flush", "complete"] as const;
const hooks = phases.flatMap((phase) => [
  logPhaseHook(phase, "before"),
  logPhaseHook(phase, "after"),
]);

// ─── Build the agent with hooks ───

let builder = ReactiveAgents.create()
  .withName("hooked-agent")
  .withProvider(useRealLLM ? "anthropic" : "test")
  .withTestResponses({
    "": "Reactive Agents is a TypeScript framework for building AI agents with Effect-TS. It features 10-phase execution, memory persistence, and lifecycle hooks.",
  })
  .withMaxIterations(3);

for (const hook of hooks) {
  builder = builder.withHook(hook);
}

const agent = await builder.build();

console.log(`Agent ID: ${agent.agentId}\n`);
console.log("Execution trace:\n");

// ─── Run a query ───

const result = await agent.run("Explain what Reactive Agents is in one paragraph.");

console.log(`\n─── Result ───`);
console.log(`Success: ${result.success}`);
console.log(`Output: ${result.output.slice(0, 200)}${result.output.length > 200 ? "..." : ""}`);

console.log(`\n─── Phase Timeline ───`);
const phaseSummary = new Map<string, { start: number; end: number }>();
for (const entry of phaseTimings) {
  if (entry.timing === "before") {
    phaseSummary.set(entry.phase, { start: entry.timestamp, end: entry.timestamp });
  } else {
    const existing = phaseSummary.get(entry.phase);
    if (existing) {
      existing.end = entry.timestamp;
    }
  }
}

for (const [phase, { start, end }] of phaseSummary) {
  const duration = end - start;
  const bar = "█".repeat(Math.max(1, Math.min(40, Math.round(duration / 5))));
  console.log(`  ${phase.padEnd(18)} ${bar} ${duration}ms`);
}

console.log(`\nDone.`);
