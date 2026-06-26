// File: src/diagnose.ts
// Wire-the-why: project trace analyzeRun into a slim RunDiagnosis attached to each run.
import { analyzeRun, loadTrace, type RunAnalysis } from "@reactive-agents/trace";
import { join } from "node:path";
import type { RunDiagnosis, TrustVerdict } from "./types.js";

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
 * Score-aware trust verdict. The trace honesty label alone is misleading for
 * text-answer tasks: `analyzeRun` labels a run `claimed-success (unverified)`
 * whenever the model claimed success + did real work but wrote no deliverable
 * FILE — so EVERY correct text answer is "unverified" (2026-06-26 sweep: this
 * inflated a "95% honesty crisis" that was mostly correct answers). The JUDGE
 * accuracy disambiguates: combine the two so the eval "why" is trustworthy.
 */
export function trustVerdict(
  honestyLabel: string | undefined,
  accuracyScore: number | undefined,
  threshold = 0.5,
): TrustVerdict {
  if (honestyLabel === undefined) return "unknown";
  if (honestyLabel === "honest-failure") return "honest-failure";
  if (honestyLabel === "dishonest-success-suspected") return "dishonest";
  if (honestyLabel === "claimed-success (unverified)") {
    if (accuracyScore === undefined) return "unknown";
    return accuracyScore >= threshold ? "verified-correct" : "claimed-but-wrong";
  }
  return "unknown";
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
