// File: src/runner.ts
/**
 * BenchmarkRunner — executes benchmark tasks against a real LLM and collects metrics.
 *
 * Each task calls `agent.run()` against the specified provider and model,
 * measuring real-world latency, token usage, cost, and correctness.
 */
import type { BenchmarkTask, TaskResult, OverheadMeasurement, BenchmarkReport, Tier } from "./types.js";
import { BENCHMARK_TASKS } from "./tasks.js";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { createRuntime } from "@reactive-agents/runtime";
import type { RuntimeOptions } from "@reactive-agents/runtime";

type ProviderName = NonNullable<RuntimeOptions["provider"]>;

export interface RunnerOptions {
  /** LLM provider to use for task execution. */
  readonly provider: ProviderName;
  /** Model to benchmark (uses provider default if omitted). */
  readonly model?: string;
  /** Filter to specific tiers. */
  readonly tiers?: readonly Tier[];
  /** Filter to specific task IDs. */
  readonly taskIds?: readonly string[];
  /** Max concurrent tasks (default: 1 — sequential for stable latency measurement). */
  readonly concurrency?: number;
  /** Per-task timeout in milliseconds (default: 120_000 — 2 minutes). */
  readonly timeoutMs?: number;
}

/** Default model per provider — cost-efficient but capable. */
const defaultModel: Partial<Record<ProviderName, string>> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2",
};

const matchesExpected = (output: string, expected?: string): boolean => {
  if (!expected) return true;
  const patterns = expected.split("|");
  return patterns.some((p) => {
    try {
      return new RegExp(p, "i").test(output);
    } catch {
      return output.toLowerCase().includes(p.toLowerCase());
    }
  });
};

/**
 * Run a single benchmark task against a real LLM.
 * Returns a TaskResult with real timing, token usage, cost, and pass/fail status.
 */
const runTask = async (
  task: BenchmarkTask,
  provider: ProviderName,
  model: string,
  timeoutMs: number,
): Promise<TaskResult> => {
  const start = performance.now();

  try {
    const builder = ReactiveAgents.create()
      .withName(`bench-${task.id}`)
      .withProvider(provider)
      .withModel(model)
      .withMaxIterations(task.strategy ? 5 : 2);

    if (task.strategy) {
      const strategyMap = {
        "react": "reactive" as const,
        "plan-execute": "plan-execute-reflect" as const,
        "tree-of-thought": "tree-of-thought" as const,
      };
      builder.withReasoning({ defaultStrategy: strategyMap[task.strategy] });
    }

    const agent = await builder.build();

    let agentResult: Awaited<ReturnType<typeof agent.run>>;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs),
      );
      agentResult = await Promise.race([agent.run(task.prompt), timeoutPromise]);
    } finally {
      await agent.dispose();
    }

    const durationMs = performance.now() - start;
    const passed = matchesExpected(agentResult.output, task.expected);

    return {
      taskId: task.id,
      tier: task.tier,
      strategy: task.strategy ?? "single-shot",
      status: passed ? "pass" : "fail",
      durationMs,
      tokensUsed: agentResult.metadata.tokensUsed,
      estimatedCost: agentResult.metadata.cost,
      iterations: agentResult.metadata.stepsCount,
      output: agentResult.output.slice(0, 1000),
    } satisfies TaskResult;
  } catch (e) {
    return {
      taskId: task.id,
      tier: task.tier,
      strategy: task.strategy ?? "single-shot",
      status: "error" as const,
      durationMs: performance.now() - start,
      tokensUsed: 0,
      estimatedCost: 0,
      iterations: 0,
      output: "",
      error: e instanceof Error ? e.message : String(e),
    } satisfies TaskResult;
  }
};

/**
 * Measure framework overhead — time to create runtime and resolve Effect layers.
 * Uses the test provider to isolate pure framework startup cost.
 */
const measureOverhead = (): OverheadMeasurement[] => {
  const measurements: OverheadMeasurement[] = [];
  const SAMPLES = 10;

  // Measure minimal runtime creation
  {
    const times: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const start = performance.now();
      createRuntime({ agentId: `overhead-${i}`, provider: "test" });
      times.push(performance.now() - start);
    }
    measurements.push({
      label: "runtime-creation",
      durationMs: times.reduce((a, b) => a + b, 0) / times.length,
      samples: SAMPLES,
    });
  }

  // Measure full feature runtime creation
  {
    const times: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const start = performance.now();
      createRuntime({
        agentId: `overhead-full-${i}`,
        provider: "test",
        enableReasoning: true,
        enableCostTracking: true,
        enableObservability: true,
        memoryTier: "1",
      });
      times.push(performance.now() - start);
    }
    measurements.push({
      label: "runtime-creation-full",
      durationMs: times.reduce((a, b) => a + b, 0) / times.length,
      samples: SAMPLES,
    });
  }

  // Measure heuristic complexity classification
  {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const costModule = require("@reactive-agents/cost");
      const heuristicClassify = costModule?.heuristicClassify;
      if (typeof heuristicClassify === "function") {
        const times: number[] = [];
        for (let i = 0; i < SAMPLES * 10; i++) {
          const start = performance.now();
          heuristicClassify("Analyze this complex multi-step code with ```typescript\nconst x = 1;\n```");
          times.push(performance.now() - start);
        }
        measurements.push({
          label: "complexity-classification",
          durationMs: times.reduce((a, b) => a + b, 0) / times.length,
          samples: SAMPLES * 10,
        });
      }
    } catch {
      // cost package not available; skip
    }
  }

  return measurements;
};

/**
 * Build summary statistics from task results.
 */
const buildSummary = (tasks: TaskResult[]): BenchmarkReport["summary"] => {
  const passed = tasks.filter((t) => t.status === "pass").length;
  const failed = tasks.filter((t) => t.status === "fail").length;
  const errors = tasks.filter((t) => t.status === "error").length;
  const totalMs = tasks.reduce((a, t) => a + t.durationMs, 0);

  const tiers: Tier[] = ["trivial", "simple", "moderate", "complex", "expert"];
  const byTier = Object.fromEntries(
    tiers.map((tier) => {
      const tierTasks = tasks.filter((t) => t.tier === tier);
      return [
        tier,
        {
          passed: tierTasks.filter((t) => t.status === "pass").length,
          total: tierTasks.length,
          avgMs: tierTasks.length > 0
            ? tierTasks.reduce((a, t) => a + t.durationMs, 0) / tierTasks.length
            : 0,
        },
      ];
    }),
  ) as Record<Tier, { passed: number; total: number; avgMs: number }>;

  return {
    totalTasks: tasks.length,
    passed,
    failed,
    errors,
    totalDurationMs: totalMs,
    totalTokens: tasks.reduce((a, t) => a + t.tokensUsed, 0),
    totalCost: tasks.reduce((a, t) => a + t.estimatedCost, 0),
    avgLatencyMs: tasks.length > 0 ? totalMs / tasks.length : 0,
    byTier,
  };
};

/**
 * Run the full benchmark suite against a real LLM provider and produce a report.
 */
export const runBenchmarks = async (
  options: RunnerOptions,
): Promise<BenchmarkReport> => {
  let tasks = [...BENCHMARK_TASKS];

  if (options.tiers?.length) {
    tasks = tasks.filter((t) => options.tiers!.includes(t.tier));
  }
  if (options.taskIds?.length) {
    tasks = tasks.filter((t) => options.taskIds!.includes(t.id));
  }

  const resolvedModel = options.model ?? defaultModel[options.provider] ?? "default";
  const timeoutMs = options.timeoutMs ?? 120_000;

  console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
  console.log(`  ║   Reactive Agents Benchmark Suite                    ║`);
  console.log(`  ╠══════════════════════════════════════════════════════╣`);
  console.log(`  ║  Provider : ${options.provider.padEnd(40)}║`);
  console.log(`  ║  Model    : ${resolvedModel.padEnd(40)}║`);
  console.log(`  ║  Tasks    : ${String(tasks.length).padEnd(40)}║`);
  console.log(`  ║  Timeout  : ${String(timeoutMs / 1000 + "s").padEnd(40)}║`);
  console.log(`  ╚══════════════════════════════════════════════════════╝\n`);

  if (options.provider === "test") {
    console.log(`  ⚠  WARNING: Using 'test' provider — no real LLM calls will be made.`);
    console.log(`  ⚠  For real-world results, use: --provider anthropic --model claude-haiku-4-5\n`);
  }

  const results: TaskResult[] = [];

  for (const task of tasks) {
    process.stdout.write(`  ⊙ [${task.tier.padEnd(8)}] ${task.name.padEnd(50)} `);
    const result = await runTask(task, options.provider, resolvedModel, timeoutMs);
    results.push(result);

    const icon = result.status === "pass" ? "✓" : result.status === "fail" ? "✗" : "⚠";
    const latency = result.durationMs >= 1000
      ? `${(result.durationMs / 1000).toFixed(1)}s`
      : `${result.durationMs.toFixed(0)}ms`;
    const tokenInfo = result.tokensUsed > 0 ? ` · ${result.tokensUsed} tok` : "";
    console.log(`${icon} ${latency}${tokenInfo}`);

    if (result.status === "error") {
      console.log(`    ↳ Error: ${result.error?.slice(0, 100)}`);
    } else if (result.status === "fail") {
      console.log(`    ↳ Expected pattern not found in output`);
    }
  }

  console.log("\n  Measuring framework overhead (test provider)...");
  const overhead = measureOverhead();
  for (const m of overhead) {
    console.log(`  ⏱  ${m.label.padEnd(32)}: ${m.durationMs.toFixed(3)}ms avg (${m.samples} samples)`);
  }

  const summary = buildSummary(results);
  const passRate = Math.round((summary.passed / summary.totalTasks) * 100);

  console.log(`\n  ┌─────────────────────────────────────────────────────┐`);
  console.log(`  │  Results                                             │`);
  console.log(`  ├─────────────────────────────────────────────────────┤`);
  console.log(`  │  Pass rate : ${(String(summary.passed) + "/" + String(summary.totalTasks) + " (" + passRate + "%)").padEnd(39)}│`);
  console.log(`  │  Duration  : ${(summary.totalDurationMs >= 1000 ? (summary.totalDurationMs / 1000).toFixed(1) + "s total, " + (summary.avgLatencyMs / 1000).toFixed(1) + "s avg" : summary.totalDurationMs.toFixed(0) + "ms total").padEnd(39)}│`);
  console.log(`  │  Tokens    : ${String(summary.totalTokens.toLocaleString()).padEnd(39)}│`);
  console.log(`  │  Cost      : $${String(summary.totalCost.toFixed(4)).padEnd(38)}│`);
  console.log(`  └─────────────────────────────────────────────────────┘\n`);

  return {
    timestamp: new Date().toISOString(),
    provider: options.provider,
    model: resolvedModel,
    tasks: results,
    overhead,
    summary,
  };
};


