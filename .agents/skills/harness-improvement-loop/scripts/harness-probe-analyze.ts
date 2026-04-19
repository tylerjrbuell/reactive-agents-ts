// harness-probe-analyze.ts — Structured analyzer for v0.10 TraceEvent JSONL
//
// Reads any <runId>.jsonl trace file and produces a ProbeAnalysis JSON.
// Uses the typed TraceEvent schema from @reactive-agents/trace.
//
// Usage:
//   bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts .reactive-agents/traces/<runId>.jsonl
//   bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts .reactive-agents/traces/
//   bun run .agents/skills/harness-improvement-loop/scripts/harness-probe-analyze.ts --registry

import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join, basename } from "path";

const DEFAULT_TRACE_DIR = ".reactive-agents/traces";

// ─────────────────────────────────────────────────────────────────────────────
// Types — aligned with TraceEvent discriminated union (packages/trace/src/events.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface EntropyDataPoint {
  iter: number;
  composite: number;
  token: number;
  structural: number;
  semantic: number;
  behavioral: number;
  contextPressure: number;
}

export interface InterventionRecord {
  iter: number;
  decisionType: string;
  patchKind: string;
}

export interface SuppressionRecord {
  iter: number;
  decisionType: string;
  reason: string;
}

export interface StrategySwitchRecord {
  iter: number;
  from: string;
  to: string;
  reason: string;
}

export interface ProbeAnalysis {
  probeId: string;
  file: string;
  analyzedAt: string;

  // Run metadata
  runId: string | null;
  runStatus: "success" | "failure" | null;
  model: string | null;
  provider: string | null;

  // Execution
  iterations: number;
  tokensUsed: number;
  totalDurationMs: number | null;
  exceeded10Iterations: boolean;

  // Entropy
  entropyTimeline: EntropyDataPoint[];
  maxEntropy: number;
  meanEntropy: number | null;
  finalEntropy: number | null;

  // Interventions
  interventionsDispatched: number;
  interventionsSuppressed: number;
  interventionsByType: Record<string, number>;
  suppressionsByReason: Record<string, number>;
  dispatched: InterventionRecord[];
  suppressed: SuppressionRecord[];

  // Strategy
  strategySwitches: StrategySwitchRecord[];
  hadStrategySwitch: boolean;
  hadEarlyStop: boolean;

  // Discovery
  discoveredEventKinds: string[];
  totalRecords: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core analyzer
// ─────────────────────────────────────────────────────────────────────────────

export function analyzeProbeJsonl(file: string): ProbeAnalysis {
  const probeId = basename(file).replace(/\.jsonl$/, "");

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

  // ── Run metadata (run-started, run-completed) ──────────────────────────────
  const started = records.find((r) => r.kind === "run-started");
  const completed = records.find((r) => r.kind === "run-completed");

  const runId = (started?.runId ?? completed?.runId ?? null) as string | null;
  const runStatus = (completed?.status ?? null) as "success" | "failure" | null;
  const model = (started?.model ?? null) as string | null;
  const provider = (started?.provider ?? null) as string | null;
  const tokensUsed = (completed?.totalTokens as number | undefined) ?? 0;
  const totalDurationMs = (completed?.durationMs as number | undefined) ?? null;

  // ── Entropy timeline (entropy-scored) ─────────────────────────────────────
  const entropyRecords = records.filter((r) => r.kind === "entropy-scored");
  const entropyTimeline: EntropyDataPoint[] = entropyRecords.map((r) => {
    const sources = (r.sources ?? {}) as Record<string, number>;
    return {
      iter: (r.iter as number) ?? -1,
      composite: (r.composite as number) ?? 0,
      token: sources.token ?? 0,
      structural: sources.structural ?? 0,
      semantic: sources.semantic ?? 0,
      behavioral: sources.behavioral ?? 0,
      contextPressure: sources.contextPressure ?? 0,
    };
  }).sort((a, b) => a.iter - b.iter);

  const composites = entropyTimeline.map((p) => p.composite);
  const maxEntropy = composites.length > 0 ? Math.max(...composites) : 0;
  const meanEntropy = composites.length > 0
    ? composites.reduce((s, v) => s + v, 0) / composites.length
    : null;
  const finalEntropy = composites.length > 0 ? composites[composites.length - 1]! : null;

  // ── Iterations ─────────────────────────────────────────────────────────────
  // Best source: count of distinct iter values in entropy-scored events.
  // Fall back to run-completed if no entropy events.
  const iterations = entropyTimeline.length > 0
    ? Math.max(...entropyTimeline.map((p) => p.iter)) + 1
    : 0;

  // ── Interventions (intervention-dispatched, intervention-suppressed) ───────
  const dispatchedRecords = records.filter((r) => r.kind === "intervention-dispatched");
  const suppressedRecords = records.filter((r) => r.kind === "intervention-suppressed");

  const dispatched: InterventionRecord[] = dispatchedRecords.map((r) => ({
    iter: (r.iter as number) ?? -1,
    decisionType: (r.decisionType as string) ?? "unknown",
    patchKind: (r.patchKind as string) ?? "unknown",
  }));

  const suppressed: SuppressionRecord[] = suppressedRecords.map((r) => ({
    iter: (r.iter as number) ?? -1,
    decisionType: (r.decisionType as string) ?? "unknown",
    reason: (r.reason as string) ?? "unknown",
  }));

  const interventionsByType: Record<string, number> = {};
  for (const d of dispatched) {
    interventionsByType[d.decisionType] = (interventionsByType[d.decisionType] ?? 0) + 1;
  }

  const suppressionsByReason: Record<string, number> = {};
  for (const s of suppressed) {
    suppressionsByReason[s.reason] = (suppressionsByReason[s.reason] ?? 0) + 1;
  }

  // ── Strategy switches (strategy-switched) ─────────────────────────────────
  const strategySwitches: StrategySwitchRecord[] = records
    .filter((r) => r.kind === "strategy-switched")
    .map((r) => ({
      iter: (r.iter as number) ?? -1,
      from: (r.from as string) ?? "unknown",
      to: (r.to as string) ?? "unknown",
      reason: (r.reason as string) ?? "",
    }));

  // ── Event kind registry ────────────────────────────────────────────────────
  const discoveredEventKinds = [
    ...new Set(records.map((r) => r.kind as string).filter(Boolean)),
  ].sort();

  return {
    probeId,
    file,
    analyzedAt: new Date().toISOString(),
    runId,
    runStatus,
    model,
    provider,
    iterations,
    tokensUsed,
    totalDurationMs,
    exceeded10Iterations: iterations > 10,
    entropyTimeline,
    maxEntropy,
    meanEntropy,
    finalEntropy,
    interventionsDispatched: dispatched.length,
    interventionsSuppressed: suppressed.length,
    interventionsByType,
    suppressionsByReason,
    dispatched,
    suppressed,
    strategySwitches,
    hadStrategySwitch: strategySwitches.length > 0,
    hadEarlyStop: dispatched.some((d) => d.decisionType === "early-stop"),
    discoveredEventKinds,
    totalRecords: records.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatAnalysis(a: ProbeAnalysis): string {
  const lines: string[] = [
    `┌─ ${a.probeId}`,
    `│  file:    ${a.file}`,
    `│  runId:   ${a.runId ?? "?"}`,
    `│  model:   ${a.model ?? "?"}  provider=${a.provider ?? "?"}`,
    `│  status:  ${a.runStatus ?? "?"}`,
    `│`,
    `│  EXECUTION`,
    `│    iterations:    ${a.iterations}  ${a.exceeded10Iterations ? "⚠ exceeded 10" : ""}`,
    `│    tokens:        ${a.tokensUsed.toLocaleString()}`,
    `│    duration:      ${a.totalDurationMs != null ? (a.totalDurationMs / 1000).toFixed(1) + "s" : "?"}`,
    `│`,
    `│  ENTROPY`,
  ];

  if (a.entropyTimeline.length > 0) {
    lines.push(`│    max=${a.maxEntropy.toFixed(3)}  mean=${a.meanEntropy?.toFixed(3)}  final=${a.finalEntropy?.toFixed(3)}`);
    const vals = a.entropyTimeline.map((p) => p.composite);
    const blocks = "▁▂▃▄▅▆▇█";
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 0.001;
    const spark = vals.map((v) => blocks[Math.min(7, Math.floor(((v - min) / range) * 8))]).join("");
    lines.push(`│    trend:  ${spark}`);
    const last = a.entropyTimeline[a.entropyTimeline.length - 1]!;
    lines.push(`│    sources (final): token=${last.token.toFixed(2)} struct=${last.structural.toFixed(2)} sem=${last.semantic.toFixed(2)} behav=${last.behavioral.toFixed(2)} ctx=${last.contextPressure.toFixed(2)}`);
  } else {
    lines.push(`│    (no entropy data)`);
  }

  lines.push(`│`);
  lines.push(`│  INTERVENTIONS  (${a.interventionsDispatched} dispatched, ${a.interventionsSuppressed} suppressed)`);
  if (a.dispatched.length > 0) {
    for (const d of a.dispatched) {
      lines.push(`│    DISPATCH  iter=${d.iter}  ${d.decisionType} → ${d.patchKind}`);
    }
  } else {
    lines.push(`│    none dispatched`);
  }
  if (a.suppressed.length > 0) {
    const byReason = Object.entries(a.suppressionsByReason)
      .map(([r, n]) => `${r}(${n})`)
      .join(", ");
    lines.push(`│    suppressed: ${byReason}`);
  }

  if (a.strategySwitches.length > 0) {
    lines.push(`│`);
    lines.push(`│  STRATEGY SWITCHES`);
    for (const s of a.strategySwitches) {
      lines.push(`│    iter=${s.iter}  ${s.from} → ${s.to}  (${s.reason})`);
    }
  }

  lines.push(`│`);
  lines.push(`│  EVENT KINDS: ${a.discoveredEventKinds.join(", ")}`);
  lines.push(`└${"─".repeat(70)}`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--registry")) {
    const allKinds = new Set<string>();
    const dir = DEFAULT_TRACE_DIR;
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f))
      : [];
    for (const file of files) {
      const a = analyzeProbeJsonl(file);
      for (const k of a.discoveredEventKinds) allKinds.add(k);
    }
    console.log(`EVENT KIND REGISTRY (all .jsonl files in ${dir}):`);
    for (const kind of [...allKinds].sort()) console.log(`  ${kind}`);
    return;
  }

  let inputFiles: string[] = [];
  if (args.length === 0) {
    inputFiles = existsSync(DEFAULT_TRACE_DIR)
      ? readdirSync(DEFAULT_TRACE_DIR)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => join(DEFAULT_TRACE_DIR, f))
      : [];
  } else {
    for (const arg of args) {
      if (arg.endsWith("/") || !arg.includes(".")) {
        const dir = arg.replace(/\/$/, "");
        inputFiles.push(
          ...readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f)),
        );
      } else {
        inputFiles.push(arg);
      }
    }
  }

  if (inputFiles.length === 0) {
    console.error(`No .jsonl files found. Run probes first, or pass a path explicitly.`);
    process.exit(1);
  }

  const analyses: ProbeAnalysis[] = [];
  for (const file of inputFiles) {
    const a = analyzeProbeJsonl(file);
    analyses.push(a);
    console.log(formatAnalysis(a));
    console.log();

    const outPath = file.replace(/\.jsonl$/, "-analysis.json");
    writeFileSync(outPath, JSON.stringify(a, null, 2));
    console.log(`  → wrote ${outPath}\n`);
  }

  if (analyses.length > 1) {
    console.log("─".repeat(90));
    console.log("SUMMARY");
    console.log("─".repeat(90));
    console.log(
      `${"PROBE".padEnd(36)} ${"ITER".padStart(5)} ${"TOKENS".padStart(7)} ${"MAX-H".padStart(6)} ${"DISPATCH".padStart(9)} ${"SUPPRESS".padStart(9)} ${"STATUS".padStart(8)}`,
    );
    console.log("─".repeat(90));
    for (const a of analyses) {
      console.log(
        `${a.probeId.padEnd(36)} ${String(a.iterations).padStart(5)} ${String(a.tokensUsed).padStart(7)} ${a.maxEntropy.toFixed(3).padStart(6)} ${String(a.interventionsDispatched).padStart(9)} ${String(a.interventionsSuppressed).padStart(9)} ${(a.runStatus ?? "?").padStart(8)}`,
      );
    }
  }
}

if (import.meta.main) {
  main();
}
