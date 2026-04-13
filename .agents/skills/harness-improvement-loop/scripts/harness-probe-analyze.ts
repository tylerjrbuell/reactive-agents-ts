// harness-probe-analyze.ts — Structured JSONL analyzer for harness probe output
//
// Reads any probe-*.jsonl file and produces a ProbeAnalysis JSON with correct
// metric extraction based on the real ReactiveAgents JSONL schema.
//
// Real JSONL schema (discovered from live probe output):
//   _type: "metric" | "log" | "span"
//
//   Key metrics:
//     execution.iteration     gauge  — single record at end; final iteration count
//     reasoning.steps         counter — fires once per kernel step (value=1 each)
//                               labels: { strategy, kernelPass }
//     entropy.composite       gauge  — per-iteration quality score
//                               labels: { taskId, iteration, shape, confidence }
//     execution.phase.count   counter — per-phase; labels: { phase }
//                               known phases: bootstrap, strategy-select, think,
//                                             act, observe, memory-flush, complete
//     execution.tokens_used   gauge  — total tokens consumed
//     execution.total_duration gauge — total wall time ms
//     execution.model_name    counter — labels: { model, provider }
//     agent.iterations        counter — alias for final iteration count
//
// Usage:
//   bun run scripts/harness-probe-analyze.ts harness-reports/probe-tool-heavy.jsonl
//   bun run scripts/harness-probe-analyze.ts harness-reports/  # analyze all probes
//   bun run scripts/harness-probe-analyze.ts --registry          # show metric registry

import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join, basename } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EntropyDataPoint {
  iteration: number;
  composite: number;
  shape: "converging" | "diverging" | "oscillating" | "flat" | string;
  confidence: "high" | "low" | "medium" | string;
}

export interface ProbeAnalysis {
  probeId: string;
  file: string;
  analyzedAt: string;

  // Execution summary
  iterations: number | null;       // execution.iteration (single final gauge)
  kernelSteps: number;             // count of reasoning.steps records (value always 1)
  kernelStepsByStrategy: Record<string, number>;  // breakdown by labels.strategy
  kernelStepsByKernelPass: Record<string, number>; // breakdown by labels.kernelPass

  // Quality
  entropyTimeline: EntropyDataPoint[];
  finalEntropy: number | null;
  meanEntropy: number | null;
  convergenceIteration: number | null;  // first iter where shape === "converging"
  entropyShape: string | null;           // shape of final entropy point

  // Phase breakdown
  phaseCounts: Record<string, number>;
  actPhaseCount: number;
  thinkPhaseCount: number;
  observePhaseCount: number;
  phaseDurationMs: Record<string, number>;  // sum of execution.phase.duration_ms by phase

  // Resources
  tokensUsed: number | null;
  totalDurationMs: number | null;
  model: string | null;
  provider: string | null;

  // Behavior signals
  loopSignals: string[];           // log messages containing loop/nudge/stall keywords
  strategySignals: string[];       // log messages containing strategy-switch keywords
  requiredToolSignals: string[];   // "Still needed:" ICS messages

  // Health flags
  exceeded10Iterations: boolean;
  hadLoopSignal: boolean;
  hadStrategySwitch: boolean;
  hadICSNudge: boolean;
  hasActPhase: boolean;

  // Discovery
  discoveredMetricNames: string[];  // all unique _type=metric names seen in this file
  totalRecords: number;
  metricRecords: number;
  logRecords: number;
  spanRecords: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core analyzer
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeProbeJsonl(file: string): ProbeAnalysis {
  const probeId = basename(file)
    .replace(/^probe-/, "")
    .replace(/\.jsonl$/, "");

  const raw = existsSync(file) ? readFileSync(file, "utf-8") : "";
  const records = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l) as Record<string, unknown>; }
      catch { return null; }
    })
    .filter(Boolean) as Record<string, unknown>[];

  const metrics = records.filter((r) => r._type === "metric");
  const logs = records.filter((r) => r._type === "log");

  // ── Iteration count ────────────────────────────────────────────────────────
  const iterRecord = metrics.find((r) => r.name === "execution.iteration");
  const iterations = iterRecord != null ? (iterRecord.value as number) : null;

  // ── Kernel steps (reasoning.steps fires per-step, value=1 each) ───────────
  const stepRecords = metrics.filter((r) => r.name === "reasoning.steps");
  const kernelSteps = stepRecords.length; // each fire = one step

  const kernelStepsByStrategy: Record<string, number> = {};
  const kernelStepsByKernelPass: Record<string, number> = {};
  for (const r of stepRecords) {
    const labels = (r.labels ?? {}) as Record<string, string>;
    const strategy = labels.strategy ?? "unknown";
    const pass = labels.kernelPass ?? "unknown";
    kernelStepsByStrategy[strategy] = (kernelStepsByStrategy[strategy] ?? 0) + 1;
    kernelStepsByKernelPass[pass] = (kernelStepsByKernelPass[pass] ?? 0) + 1;
  }

  // ── Entropy timeline ───────────────────────────────────────────────────────
  const entropyRecords = metrics.filter((r) => r.name === "entropy.composite");
  // Deduplicate by iteration number (multiple records per iteration possible)
  const entropyByIter = new Map<number, EntropyDataPoint>();
  for (const r of entropyRecords) {
    const labels = (r.labels ?? {}) as Record<string, string>;
    const iter = parseInt(labels.iteration ?? "0", 10);
    const point: EntropyDataPoint = {
      iteration: iter,
      composite: r.value as number,
      shape: labels.shape ?? "unknown",
      confidence: labels.confidence ?? "unknown",
    };
    // Keep last record for each iteration number
    entropyByIter.set(iter, point);
  }
  const entropyTimeline = Array.from(entropyByIter.values()).sort(
    (a, b) => a.iteration - b.iteration,
  );

  const finalEntropy =
    entropyTimeline.length > 0
      ? entropyTimeline[entropyTimeline.length - 1]!.composite
      : null;
  const meanEntropy =
    entropyTimeline.length > 0
      ? entropyTimeline.reduce((s, p) => s + p.composite, 0) / entropyTimeline.length
      : null;
  const convergencePoint = entropyTimeline.find((p) => p.shape === "converging");
  const convergenceIteration = convergencePoint?.iteration ?? null;
  const entropyShape =
    entropyTimeline.length > 0
      ? entropyTimeline[entropyTimeline.length - 1]!.shape
      : null;

  // ── Phase counts ───────────────────────────────────────────────────────────
  const phaseCounts: Record<string, number> = {};
  const phaseDurationMs: Record<string, number> = {};
  for (const r of metrics) {
    if (r.name === "execution.phase.count") {
      const phase = ((r.labels as Record<string, string>) ?? {}).phase ?? "unknown";
      phaseCounts[phase] = (phaseCounts[phase] ?? 0) + (r.value as number);
    }
    if (r.name === "execution.phase.duration_ms") {
      const phase = ((r.labels as Record<string, string>) ?? {}).phase ?? "unknown";
      phaseDurationMs[phase] = (phaseDurationMs[phase] ?? 0) + (r.value as number);
    }
  }

  // ── Resources ─────────────────────────────────────────────────────────────
  const tokensRecord = metrics.find((r) => r.name === "execution.tokens_used");
  const tokensUsed = tokensRecord != null ? (tokensRecord.value as number) : null;

  const durationRecord = metrics.find((r) => r.name === "execution.total_duration");
  const totalDurationMs =
    durationRecord != null ? (durationRecord.value as number) : null;

  const modelRecord = metrics.find((r) => r.name === "execution.model_name");
  const modelLabels = ((modelRecord?.labels ?? {}) as Record<string, string>);
  const model = modelLabels.model ?? null;
  const provider = modelLabels.provider ?? null;

  // ── Behavior signals ───────────────────────────────────────────────────────
  const loopKeywords = /loop detect|reasoning.loop|nudge|stall|consecutive thought/i;
  const switchKeywords = /strategy.switch|strategy_switch|switching to/i;
  const icsKeywords = /still needed|required tool|ICS nudge/i;

  const logMessages = logs.map((r) => ({
    level: (r.level as string) ?? "info",
    message: (r.message as string) ?? "",
  }));

  const loopSignals = logMessages
    .filter((m) => loopKeywords.test(m.message))
    .map((m) => m.message);

  const strategySignals = logMessages
    .filter((m) => switchKeywords.test(m.message))
    .map((m) => m.message);

  const requiredToolSignals = logMessages
    .filter((m) => icsKeywords.test(m.message))
    .map((m) => m.message);

  // ── Metric name registry ───────────────────────────────────────────────────
  const discoveredMetricNames = [
    ...new Set(metrics.map((r) => r.name as string).filter(Boolean)),
  ].sort();

  // ── Health flags ───────────────────────────────────────────────────────────
  const actPhaseCount = phaseCounts["act"] ?? 0;
  const thinkPhaseCount = phaseCounts["think"] ?? 0;
  const observePhaseCount = phaseCounts["observe"] ?? 0;

  return {
    probeId,
    file,
    analyzedAt: new Date().toISOString(),

    iterations,
    kernelSteps,
    kernelStepsByStrategy,
    kernelStepsByKernelPass,

    entropyTimeline,
    finalEntropy,
    meanEntropy,
    convergenceIteration,
    entropyShape,

    phaseCounts,
    actPhaseCount,
    thinkPhaseCount,
    observePhaseCount,
    phaseDurationMs,

    tokensUsed,
    totalDurationMs,
    model,
    provider,

    loopSignals,
    strategySignals,
    requiredToolSignals,

    exceeded10Iterations: (iterations ?? 0) > 10,
    hadLoopSignal: loopSignals.length > 0,
    hadStrategySwitch: strategySignals.length > 0,
    hadICSNudge: requiredToolSignals.length > 0,
    hasActPhase: actPhaseCount > 0,

    discoveredMetricNames,
    totalRecords: records.length,
    metricRecords: metrics.length,
    logRecords: logs.length,
    spanRecords: records.filter((r) => r._type === "span").length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatAnalysis(a: ProbeAnalysis): string {
  const lines: string[] = [
    `┌─ ${a.probeId} ─── ${a.file}`,
    `│  Records: ${a.totalRecords} (${a.metricRecords} metric, ${a.logRecords} log, ${a.spanRecords} span)`,
    `│  Model:   ${a.model ?? "?"}  provider=${a.provider ?? "?"}`,
    `│`,
    `│  EXECUTION`,
    `│    iterations:    ${a.iterations ?? "?"}`,
    `│    kernelSteps:   ${a.kernelSteps}`,
    `│    exceeded10:    ${a.exceeded10Iterations}`,
    `│    tokens:        ${a.tokensUsed?.toLocaleString() ?? "?"}`,
    `│    duration:      ${a.totalDurationMs != null ? (a.totalDurationMs / 1000).toFixed(1) + "s" : "?"}`,
    `│`,
    `│  PHASES  (count / duration_ms)`,
  ];

  const allPhases = [
    "bootstrap",
    "strategy-select",
    "think",
    "act",
    "observe",
    "memory-flush",
    "complete",
  ];
  for (const phase of allPhases) {
    const count = a.phaseCounts[phase] ?? 0;
    const dur = a.phaseDurationMs[phase];
    if (count > 0 || phase === "act") {
      lines.push(
        `│    ${phase.padEnd(18)} ${String(count).padStart(3)}  ${dur != null ? dur.toFixed(1) + "ms" : ""}`,
      );
    }
  }

  lines.push(`│`);
  lines.push(`│  QUALITY (entropy.composite)`);
  if (a.entropyTimeline.length > 0) {
    lines.push(
      `│    mean=${a.meanEntropy?.toFixed(3)}  final=${a.finalEntropy?.toFixed(3)}  shape=${a.entropyShape}`,
    );
    lines.push(
      `│    convergence at iter: ${a.convergenceIteration ?? "never"}`,
    );
    // Mini spark-line (ascii) of entropy per iteration
    const vals = a.entropyTimeline.map((p) => p.composite);
    const blocks = "▁▂▃▄▅▆▇█";
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 0.001;
    const spark = vals
      .map((v) => blocks[Math.min(7, Math.floor(((v - min) / range) * 8))])
      .join("");
    lines.push(`│    entropy: ${spark}`);
  } else {
    lines.push(`│    (no entropy data)`);
  }

  lines.push(`│`);
  lines.push(`│  SIGNALS`);
  lines.push(`│    loopDetected:    ${a.hadLoopSignal}  (${a.loopSignals.length} signals)`);
  lines.push(`│    strategySwitch:  ${a.hadStrategySwitch}  (${a.strategySignals.length} signals)`);
  lines.push(`│    ICS nudges:      ${a.hadICSNudge}  (${a.requiredToolSignals.length} signals)`);
  lines.push(`│    hasActPhase:     ${a.hasActPhase}  (act count=${a.actPhaseCount})`);

  if (a.hadLoopSignal) {
    for (const s of a.loopSignals.slice(0, 3)) {
      lines.push(`│      loop> ${s.slice(0, 80)}`);
    }
  }

  lines.push(`│`);
  lines.push(`│  KERNEL STEPS by kernelPass:`);
  for (const [pass, count] of Object.entries(a.kernelStepsByKernelPass).sort(
    ([, a], [, b]) => b - a,
  )) {
    lines.push(`│    ${pass.padEnd(30)} ${count}`);
  }

  lines.push(`└${"─".repeat(70)}`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--registry")) {
    // Print global metric registry discovered across all JSONL files
    const allNames = new Set<string>();
    const jsonlFiles = readdirSync("harness-reports")
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join("harness-reports", f));

    for (const file of jsonlFiles) {
      const a = analyzeProbeJsonl(file);
      for (const n of a.discoveredMetricNames) allNames.add(n);
    }

    console.log("METRIC REGISTRY (all .jsonl files in harness-reports/):");
    for (const name of [...allNames].sort()) {
      console.log(`  ${name}`);
    }
    return;
  }

  // Determine input files
  let inputFiles: string[] = [];
  if (args.length === 0) {
    // Default: all probe-*.jsonl in harness-reports/
    inputFiles = readdirSync("harness-reports")
      .filter((f) => f.startsWith("probe-") && f.endsWith(".jsonl"))
      .map((f) => join("harness-reports", f));
  } else {
    for (const arg of args) {
      if (arg.endsWith("/") || !arg.includes(".")) {
        // Directory
        const dir = arg.replace(/\/$/, "");
        const found = readdirSync(dir)
          .filter((f) => f.startsWith("probe-") && f.endsWith(".jsonl"))
          .map((f) => join(dir, f));
        inputFiles.push(...found);
      } else {
        inputFiles.push(arg);
      }
    }
  }

  if (inputFiles.length === 0) {
    console.error("No JSONL files found.");
    process.exit(1);
  }

  const analyses: ProbeAnalysis[] = [];

  for (const file of inputFiles) {
    const a = analyzeProbeJsonl(file);
    analyses.push(a);
    console.log(formatAnalysis(a));
    console.log();

    // Write per-probe analysis JSON
    const outPath = file.replace(/\.jsonl$/, "-analysis.json");
    writeFileSync(outPath, JSON.stringify(a, null, 2));
    console.log(`  → wrote ${outPath}\n`);
  }

  // Summary table
  if (analyses.length > 1) {
    console.log("─".repeat(80));
    console.log("SUMMARY");
    console.log("─".repeat(80));
    console.log(
      `${"PROBE".padEnd(38)} ${"ITER".padStart(5)} ${"STEPS".padStart(6)} ${"ACT".padStart(4)} ${"ENTROPY".padStart(8)} ${"LOOP".padStart(6)} ${"ICS".padStart(5)}`,
    );
    console.log("─".repeat(80));
    for (const a of analyses) {
      const iter = String(a.iterations ?? "?").padStart(5);
      const steps = String(a.kernelSteps).padStart(6);
      const act = String(a.actPhaseCount).padStart(4);
      const entropy = a.finalEntropy != null ? a.finalEntropy.toFixed(3).padStart(8) : "     ?";
      const loop = a.hadLoopSignal ? "  YES" : "   no";
      const ics = a.hadICSNudge ? "  YES" : "   no";
      console.log(`${a.probeId.padEnd(38)} ${iter} ${steps} ${act} ${entropy} ${loop} ${ics}`);
    }
  }
}

// Only run CLI when this file is the entry point (not when imported as a module)
if (import.meta.main) {
  main();
}
