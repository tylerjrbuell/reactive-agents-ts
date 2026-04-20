// Usage: bun run scripts/validate-entropy.ts .reactive-agents/traces/
// When a corpus-labels.json sidecar exists in the directory, its labels take
// precedence over the agent's self-reported completion status so AUC reflects
// the *intended* success/failure split rather than model self-assessment.
import { readdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { loadTrace, traceStats } from "@reactive-agents/trace"

async function main() {
  const dir = resolve(process.cwd(), process.argv[2] ?? ".reactive-agents/traces")
  const files = (await readdir(dir).catch(() => [])).filter((f: string) => f.endsWith(".jsonl"))

  if (files.length === 0) {
    console.log(`No .jsonl trace files found in ${dir}`)
    console.log("Run the agent harness with .withTracing() to generate traces first.")
    process.exit(0)
  }

  // Load corpus labels if a sidecar exists (written by failure-corpus.ts)
  const labelFile = `${dir}/corpus-labels.json`
  const corpusLabels: Record<string, "success" | "failure"> = existsSync(labelFile)
    ? JSON.parse(await readFile(labelFile, "utf8"))
    : {}
  const hasLabels = Object.keys(corpusLabels).length > 0
  if (hasLabels) {
    console.log(`Using corpus labels from corpus-labels.json (${Object.keys(corpusLabels).length} entries)`)
  }

  // Build points: (max entropy, dispatched count, success?)
  const points: { maxEntropy: number; dispatched: number; success: boolean }[] = []
  for (const f of files) {
    const trace = await loadTrace(`${dir}/${f}`)
    const stats = traceStats(trace)
    const runId = trace.runId
    // Prefer corpus label; fall back to agent-reported status
    if (hasLabels && runId in corpusLabels) {
      points.push({
        maxEntropy: stats.maxEntropy,
        dispatched: stats.interventionsDispatched,
        success: corpusLabels[runId] === "success",
      })
      continue
    }
    const completed = trace.events.find((e) => e.kind === "run-completed")
    if (!completed || completed.kind !== "run-completed") continue
    points.push({
      maxEntropy: stats.maxEntropy,
      dispatched: stats.interventionsDispatched,
      success: completed.status === "success",
    })
  }

  if (points.length === 0) {
    console.log("No completed runs found in traces.")
    process.exit(0)
  }

  function computeAuc(signal: (p: typeof points[number]) => number): number {
    // Sweep thresholds high → low so fpr goes 0→1 (correct ROC direction)
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
      // Trapezoid rule
      auc += (fpr - prevFpr) * (tpr + prevTpr) / 2
      prevFpr = fpr
      prevTpr = tpr
    }
    return Math.abs(auc)
  }

  const entropyAuc = computeAuc((p) => p.maxEntropy)
  // Normalise dispatch count to [0,1] range for threshold sweep
  const maxDispatched = Math.max(...points.map((p) => p.dispatched), 1)
  const dispatchAuc = computeAuc((p) => p.dispatched / maxDispatched)

  const avgEntropySuccess = points.filter(p => p.success).reduce((s, p) => s + p.maxEntropy, 0) / Math.max(1, points.filter(p => p.success).length)
  const avgEntropyFailure = points.filter(p => !p.success).reduce((s, p) => s + p.maxEntropy, 0) / Math.max(1, points.filter(p => !p.success).length)
  const avgDispatchSuccess = points.filter(p => p.success).reduce((s, p) => s + p.dispatched, 0) / Math.max(1, points.filter(p => p.success).length)
  const avgDispatchFailure = points.filter(p => !p.success).reduce((s, p) => s + p.dispatched, 0) / Math.max(1, points.filter(p => !p.success).length)

  console.log(`\nEntropy+Dispatch validation over ${points.length} traces`)
  console.log(`─── Entropy signal ───────────────────────────────────────────`)
  console.log(`  AUC (max-entropy → failure): ${entropyAuc.toFixed(3)}   (>0.7 = real signal)`)
  console.log(`  Avg entropy  success=${avgEntropySuccess.toFixed(3)}  failure=${avgEntropyFailure.toFixed(3)}  gap=${(avgEntropyFailure - avgEntropySuccess).toFixed(3)}`)
  console.log(`─── Dispatch signal ──────────────────────────────────────────`)
  console.log(`  AUC (dispatched → failure):  ${dispatchAuc.toFixed(3)}   (>0.7 = real signal)`)
  console.log(`  Avg dispatch success=${avgDispatchSuccess.toFixed(1)}  failure=${avgDispatchFailure.toFixed(1)}`)
  console.log(`Success rate: ${points.filter((p) => p.success).length}/${points.length}`)
}

main().catch(console.error)
