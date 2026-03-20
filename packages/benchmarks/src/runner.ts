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
      .withMaxIterations(task.strategy ? 30 : 5);

    if (task.strategy) {
      const strategyMap = {
        "react": "reactive" as const,
        "plan-execute": "plan-execute-reflect" as const,
        "tree-of-thought": "tree-of-thought" as const,
      };
      builder.withReasoning({ defaultStrategy: strategyMap[task.strategy] });
    }

    if (task.requiresTools) {
      builder.withTools();
    }

    if (task.requiresGuardrails) {
      builder.withGuardrails();
    }

    const agent = await builder.build();

    let agentResult: Awaited<ReturnType<typeof agent.run>>;
    let cumulativeTokens = 0;
    let cumulativeCost = 0;
    let iterations = 0;

    // Listen for progress to capture tokens/cost even on timeout
    const unsub = await agent.subscribe((event) => {
      if (event._tag === "LLMRequestCompleted") {
        cumulativeTokens += event.tokensUsed;
        cumulativeCost += event.estimatedCost;
      }
      if (event._tag === "ReasoningStepCompleted") {
        iterations++;
      }
    });

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Task timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      );
      agentResult = await Promise.race([agent.run(task.prompt), timeoutPromise]);
    } catch (error) {
      const durationMs = performance.now() - start;
      await agent.dispose();
      unsub();
      return {
        taskId: task.id,
        tier: task.tier,
        strategy: task.strategy ?? "single-shot",
        status: "fail",
        durationMs,
        tokensUsed: cumulativeTokens,
        estimatedCost: cumulativeCost,
        iterations,
        output: error instanceof Error ? `Error: ${error.message}` : String(error),
      } satisfies TaskResult;
    } finally {
      unsub();
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
      tokensUsed: agentResult.metadata.tokensUsed || cumulativeTokens,
      estimatedCost: agentResult.metadata.cost || cumulativeCost,
      iterations: agentResult.metadata.stepsCount || iterations,
      output: agentResult.output.slice(0, 1000),
    } satisfies TaskResult;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    // If the task specifically expects an error (like a guardrail block), consider it a pass if the message matches
    const isExpectedError = task.expected && matchesExpected(errorMessage, task.expected);

    return {
      taskId: task.id,
      tier: task.tier,
      strategy: task.strategy ?? "single-shot",
      status: isExpectedError ? "pass" : "error",
      durationMs: performance.now() - start,
      tokensUsed: 0,
      estimatedCost: 0,
      iterations: 0,
      output: isExpectedError ? errorMessage : "",
      error: isExpectedError ? undefined : errorMessage,
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
  const timeoutMs = options.timeoutMs ?? 300_000;

  // ── ANSI color codes (violet #8b5cf6, cyan #06b6d4, brand palette) ──
  const V = "\x1b[38;2;139;92;246m";  // Violet
  const C = "\x1b[38;2;6;182;212m";   // Cyan
  const G = "\x1b[38;2;74;222;128m";  // Green (pass)
  const R = "\x1b[38;2;248;113;113m"; // Red (fail)
  const Y = "\x1b[38;2;250;204;21m";  // Yellow (warn)
  const D = "\x1b[2m";                // Dim
  const B = "\x1b[1m";                // Bold
  const X = "\x1b[0m";                // Reset

  console.log(`\n  ${V}╔══════════════════════════════════════════════════════╗${X}`);
  console.log(`  ${V}║${X}   ${B}${C}Reactive Agents${X} ${D}Benchmark Suite${X}                    ${V}║${X}`);
  console.log(`  ${V}╠══════════════════════════════════════════════════════╣${X}`);
  console.log(`  ${V}║${X}  ${D}Provider${X} ${C}${options.provider.padEnd(42)}${X}${V}║${X}`);
  console.log(`  ${V}║${X}  ${D}Model${X}    ${C}${resolvedModel.padEnd(42)}${X}${V}║${X}`);
  console.log(`  ${V}║${X}  ${D}Tasks${X}    ${C}${String(tasks.length).padEnd(42)}${X}${V}║${X}`);
  console.log(`  ${V}║${X}  ${D}Timeout${X}  ${C}${String(timeoutMs / 1000 + "s").padEnd(42)}${X}${V}║${X}`);
  console.log(`  ${V}╚══════════════════════════════════════════════════════╝${X}\n`);

  if (options.provider === "test") {
    console.log(`  ${Y}!${X}  ${D}Using 'test' provider — no real LLM calls will be made.${X}`);
    console.log(`  ${Y}!${X}  ${D}For real-world results, use: --provider anthropic --model claude-haiku-4-5${X}\n`);
  }

  const results: TaskResult[] = [];

  // Tier color mapping
  const tierColor = (tier: string) => {
    switch (tier) {
      case "trivial": return D;
      case "simple": return C;
      case "moderate": return V;
      case "complex": return Y;
      case "expert": return R;
      default: return X;
    }
  };

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const progress = `${D}[${i + 1}/${tasks.length}]${X}`;
    const tier = `${tierColor(task.tier)}${task.tier.padEnd(8)}${X}`;

    process.stdout.write(`  ${progress} ${V}●${X} ${tier} ${task.name.padEnd(50)} `);
    const result = await runTask(task, options.provider, resolvedModel, timeoutMs);
    results.push(result);

    const statusIcon =
      result.status === "pass" ? `${G}✓${X}` :
      result.status === "fail" ? `${R}✗${X}` : `${Y}⚠${X}`;
    const latency = result.durationMs >= 1000
      ? `${(result.durationMs / 1000).toFixed(1)}s`
      : `${result.durationMs.toFixed(0)}ms`;
    const tokenInfo = result.tokensUsed > 0 ? ` ${D}·${X} ${C}${result.tokensUsed}${X}${D} tok${X}` : "";
    console.log(`${statusIcon} ${D}${latency}${X}${tokenInfo}`);

    if (result.status === "error") {
      console.log(`      ${R}↳${X} ${D}${result.error?.slice(0, 100)}${X}`);
    } else if (result.status === "fail") {
      console.log(`      ${Y}↳${X} ${D}Expected pattern not found in output${X}`);
    }
  }

  console.log(`\n  ${G}✨${X} ${B}All ${tasks.length} tasks completed.${X}`);

  console.log(`\n  ${D}Measuring framework overhead...${X}`);
  const overhead = measureOverhead();
  for (const m of overhead) {
    console.log(`  ${C}⏱${X}  ${m.label.padEnd(32)} ${D}${m.durationMs.toFixed(3)}ms avg (${m.samples} samples)${X}`);
  }

  const summary = buildSummary(results);
  const passRate = Math.round((summary.passed / summary.totalTasks) * 100);
  const passColor = passRate >= 80 ? G : passRate >= 50 ? Y : R;

  // ── Progress bar ──
  const barWidth = 30;
  const filledWidth = Math.round((summary.passed / summary.totalTasks) * barWidth);
  const bar = `${G}${"█".repeat(filledWidth)}${X}${D}${"░".repeat(barWidth - filledWidth)}${X}`;

  console.log(`\n  ${V}┌─────────────────────────────────────────────────────┐${X}`);
  console.log(`  ${V}│${X}  ${B}${C}Results${X}                                             ${V}│${X}`);
  console.log(`  ${V}├─────────────────────────────────────────────────────┤${X}`);
  console.log(`  ${V}│${X}  ${bar} ${passColor}${B}${summary.passed}/${summary.totalTasks}${X} ${D}(${passRate}%)${X}   ${V}│${X}`);
  console.log(`  ${V}│${X}                                                     ${V}│${X}`);

  const durationStr = summary.totalDurationMs >= 1000
    ? `${(summary.totalDurationMs / 1000).toFixed(1)}s total, ${(summary.avgLatencyMs / 1000).toFixed(1)}s avg`
    : `${summary.totalDurationMs.toFixed(0)}ms total`;
  console.log(`  ${V}│${X}  ${D}Duration${X}  ${C}${durationStr.padEnd(40)}${X} ${V}│${X}`);
  console.log(`  ${V}│${X}  ${D}Tokens${X}    ${C}${String(summary.totalTokens.toLocaleString()).padEnd(40)}${X} ${V}│${X}`);
  console.log(`  ${V}│${X}  ${D}Cost${X}      ${C}${"$" + summary.totalCost.toFixed(4)}${X}${" ".repeat(Math.max(0, 39 - ("$" + summary.totalCost.toFixed(4)).length))} ${V}│${X}`);
  console.log(`  ${V}└─────────────────────────────────────────────────────┘${X}\n`);

  // ── Per-tier breakdown ──
  const tiers: Tier[] = ["trivial", "simple", "moderate", "complex", "expert"];
  console.log(`  ${D}Per-tier breakdown:${X}`);
  for (const tier of tiers) {
    const tierData = summary.byTier[tier];
    if (tierData.total === 0) continue;
    const pct = Math.round((tierData.passed / tierData.total) * 100);
    const avgStr = tierData.avgMs >= 1000 ? `${(tierData.avgMs / 1000).toFixed(1)}s` : `${tierData.avgMs.toFixed(0)}ms`;
    const pctColor = pct >= 80 ? G : pct >= 50 ? Y : R;
    console.log(`  ${tierColor(tier)}  ${tier.padEnd(10)}${X} ${pctColor}${tierData.passed}/${tierData.total}${X} ${D}(${pct}%)${X}  ${D}avg ${avgStr}${X}`);
  }

  return {
    timestamp: new Date().toISOString(),
    provider: options.provider,
    model: resolvedModel,
    tasks: results,
    overhead,
    summary,
  };
};


