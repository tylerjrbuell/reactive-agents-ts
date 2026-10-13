#!/usr/bin/env bun
/**
 * Lift Protocol rung-0 baseline runner (Task 0, 2026-10-12 program).
 *
 * Captures the canonical defect scenarios (S1-S4) at temp 0 against the
 * harness AS SHIPPED at Wave 0 close. ZERO framework behavior changes: this
 * file only composes the public builder (`@reactive-agents/runtime`) and the
 * public file-root seam (`@reactive-agents/tools`), then parses the trace
 * JSONL the recorder writes into `fixtures/` via
 * `.withObservability({ tracing: { dir } })`.
 *
 * Interface (per plan): runScenario({id, model, task, config, n, temperature,
 * traceDir}) → per-run metric rows extracted from trace events by kind:
 *   assessment.evidenceDelta, llm-exchange (purpose/content/toolCalls/tokens),
 *   guard-fired, tool-call-start, run-completed.
 *
 * Metrics append to `fixtures/baseline-metrics.jsonl` (one JSON object per
 * run, crash-safe incremental) — the scoreboard/MANIFEST rows are derived
 * from that file + the per-run trace JSONL (committed alongside).
 *
 * Usage:
 *   bun run scripts/lift/bench.ts list
 *   bun run scripts/lift/bench.ts <arm-id> [<arm-id> ...]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ReactiveAgents } from "@reactive-agents/runtime"
import { withFileRoot } from "@reactive-agents/tools"

// ─── Extractor (pure over JSONL text; unit-tested against a committed fixture) ───

export interface AssessmentRow {
  readonly iter: number
  readonly evidenceDelta: number
  readonly band: string
  readonly requirementsOutstanding: number
  readonly deliverablesMissing: number
}

export interface RunMetrics {
  readonly arm: string
  readonly runIndex: number
  readonly runId: string
  readonly traceFile: string
  readonly capturedAt: string
  readonly wallClockMs: number
  readonly hung: boolean
  readonly success: boolean | null
  readonly runStatus: string | null
  readonly terminatedBy: string | null
  readonly totalTokens: number | null
  readonly totalCostUsd: number | null
  readonly durationMs: number | null
  readonly llmCalls: number
  readonly thinkCalls: number
  readonly classifyCalls: number
  readonly tokensInSum: number
  readonly tokensOutSum: number
  readonly assessments: readonly AssessmentRow[]
  readonly evidenceDeltaAllZero: boolean
  readonly emptyContentThinkExchanges: number
  readonly emptyContentRate: number | null
  readonly firstActingIter: number | null
  readonly toolCallCounts: Readonly<Record<string, number>>
  readonly loopDetectorEvents: number
  readonly guardFired: ReadonlyArray<{ readonly guard: string; readonly outcome: string; readonly iter: number }>
  readonly decisionEvaluated: Readonly<Record<string, number>>
  readonly falseSuccess: boolean
  readonly finalRequirementsOutstanding: number | null
  readonly finalDeliverablesMissing: number | null
  readonly maxToolSchemaNamesPerCall: number
  readonly schemaNamesPerCall: readonly number[]
}

type Json = Record<string, unknown>

const asNum = (v: unknown, dflt = 0): number => (typeof v === "number" ? v : dflt)
const asStr = (v: unknown, dflt = ""): string => (typeof v === "string" ? v : dflt)
const asArr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : [])

/** Parse a trace JSONL (tolerating partial flushes / bad lines) into metrics. */
export function extractRunMetrics(jsonl: string, arm: string, runIndex: number): RunMetrics {
  const events: Json[] = []
  for (const line of jsonl.split("\n")) {
    const t = line.trim()
    if (!t) continue
    try {
      const obj: unknown = JSON.parse(t)
      if (obj && typeof obj === "object") events.push(obj as Json)
    } catch {
      /* partial line (flush mid-write) — skip, keep the rest */
    }
  }
  const byKind = (kind: string): Json[] => events.filter((e) => e.kind === kind)
  const runId = asStr(events[0]?.runId)

  const assessments: AssessmentRow[] = byKind("assessment").map((e) => ({
    iter: asNum(e.iter, -1),
    evidenceDelta: asNum(e.evidenceDelta),
    band: asStr(e.band),
    requirementsOutstanding: asNum(e.requirementsOutstanding),
    deliverablesMissing: asNum(e.deliverablesMissing),
  }))
  const evidenceDeltaAllZero = assessments.length > 0 && assessments.every((a) => a.evidenceDelta === 0)

  const exchanges = byKind("llm-exchange")
  let thinkCalls = 0
  let classifyCalls = 0
  let tokensInSum = 0
  let tokensOutSum = 0
  let emptyContentThinkExchanges = 0
  const schemaNamesPerCall: number[] = []
  for (const e of exchanges) {
    const purpose = asStr(e.purpose, "unknown")
    if (purpose === "think") thinkCalls++
    if (purpose === "classify") classifyCalls++
    const resp = (e.response ?? {}) as Json
    tokensInSum += asNum(resp.tokensIn)
    tokensOutSum += asNum(resp.tokensOut)
    const content = asStr(resp.content)
    const toolCalls = asArr(resp.toolCalls)
    if (purpose === "think" && content.trim() === "" && toolCalls.length === 0) emptyContentThinkExchanges++
    const names = asArr(e.toolSchemaNames)
    schemaNamesPerCall.push(names.length)
  }

  const toolCallCounts: Record<string, number> = {}
  let firstActingIter: number | null = null
  for (const e of byKind("tool-call-start")) {
    const name = asStr(e.toolName, "?")
    toolCallCounts[name] = (toolCallCounts[name] ?? 0) + 1
    const iter = asNum(e.iter, -1)
    if (firstActingIter === null || iter < firstActingIter) firstActingIter = iter
  }

  const guards = byKind("guard-fired").map((e) => ({
    guard: asStr(e.guard),
    outcome: asStr(e.outcome),
    iter: asNum(e.iter, -1),
  }))
  const loopDetectorEvents = guards.filter((g) => g.guard.toLowerCase().includes("loop")).length

  const decisionEvaluated: Record<string, number> = {}
  for (const e of byKind("decision-evaluated")) {
    const dt = asStr(e.decisionType, "?")
    decisionEvaluated[dt] = (decisionEvaluated[dt] ?? 0) + 1
  }

  const completed = byKind("run-completed")[0] as Json | undefined
  const runStatus = completed ? asStr(completed.status) : null
  const terminatedBy = completed?.terminatedBy !== undefined ? asStr(completed.terminatedBy, "undefined") : null
  const lastAssessment = assessments.length > 0 ? assessments[assessments.length - 1] : null
  const outstanding = lastAssessment ? lastAssessment.requirementsOutstanding : null
  const missing = lastAssessment ? lastAssessment.deliverablesMissing : null
  const success = runStatus !== null ? runStatus === "success" : null
  const falseSuccess =
    success === true &&
    ((outstanding !== null && outstanding > 0) ||
      (missing !== null && missing > 0) ||
      (terminatedBy !== null && terminatedBy !== "final_answer" && terminatedBy !== "final_answer_tool"))

  return {
    arm,
    runIndex,
    runId,
    traceFile: "",
    capturedAt: new Date().toISOString(),
    wallClockMs: 0,
    hung: false,
    success,
    runStatus,
    terminatedBy,
    totalTokens: completed ? asNum(completed.totalTokens, -1) : null,
    totalCostUsd: completed ? asNum(completed.totalCostUsd, -1) : null,
    durationMs: completed ? asNum(completed.durationMs, -1) : null,
    llmCalls: exchanges.length,
    thinkCalls,
    classifyCalls,
    tokensInSum,
    tokensOutSum,
    assessments,
    evidenceDeltaAllZero,
    emptyContentThinkExchanges,
    emptyContentRate: thinkCalls > 0 ? emptyContentThinkExchanges / thinkCalls : null,
    firstActingIter,
    toolCallCounts,
    loopDetectorEvents,
    guardFired: guards,
    decisionEvaluated,
    falseSuccess,
    finalRequirementsOutstanding: outstanding,
    finalDeliverablesMissing: missing,
    maxToolSchemaNamesPerCall: schemaNamesPerCall.reduce((m, x) => Math.max(m, x), 0),
    schemaNamesPerCall,
  }
}

// ─── Scenario definitions (temp 0) ───

export const FIXTURES_DIR = join(
  import.meta.dir,
  "../../wiki/Research/Harness-Reports/2026-10-12-live-probe-audit-results/fixtures",
)
const METRICS_LOG = join(FIXTURES_DIR, "baseline-metrics.jsonl")

const S1_TASK =
  'Send a slack message to the #general channel saying "Hello, team! This is a test message from our Reactive Agent."'

// Arithmetic word problem sized so thinking ≫ visible content (single-number answer).
const S2_TASK =
  "Solve this carefully, step by step, then reply with ONLY the final number. A warehouse has 143 crates, each holding 12 kg of grain. On Monday they ship out 9 full crates but 3 crates are damaged and the grain from those is discarded. On Tuesday they receive 4 new crates of grain plus 1 half-empty crate holding 6 kg. On Wednesday a customer buys half of ALL remaining grain at $4 per kg, paying $200 up front and the rest on delivery. On Thursday they pay the rest. How many dollars did the customer pay on Thursday?"

// Multi-step file task (S3 + S4 share it): read 2 inputs → transform → 3-section report.
const S3_TASK =
  "In the current directory there are two files, sales-q1.txt and sales-q2.txt, each listing per-product revenue for one quarter. Read both files. Then write a file named report.md containing exactly three markdown sections, with these headings: ## Summary, ## Totals, ## Recommendation. Under Totals, list each product's combined revenue across both quarters and the grand total. Under Recommendation, write one sentence about which product is declining."

interface ArmSpec {
  readonly id: string
  readonly scenario: "S1" | "S2" | "S3" | "S4"
  readonly provider: "ollama" | "anthropic"
  readonly model: string
  readonly task: string
  readonly n: number
  readonly fileTools: boolean
  readonly numCtx?: number
  /** Mirror the benchmarks ra-full variant (tools+reasoning+RI+memory) — rung-2 arms. */
  readonly fullHarness?: boolean
}

export const ARMS: readonly ArmSpec[] = [
  { id: "s1-qwen34b", scenario: "S1", provider: "ollama", model: "qwen3:4b", task: S1_TASK, n: 5, fileTools: false },
  { id: "s2-qwen34b", scenario: "S2", provider: "ollama", model: "qwen3:4b", task: S2_TASK, n: 5, fileTools: false },
  { id: "s3-qwen34b", scenario: "S3", provider: "ollama", model: "qwen3:4b", task: S3_TASK, n: 5, fileTools: true, numCtx: 8192 },
  { id: "s3-llama32", scenario: "S3", provider: "ollama", model: "llama3.2:latest", task: S3_TASK, n: 5, fileTools: true, numCtx: 8192 },
  { id: "s1-qwen35", scenario: "S1", provider: "ollama", model: "qwen3.5:latest", task: S1_TASK, n: 5, fileTools: false },
  { id: "s4-phi4mini", scenario: "S4", provider: "ollama", model: "phi4-mini-reasoning:latest", task: S3_TASK, n: 3, fileTools: true },
  { id: "haiku-s1", scenario: "S1", provider: "anthropic", model: "claude-haiku-4-5-20251001", task: S1_TASK, n: 3, fileTools: false, fullHarness: true },
  { id: "haiku-s3", scenario: "S3", provider: "anthropic", model: "claude-haiku-4-5-20251001", task: S3_TASK, n: 3, fileTools: true, fullHarness: true },
]

const HANG_MS = 8 * 60_000

// ─── runScenario ──────────────────────────────────────────────────────────────

function freshTraceFile(traceDir: string, afterMs: number): string | null {
  // Recorder writes <runId>.jsonl; on a hang we take the newest file created
  // after the run started (partial flush is still baseline data).
  let best: string | null = null
  let bestM = afterMs
  for (const f of readdirSync(traceDir)) {
    if (!f.endsWith(".jsonl")) continue
    const p = join(traceDir, f)
    const m = statSync(p).mtimeMs
    if (m > bestM) { bestM = m; best = p }
  }
  return best
}

async function prepareWorkspace(arm: ArmSpec, runIndex: number): Promise<string> {
  const ws = join(FIXTURES_DIR, "workspaces", `${arm.id}-run${runIndex}`)
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(ws, "sales-q1.txt"), "Q1 sales by product (USD)\nWidget: 1200\nGadget: 800\nGizmo: 500\n")
  writeFileSync(join(ws, "sales-q2.txt"), "Q2 sales by product (USD)\nWidget: 900\nGadget: 1100\nGizmo: 400\n")
  return ws
}

export interface ScenarioRunOptions {
  readonly arm: ArmSpec
  readonly runIndex: number
  readonly temperature: number
  readonly traceDir: string
}

/** One scenario run: build → run (with hang guard) → extract → append metric line. */
export async function runScenario(opts: ScenarioRunOptions): Promise<RunMetrics> {
  const { arm, runIndex, temperature, traceDir } = opts
  mkdirSync(traceDir, { recursive: true })

  let builder = ReactiveAgents.create()
    .withName(`lift-${arm.id}-r${runIndex}`)
    .withProvider(arm.provider)
    .withModel(
      arm.numCtx !== undefined
        ? { model: arm.model, temperature, numCtx: arm.numCtx }
        : { model: arm.model, temperature },
    )
    .withObservability({ tracing: { dir: traceDir } })

  if (arm.fullHarness) {
    // Mirrors packages/benchmarks/src/runner.ts ra-full mapping
    // ({tools,reasoning,reactiveIntelligence,memory} → these withers).
    builder = arm.fileTools
      ? builder.withTools({ builtins: ["file-read", "file-write"] })
      : builder.withTools()
    builder = builder
      .withReasoning({ defaultStrategy: "reactive" })
      .withReactiveIntelligence()
      .withMemory()
  } else {
    if (arm.fileTools) builder = builder.withTools({ builtins: ["file-read", "file-write"] })
    builder = builder
      .withoutMemory()
      .withReasoning({ strategies: { reactive: { maxIterations: 10 } } })
  }

  const agent = await builder.build()
  const startTs = Date.now()
  let hung = false
  let result: Awaited<ReturnType<typeof agent.run>> | null = null
  try {
    const exec = arm.fileTools
      ? withFileRoot(await prepareWorkspace(arm, runIndex), () => agent.run(arm.task))
      : agent.run(arm.task)
    let guardTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const guard = new Promise<"hung">((res) => { guardTimer = setTimeout(() => res("hung"), HANG_MS) })
      const raced = await Promise.race([exec.then((r) => ({ r })), guard])
      if (raced === "hung") hung = true
      else result = raced.r
    } finally {
      if (guardTimer !== undefined) clearTimeout(guardTimer)
    }
  } finally {
    let disposeTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        agent.dispose().finally(() => { if (disposeTimer !== undefined) clearTimeout(disposeTimer) }),
        new Promise<void>((res) => { disposeTimer = setTimeout(res, 15_000) }),
      ])
    } catch { /* dispose failure is not capture-fatal */ }
    if (disposeTimer !== undefined) clearTimeout(disposeTimer)
  }

  const wallClockMs = Date.now() - startTs
  const meta = (result?.metadata ?? {}) as Record<string, unknown>
  let tracePath = typeof meta.tracePath === "string" ? meta.tracePath : null
  if (!tracePath) tracePath = freshTraceFile(traceDir, startTs - 5_000)
  const traceFile = tracePath ?? ""
  const base = traceFile && existsSync(traceFile) ? extractRunMetrics(readFileSync(traceFile, "utf8"), arm.id, runIndex) : extractRunMetrics("", arm.id, runIndex)
  const metrics: RunMetrics = { ...base, traceFile, wallClockMs, hung, ...(hung ? { success: null } : {}) }
  appendFileSync(METRICS_LOG, JSON.stringify(metrics) + "\n")
  console.log(JSON.stringify(metrics))
  return metrics
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === "list") {
    for (const a of ARMS) console.log(`${a.id}\t${a.scenario}\t${a.provider}\t${a.model}\tn=${a.n}`)
    return
  }
  for (const id of args) {
    const arm = ARMS.find((a) => a.id === id)
    if (!arm) { console.error(`unknown arm: ${id}`); process.exit(1) }
    for (let k = 1; k <= arm.n; k++) {
      console.error(`[bench] ${arm.id} run ${k}/${arm.n} start`)
      await runScenario({ arm, runIndex: k, temperature: 0, traceDir: FIXTURES_DIR })
    }
  }
}

if (import.meta.main) await main()
