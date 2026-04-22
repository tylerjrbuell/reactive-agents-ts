// File: src/run.ts
import { writeFileSync, readFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { MultiModelReport } from "./types.js"
import { runBenchmarks } from "./runner.js"
import { runSession } from "./runner.js"
import { regressionGateSession } from "./sessions/regression-gate.js"
import { realWorldFullSession } from "./sessions/real-world-full.js"
import { competitorComparisonSession } from "./sessions/competitor-comparison.js"
import { localModelsSession } from "./sessions/local-models.js"
import { saveBaseline, loadBaseline, computeDrift, exceedsThreshold } from "./ci.js"
import type { BenchmarkSession, SessionReport } from "./types.js"

function printSessionSummary(report: SessionReport): void {
  const ablation = report.ablation ?? []
  const tasks = [...new Set(ablation.map(a => a.taskId))]
  const models = [...new Set(ablation.map(a => a.modelVariantId))]
  const variants = ablation[0]?.variants.map(v => v.variantId) ?? []

  console.log("\n  ┌─────────────────────────────────────────────────────────────┐")
  console.log(`  │  Session: ${report.sessionId} v${report.sessionVersion}`)
  console.log(`  │  SHA: ${report.gitSha}  ·  Tasks: ${tasks.length}  ·  Models: ${models.length}  ·  Variants: ${variants.join(" vs ")}`)
  console.log("  ├─────────────────────────────────────────────────────────────┤")

  // Per-task harness lift table
  for (const model of models) {
    console.log(`\n  Model: ${model}`)
    console.log(`  ${"Task".padEnd(30)} ${"Bare LLM".padEnd(10)} ${"RA Full".padEnd(10)} Lift`)
    console.log("  " + "─".repeat(60))

    for (const result of ablation.filter(a => a.modelVariantId === model)) {
      const base = result.variants.find(v => v.variantId === result.baselineVariantId)
      const best = result.variants.find(v => v.variantId === result.bestVariantId)
      const baseScore = base?.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0
      const bestScore = best?.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0
      const lift = result.harnessLift
      const liftStr = lift > 0 ? `+${(lift * 100).toFixed(0)}%` : `${(lift * 100).toFixed(0)}%`
      console.log(`  ${result.taskName.slice(0, 29).padEnd(30)} ${(baseScore * 100).toFixed(0).padStart(6)}%   ${(bestScore * 100).toFixed(0).padStart(6)}%   ${liftStr}`)
    }
  }

  // Dimension summary
  if (report.dimensionSummary?.length) {
    console.log("\n  Dimension scores by variant:")
    for (const dim of report.dimensionSummary) {
      const scores = dim.byVariant.map(v => `${v.variantId}: ${(v.meanScore * 100).toFixed(0)}%`).join("  ")
      console.log(`    ${dim.dimension.padEnd(22)} ${scores}`)
    }
  }

  console.log("\n  └─────────────────────────────────────────────────────────────┘\n")
}

const SESSIONS: Record<string, BenchmarkSession> = {
  "regression-gate":       regressionGateSession,
  "real-world-full":       realWorldFullSession,
  "competitor-comparison": competitorComparisonSession,
  "local-models":          localModelsSession,
}

export interface CliArgs {
  // Legacy flags
  provider?: string
  model?: string
  tiers?: string[]
  taskIds?: string[]
  output?: string
  timeoutSec?: number
  // v2 flags
  session?: string
  runs?: number
  saveBaseline?: boolean
  ci?: boolean
  baselinePath?: string
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!
    const next = argv[i + 1]
    switch (flag) {
      case "--provider":     args.provider = next; i++; break
      case "--model":        args.model = next; i++; break
      case "--tier":         args.tiers = next?.split(","); i++; break
      case "--task":         args.taskIds = next?.split(","); i++; break
      case "--output":       args.output = next; i++; break
      case "--timeout":      args.timeoutSec = next ? parseInt(next, 10) : undefined; i++; break
      case "--session":      args.session = next; i++; break
      case "--runs":         args.runs = next ? parseInt(next, 10) : undefined; i++; break
      case "--save-baseline":args.saveBaseline = true; break
      case "--ci":           args.ci = true; break
      case "--baseline":     args.baselinePath = next; i++; break
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  // ── v2 path: named session ───────────────────────────────────────────────
  if (args.session) {
    const sessionDef = SESSIONS[args.session]
    if (!sessionDef) {
      console.error(`Unknown session: ${args.session}. Available: ${Object.keys(SESSIONS).join(", ")}`)
      process.exit(1)
    }

    const session = args.runs ? { ...sessionDef, runs: args.runs } : sessionDef
    const outputPath = args.output ?? "apps/docs/src/data/benchmark-report.json"
    const baselinePath = args.baselinePath ?? `benchmark-baselines/${args.session}.json`

    const report = await runSession(session, args.output ? outputPath : undefined)
    printSessionSummary(report)

    if (args.saveBaseline) {
      const allVariantReports = report.ablation?.flatMap(a => a.variants) ?? []
      saveBaseline(allVariantReports, report.gitSha, baselinePath)
      console.log(`Baseline saved to ${baselinePath}`)
    }

    if (args.ci) {
      const baseline = loadBaseline(baselinePath)
      if (!baseline) {
        console.warn("No baseline found — skipping drift check. Run with --save-baseline first.")
      } else {
        const allVariantReports = report.ablation?.flatMap(a => a.variants) ?? []
        const drift = computeDrift(baseline.reports, allVariantReports, baseline.gitSha)
        if (exceedsThreshold(drift)) {
          console.error(`CI FAIL: ${drift.regressions.length} regressions detected. Max delta: ${drift.maxRegressionDelta.toFixed(3)}`)
          for (const r of drift.regressions) {
            console.error(`  ${r.taskId} / ${r.variantId} / ${r.dimension}: ${r.baselineScore.toFixed(2)} → ${r.currentScore.toFixed(2)} (${r.delta.toFixed(2)})`)
          }
          process.exit(1)
        }
        console.log(`CI PASS: no significant regressions (${drift.improvements.length} improvements)`)
      }
    }

    return
  }

  // ── Legacy path: runBenchmarks() ────────────────────────────────────────
  const provider = (args.provider ?? "anthropic") as Parameters<typeof runBenchmarks>[0]["provider"]
  const report = await runBenchmarks({
    provider,
    model: args.model,
    tiers: args.tiers as Parameters<typeof runBenchmarks>[0]["tiers"],
    taskIds: args.taskIds,
    timeoutMs: args.timeoutSec ? args.timeoutSec * 1000 : undefined,
  })

  if (args.output) {
    let existing: MultiModelReport = { generatedAt: new Date().toISOString(), runs: [] }
    try { existing = JSON.parse(readFileSync(args.output, "utf8")) as MultiModelReport } catch {}
    const updated: MultiModelReport = {
      generatedAt: new Date().toISOString(),
      runs: [
        ...existing.runs.filter(r => !(r.provider === report.provider && r.model === report.model)),
        report,
      ],
    }
    mkdirSync(dirname(args.output), { recursive: true })
    writeFileSync(args.output, JSON.stringify(updated, null, 2), "utf8")
    console.log(`\n  Report written to ${args.output}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
