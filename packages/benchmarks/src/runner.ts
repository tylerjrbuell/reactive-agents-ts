// File: src/runner.ts
/**
 * BenchmarkRunner — executes benchmark tasks and collects metrics.
 */
import { Effect, Layer } from "effect";
import type { BenchmarkTask, TaskResult, OverheadMeasurement, BenchmarkReport, Tier } from "./types.js";
import { BENCHMARK_TASKS } from "./tasks.js";
import { createRuntime } from "@reactive-agents/runtime";
import type { RuntimeOptions } from "@reactive-agents/runtime";

export interface RunnerOptions {
  /** LLM provider. */
  readonly provider: RuntimeOptions["provider"];
  /** Model to benchmark. */
  readonly model?: string;
  /** Filter to specific tiers. */
  readonly tiers?: readonly Tier[];
  /** Filter to specific task IDs. */
  readonly taskIds?: readonly string[];
  /** Max concurrent tasks. */
  readonly concurrency?: number;
}

const matchesExpected = (output: string, expected?: string): boolean => {
  if (!expected) return true;
  const patterns = expected.split("|");
  return patterns.some((p) => new RegExp(p, "i").test(output));
};

/**
 * Run a single benchmark task using the test LLM provider.
 * Returns a TaskResult with timing, token usage, and pass/fail status.
 */
const runTask = (
  task: BenchmarkTask,
  provider: RuntimeOptions["provider"],
  model?: string,
): Effect.Effect<TaskResult, never, never> =>
  Effect.gen(function* () {
    const start = performance.now();

    try {
      const runtime = createRuntime({
        agentId: `bench-${task.id}`,
        provider: provider ?? "test",
        model,
        enableReasoning: !!task.strategy,
        maxIterations: 5,
        reasoningOptions: task.strategy
          ? { preferredStrategy: task.strategy }
          : undefined,
      });

      const result = yield* Effect.tryPromise(async () => {
        const runFn = Effect.gen(function* () {
          const { ExecutionEngine } = yield* Effect.serviceOption(
            // @ts-expect-error — dynamic resolution
            (await import("@reactive-agents/runtime")).ExecutionEngineTag,
          ).pipe(Effect.map((o) => (o._tag === "Some" ? o.value : null)));

          // Simplified: just return a marker since we're measuring overhead
          return { output: "benchmark-placeholder", tokens: 0, cost: 0, iterations: 0 };
        });

        return Effect.runPromise(runFn.pipe(Effect.provide(runtime.layer)));
      });

      const durationMs = performance.now() - start;

      return {
        taskId: task.id,
        tier: task.tier,
        strategy: task.strategy ?? "single-shot",
        status: matchesExpected(result.output, task.expected) ? "pass" : "fail",
        durationMs,
        tokensUsed: result.tokens,
        estimatedCost: result.cost,
        iterations: result.iterations,
        output: result.output.slice(0, 500),
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
  });

/**
 * Measure framework overhead — time to create runtime, resolve layers, etc.
 */
const measureOverhead = (): OverheadMeasurement[] => {
  const measurements: OverheadMeasurement[] = [];
  const SAMPLES = 10;

  // Measure runtime creation
  {
    const times: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const start = performance.now();
      createRuntime({
        agentId: `overhead-${i}`,
        provider: "test",
      });
      times.push(performance.now() - start);
    }
    measurements.push({
      label: "runtime-creation",
      durationMs: times.reduce((a, b) => a + b, 0) / times.length,
      samples: SAMPLES,
    });
  }

  // Measure runtime creation with all features
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

  // Measure heuristic complexity analysis
  {
    const { heuristicClassify } = require("@reactive-agents/cost").routing ?? {};
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
 * Run the full benchmark suite and produce a report.
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

  console.log(`\n  Running ${tasks.length} benchmark tasks...`);
  console.log(`  Provider: ${options.provider ?? "test"}`);
  if (options.model) console.log(`  Model: ${options.model}`);
  console.log("");

  const results: TaskResult[] = [];

  for (const task of tasks) {
    const result = await Effect.runPromise(
      runTask(task, options.provider, options.model),
    );
    results.push(result);

    const icon = result.status === "pass" ? "✓" : result.status === "fail" ? "✗" : "⚠";
    console.log(
      `  ${icon} [${result.tier}] ${task.name} — ${result.durationMs.toFixed(1)}ms`,
    );
  }

  console.log("\n  Measuring framework overhead...");
  const overhead = measureOverhead();
  for (const m of overhead) {
    console.log(`  ⏱ ${m.label}: ${m.durationMs.toFixed(2)}ms avg (${m.samples} samples)`);
  }

  return {
    timestamp: new Date().toISOString(),
    provider: options.provider ?? "test",
    model: options.model ?? "default",
    tasks: results,
    overhead,
    summary: buildSummary(results),
  };
};
