// File: src/h3/run-h3.ts
//
// H3 runner. REUSES runSession (one cell = one runSession call with runs=1) so
// task dispatch, hidden-fixture scoring, billed-token capture and trace wiring
// are exactly the bench's own. This file adds only: the frozen task registration,
// per-cell isolated trace dirs, resume-by-cell-id, and incremental persistence.
//
//   bun run src/h3/run-h3.ts --out <ABS results.json> --trace-root <ABS dir> \
//     --tier qwen3:4b --k 5 --budget-sec 560
//
// Cells are visited RUN-MAJOR (every task at run 0, then every task at run 1,...)
// so a cut-off leaves balanced coverage. A re-invocation with the same --out skips
// every cell already recorded. A cell is never started if it cannot finish inside
// --budget-sec (cell wall = --cell-timeout-sec).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { spawnSync, execSync } from "node:child_process"
import { runSession, ALL_TASKS } from "../runner.js"
import { isSolved } from "../report-format.js"
import type { BenchmarkTask, HarnessVariant, ModelVariant } from "../types.js"
import { H3_TASKS } from "./tasks.js"
import { h3Hashes } from "./freeze.js"

export const H3_VERSION = "1.0.0"

/** The default-path arm: tools + reasoning, nothing opt-in (no memory / long-horizon). */
export const H3_VARIANT: HarnessVariant = {
  type: "internal",
  id: "ra-default",
  label: "RA default path (tools+reasoning)",
  config: { tools: true, reasoning: true },
}

/**
 * OPT-IN second arm (`--meta-arm`) for the todo-heavy shape; NOT part of the
 * baseline. Instrument check 2026-11-03 (qwen3:4b, run-started.config + every
 * tool-surface-resolved event): the default path exposes `[...required, recall]`
 * and `.withMetaTools()` adds only brief/pulse/find. The `todo` meta-tool is
 * visible in NEITHER arm, and the bench HarnessConfig (`metaTools: boolean`)
 * cannot express `withMetaTools({ todo: true })`. So H3 cannot yet exercise the
 * K2 surface (todo-iteration stall accrual); that needs a bench-seam widening.
 */
export const H3_META_VARIANT: HarnessVariant = {
  type: "internal",
  id: "ra-default+meta",
  label: "RA default path + meta-tools (todo/brief/checkpoint/pulse)",
  config: { tools: true, reasoning: true, metaTools: true },
}

/** Task ids that also run under the meta-tools arm. */
export const H3_META_TASKS: readonly string[] = ["h3-todo-heavy"]

export const H3_TIERS: Record<string, ModelVariant> = {
  // Tier choice is constrained by the bench's capability-source preflight: models
  // absent from STATIC_CAPABILITIES (llama3.2:3b, gemma4:e4b, gemma4:12b) resolve
  // source="fallback" (2048-token ctx) and every cell is INCONCLUSIVE by design
  // (measured 2026-11-03). qwen3:4b (small) and cogito:8b (mid) are both trusted
  // static-table entries and cogito:8b is the bench's standing local baseline model.
  "qwen3:4b": { id: "qwen3:4b", provider: "ollama", model: "qwen3:4b", contextTier: "local" },
  "cogito:8b": { id: "cogito:8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
}

export interface H3Cell {
  readonly cellId: string
  readonly taskId: string
  readonly variant: string
  readonly tier: string
  readonly run: number
  readonly accuracy: number | null
  readonly solved: boolean
  readonly status: string
  readonly inconclusive: boolean
  readonly tokens: number
  readonly billedTokens: number | null
  readonly durationMs: number
  /** Distinct kernel iterations seen in the trace (tool-surface-resolved events). */
  readonly iterations: number | null
  readonly terminatedBy: string | null
  /** `rax diagnose cause` label (`none` = clean end), or `no-trace`/`parse-failed`. */
  readonly causeLabel: string
  readonly causeAuthority: string | null
  readonly toolSurface: ReadonlyArray<string>
  readonly traceFile: string | null
  readonly traceDir: string
  readonly failureModes: ReadonlyArray<string>
  readonly honestyLabel: string | null
  readonly error?: string
}

export interface H3Results {
  readonly suite: "h3"
  readonly version: string
  readonly gitSha: string
  readonly taskHashes: Record<string, string>
  readonly k: number
  readonly cells: ReadonlyArray<H3Cell>
}

export const cellIdOf = (tier: string, taskId: string, variantId: string, run: number): string =>
  `${tier}|${taskId}${variantId === H3_VARIANT.id ? "" : `@${variantId}`}|${run}`

/** Swap the (judge-stripped) H3 tasks into the registry runSession reads. Idempotent. */
export function registerH3Tasks(): void {
  const reg = ALL_TASKS as unknown as BenchmarkTask[]
  for (const t of H3_TASKS) {
    const i = reg.findIndex((x) => x.id === t.id)
    if (i >= 0) reg[i] = t
    else reg.push(t)
  }
}

const gitSha = (): string => {
  try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() } catch { return "unknown" }
}

const loadResults = (out: string, k: number): H3Results => {
  if (existsSync(out)) return JSON.parse(readFileSync(out, "utf8")) as H3Results
  return { suite: "h3", version: H3_VERSION, gitSha: gitSha(), taskHashes: h3Hashes(), k, cells: [] }
}

const persist = (out: string, r: H3Results): void => {
  mkdirSync(dirname(out), { recursive: true })
  const tmp = `${out}.tmp`
  writeFileSync(tmp, JSON.stringify(r, null, 2), "utf8")
  renameSync(tmp, out)
}

function repoRoot(): string {
  let d = dirname(new URL(import.meta.url).pathname)
  while (d !== "/") {
    if (existsSync(join(d, "turbo.json"))) return d
    d = dirname(d)
  }
  throw new Error("repo root not found")
}

interface TraceFacts {
  readonly iterations: number | null
  readonly terminatedBy: string | null
  readonly toolSurface: ReadonlyArray<string>
  readonly causeLabel: string
  readonly causeAuthority: string | null
}

/** Read the trace once for iterations / tool surface / terminatedBy and ask `rax diagnose cause --json` for the label. */
export function traceFactsOf(traceFile: string | null): TraceFacts {
  if (!traceFile || !existsSync(traceFile)) {
    return { iterations: null, terminatedBy: null, toolSurface: [], causeLabel: "no-trace", causeAuthority: null }
  }
  const events = readFileSync(traceFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>)
  const iters = new Set(events.filter((e) => e.kind === "tool-surface-resolved").map((e) => e.iter))
  const surface = events.find((e) => e.kind === "tool-surface-resolved")
  const done = events.find((e) => e.kind === "run-completed")
  const cli = join(repoRoot(), "apps/cli/src/index.ts")
  const r = spawnSync("bun", [cli, "diagnose", "cause", traceFile, "--json"], { encoding: "utf8", timeout: 60_000 })
  let causeLabel = "parse-failed"
  let causeAuthority: string | null = null
  try {
    const c = JSON.parse(r.stdout) as { cause?: string; authority?: string }
    causeLabel = c.cause ?? "parse-failed"
    causeAuthority = c.authority ?? null
  } catch { /* leave parse-failed */ }
  return {
    iterations: iters.size,
    terminatedBy: typeof done?.terminatedBy === "string" ? done.terminatedBy : null,
    toolSurface: Array.isArray(surface?.visible) ? (surface.visible as string[]) : [],
    causeLabel,
    causeAuthority,
  }
}

export interface RunH3Opts {
  readonly out: string
  readonly traceRoot: string
  readonly tiers: readonly string[]
  readonly k: number
  readonly budgetSec: number
  readonly cellTimeoutSec: number
  /** Start a cell only if elapsed + this margin fits in budgetSec (default cellTimeoutSec+20). A cell cut by an outer `timeout` is simply re-run on resume. */
  readonly startMarginSec?: number
  readonly taskFilter?: readonly string[]
  /** Also run the todo-heavy task under the `+meta` arm (opt-in; not in the baseline). */
  readonly metaArm?: boolean
}

export async function runH3(opts: RunH3Opts): Promise<{ ran: number; remaining: number }> {
  if (!isAbsolute(opts.out) || !isAbsolute(opts.traceRoot)) throw new Error("H3: --out and --trace-root must be ABSOLUTE paths")
  registerH3Tasks()
  const results = loadResults(opts.out, opts.k)
  if (results.gitSha !== gitSha()) console.warn(`H3: results file was started at ${results.gitSha}, HEAD is ${gitSha()} (baseline must stay on one SHA)`)
  const done = new Set(results.cells.map((c) => c.cellId))
  let cells = [...results.cells]
  const started = Date.now()
  const tasks = H3_TASKS.filter((t) => !opts.taskFilter?.length || opts.taskFilter.includes(t.id))
  let ran = 0
  let remaining = 0
  const plan: Array<{ tier: string; task: BenchmarkTask; variant: HarnessVariant; run: number }> = []
  for (let run = 0; run < opts.k; run++)
    for (const tier of opts.tiers)
      for (const task of tasks) {
        plan.push({ tier, task, variant: H3_VARIANT, run })
        if (opts.metaArm && H3_META_TASKS.includes(task.id)) plan.push({ tier, task, variant: H3_META_VARIANT, run })
      }

  for (const p of plan) {
    const id = cellIdOf(p.tier, p.task.id, p.variant.id, p.run)
    if (done.has(id)) continue
    const elapsed = (Date.now() - started) / 1000
    if (elapsed + (opts.startMarginSec ?? opts.cellTimeoutSec + 20) > opts.budgetSec) { remaining++; continue }
    const model = H3_TIERS[p.tier]
    if (!model) throw new Error(`H3: unknown tier ${p.tier}. Known: ${Object.keys(H3_TIERS).join(", ")}`)
    const traceDir = join(opts.traceRoot, p.tier.replace(/[^\w.-]/g, "_"), p.variant.id.replace(/[^\w.-]/g, "_"), p.task.id, `run${p.run}`)
    mkdirSync(traceDir, { recursive: true })
    const prevEnv = process.env.REACTIVE_AGENTS_TRACE_DIR
    process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir
    let cell: H3Cell
    try {
      const rep = await runSession({
        id: "h3",
        name: "H3 frozen real-task suite",
        version: H3_VERSION,
        taskIds: [p.task.id],
        models: [model],
        harnessVariants: [p.variant],
        runs: 1,
        traceDir,
        concurrency: 1,
        timeoutMs: opts.cellTimeoutSec * 1000,
        logLevel: "silent",
      })
      const tr = rep.taskReports?.[0]
      const run0 = tr?.runs[0]
      const traceFile = run0?.traceId ? join(traceDir, `${run0.traceId}.jsonl`) : null
      const acc = run0?.dimensions.find((d) => d.dimension === "accuracy")?.score ?? null
      const facts = traceFactsOf(traceFile)
      cell = {
        cellId: id, taskId: p.task.id, variant: p.variant.id, tier: p.tier, run: p.run,
        accuracy: acc, solved: run0 ? isSolved(run0) : false,
        status: run0?.status ?? "no-run", inconclusive: tr?.inconclusive !== undefined,
        tokens: run0?.tokensUsed ?? 0, billedTokens: run0?.billedTokens ?? null,
        durationMs: Math.round(run0?.durationMs ?? 0),
        iterations: facts.iterations, terminatedBy: facts.terminatedBy,
        causeLabel: facts.causeLabel, causeAuthority: facts.causeAuthority, toolSurface: facts.toolSurface,
        traceFile, traceDir,
        failureModes: run0?.diagnosis?.failureModes.map((f) => f.mode) ?? [],
        honestyLabel: run0?.diagnosis?.honestyLabel ?? null,
        ...(tr?.inconclusive ? { error: typeof tr.inconclusive === "string" ? tr.inconclusive : (tr.inconclusive as { message: string }).message } : {}),
      }
    } catch (e) {
      cell = {
        cellId: id, taskId: p.task.id, variant: p.variant.id, tier: p.tier, run: p.run, accuracy: null, solved: false,
        status: "harness-error", inconclusive: true, tokens: 0, billedTokens: null, durationMs: 0,
        iterations: null, terminatedBy: null, causeLabel: "harness-error", causeAuthority: null, toolSurface: [],
        traceFile: null, traceDir, failureModes: [], honestyLabel: null,
        error: e instanceof Error ? e.message : String(e),
      }
    } finally {
      if (prevEnv === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR
      else process.env.REACTIVE_AGENTS_TRACE_DIR = prevEnv
    }
    cells = [...cells, cell]
    persist(opts.out, { ...results, cells })
    ran++
    console.error(`[h3] ${id} solved=${cell.solved} acc=${cell.accuracy} ${cell.status} cause=${cell.causeLabel} it=${cell.iterations} ${cell.tokens}tok ${(cell.durationMs / 1000).toFixed(0)}s elapsed=${((Date.now() - started) / 1000).toFixed(0)}s`)
  }
  return { ran, remaining }
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

if (import.meta.main) {
  const out = arg("out")
  const traceRoot = arg("trace-root")
  const tier = arg("tier")
  if (!out || !traceRoot || !tier) {
    console.error("usage: --out <abs.json> --trace-root <abs dir> --tier a,b [--k 5] [--budget-sec 560] [--cell-timeout-sec 150] [--task id,id] [--meta-arm]")
    process.exit(2)
  }
  const r = await runH3({
    out, traceRoot,
    tiers: tier.split(","),
    k: Number(arg("k", "5")),
    budgetSec: Number(arg("budget-sec", "560")),
    cellTimeoutSec: Number(arg("cell-timeout-sec", "150")),
    ...(arg("start-margin-sec") ? { startMarginSec: Number(arg("start-margin-sec")) } : {}),
    metaArm: process.argv.includes("--meta-arm"),
    ...(arg("task") ? { taskFilter: arg("task")!.split(",") } : {}),
  })
  console.error(`[h3] ran=${r.ran} remaining=${r.remaining}`)
  process.exit(0)
}
