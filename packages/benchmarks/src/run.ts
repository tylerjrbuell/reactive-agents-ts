// File: src/run.ts
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import type { MultiModelReport } from "./types.js"
import { runBenchmarks } from "./runner.js"
import { runSession } from "./runner.js"
import { gateReceiptFor, powerWarningFor } from "./gate/on-path.js"
import { DEFAULT_LIFT_POLICY } from "./gate/types.js"
import { LONG_HORIZON_TASKS } from "./tasks/long-horizon.js"
import { regressionGateSession } from "./sessions/regression-gate.js"
import { realWorldFullSession } from "./sessions/real-world-full.js"
import { competitorComparisonSession } from "./sessions/competitor-comparison.js"
import { localModelsSession } from "./sessions/local-models.js"
import { frontierSpotCheckSession } from "./sessions/frontier-spot-check.js"
import { m3AblationSession } from "./sessions/m3-ablation.js"
import { contextStressSession } from "./sessions/context-stress.js"
import { recitationAblationSession } from "./sessions/recitation-ablation.js"
import { adaptiveAblationSession } from "./sessions/adaptive-ablation.js"
import { clusterAGateSession } from "./sessions/cluster-a-gate.js"
import { crossTierStressSession } from "./sessions/cross-tier-stress.js"
import { thinkingAblationSession } from "./sessions/thinking-ablation.js"
import { publicCompetitorQwenSession, publicCompetitorCogitoSession, publicCompetitorSmokeSession } from "./sessions/public-competitor-bench.js"
import { saveBaseline, loadBaseline, computeDrift, exceedsThreshold } from "./ci.js"
import { resolveTasks, assertNonEmptySelection } from "./session.js"
import { ALL_TASKS } from "./runner.js"
import type { BenchmarkSession, SessionReport } from "./types.js"

// Load workspace-root .env. Bun loads .env relative to cwd, but `bun run bench`
// invoked from `packages/benchmarks/` ignores the repo-root .env that holds
// the provider API keys — runs then silently terminate with `llm_error` at
// stream init. Walk up from this file's location to find the workspace root
// (package.json with `workspaces`) and load its .env if present.
function loadWorkspaceEnv(): void {
  let dir = dirname(new URL(import.meta.url).pathname)
  while (dir !== "/") {
    const pkgPath = join(dir, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown; name?: string }
        if (pkg.workspaces || pkg.name === "reactive-agents") {
          const envPath = join(dir, ".env")
          if (existsSync(envPath)) {
            for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
              const eq = line.indexOf("=")
              if (eq <= 0) continue
              const key = line.slice(0, eq).trim()
              if (!key || key.startsWith("#")) continue
              if (key in process.env) continue
              const raw = line.slice(eq + 1).trim()
              process.env[key] = raw.replace(/^['"]|['"]$/g, "")
            }
          }
          return
        }
      } catch { /* ignore non-JSON or unreadable */ }
    }
    dir = dirname(dir)
  }
}
loadWorkspaceEnv()

function printSessionSummary(report: SessionReport): void {
  const ablation = report.ablation ?? []
  const taskReports = report.taskReports ?? []
  // Prefer ablation (cross-variant lift) when present; fall back to taskReports
  // so single-variant sessions still print meaningful counts + per-task scores.
  const tasks = ablation.length
    ? [...new Set(ablation.map(a => a.taskId))]
    : [...new Set(taskReports.map(r => r.taskId))]
  const models = ablation.length
    ? [...new Set(ablation.map(a => a.modelVariantId))]
    : [...new Set(taskReports.map(r => r.modelVariantId))]
  const variants = ablation.length
    ? ablation[0]?.variants.map(v => v.variantId) ?? []
    : [...new Set(taskReports.map(r => r.variantId))]

  console.log("\n  ┌─────────────────────────────────────────────────────────────┐")
  console.log(`  │  Session: ${report.sessionId} v${report.sessionVersion}`)
  console.log(`  │  SHA: ${report.gitSha}  ·  Tasks: ${tasks.length}  ·  Models: ${models.length}  ·  Variants: ${variants.join(" vs ")}`)
  console.log("  ├─────────────────────────────────────────────────────────────┤")

  // Per-task harness lift table (when multi-variant ablation is available)
  for (const model of models) {
    if (ablation.length) {
      console.log(`\n  Model: ${model}`)
      console.log(`  ${"Task".padEnd(30)} ${"Bare LLM".padEnd(10)} ${"RA Full".padEnd(10)} Lift`)
      console.log("  " + "─".repeat(60))

      for (const result of ablation.filter(a => a.modelVariantId === model)) {
        // Header says "RA Full" — pull the ra-full variant specifically, not
        // bestVariantId (whichever variant scored highest accuracy, which with
        // >2 variants is often a competitor, not RA). Using bestVariantId here
        // desynced this column from `harnessLift` (ra-full - bare-llm), producing
        // nonsensical rows like a 75%->95% task showing as "-75%" lift.
        const base = result.variants.find(v => v.variantId === result.baselineVariantId)
        const full = result.variants.find(v => v.variantId === "ra-full")
        const baseScore = base?.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0
        const fullScore = full?.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0
        const lift = result.harnessLift
        const liftStr = lift > 0 ? `+${(lift * 100).toFixed(0)}%` : `${(lift * 100).toFixed(0)}%`
        console.log(`  ${result.taskName.slice(0, 29).padEnd(30)} ${(baseScore * 100).toFixed(0).padStart(6)}%   ${(fullScore * 100).toFixed(0).padStart(6)}%   ${liftStr}`)
      }
    } else {
      // Single-variant session: emit accuracy + tokens + duration per task so
      // frontier sanity checks aren't flying blind.
      const rows = taskReports.filter(r => r.modelVariantId === model)
      if (rows.length === 0) continue
      console.log(`\n  Model: ${model}  ·  Variant: ${[...new Set(rows.map(r => r.variantId))].join(", ")}`)
      console.log(`  ${"Task".padEnd(30)} ${"Acc".padEnd(8)} ${"Tokens".padEnd(8)} ${"Dur".padEnd(6)} Status`)
      console.log("  " + "─".repeat(72))
      for (const r of rows) {
        const acc = r.meanScores.find(s => s.dimension === "accuracy")?.score ?? 0
        const status = r.passRate === 1 ? "✓" : r.passRate === 0 ? "✗" : `${(r.passRate * 100).toFixed(0)}%`
        const tokStr = r.meanTokens.toString()
        const durStr = `${(r.meanDurationMs / 1000).toFixed(1)}s`
        console.log(`  ${r.taskId.slice(0, 29).padEnd(30)} ${(acc * 100).toFixed(0).padStart(5)}%  ${tokStr.padEnd(8)} ${durStr.padEnd(6)} ${status}`)
      }
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
  "frontier-spot-check":   frontierSpotCheckSession,
  "m3-ablation":           m3AblationSession,
  "context-stress":        contextStressSession,
  "recitation-ablation":   recitationAblationSession,
  "adaptive-ablation":     adaptiveAblationSession,
  "cluster-a-gate":        clusterAGateSession,
  "cross-tier-stress":     crossTierStressSession,
  "thinking-ablation":     thinkingAblationSession(),
  "public-competitor-qwen3-14b": publicCompetitorQwenSession,
  "public-competitor-cogito-8b": publicCompetitorCogitoSession,
  "public-competitor-smoke": publicCompetitorSmokeSession,
}

export interface CliArgs {
  // Legacy flags
  provider?: string
  model?: string
  tiers?: string[]
  taskIds?: string[]
  variantIds?: string[]
  output?: string
  /** `[baselineVariantId, candidateVariantId]` for the on-path lift gate. */
  gate?: string[]
  timeoutSec?: number
  // v2 flags
  session?: string
  modelIds?: string[]
  runs?: number
  saveBaseline?: boolean
  ci?: boolean
  baselinePath?: string
  verbose?: boolean
  judgeUrl?: string
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
      case "--variant":      args.variantIds = next?.split(","); i++; break
      case "--output":       args.output = next; i++; break
      case "--timeout":      args.timeoutSec = next ? parseInt(next, 10) : undefined; i++; break
      case "--session":      args.session = next; i++; break
      case "--models":       args.modelIds = next?.split(","); i++; break
      case "--runs":         args.runs = next ? parseInt(next, 10) : undefined; i++; break
      case "--save-baseline":args.saveBaseline = true; break
      case "--ci":           args.ci = true; break
      case "--baseline":     args.baselinePath = next; i++; break
      case "--verbose":      args.verbose = true; break
      case "--judge-url":    args.judgeUrl = next; i++; break
      // `--gate <baselineVariantId>,<candidateVariantId>` — print the lift-gate
      // verdict for this session's report instead of leaving the means to be
      // eyeballed. The gate had zero production callers before 2026-07-09.
      case "--gate":         args.gate = next?.split(","); i++; break
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

    let session = args.runs ? { ...sessionDef, runs: args.runs } : sessionDef
    if (args.taskIds?.length) session = { ...session, taskIds: args.taskIds, tiers: undefined } as typeof session
    // A CLI run that would measure NOTHING must fail here, before a report of
    // zeros is printed and written. (A zero-cell `runSession` is still a legal
    // library call — preflight/reproducibility tests use it deliberately — so
    // the guard lives at the reporting boundary, not inside runSession.)
    // --variant: run a subset of the session's harness variants. The fix-
    // iteration workhorse — verifying one kernel change against one failing
    // cell costs 1 variant, not 6 (feedback-loop amplification, 2026-07-07).
    if (args.variantIds?.length) {
      const want = args.variantIds
      const harnessVariants = (session.harnessVariants ?? []).filter(v => want.includes(v.id))
      if (harnessVariants.length === 0) {
        console.error(`--variant matched nothing. Session "${session.id}" has: ${(session.harnessVariants ?? []).map(v => v.id).join(", ")}`)
        process.exit(1)
      }
      session = { ...session, harnessVariants } as typeof session
    }
    if (args.verbose) session = { ...session, logLevel: "verbose" } as typeof session
    if (args.judgeUrl) session = { ...session, judgeUrl: args.judgeUrl } as typeof session
    // Filter the session's models to a subset (by id or model string), keeping
    // each model's declared contextTier — e.g. run frontier tiers now and add
    // the local tier later (results accumulate via the merge-by-cell writer).
    if (args.modelIds?.length) {
      const want = args.modelIds
      const models = session.models.filter(m => want.includes(m.id) || want.includes(m.model))
      if (models.length === 0) {
        console.error(`--models matched nothing. Session "${session.id}" has: ${session.models.map(m => m.id).join(", ")}`)
        process.exit(1)
      }
      session = { ...session, models } as typeof session
    }
    // Allow swapping the session's model via CLI: `--provider gemini --model gemini-2.5-pro`
    // Useful for spot-checking a session against a single non-default provider
    // without authoring a new session config.
    if (args.provider || args.model) {
      const provider = args.provider ?? session.models[0]?.provider
      const model = args.model ?? session.models[0]?.model
      if (provider && model) {
        session = { ...session, models: [{ id: model, provider, model, contextTier: session.models[0]?.contextTier ?? "standard" }] } as typeof session
      }
    }
    assertNonEmptySelection({
      tasks: resolveTasks(session, ALL_TASKS),
      variants: session.harnessVariants,
      ...(session.taskIds ? { requestedTaskIds: session.taskIds } : {}),
      ...(args.variantIds ? { requestedVariantIds: args.variantIds } : {}),
      available: ALL_TASKS.map((t) => t.id),
    })
    const outputPath = args.output ?? "apps/docs/src/data/benchmark-report.json"
    const baselinePath = args.baselinePath ?? `benchmark-baselines/${args.session}.json`

    const report = await runSession(session, args.output ? outputPath : undefined)
    printSessionSummary(report)

    // The gate is ON the session path (wiring audit 2026-07-09). The power
    // warning is unconditional: a multi-variant table whose cells are too thin
    // to compare must never be printed without saying so.
    const warning = powerWarningFor(report)
    if (warning) console.log(warning)
    if (args.gate) {
      const [baseline, candidate] = args.gate
      if (baseline && candidate) {
        console.log("")
        // Only the long-horizon tags matter for class routing; untagged tasks
        // are judged under the short-class (token-overhead) rule.
        console.log(gateReceiptFor(report, baseline, candidate, DEFAULT_LIFT_POLICY, {
          tasks: LONG_HORIZON_TASKS.map(t => ({ id: t.id, tags: [...(t.tags ?? [])] })),
        }))
      }
    }

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
