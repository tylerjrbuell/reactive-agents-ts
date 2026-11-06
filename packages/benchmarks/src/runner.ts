// File: src/runner.ts
/**
 * BenchmarkRunner — executes benchmark tasks against a real LLM and collects metrics.
 *
 * Each task calls `agent.run()` against the specified provider and model,
 * measuring real-world latency, token usage, cost, and correctness.
 */
import type { BenchmarkTask, TaskResult, OverheadMeasurement, BenchmarkReport, Tier } from "./types.js";
import { toolsToExpose } from "@reactive-agents/core";
import { BENCHMARK_TASKS } from "./task-registry.js";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { createRuntime } from "@reactive-agents/runtime";
import type { RuntimeOptions } from "@reactive-agents/runtime";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { serve } from "@reactive-agents/runtime-shim"
import { withFileRoot } from "@reactive-agents/tools"
import type {
  BenchmarkSession, HarnessVariant, ModelVariant,
  TaskVariantReport, AblationResult, SessionReport, RunScore,
  DimensionScore, QualityDimension, HarnessConfig, TaskRunResult,
  SessionReproducibility, InconclusiveReason,
} from "./types.js"
import { REAL_WORLD_TASKS, ABSTENTION_TRAP_TASKS } from "./tasks/real-world.js"
import { CONTEXT_STRESS_TASKS } from "./tasks/context-stress.js"
import { LONG_HORIZON_TASKS } from "./tasks/long-horizon.js"
import { COMPETITOR_RUNNERS } from "./competitors/index.js"
import { resolveTasks, mergeConfigs, assertNonEmptySelection } from "./session.js"
import { completionRateOf, passKOf, PASS_K_VALUES, solveRateOf, runInconclusiveReasonOf } from "./report-format.js"
import { checkCapabilitySourcePreflight } from "./preflight.js"
import { ALL_TASKS } from "./all-tasks.js"
import {
  aggregateAbstention, aggregateRuns, aggregatePassKByVariant, computeAllAblation, summarizeDimensions,
} from "./aggregate.js"
import {
  withConfigEnv, matchesExpected, shouldUseLongHorizon, billedTokenFields,
  writeFixtures, computeGroundingSet, dispatch,
} from "./run-internal.js"

// GH #268: moved verbatim to sibling modules; re-exported so importers of
// "./runner.js" keep working.
export { ALL_TASKS }
export { aggregateAbstention, aggregateRuns, aggregatePassKByVariant, computeAllAblation, summarizeDimensions }
export { withConfigEnv, shouldUseLongHorizon, billedTokenFields, writeFixtures, computeGroundingSet }

import { scoreTask, scoreErrorCell, computeReliability, judgeUnreachable, DEFAULT_JUDGE_URL } from "./judge.js"
import { formatDiagnosisLine, trustVerdict } from "./diagnose.js"
import { gradeThenDiagnose } from "./eval-graded.js"

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
        "blueprint": "blueprint" as const,
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

    // A4: long-horizon tasks (tagged `horizon:long`, e.g. lh-1) run under the
    // scaled guard profile so ≥40-iteration work is not tripped by short-run guards.
    if (shouldUseLongHorizon(task)) {
      builder.withLongHorizon();
    }

    // Suppress build-validation console.log (provider/model/key info)
    const _log = console.log;
    console.log = () => {};
    const agent = await builder.build();
    console.log = _log;

    let agentResult: Awaited<ReturnType<typeof agent.run>>;
    let cumulativeTokens = 0;
    let cumulativeCost = 0;
    let cumulativeBilledTokens = 0;
    let cumulativeCacheReadTokens = 0;
    // Set true the first time LLMRequestCompleted actually fires. A subscribe
    // race or a dropped event must not leave cumulativeBilledTokens sitting at
    // its 0 initializer and reported as a genuine "0 billed tokens" — that
    // would silently violate the never-default-to-0 guarantee downstream
    // (aggregateRuns's `??` fallback only engages on undefined, not on a
    // defined-but-wrong 0). Both return sites below omit the fields entirely
    // when this stays false, so the raw-tokensUsed fallback correctly engages.
    let sawLLMRequestCompleted = false;
    let iterations = 0;

    // Listen for progress to capture tokens/cost even on timeout
    const unsub = await agent.subscribe((event) => {
      if (event._tag === "LLMRequestCompleted") {
        cumulativeTokens += event.tokensUsed;
        cumulativeCost += event.estimatedCost;
        // Before the F-1 fix nothing published this event, so these
        // accumulators sat at 0 and the bench silently fell through to
        // agentResult.metadata.tokensUsed. They are live now.
        cumulativeBilledTokens += event.billedTokens ?? event.tokensUsed;
        cumulativeCacheReadTokens += event.cacheReadTokensIn ?? 0;
        sawLLMRequestCompleted = true;
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
        ...billedTokenFields(sawLLMRequestCompleted, cumulativeBilledTokens, cumulativeCacheReadTokens),
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
      // AgentResultMetadata does not (yet) carry a billed/cache-read split, so
      // these fall back to the event-stream accumulator directly rather than
      // ORing against a nonexistent metadata field. Omit entirely (not 0) when
      // the subscriber never fired, so aggregateRuns falls back to raw tokensUsed.
      ...billedTokenFields(sawLLMRequestCompleted, cumulativeBilledTokens, cumulativeCacheReadTokens),
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
  // Never run (and never REPORT) an empty benchmark. This path filters
  // BENCHMARK_TASKS, which does not contain the `rw-*` real-world ids — so a
  // `--task rw-9` without `--session` used to select nothing and still exit 0
  // with a report of zeros.
  assertNonEmptySelection({
    tasks,
    ...(options.taskIds ? { requestedTaskIds: options.taskIds } : {}),
    available: BENCHMARK_TASKS.map((t) => t.id),
  });

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

    // Honor per-task timeoutSec here too (fall back to the run-level wall).
    const taskTimeoutMs = task.timeoutSec != null ? task.timeoutSec * 1000 : timeoutMs;
    const result = await runTask(task, options.provider, resolvedModel, taskTimeoutMs, logLevel);
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

// ABSTENTION_TRAP_TASKS was authored and then never referenced: it appeared in

function getGitSha(): string {
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() }
  catch { return "unknown" }
}


/**
 * Remove leftover `.bench-run-*` temp dirs from prior killed/crashed runs.
 * Best-effort — swallows all errors so cleanup never aborts a benchmark.
 */
export function cleanupStaleBenchDirs(baseDir: string = process.cwd()): number {
  let removed = 0
  try {
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".bench-run-")) {
        try {
          rmSync(join(baseDir, entry.name), { recursive: true, force: true })
          removed++
        } catch {
          /* ignore a single dir we can't remove (in-use by a live run, perms) */
        }
      }
    }
  } catch {
    /* readdir failed (cwd gone?) — nothing to sweep */
  }
  return removed
}

export async function runSession(
  session: BenchmarkSession,
  outputPath?: string,
): Promise<SessionReport> {
  // ── Stale-artifact sweep ───────────────────────────────────────────────────
  // Per-cell temp dirs are removed in a `finally`, but a killed/crashed run
  // (SIGKILL, timeout, Ctrl-C) skips it and leaks `.bench-run-*` into the cwd.
  // Sweep leftovers from prior runs at session start so the working tree never
  // accumulates clutter. Best-effort: never let cleanup abort a benchmark.
  cleanupStaleBenchDirs()
  // ── Rule-4 guard (Phase 0 Task 9) ─────────────────────────────────────────
  // Per docs/spec/docs/00-RESEARCH-DISCIPLINE.md Rule 4: the judge model MUST
  // be a separately-versioned, model-pinned artifact distinct from the System
  // Under Test. Self-evaluation produces inflated scores via self-preference
  // bias (arXiv:2410.21819). When a judge URL is configured (session.judgeUrl
  // or JUDGE_URL env), probe /version and refuse to run if the judge model
  // matches any SUT model variant. When no judge URL is set, the guard skips
  // (existing bench behavior preserved for non-judge code paths).
  //
  // REACHABILITY (2026-07-26). The Rule-4 guard below fires only when a judge
  // URL is EXPLICITLY configured — but the judge CLIENT (`judge.ts`
  // `resolveJudgeUrl`) always falls back to `DEFAULT_JUDGE_URL`. Two different
  // notions of "is a judge configured": the guard's (explicit only) and the
  // client's (always). So a session with no JUDGE_URL set ran a full sweep
  // against a dead default judge, scored every judge dimension as unmeasured,
  // and reported it as zeros — observed live 2026-07-26 across all 10
  // real-world tasks. The aggregation fix makes that report HONEST; this warns
  // BEFORE the sweep, so nobody spends 40 minutes and real tokens to find out.
  // A warning rather than a throw: deterministic-only sessions legitimately
  // never call the judge, and must not be made to depend on one.
  // The probe itself runs AFTER task resolution and only when this session
  // actually has judge-scored dimensions — see `needsJudge` below. A
  // deterministic session (t0) must reach zero network, and an unconditional
  // localhost fetch here violated that even though it failed fast.
  const judgeUrlForGuard = session.judgeUrl ?? process.env.JUDGE_URL;
  let probedJudgeModelSha: string | undefined;
  let probedJudgeCodeSha: string | undefined;
  if (judgeUrlForGuard) {
    let versionRes: Response;
    try {
      versionRes = await fetch(`${judgeUrlForGuard}/version`);
    } catch (e) {
      throw new Error(
        `Could not reach judge-server at ${judgeUrlForGuard} for Rule-4 check: ${String(e)}`,
      );
    }
    if (!versionRes.ok) {
      throw new Error(
        `Judge-server /version returned ${versionRes.status} from ${judgeUrlForGuard}`,
      );
    }
    const versionBody = (await versionRes.json()) as {
      judgeModelSha: string;
      judgeCodeSha: string;
    };
    probedJudgeModelSha = versionBody.judgeModelSha;
    probedJudgeCodeSha = versionBody.judgeCodeSha;
    for (const variant of session.models) {
      if (probedJudgeModelSha === variant.model) {
        throw new Error(
          `Rule-4 violation: judge model (${probedJudgeModelSha}) must differ from SUT model (${variant.model}). ` +
            `See docs/spec/docs/00-RESEARCH-DISCIPLINE.md Rule 4. ` +
            `Configure a different JUDGE_MODEL env var when starting the judge-server.`,
        );
      }
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  // ── Capability-source preflight is now PER-CELL (canonical-contracts §6) ──
  // A model whose capability resolves from source="fallback" produces
  // INCONCLUSIVE cells (not a misconfigured-budget score, not a whole-session
  // abort). Resolved once per model below, inside the loop, so a mixed-tier
  // session measures its trusted cells and flags only the untrusted ones.
  // Override with RA_BENCH_ALLOW_FALLBACK=1. See `src/preflight.ts`.
  const allowFallback = process.env.RA_BENCH_ALLOW_FALLBACK === "1";
  // ──────────────────────────────────────────────────────────────────────────

  // ── Reproducibility metadata (Phase 0 Task 10) ────────────────────────────
  // Per docs/spec/docs/00-RESEARCH-DISCIPLINE.md Rule 4: every SessionReport
  // carries enough metadata to replay the run from frozen artifacts. The
  // single `runId` is the source of truth — every judge call within this
  // runSession invocation should reuse it (Task 12 will thread it through).
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const replayCommand =
    `bun run --cwd packages/benchmarks bench --session ${session.id} --run-id ${runId}` +
    (judgeUrlForGuard ? ` --judge-url ${judgeUrlForGuard}` : "");
  // Both branches (with/without judge URL) collapsed: when judge wasn't probed,
  // probedJudgeModelSha/CodeSha are undefined and the nullish-coalesce yields
  // the sentinel naturally.
  const reproducibility: SessionReproducibility = {
    judgeModelSha: probedJudgeModelSha ?? "unknown-no-judge-configured",
    judgeCodeSha: probedJudgeCodeSha ?? "unknown-no-judge-configured",
    runId,
    replayCommand,
  };
  // ──────────────────────────────────────────────────────────────────────────

  const tasks = resolveTasks(session, session.tasks ?? ALL_TASKS)

  // Judge REACHABILITY warning. The Rule-4 guard above fires only when a judge
  // URL is EXPLICITLY configured — but the judge CLIENT (`judge.ts`
  // `resolveJudgeUrl`) always falls back to `DEFAULT_JUDGE_URL`. Two different
  // notions of "is a judge configured": the guard's (explicit only) and the
  // client's (always). That is how a full real-world sweep ran against a dead
  // default judge on 2026-07-26, scoring every judge dimension as unmeasured.
  // The aggregation fix makes that report honest; this warns BEFORE the sweep,
  // so nobody spends 40 minutes and real tokens to find out.
  //
  // Gated on the session actually HAVING judge-scored dimensions (a task with
  // `dimensionRubrics`). A deterministic session scores every cell from
  // verifiable commands and must reach zero network — the first version of this
  // probe fetched unconditionally and violated that, which t0-deterministic's
  // "zero network access" case exists to catch. Warning, never a throw:
  // judge-free sessions must not be made to depend on a judge.
  const needsJudge = tasks.some((t) => (t.dimensionRubrics?.length ?? 0) > 0)
  if (needsJudge) {
    const resolvedJudgeUrl = session.judgeUrl ?? process.env.JUDGE_URL ?? DEFAULT_JUDGE_URL;
    if (await judgeUnreachable(resolvedJudgeUrl)) {
      console.warn(
        `\n  ⚠ judge-server unreachable at ${resolvedJudgeUrl}.\n` +
          `    Every llm-judge dimension will be INCONCLUSIVE (not a zero), the report\n` +
          `    will be marked partialMeasurement, and the run will exit non-zero.\n` +
          `    Start it with: cd packages/judge-server && JUDGE_LAYER=live bun run src/index.ts\n`,
      );
    }
  }

  const gitSha = getGitSha()
  const allVariantReports: TaskVariantReport[] = []
  const abstentionInputs: Array<{ abstainExpected: boolean; abstained: boolean }> = []

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

  // ── Local-model warm-up ────────────────────────────────────────────────────
  // Cold-load and GPU contention produce timing artifacts (a first call can
  // pay 30s+ of model load that later calls don't). Load each Ollama model
  // once, untimed, before any measured cell. Sessions that need strict
  // one-model-resident serialization should define one model per session.
  // Warm only models that will dispatch a cell (no tasks / fallback source = no call).
  for (const m of tasks.length === 0 ? [] : session.models) {
    if (m.provider !== "ollama") continue
    if (!allowFallback && checkCapabilitySourcePreflight([{ provider: m.provider, model: m.model }])[0] !== undefined) continue
    const base = process.env["OLLAMA_OPENAI_BASE_URL"]?.replace(/\/v1\/?$/, "") ?? "http://localhost:11434"
    const t0 = performance.now()
    try {
      await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.model, prompt: "ok", stream: false, options: { num_predict: 1 } }),
      })
      log(`  Warmed ${m.model} in ${Math.round(performance.now() - t0)}ms`)
    } catch (e) {
      log(`  Warm-up failed for ${m.model}: ${String(e)} (continuing — first cell will pay the load)`)
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  for (const task of tasks) {
    // Per-task wall override: long-horizon tasks (≥40 iterations) carry their
    // own timeoutSec because the session wall (e.g. 420s) buys only a handful
    // of local iterations. Unset → fall back to the session timeout, so every
    // existing task keeps byte-identical behavior.
    const taskTimeoutMs = task.timeoutSec != null ? task.timeoutSec * 1000 : timeoutMs
    for (const model of session.models) {
      // Per-cell capability-source preflight: resolve once per model. A fallback
      // source makes every cell for this model inconclusive (skip dispatch).
      const modelViolation = allowFallback
        ? undefined
        : checkCapabilitySourcePreflight([{ provider: model.provider, model: model.model }])[0]

      for (const variant of session.harnessVariants) {
        if (modelViolation) {
          allVariantReports.push({
            taskId: task.id,
            modelVariantId: model.id,
            variantId: variant.id,
            variantLabel: variant.label,
            runs: [],
            meanScores: [],
            variance: 0,
            meanTokens: 0,
            meanBilledTokens: 0,
            meanCacheReadTokens: 0,
            meanDurationMs: 0,
            passRate: 0,
            solveRate: 0,
            inconclusive: modelViolation,
          })
          if (logLevel !== "silent") process.stdout.write("?")
          continue
        }

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
                // Root file-read/file-write at the per-cell temp dir so
                // model-invented writes (report.md, generate.ts) land in the
                // sandbox — not the repo root — where scoreTask reads them and
                // the per-cell `finally` cleans them up. Concurrency-safe (ALS).
                result = await withFileRoot(tmpDir, () =>
                  dispatch(task, model, variant, tmpDir, taskTimeoutMs, session.traceDir),
                )
              } finally {
                console.log = consoleLog;
                console.error = consoleError;
                console.warn = consoleWarn;
                console.info = consoleInfo;
                console.debug = consoleDebug;
                process.stdout.write = stdoutWrite;
              }
            } else {
              result = await withFileRoot(tmpDir, () =>
                dispatch(task, model, variant, tmpDir, taskTimeoutMs, session.traceDir),
              )
            }
            abstentionInputs.push({
              abstainExpected: task.abstainExpected ?? false,
              abstained: result.terminatedBy === "abstained",
            })
            // Timeout/crash cells never reach the judge — an empty output judged
            // by an LLM yields hallucinated evidence (2026-07-07 forensic run).
            const dimensions = result.status === "error"
              ? scoreErrorCell(task, result.error ?? "error", result.durationMs)
              : await scoreTask(result.output, task, tmpDir, result.tokensUsed, result.iterations, undefined, result.terminatedBy)
            // Grader-in-trace: append the deterministic grade to the trace, THEN diagnose it.
            const diagnosis = await gradeThenDiagnose(session.traceDir, result.traceId, dimensions, task.id, session.suiteHash)
            // Score-aware trust verdict: combine the trace honesty label with
            // the judge accuracy so a correct text answer isn't mislabeled
            // "unverified" and an overconfident wrong answer surfaces as
            // "claimed-but-wrong" (2026-06-26 sweep reframe).
            const accuracyScore = dimensions.find((d) => d.dimension === "accuracy")?.score
            const trust = diagnosis
              ? trustVerdict(diagnosis.honestyLabel, accuracyScore)
              : undefined
            runScores.push({
              runIndex: i,
              dimensions,
              tokensUsed: result.tokensUsed,
              durationMs: result.durationMs,
              status: result.status,
              output: result.output,
              ...(result.traceId ? { traceId: result.traceId } : {}),
              ...(diagnosis ? { diagnosis } : {}),
              ...(trust ? { trust } : {}),
              ...(result.billedTokens != null ? { billedTokens: result.billedTokens } : {}),
              ...(result.cacheReadTokens != null ? { cacheReadTokens: result.cacheReadTokens } : {}),
            })
            if (diagnosis) {
              const diagLine = formatDiagnosisLine(diagnosis);
              if (diagLine) log(`     ${diagLine}`);
            }
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

  // Inconclusive cells are excluded from aggregation/ablation/verdicts — a
  // misconfigured-budget cell must never feed an equal-or-better comparison.
  const measuredReports = allVariantReports.filter((r) => !r.inconclusive)
  const inconclusiveCells = allVariantReports
    .filter((r) => r.inconclusive)
    .map((r) => ({
      taskId: r.taskId,
      modelVariantId: r.modelVariantId,
      variantId: r.variantId,
      reason: r.inconclusive!,
    }))

  const ablation = computeAllAblation(measuredReports)
  const dimensionSummary = summarizeDimensions(measuredReports)
  const passKByVariant = aggregatePassKByVariant(measuredReports)

  const hasTrapTasks = abstentionInputs.some((r) => r.abstainExpected)
  const abstentionMetrics = hasTrapTasks ? aggregateAbstention(abstentionInputs) : undefined

  const sessionReport: SessionReport = {
    generatedAt: new Date().toISOString(),
    runs: [],
    sessionId: session.id,
    sessionVersion: session.version,
    gitSha,
    ablation,
    taskReports: allVariantReports,
    dimensionSummary,
    reproducibility,
    inconclusiveCells,
    partialMeasurement: inconclusiveCells.length > 0,
    ...(abstentionMetrics != null ? {
      abstentionAccuracy: abstentionMetrics.abstentionAccuracy,
      fabricationUnderTrapRate: abstentionMetrics.fabricationUnderTrapRate,
    } : {}),
    ...(passKByVariant !== undefined ? { passKByVariant } : {}),
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


