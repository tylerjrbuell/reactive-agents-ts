/**
 * Example 02: Lifecycle Hooks
 *
 * Demonstrates the ExecutionEngine's lifecycle hook system:
 * - Register before/after hooks on engine phases (full ExecutionContext)
 * - Register a per-turn `think` hook that sees each kernel turn's iteration and state
 * - Observe the agent loop's internal execution flow
 * - Modify execution context via hooks
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/foundations/02-lifecycle-hooks.ts
 *
 * Or with test mode:
 *   bun run apps/examples/src/foundations/02-lifecycle-hooks.ts
 */

import { Effect } from "effect";
import { ReactiveAgents } from "reactive-agents";
import type {
  EngineLifecycleHook,
  EngineLifecyclePhase,
  ExecutionContext,
  KernelTurnLifecycleHook,
  LifecycleHook,
} from "reactive-agents";

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

  console.log("=== Reactive Agents: Lifecycle Hooks Example ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // ─── Define hooks ───

  const phaseTimings: Array<{ phase: string; timing: string; timestamp: number }> = [];

  const recordEnginePhase = (phase: string, timing: "before" | "after", ctx: ExecutionContext): void => {
    const elapsed = Date.now() - ctx.startedAt.getTime();
    phaseTimings.push({ phase, timing, timestamp: elapsed });
    console.log(`  [${timing.toUpperCase().padEnd(6)}] Phase: ${phase.padEnd(16)} (${elapsed}ms)`);
  };

  // Engine phases fire once per run with the full ExecutionContext
  // (startedAt, metadata, toolResults, ...). Returning the context passes it
  // down the phase chain unchanged.
  const enginePhaseHook = (phase: EngineLifecyclePhase, timing: "before" | "after"): EngineLifecycleHook => ({
    phase,
    timing,
    handler: (ctx) => {
      recordEnginePhase(phase, timing, ctx);
      return Effect.succeed(ctx);
    },
  });

  // `think`, `act` and `observe` are per-turn phases: the reasoning kernel
  // fires them once per kernel turn with { phase, iteration, state }, and the
  // engine may also fire them with an ExecutionContext. Narrow with
  // `"metadata" in ctx` before reading engine-only fields.
  const thinkHook = (timing: "before" | "after"): KernelTurnLifecycleHook => ({
    phase: "think",
    timing,
    handler: (ctx) => {
      if ("metadata" in ctx) {
        recordEnginePhase("think", timing, ctx);
        return;
      }
      // Kernel firing: report each turn once, as it starts.
      if (timing === "before") {
        console.log(
          `      turn ${ctx.iteration}: ${ctx.state.steps.length} steps, ${ctx.state.tokens} tokens so far`,
        );
      }
    },
  });

  const enginePhases = ["bootstrap", "strategy-select", "memory-flush", "complete"] as const;
  const hooks: LifecycleHook[] = [
    ...enginePhases.flatMap((phase) => [enginePhaseHook(phase, "before"), enginePhaseHook(phase, "after")]),
    thinkHook("before"),
    thinkHook("after"),
  ];

  // ─── Build the agent with hooks ───

  let builder = ReactiveAgents.create()
    .withName("hooked-agent")
    .withProvider(provider);
  if (opts?.model) builder = builder.withModel(opts.model);
  if (provider === "test") {
    builder = builder.withTestScenario([
      { match: "Reactive Agents", text: "Reactive Agents is a TypeScript framework for building AI agents with Effect-TS. It features 10-phase execution, memory persistence, and lifecycle hooks." },
    ]);
  }
  builder = builder.withMaxIterations(3);

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

  for (const [phase, { start: phaseStart, end }] of phaseSummary) {
    const duration = end - phaseStart;
    const bar = "█".repeat(Math.max(1, Math.min(40, Math.round(duration / 5))));
    console.log(`  ${phase.padEnd(18)} ${bar} ${duration}ms`);
  }

  console.log(`\nDone.`);

  const passed = result.success && result.metadata.stepsCount >= 1;
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
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
