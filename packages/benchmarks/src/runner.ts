// File: src/runner.ts
/**
 * BenchmarkRunner — executes benchmark tasks against a real LLM and collects metrics.
 *
 * Each task calls `agent.run()` against the specified provider and model,
 * measuring real-world latency, token usage, cost, and correctness.
 */
import type { BenchmarkTask, TaskResult, OverheadMeasurement, BenchmarkReport, Tier } from "./types.js";
import { BENCHMARK_TASKS } from "./task-registry.js";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { createRuntime } from "@reactive-agents/runtime";
import type { RuntimeOptions } from "@reactive-agents/runtime";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import type {
  BenchmarkSession, HarnessVariant, ModelVariant,
  TaskVariantReport, AblationResult, SessionReport, RunScore,
  DimensionScore, QualityDimension, HarnessConfig, TaskRunResult,
} from "./types.js"
import { REAL_WORLD_TASKS } from "./tasks/real-world.js"
import { COMPETITOR_RUNNERS } from "./competitors/index.js"
import { resolveTasks, mergeConfigs } from "./session.js"
import { scoreTask, computeReliability } from "./judge.js"

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
  /** Log level: "silent" = no output; "progress" = progress bar & results only; "verbose" = all agent details (default: "progress"). */
  readonly logLevel?: "silent" | "progress" | "verbose";
}

/** Default model per provider — cost-efficient but capable. */
const defaultModel: Partial<Record<ProviderName, string>> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
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
  logLevel: "silent" | "progress" | "verbose",
): Promise<TaskResult> => {
  const start = performance.now();

  try {
    const maxIter = task.maxIterations ?? (task.strategy ? 15 : 5);
    const builder = ReactiveAgents.create()
      .withName(`bench-${task.id}`)
      .withProvider(provider)
      .withModel(model)
      .withMaxIterations(maxIter);

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

    if (task.requiresDynamicSubAgents) {
      builder.withDynamicSubAgents({ maxIterations: 8 });
    }

    if (task.requiresGuardrails) {
      builder.withGuardrails();
    }

    // Suppress build-validation console.log (provider/model/key info)
    const _log = console.log;
    console.log = () => {};
    const agent = await builder.build();
    console.log = _log;

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
      // Suppress agent output in silent and progress modes; show everything in verbose
      let agentResult2: Awaited<ReturnType<typeof agent.run>> | undefined;
      if (logLevel !== "verbose") {
        // Suppress console and stdout in both silent and progress modes
        const consoleLog = console.log;
        const consoleError = console.error;
        const consoleWarn = console.warn;
        const consoleInfo = console.info;
        const consoleDebug = console.debug;
        const stdoutWrite = process.stdout.write.bind(process.stdout);

        console.log = console.error = console.warn = console.info = console.debug = () => {};
        process.stdout.write = (() => true) as any;

        try {
          agentResult2 = await Promise.race([agent.run(task.prompt), timeoutPromise]);
        } finally {
          console.log = consoleLog;
          console.error = consoleError;
          console.warn = consoleWarn;
          console.info = consoleInfo;
          console.debug = consoleDebug;
          process.stdout.write = stdoutWrite;
        }
      } else {
        // In verbose mode, allow agent to run with full output
        agentResult2 = await Promise.race([agent.run(task.prompt), timeoutPromise]);
      }
      agentResult = agentResult2;
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
  const logLevel = options.logLevel ?? "progress";

  // Control cortex logging based on log level
  const prevCortexLog = process.env.CORTEX_LOG;
  if (logLevel === "silent") {
    process.env.CORTEX_LOG = "off";
  } else if (logLevel === "progress") {
    process.env.CORTEX_LOG = "error";  // Only show errors, suppress info/debug
  }
  // For "verbose", leave CORTEX_LOG unchanged (use default or user setting)

  const log = (...args: any[]) => {
    if (logLevel !== "silent") {
      console.log(...args);
    }
  };

  // ── ANSI color codes (violet #8b5cf6, cyan #06b6d4, brand palette) ──
  const V = "\x1b[38;2;139;92;246m";  // Violet
  const C = "\x1b[38;2;6;182;212m";   // Cyan
  const G = "\x1b[38;2;74;222;128m";  // Green (pass)
  const R = "\x1b[38;2;248;113;113m"; // Red (fail)
  const Y = "\x1b[38;2;250;204;21m";  // Yellow (warn)
  const D = "\x1b[2m";                // Dim
  const B = "\x1b[1m";                // Bold
  const X = "\x1b[0m";                // Reset

  log(`\n  ${V}╔══════════════════════════════════════════════════════╗${X}`);
  log(`  ${V}║${X}   ${B}${C}Reactive Agents${X} ${D}Benchmark Suite${X}                    ${V}║${X}`);
  log(`  ${V}╠══════════════════════════════════════════════════════╣${X}`);
  log(`  ${V}║${X}  ${D}Provider${X} ${C}${options.provider.padEnd(42)}${X}${V}║${X}`);
  log(`  ${V}║${X}  ${D}Model${X}    ${C}${resolvedModel.padEnd(42)}${X}${V}║${X}`);
  log(`  ${V}║${X}  ${D}Tasks${X}    ${C}${String(tasks.length).padEnd(42)}${X}${V}║${X}`);
  log(`  ${V}║${X}  ${D}Timeout${X}  ${C}${String(timeoutMs / 1000 + "s").padEnd(42)}${X}${V}║${X}`);
  log(`  ${V}╚══════════════════════════════════════════════════════╝${X}\n`);

  if (options.provider === "test") {
    log(`  ${Y}!${X}  ${D}Using 'test' provider — no real LLM calls will be made.${X}`);
    log(`  ${Y}!${X}  ${D}For real-world results, use: --provider anthropic --model claude-haiku-4-5${X}\n`);
  }

  const results: TaskResult[] = [];
  let passCount = 0;
  let failCount = 0;
  let errorCount = 0;

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

  // ── Progress bar helpers ──
  const cols = process.stdout.columns || 80;
  const barW = Math.min(30, cols - 50);  // leave room for stats
  const suiteStart = performance.now();

  const progressLine = (done: number, total: number, label?: string) => {
    const pct = Math.round((done / total) * 100);
    const filled = Math.round((done / total) * barW);
    const bar = `${G}${"━".repeat(filled)}${X}${D}${"─".repeat(barW - filled)}${X}`;
    const elapsed = ((performance.now() - suiteStart) / 1000).toFixed(0);
    const counts = [
      passCount > 0 ? `${G}${passCount}✓${X}` : null,
      failCount > 0 ? `${R}${failCount}✗${X}` : null,
      errorCount > 0 ? `${Y}${errorCount}⚠${X}` : null,
    ].filter(Boolean).join(` `);
    return `  ${bar} ${B}${pct}%${X} ${D}(${done}/${total} · ${elapsed}s)${X} ${counts}`;
  };

  // Strip ANSI codes to get visible character count
  const visLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

  // Write a progress line that gets overwritten by the next write
  const writeProgress = (done: number, total: number, label?: string) => {
    if (logLevel === "silent") return;
    // Show progress in both "progress" and "verbose" modes
    const base = progressLine(done, total);
    const baseLen = visLen(base);
    // Truncate task label to prevent line wrapping
    let line = base;
    if (label && baseLen + 4 + label.length < cols) {
      line += `  ${V}▸${X} ${D}${label}${X}`;
    } else if (label) {
      const maxLabel = cols - baseLen - 5;
      if (maxLabel > 3) line += `  ${V}▸${X} ${D}${label.slice(0, maxLabel)}${X}`;
    }
    process.stdout.write(`\x1b[2K\r${line}`);
  };

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    writeProgress(i, tasks.length, `${task.tier} · ${task.name}`);

    const result = await runTask(task, options.provider, resolvedModel, timeoutMs, logLevel);
    results.push(result);

    if (result.status === "pass") passCount++;
    else if (result.status === "fail") failCount++;
    else errorCount++;

    const statusIcon =
      result.status === "pass" ? `${G}✓${X}` :
      result.status === "fail" ? `${R}✗${X}` : `${Y}⚠${X}`;
    const latency = result.durationMs >= 1000
      ? `${(result.durationMs / 1000).toFixed(1)}s`
      : `${result.durationMs.toFixed(0)}ms`;
    const tokenInfo = result.tokensUsed > 0 ? ` ${D}·${X} ${C}${result.tokensUsed}${X}${D} tok${X}` : "";
    const tier = `${tierColor(task.tier)}${task.tier.padEnd(8)}${X}`;

    // Clear progress line, print result
    if (logLevel !== "silent") {
      process.stdout.write(`\x1b[2K\r`);
      log(`  ${statusIcon} ${tier} ${task.name.padEnd(48)} ${D}${latency}${X}${tokenInfo}`);
      if (result.status === "error") {
        log(`    ${R}↳${X} ${D}${result.error?.slice(0, 100)}${X}`);
      } else if (result.status === "fail") {
        log(`    ${Y}↳${X} ${D}Expected pattern not found in output${X}`);
      }
    }
  }

  // Final completed progress bar
  log(`\n${progressLine(tasks.length, tasks.length)}`);
  log(`  ${G}✨${X} ${B}All ${tasks.length} tasks completed in ${((performance.now() - suiteStart) / 1000).toFixed(1)}s${X}`);

  log(`\n  ${D}Measuring framework overhead...${X}`);
  const overhead = measureOverhead();
  for (const m of overhead) {
    log(`  ${C}⏱${X}  ${m.label.padEnd(32)} ${D}${m.durationMs.toFixed(3)}ms avg (${m.samples} samples)${X}`);
  }

  const summary = buildSummary(results);
  const passRate = Math.round((summary.passed / summary.totalTasks) * 100);
  const passColor = passRate >= 80 ? G : passRate >= 50 ? Y : R;

  // ── Progress bar ──
  const barWidth = 30;
  const filledWidth = Math.round((summary.passed / summary.totalTasks) * barWidth);
  const bar = `${G}${"█".repeat(filledWidth)}${X}${D}${"░".repeat(barWidth - filledWidth)}${X}`;

  log(`\n  ${V}┌─────────────────────────────────────────────────────┐${X}`);
  log(`  ${V}│${X}  ${B}${C}Results${X}                                             ${V}│${X}`);
  log(`  ${V}├─────────────────────────────────────────────────────┤${X}`);
  log(`  ${V}│${X}  ${bar} ${passColor}${B}${summary.passed}/${summary.totalTasks}${X} ${D}(${passRate}%)${X}   ${V}│${X}`);
  log(`  ${V}│${X}                                                     ${V}│${X}`);

  const durationStr = summary.totalDurationMs >= 1000
    ? `${(summary.totalDurationMs / 1000).toFixed(1)}s total, ${(summary.avgLatencyMs / 1000).toFixed(1)}s avg`
    : `${summary.totalDurationMs.toFixed(0)}ms total`;
  log(`  ${V}│${X}  ${D}Duration${X}  ${C}${durationStr.padEnd(40)}${X} ${V}│${X}`);
  log(`  ${V}│${X}  ${D}Tokens${X}    ${C}${String(summary.totalTokens.toLocaleString()).padEnd(40)}${X} ${V}│${X}`);
  log(`  ${V}│${X}  ${D}Cost${X}      ${C}${"$" + summary.totalCost.toFixed(4)}${X}${" ".repeat(Math.max(0, 39 - ("$" + summary.totalCost.toFixed(4)).length))} ${V}│${X}`);
  log(`  ${V}└─────────────────────────────────────────────────────┘${X}\n`);

  // ── Per-tier breakdown ──
  const tiers: Tier[] = ["trivial", "simple", "moderate", "complex", "expert"];
  log(`  ${D}Per-tier breakdown:${X}`);
  for (const tier of tiers) {
    const tierData = summary.byTier[tier];
    if (tierData.total === 0) continue;
    const pct = Math.round((tierData.passed / tierData.total) * 100);
    const avgStr = tierData.avgMs >= 1000 ? `${(tierData.avgMs / 1000).toFixed(1)}s` : `${tierData.avgMs.toFixed(0)}ms`;
    const pctColor = pct >= 80 ? G : pct >= 50 ? Y : R;
    log(`  ${tierColor(tier)}  ${tier.padEnd(10)}${X} ${pctColor}${tierData.passed}/${tierData.total}${X} ${D}(${pct}%)${X}  ${D}avg ${avgStr}${X}`);
  }

  // Restore previous cortex log level
  if (prevCortexLog !== undefined) {
    process.env.CORTEX_LOG = prevCortexLog;
  } else {
    delete process.env.CORTEX_LOG;
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

// ── v2: runSession() — multi-variant, multi-model, multi-run session runner ──

const ALL_TASKS = [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS] as const

function getGitSha(): string {
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() }
  catch { return "unknown" }
}

function writeFixtures(task: BenchmarkTask, dir: string): void {
  for (const fixture of task.fixtures ?? []) {
    const dest = join(dir, fixture.path)
    mkdirSync(join(dir, fixture.path.split("/").slice(0, -1).join("/")), { recursive: true })
    writeFileSync(dest, fixture.content, "utf8")
  }
}

async function runInternal(
  task: BenchmarkTask,
  model: ModelVariant,
  config: HarnessConfig,
  tmpDir: string,
  timeoutMs: number,
): Promise<TaskRunResult> {
  const start = performance.now()
  try {
    const maxIter = task.maxIterations ?? (config.reasoning ? 20 : config.tools ? 15 : 1)
    const builder = ReactiveAgents.create()
      .withName(`bench-${task.id}`)
      .withProvider(model.provider)
      .withModel(model.model)
      .withMaxIterations(maxIter)

    if (config.tools) builder.withTools()
    if (config.guardrails) builder.withGuardrails()

    if (config.reasoning) {
      const strategyMap = {
        "react": "reactive" as const,
        "plan-execute": "plan-execute-reflect" as const,
        "tree-of-thought": "tree-of-thought" as const,
        "adaptive": "adaptive" as const,
      }
      const strategy = config.strategy ? strategyMap[config.strategy] : "reactive"
      builder.withReasoning({ defaultStrategy: strategy })
    }

    if (config.reactiveIntelligence) builder.withReactiveIntelligence()

    if (config.memory && "withMemory" in builder && typeof (builder as unknown as Record<string, unknown>)["withMemory"] === "function") {
      ;(builder as unknown as Record<string, () => void>)["withMemory"]!()
    }

    const _log = console.log; console.log = () => {}
    const agent = await builder.build()
    console.log = _log

    try {
      const prompt = task.fixtures?.length
        ? `Working directory for this task: ${tmpDir}\n\nAll task files (e.g. ${task.fixtures.map(f => f.path).join(", ")}) are located in that directory. Use the full path when reading files.\n\n${task.prompt}`
        : task.prompt
      const timeoutP = new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs))
      const result = await Promise.race([agent.run(prompt), timeoutP])
      return {
        output: result.output,
        tokensUsed: result.metadata.tokensUsed ?? 0,
        durationMs: performance.now() - start,
        iterations: result.metadata.stepsCount ?? 0,
        status: "pass",
      }
    } finally {
      await agent.dispose()
    }
  } catch (e) {
    return {
      output: "",
      tokensUsed: 0,
      durationMs: performance.now() - start,
      iterations: 0,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

async function startFlakyPriceServer(): Promise<{ url: string; stop: () => void }> {
  const fallbackData = {
    bitcoin:  { usd: 68450.21, usd_24h_change: 2.34,  usd_market_cap: 1_347_000_000_000 },
    ethereum: { usd: 3512.88,  usd_24h_change: -0.87, usd_market_cap: 422_000_000_000 },
    solana:   { usd: 172.44,   usd_24h_change: 4.12,  usd_market_cap: 79_000_000_000 },
  }
  let callCount = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      callCount++
      if (callCount <= 2) return new Response("Service Unavailable", { status: 503 })
      return new Response(JSON.stringify(fallbackData), { status: 200,
        headers: { "Content-Type": "application/json" } })
    },
  })
  return { url: `http://localhost:${server.port}`, stop: () => server.stop() }
}

async function dispatch(
  task: BenchmarkTask,
  model: ModelVariant,
  variant: HarnessVariant,
  tmpDir: string,
  timeoutMs: number,
): Promise<TaskRunResult> {
  if (variant.type === "competitor") {
    const runner = COMPETITOR_RUNNERS[variant.framework]
    if (!runner) return { output: "", tokensUsed: 0, durationMs: 0, iterations: 0, status: "error", error: `No runner for ${variant.framework}` }
    return runner.run(task, model, tmpDir, timeoutMs)
  }

  const effectiveConfig = variant.id === "ra-full" && task.optimalHarnessConfig
    ? mergeConfigs(variant.config, task.optimalHarnessConfig)
    : variant.config

  if (task.id === "rw-9") {
    const { url, stop } = await startFlakyPriceServer()
    const modifiedTask = { ...task, prompt: task.prompt.replace("INJECT_MOCK_URL", url) }
    try { return await runInternal(modifiedTask, model, effectiveConfig, tmpDir, timeoutMs) }
    finally { stop() }
  }

  return runInternal(task, model, effectiveConfig, tmpDir, timeoutMs)
}

export function aggregateRuns(
  taskId: string,
  modelVariantId: string,
  variant: HarnessVariant,
  runs: ReadonlyArray<RunScore>,
): TaskVariantReport {
  if (runs.length === 0) {
    return { taskId, modelVariantId, variantId: variant.id, variantLabel: variant.label,
      runs: [], meanScores: [], variance: 0, meanTokens: 0, meanDurationMs: 0, passRate: 0 }
  }

  const dims = [...new Set(runs.flatMap(r => r.dimensions.map(d => d.dimension)))] as QualityDimension[]

  const meanScores: DimensionScore[] = dims.map(dim => {
    const scores = runs.map(r => r.dimensions.find(d => d.dimension === dim)?.score ?? 0)
    return { dimension: dim, score: scores.reduce((a, b) => a + b, 0) / scores.length }
  })

  const accuracyScores = runs.map(r => r.dimensions.find(d => d.dimension === "accuracy")?.score ?? 0)
  const mean = accuracyScores.reduce((a, b) => a + b, 0) / accuracyScores.length
  const variance = accuracyScores.reduce((a, b) => a + (b - mean) ** 2, 0) / accuracyScores.length
  const reliability = computeReliability(runs)

  if (!meanScores.find(s => s.dimension === "reliability")) {
    meanScores.push({ dimension: "reliability", score: reliability })
  }

  return {
    taskId, modelVariantId,
    variantId: variant.id, variantLabel: variant.label,
    runs,
    meanScores,
    variance: Math.sqrt(variance),
    meanTokens: Math.round(runs.reduce((a, r) => a + r.tokensUsed, 0) / runs.length),
    meanDurationMs: Math.round(runs.reduce((a, r) => a + r.durationMs, 0) / runs.length),
    passRate: runs.filter(r => r.status === "pass").length / runs.length,
  }
}

export function computeAllAblation(reports: ReadonlyArray<TaskVariantReport>): ReadonlyArray<AblationResult> {
  const groups = new Map<string, TaskVariantReport[]>()
  for (const r of reports) {
    const key = `${r.taskId}::${r.modelVariantId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  const results: AblationResult[] = []
  for (const [key, variants] of groups) {
    const [taskId, modelVariantId] = key.split("::") as [string, string]
    const baseline = variants.find(v => v.variantId === "bare-llm")
    const full = variants.find(v => v.variantId === "ra-full")
    if (!baseline || !full) continue

    const baseAcc = baseline.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0
    const fullAcc = full.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0

    const allDims = [...new Set(variants.flatMap(v => v.meanScores.map(s => s.dimension)))] as QualityDimension[]
    const perDimensionLift = allDims.map(dim => {
      const baseScore = baseline.meanScores.find(s => s.dimension === dim)?.score ?? 0
      const fullScore = full.meanScores.find(s => s.dimension === dim)?.score ?? 0
      return { dimension: dim, lift: fullScore - baseScore }
    })

    const bestVariant = [...variants].sort((a, b) =>
      (b.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0) -
      (a.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0)
    )[0]!

    const taskName = ALL_TASKS.find(t => t.id === taskId)?.name ?? taskId
    results.push({
      taskId, taskName, modelVariantId, variants,
      harnessLift: fullAcc - baseAcc,
      perDimensionLift,
      bestVariantId: bestVariant.variantId,
      baselineVariantId: "bare-llm",
    })
  }
  return results
}

export function summarizeDimensions(
  reports: ReadonlyArray<TaskVariantReport>,
): SessionReport["dimensionSummary"] {
  const dims = [...new Set(reports.flatMap(r => r.meanScores.map(s => s.dimension)))] as QualityDimension[]
  return dims.map(dim => {
    const variantIds = [...new Set(reports.map(r => r.variantId))]
    return {
      dimension: dim,
      byVariant: variantIds.map(variantId => {
        const variantReports = reports.filter(r => r.variantId === variantId)
        const scores = variantReports.map(r => r.meanScores.find(s => s.dimension === dim)?.score ?? 0)
        return {
          variantId,
          meanScore: scores.reduce((a, b) => a + b, 0) / (scores.length || 1),
        }
      }),
    }
  })
}

export async function runSession(
  session: BenchmarkSession,
  outputPath?: string,
): Promise<SessionReport> {
  const tasks = resolveTasks(session, ALL_TASKS)
  const gitSha = getGitSha()
  const allVariantReports: TaskVariantReport[] = []

  const runCount = session.runs ?? 1
  const timeoutMs = session.timeoutMs ?? 120_000
  const logLevel = session.logLevel ?? "progress"

  // Control cortex logging based on log level
  const prevCortexLog = process.env.CORTEX_LOG;
  if (logLevel === "silent") {
    process.env.CORTEX_LOG = "off";
  } else if (logLevel === "progress") {
    process.env.CORTEX_LOG = "error";  // Only show errors, suppress info/debug
  }

  const log = (...args: any[]) => {
    if (logLevel !== "silent") {
      console.log(...args);
    }
  };

  log(`\n  Running session: ${session.name} (${session.id} v${session.version})`)
  log(`  Tasks: ${tasks.length} | Models: ${session.models.length} | Variants: ${session.harnessVariants.length} | Runs: ${runCount}\n`)

  for (const task of tasks) {
    for (const model of session.models) {
      for (const variant of session.harnessVariants) {
        const runScores: RunScore[] = []

        for (let i = 0; i < runCount; i++) {
          const tmpDir = mkdtempSync(join(process.cwd(), ".bench-run-"))
          try {
            writeFixtures(task, tmpDir)
            // Suppress agent output in silent and progress modes
            let result;
            if (logLevel !== "verbose") {
              const consoleLog = console.log;
              const consoleError = console.error;
              const consoleWarn = console.warn;
              const consoleInfo = console.info;
              const consoleDebug = console.debug;
              const stdoutWrite = process.stdout.write.bind(process.stdout);

              console.log = console.error = console.warn = console.info = console.debug = () => {};
              process.stdout.write = (() => true) as any;

              try {
                result = await dispatch(task, model, variant, tmpDir, timeoutMs)
              } finally {
                console.log = consoleLog;
                console.error = consoleError;
                console.warn = consoleWarn;
                console.info = consoleInfo;
                console.debug = consoleDebug;
                process.stdout.write = stdoutWrite;
              }
            } else {
              result = await dispatch(task, model, variant, tmpDir, timeoutMs)
            }
            const dimensions = await scoreTask(result.output, task, tmpDir, result.tokensUsed, result.iterations)
            runScores.push({
              runIndex: i,
              dimensions,
              tokensUsed: result.tokensUsed,
              durationMs: result.durationMs,
              status: result.status,
              output: result.output,
            })
          } finally {
            rmSync(tmpDir, { recursive: true, force: true })
          }
        }

        allVariantReports.push(aggregateRuns(task.id, model.id, variant, runScores))
        if (logLevel !== "silent") {
          process.stdout.write(".")
        }
      }
    }
  }

  log("\n")

  const ablation = computeAllAblation(allVariantReports)
  const dimensionSummary = summarizeDimensions(allVariantReports)

  const sessionReport: SessionReport = {
    generatedAt: new Date().toISOString(),
    runs: [],
    sessionId: session.id,
    sessionVersion: session.version,
    gitSha,
    ablation,
    taskReports: allVariantReports,
    dimensionSummary,
  }

  if (outputPath) {
    let existing: SessionReport = sessionReport
    try { existing = JSON.parse(readFileSync(outputPath, "utf8")) as SessionReport } catch (e) {
      if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) throw e
    }
    writeFileSync(outputPath, JSON.stringify({ ...existing, ...sessionReport }, null, 2), "utf8")
  }

  // Restore previous cortex log level
  if (prevCortexLog !== undefined) {
    process.env.CORTEX_LOG = prevCortexLog;
  } else {
    delete process.env.CORTEX_LOG;
  }

  return sessionReport
}


