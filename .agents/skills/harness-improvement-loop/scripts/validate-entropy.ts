// validate-entropy.ts — Compute entropy+dispatch AUC over a directory of trace files.
//
// Usage (from project root):
//   bun run .agents/skills/harness-improvement-loop/scripts/validate-entropy.ts .reactive-agents/traces/failure-corpus
//
// When a corpus-labels.json sidecar exists in the directory (written by failure-corpus.ts),
// its labels take precedence over the agent's self-reported completion status so AUC
// reflects the *intended* success/failure split rather than model self-assessment.
//
// Metrics:
//   AUC (max-entropy → failure): does higher entropy predict failure? (imperfect for logprob-less models)
//   AUC (dispatched → failure):  does RI intervention dispatch predict failure? (target: 1.0)

import { readdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { loadTrace, traceStats } from "@reactive-agents/trace"

async function main() {
  const dir = resolve(process.cwd(), process.argv[2] ?? ".reactive-agents/traces")
  const files = (await readdir(dir).catch(() => [])).filter((f: string) => f.endsWith(".jsonl"))

  // Don't exit early if there's a labels file — labeled runs without JSONL are valid data points
  const labelFile = `${dir}/corpus-labels.json`
  const hasLabelFile = existsSync(labelFile)
  if (files.length === 0 && !hasLabelFile) {
    console.log(`No .jsonl trace files found in ${dir}`)
    console.log("Run failure-corpus.ts first to generate traces.")
    process.exit(0)
  }

  // Load corpus labels if a sidecar exists (written by failure-corpus.ts)
  const corpusLabels: Record<string, "success" | "failure"> = hasLabelFile
    ? JSON.parse(await readFile(labelFile, "utf8"))
    : {}
  const hasLabels = Object.keys(corpusLabels).length > 0
  if (hasLabels) {
    console.log(`Using corpus labels from corpus-labels.json (${Object.keys(corpusLabels).length} entries)`)
  }

  // Build a runId→stats map from JSONL files (some runs may not have files —
  // short success scenarios complete in 1 iteration and the tracer doesn't flush).
  const traceStats_: Record<string, { maxEntropy: number; dispatched: number }> = {}
  for (const f of files) {
    try {
      const trace = await loadTrace(`${dir}/${f}`)
      const s = traceStats(trace)
      traceStats_[trace.runId] = { maxEntropy: s.maxEntropy, dispatched: s.interventionsDispatched }
    } catch { /* skip unreadable files */ }
  }

  // Build points: prefer corpus labels as ground truth; fall back to agent status.
  // Labeled runs without a JSONL are included with zero entropy/dispatch — valid
  // data points (short successful runs that didn't flush a trace file).
  const points: { maxEntropy: number; dispatched: number; success: boolean }[] = []

  if (hasLabels) {
    for (const [runId, label] of Object.entries(corpusLabels)) {
      const stats = traceStats_[runId] ?? { maxEntropy: 0, dispatched: 0 }
      points.push({ ...stats, success: label === "success" })
    }
  } else {
    for (const f of files) {
      try {
        const trace = await loadTrace(`${dir}/${f}`)
        const s = traceStats(trace)
        const completed = trace.events.find((e) => e.kind === "run-completed")
        if (!completed || completed.kind !== "run-completed") continue
        points.push({ maxEntropy: s.maxEntropy, dispatched: s.interventionsDispatched, success: completed.status === "success" })
      } catch { /* skip */ }
    }
  }

  if (points.length === 0) {
    console.log("No completed runs found in traces.")
    process.exit(0)
  }

  function computeAuc(signal: (p: typeof points[number]) => number): number {
    // Sweep thresholds high → low so fpr increases from 0→1 (standard ROC direction)
    const thresholds = Array.from({ length: 21 }, (_: unknown, i: number) => 1 - i * 0.05)
    let auc = 0
    let prevFpr = 0
    let prevTpr = 0
    for (const t of thresholds) {
      const tp = points.filter((p) => !p.success && signal(p) >= t).length
      const fp = points.filter((p) => p.success && signal(p) >= t).length
      const fn = points.filter((p) => !p.success && signal(p) < t).length
      const tn = points.filter((p) => p.success && signal(p) < t).length
      const tpr = tp / Math.max(1, tp + fn)
      const fpr = fp / Math.max(1, fp + tn)
      auc += (fpr - prevFpr) * (tpr + prevTpr) / 2  // trapezoid rule
      prevFpr = fpr
      prevTpr = tpr
    }
    return Math.abs(auc)
  }

  const entropyAuc = computeAuc((p) => p.maxEntropy)
  const maxDispatched = Math.max(...points.map((p) => p.dispatched), 1)
  const dispatchAuc = computeAuc((p) => p.dispatched / maxDispatched)

  const successPts = points.filter(p => p.success)
  const failPts = points.filter(p => !p.success)
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length)

  console.log(`\nEntropy+Dispatch validation over ${points.length} traces`)
  console.log(`─── Entropy signal ───────────────────────────────────────────`)
  console.log(`  AUC (max-entropy → failure): ${entropyAuc.toFixed(3)}   (>0.7 = real signal)`)
  console.log(`  Avg entropy  success=${avg(successPts.map(p => p.maxEntropy)).toFixed(3)}  failure=${avg(failPts.map(p => p.maxEntropy)).toFixed(3)}  gap=${(avg(failPts.map(p => p.maxEntropy)) - avg(successPts.map(p => p.maxEntropy))).toFixed(3)}`)
  console.log(`─── Dispatch signal ──────────────────────────────────────────`)
  console.log(`  AUC (dispatched → failure):  ${dispatchAuc.toFixed(3)}   (target: 1.0)`)
  console.log(`  Avg dispatch success=${avg(successPts.map(p => p.dispatched)).toFixed(1)}  failure=${avg(failPts.map(p => p.dispatched)).toFixed(1)}`)
  console.log(`Success rate: ${successPts.length}/${points.length}`)
}

main().catch(console.error)
