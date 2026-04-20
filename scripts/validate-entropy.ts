// Usage: bun run scripts/validate-entropy.ts .reactive-agents/traces/
// When a corpus-labels.json sidecar exists in the directory, its labels take
// precedence over the agent's self-reported completion status so AUC reflects
// the *intended* success/failure split rather than model self-assessment.
import { readdir, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { loadTrace, traceStats } from "@reactive-agents/trace"

async function main() {
  const dir = process.argv[2] ?? ".reactive-agents/traces"
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

  // Build points: (max entropy, success?)
  const points: { maxEntropy: number; success: boolean }[] = []
  for (const f of files) {
    const trace = await loadTrace(`${dir}/${f}`)
    const stats = traceStats(trace)
    const runId = trace.runId
    // Prefer corpus label; fall back to agent-reported status
    if (hasLabels && runId in corpusLabels) {
      points.push({ maxEntropy: stats.maxEntropy, success: corpusLabels[runId] === "success" })
      continue
    }
    const completed = trace.events.find((e) => e.kind === "run-completed")
    if (!completed || completed.kind !== "run-completed") continue
    points.push({ maxEntropy: stats.maxEntropy, success: completed.status === "success" })
  }

  if (points.length === 0) {
    console.log("No completed runs found in traces.")
    process.exit(0)
  }

  // Compute AUC using threshold sweep (max-entropy predicts failure)
  const thresholds = Array.from({ length: 20 }, (_: unknown, i: number) => i * 0.05)
  let auc = 0
  let prevFpr = 0
  for (const t of thresholds) {
    const tp = points.filter((p) => !p.success && p.maxEntropy >= t).length
    const fp = points.filter((p) => p.success && p.maxEntropy >= t).length
    const fn = points.filter((p) => !p.success && p.maxEntropy < t).length
    const tn = points.filter((p) => p.success && p.maxEntropy < t).length
    const tpr = tp / Math.max(1, tp + fn)
    const fpr = fp / Math.max(1, fp + tn)
    auc += (fpr - prevFpr) * tpr
    prevFpr = fpr
  }

  console.log(`\nEntropy validation over ${points.length} traces`)
  console.log(`AUC (max-entropy -> failure): ${auc.toFixed(3)}`)
  console.log(`Success rate: ${points.filter((p) => p.success).length}/${points.length}`)
  console.log(`Interpretation: AUC > 0.7 = signal is real. 0.5 = noise. < 0.5 = inverted.`)
}

main().catch(console.error)
