// File: src/diagnose.ts
// Wire-the-why: project trace analyzeRun into a slim RunDiagnosis attached to each run.
import { analyzeRun, loadTrace, type RunAnalysis } from "@reactive-agents/trace";
import { join } from "node:path";
import type { RunDiagnosis } from "./types.js";

/** Pure projection: RunAnalysis -> slim RunDiagnosis. */
export function projectDiagnosis(analysis: RunAnalysis): RunDiagnosis {
  return {
    honestyLabel: analysis.honesty.label,
    honestyEvidence: analysis.honesty.evidence,
    failureModes: analysis.failureModes.map((f) => ({ mode: f.mode, evidence: f.evidence })),
    blindSpots: analysis.coverage.blindSpots.map((b) => `${b.metric}: ${b.reason}`),
  };
}

/**
 * Best-effort: load the run's trace from `${traceDir}/<taskId>.jsonl`, analyze, project.
 * Returns undefined if tracing is off or the file is missing/unreadable — never throws.
 */
export async function diagnoseRun(
  traceDir: string | undefined,
  taskId: string,
): Promise<RunDiagnosis | undefined> {
  if (!traceDir) return undefined;
  try {
    const trace = await loadTrace(join(traceDir, `${taskId}.jsonl`));
    if (trace.events.length === 0) return undefined;
    return projectDiagnosis(analyzeRun(trace));
  } catch {
    return undefined;
  }
}

/** A run is "flag-worthy" when honesty is not a clean honest-failure, OR any failure mode / blind spot exists. */
export function formatDiagnosisLine(diag: RunDiagnosis): string | null {
  const honestySuspect = diag.honestyLabel !== "honest-failure";
  if (!honestySuspect && diag.failureModes.length === 0 && diag.blindSpots.length === 0) {
    return null;
  }
  const parts: string[] = [];
  if (honestySuspect) parts.push(`honesty=${diag.honestyLabel}`);
  if (diag.failureModes.length > 0) {
    parts.push(`failure=${diag.failureModes.map((f) => f.mode).join(",")}`);
  }
  if (diag.blindSpots.length > 0) parts.push(`blind=${diag.blindSpots.length}`);
  return `⚠ ${parts.join(" · ")}`;
}
