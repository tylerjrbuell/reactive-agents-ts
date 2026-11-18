// File: src/driver/driver.ts — detached, resumable bench driver core.
//
// Why: live bench cells get SIGKILLed when run as background tool tasks, and a
// foreground tool call is capped at 590 s, so a long A/B needed a human to
// re-invoke run-h3 every chunk. The driver is a supervisor process (own process
// group, started by cli.ts) that runs run-h3 as short child processes until
// every cell is recorded, keeping all progress in an idempotent state file.
//
// Design:
//  - Unit = (run, tier, task, arm): ONE run-h3 invocation (`--k run+1 --task t`
//    skips every cell already in the arm's results file, so exactly one cell
//    runs). Units are ordered run-major, then tier, then task, then arm, with
//    the arms in the spec's order: the arms of a task run back to back, so
//    contention and time-of-day drift hit both arms alike, and a cut leaves
//    balanced, paired coverage. The order is recorded in the state file.
//  - run-h3 owns the results file (resume by cellId). The driver never writes
//    cells, so it cannot double-count: re-running a done unit is a no-op there.
//  - Contention is checked before every chunk; a contended host pauses the
//    driver with exponential backoff (recorded) instead of producing cells
//    that measure the host.
//  - The state file is replaced atomically (tmp + rename).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

// ── spec ──────────────────────────────────────────────────────────────────────

/** One side of the A/B. `env` is layered over `DriveSpec.env` (RA_* flags per arm). */
export interface ArmSpec {
  readonly id: string
  readonly env?: Readonly<Record<string, string>>
  /** run-h3 `--no-switch` (strategy-switching-off ablation arm). */
  readonly noSwitch?: boolean
  /** run-h3 `--meta-arm`. */
  readonly metaArm?: boolean
}

/** Verdict to run on completion: arm `before` vs arm `after` (their results files). */
export interface VerdictSpec {
  readonly before: string
  readonly after: string
  readonly reason: string
  readonly mechanism?: string
}

export interface DriveSpec {
  /** Absolute. Holds state.json, one `<arm>.json` per arm, traces/, logs/, summary.json. */
  readonly outDir: string
  readonly tiers: readonly string[]
  readonly arms: readonly ArmSpec[]
  readonly k: number
  /** Task ids (the CLI fills the suite's full list when omitted). */
  readonly tasks: readonly string[]
  readonly suite?: "h3" | "long-horizon"
  readonly cellTimeoutSec?: number
  /** run-h3 `--budget-sec` per chunk; <= 590 (default cellTimeoutSec + 30). */
  readonly chunkBudgetSec?: number
  readonly startMarginSec?: number
  /** Env for every chunk (layered over the supervisor's own env). */
  readonly env?: Readonly<Record<string, string>>
  /** Pass `--allow-contention` to run-h3 and never pause (recorded in provenance). */
  readonly allowContention?: boolean
  /** `off` skips the driver's own preflight (tests / non-Ollama tiers). Default `check`. */
  readonly contention?: "check" | "off"
  /** Command prefix for the runner; default `bun run <run-h3.ts>`. Args are appended. */
  readonly runnerCmd?: readonly string[]
  /** Failed chunks per unit before the unit is marked failed (default 2). */
  readonly maxUnitAttempts?: number
  /** Give up after this many seconds paused in total (default 6 h). */
  readonly maxPauseTotalSec?: number
  readonly pauseBaseSec?: number
  readonly pauseCapSec?: number
  readonly verdict?: VerdictSpec
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const strArray = (v: unknown): readonly string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((x): x is string => typeof x === "string" && x.length > 0) ? v : null
const strMap = (v: unknown): Record<string, string> | null => {
  if (!isRecord(v)) return null
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== "string") return null
    out[k] = x
  }
  return out
}
const optNum = (o: Record<string, unknown>, k: string): number | undefined | null =>
  o[k] === undefined ? undefined : typeof o[k] === "number" && Number.isFinite(o[k]) && o[k] > 0 ? o[k] : null

/** Validate untyped JSON into a DriveSpec. `tasks` may be omitted only when `defaultTasks` is given. */
export function parseSpec(raw: unknown, defaultTasks?: (suite: "h3" | "long-horizon") => readonly string[]): DriveSpec | string {
  if (!isRecord(raw)) return "spec: must be a JSON object"
  if (typeof raw.outDir !== "string" || !isAbsolute(raw.outDir)) return "spec.outDir: ABSOLUTE path required"
  const tiers = strArray(raw.tiers)
  if (!tiers) return "spec.tiers: non-empty string[] required"
  if (!Array.isArray(raw.arms) || raw.arms.length === 0) return "spec.arms: non-empty array required"
  const arms: ArmSpec[] = []
  for (const a of raw.arms) {
    if (!isRecord(a) || typeof a.id !== "string" || !/^[\w.-]+$/.test(a.id)) return "spec.arms[].id: [\\w.-]+ string required"
    const env = a.env === undefined ? undefined : strMap(a.env)
    if (env === null) return `spec.arms[${a.id}].env: string map required`
    if (arms.some((x) => x.id === a.id)) return `spec.arms: duplicate id ${a.id}`
    arms.push({
      id: a.id,
      ...(env ? { env } : {}),
      ...(a.noSwitch === true ? { noSwitch: true } : {}),
      ...(a.metaArm === true ? { metaArm: true } : {}),
    })
  }
  if (typeof raw.k !== "number" || !Number.isInteger(raw.k) || raw.k < 1) return "spec.k: integer >= 1 required"
  const suite = raw.suite === "long-horizon" ? "long-horizon" : raw.suite === undefined || raw.suite === "h3" ? "h3" : null
  if (suite === null) return "spec.suite: h3 | long-horizon"
  const tasks = raw.tasks === undefined ? (defaultTasks ? defaultTasks(suite) : null) : strArray(raw.tasks)
  if (!tasks || tasks.length === 0) return "spec.tasks: non-empty string[] required"
  const cell = optNum(raw, "cellTimeoutSec")
  const budget = optNum(raw, "chunkBudgetSec")
  const margin = optNum(raw, "startMarginSec")
  const attempts = optNum(raw, "maxUnitAttempts")
  const pauseMax = optNum(raw, "maxPauseTotalSec")
  const pauseBase = optNum(raw, "pauseBaseSec")
  const pauseCap = optNum(raw, "pauseCapSec")
  if ([cell, budget, margin, attempts, pauseMax, pauseBase, pauseCap].includes(null)) return "spec: numeric fields must be positive numbers"
  if (budget !== undefined && budget !== null && budget > 590) return "spec.chunkBudgetSec: must be <= 590"
  const env = raw.env === undefined ? undefined : strMap(raw.env)
  if (env === null) return "spec.env: string map required"
  const runnerCmd = raw.runnerCmd === undefined ? undefined : strArray(raw.runnerCmd)
  if (runnerCmd === null) return "spec.runnerCmd: non-empty string[] required"
  let verdict: VerdictSpec | undefined
  if (raw.verdict !== undefined) {
    const v = raw.verdict
    if (!isRecord(v) || typeof v.before !== "string" || typeof v.after !== "string" || typeof v.reason !== "string") return "spec.verdict: {before, after, reason} required"
    if (!arms.some((a) => a.id === v.before) || !arms.some((a) => a.id === v.after)) return "spec.verdict: before/after must be arm ids"
    verdict = { before: v.before, after: v.after, reason: v.reason, ...(typeof v.mechanism === "string" ? { mechanism: v.mechanism } : {}) }
  }
  const num = (v: number | undefined | null): number | undefined => (typeof v === "number" ? v : undefined)
  return {
    outDir: raw.outDir,
    tiers,
    arms,
    k: raw.k,
    tasks,
    suite,
    ...(num(cell) !== undefined ? { cellTimeoutSec: num(cell)! } : {}),
    ...(num(budget) !== undefined ? { chunkBudgetSec: num(budget)! } : {}),
    ...(num(margin) !== undefined ? { startMarginSec: num(margin)! } : {}),
    ...(env ? { env } : {}),
    ...(raw.allowContention === true ? { allowContention: true } : {}),
    ...(raw.contention === "off" ? { contention: "off" as const } : {}),
    ...(runnerCmd ? { runnerCmd } : {}),
    ...(num(attempts) !== undefined ? { maxUnitAttempts: num(attempts)! } : {}),
    ...(num(pauseMax) !== undefined ? { maxPauseTotalSec: num(pauseMax)! } : {}),
    ...(num(pauseBase) !== undefined ? { pauseBaseSec: num(pauseBase)! } : {}),
    ...(num(pauseCap) !== undefined ? { pauseCapSec: num(pauseCap)! } : {}),
    ...(verdict ? { verdict } : {}),
  }
}

// ── plan ──────────────────────────────────────────────────────────────────────

export interface Unit {
  readonly id: string
  readonly run: number
  readonly tier: string
  readonly task: string
  readonly arm: string
}

export const unitId = (run: number, tier: string, task: string, arm: string): string => `${run}|${tier}|${task}|${arm}`

/** Run-major, then tier, then task, then arms in spec order (paired, identical order for every arm). */
export function planUnits(spec: DriveSpec): readonly Unit[] {
  const out: Unit[] = []
  for (let run = 0; run < spec.k; run++)
    for (const tier of spec.tiers)
      for (const task of spec.tasks)
        for (const arm of spec.arms) out.push({ id: unitId(run, tier, task, arm.id), run, tier, task, arm: arm.id })
  return out
}

// ── state ─────────────────────────────────────────────────────────────────────

export type DriveStatus = "starting" | "running" | "paused" | "completed" | "completed-with-failures" | "stopped" | "failed"

export interface UnitState {
  readonly status: "pending" | "done" | "failed"
  readonly attempts: number
  readonly wallSec?: number
  readonly error?: string
}

export interface PauseRecord {
  readonly at: string
  readonly unit: string
  readonly findings: readonly string[]
  readonly waitSec: number
}

export interface DriveState {
  readonly version: 1
  readonly spec: DriveSpec
  /** Unit ids in execution order (the recorded interleave). */
  readonly order: readonly string[]
  readonly status: DriveStatus
  readonly pid: number | null
  readonly startedAt: string
  readonly updatedAt: string
  readonly units: Readonly<Record<string, UnitState>>
  readonly current: { readonly unit: string; readonly log: string; readonly startedAt: string } | null
  readonly chunks: number
  readonly pauses: readonly PauseRecord[]
  readonly pausedSec: number
  readonly lastError: string | null
  readonly driftWarnings: readonly string[]
}

export const statePath = (outDir: string): string => join(outDir, "state.json")
export const armResultsPath = (outDir: string, arm: string): string => join(outDir, `${arm}.json`)

export function newState(spec: DriveSpec, now: Date = new Date()): DriveState {
  const units = planUnits(spec)
  return {
    version: 1,
    spec,
    order: units.map((u) => u.id),
    status: "starting",
    pid: null,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    units: Object.fromEntries(units.map((u) => [u.id, { status: "pending" as const, attempts: 0 }])),
    current: null,
    chunks: 0,
    pauses: [],
    pausedSec: 0,
    lastError: null,
    driftWarnings: [],
  }
}

/** Atomic replace: a crash leaves either the old or the new file, never a torn one. */
export function writeState(state: DriveState): void {
  const path = statePath(state.spec.outDir)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8")
  renameSync(tmp, path)
}

const isDriveState = (v: unknown): v is DriveState =>
  isRecord(v) && v.version === 1 && isRecord(v.spec) && Array.isArray(v.order) && isRecord(v.units)

/** Read the state file; null when absent or unparseable (a stale `.tmp` is ignored). */
export function readState(outDir: string): DriveState | null {
  const path = statePath(outDir)
  if (!existsSync(path)) return null
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
    return isDriveState(raw) ? raw : null
  } catch {
    return null
  }
}

// ── chunk argv ────────────────────────────────────────────────────────────────

/** Default runner: run-h3.ts beside this package's src. */
export const defaultRunnerCmd = (): readonly string[] => ["bun", "run", new URL("../h3/run-h3.ts", import.meta.url).pathname]

/** run-h3 argv for one unit (excludes the runner command prefix). */
export function chunkArgs(spec: DriveSpec, unit: Unit): readonly string[] {
  const arm = spec.arms.find((a) => a.id === unit.arm)
  const cellT = spec.cellTimeoutSec ?? 180
  return [
    "--out", armResultsPath(spec.outDir, unit.arm),
    "--trace-root", join(spec.outDir, "traces", unit.arm),
    "--tier", unit.tier,
    "--k", String(unit.run + 1),
    "--task", unit.task,
    "--budget-sec", String(spec.chunkBudgetSec ?? Math.min(590, cellT + 30)),
    "--cell-timeout-sec", String(cellT),
    ...(spec.startMarginSec !== undefined ? ["--start-margin-sec", String(spec.startMarginSec)] : []),
    ...(spec.suite === "long-horizon" ? ["--suite", "long-horizon"] : []),
    ...(arm?.noSwitch ? ["--no-switch"] : []),
    ...(arm?.metaArm ? ["--meta-arm"] : []),
    ...(spec.allowContention ? ["--allow-contention"] : []),
  ]
}

/** Chunk env: spec env, then the arm's env (arm wins). */
export function chunkEnv(spec: DriveSpec, armId: string): Record<string, string> {
  return { ...(spec.env ?? {}), ...(spec.arms.find((a) => a.id === armId)?.env ?? {}) }
}

// ── driver loop ───────────────────────────────────────────────────────────────

export interface ChunkResult {
  readonly code: number | null
}

export interface DriverDeps {
  /** Run `argv` to completion with stdout+stderr appended to `logPath`. */
  readonly spawnChunk: (c: { readonly argv: readonly string[]; readonly env: Readonly<Record<string, string>>; readonly logPath: string }) => Promise<ChunkResult>
  readonly preflight: (models: readonly string[]) => Promise<{ readonly ok: boolean; readonly findings: readonly string[] }>
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
}

/** The live state, mutated only via `commit` (which persists). */
export interface StateStore {
  state: DriveState
  commit: (patch: Partial<DriveState>) => void
}

export function makeStore(initial: DriveState, persist: (s: DriveState) => void = writeState): StateStore {
  const store: StateStore = {
    state: initial,
    commit: (patch) => {
      store.state = { ...store.state, ...patch, updatedAt: new Date().toISOString() }
      persist(store.state)
    },
  }
  return store
}

const readText = (p: string): string => {
  try { return readFileSync(p, "utf8") } catch { return "" }
}

/** Parse run-h3's closing `[h3] ran=N remaining=M` line. */
export function parseChunkSummary(log: string): { readonly ran: number; readonly remaining: number } | null {
  const ms = [...log.matchAll(/\[h3\] ran=(\d+) remaining=(\d+)/g)]
  const m = ms[ms.length - 1]
  return m ? { ran: Number(m[1]), remaining: Number(m[2]) } : null
}

const lastLine = (log: string): string => log.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "(no output)"

export async function runDriver(store: StateStore, deps: DriverDeps): Promise<DriveStatus> {
  const spec = store.state.spec
  const unitById = new Map(planUnits(spec).map((u) => [u.id, u]))
  const maxAttempts = spec.maxUnitAttempts ?? 2
  const pauseBase = spec.pauseBaseSec ?? 30
  const pauseCap = spec.pauseCapSec ?? 600
  const maxPause = spec.maxPauseTotalSec ?? 6 * 3600
  const models = spec.tiers
  const checkHost = spec.contention !== "off" && spec.allowContention !== true
  mkdirSync(join(spec.outDir, "logs"), { recursive: true })
  store.commit({ status: "running" })
  let backoff = pauseBase

  const setUnit = (id: string, u: UnitState): void => store.commit({ units: { ...store.state.units, [id]: u } })

  const pause = async (unit: string, findings: readonly string[]): Promise<boolean> => {
    const waitSec = backoff
    store.commit({
      status: "paused",
      pauses: [...store.state.pauses, { at: new Date(deps.now()).toISOString(), unit, findings, waitSec }],
    })
    await deps.sleep(waitSec * 1000)
    backoff = Math.min(pauseCap, backoff * 2)
    store.commit({ status: "running", pausedSec: store.state.pausedSec + waitSec })
    return store.state.pausedSec <= maxPause
  }

  for (const id of store.state.order) {
    const unit = unitById.get(id)
    if (!unit || store.state.units[id]?.status !== "pending") continue
    let attempts = store.state.units[id]?.attempts ?? 0
    const unitStart = deps.now()
    for (;;) {
      if (checkHost) {
        const pre = await deps.preflight(models)
        if (!pre.ok) {
          if (!(await pause(id, pre.findings))) {
            store.commit({ status: "failed", lastError: `paused over ${maxPause}s on host contention`, current: null })
            return "failed"
          }
          continue
        }
        backoff = pauseBase
      }
      const chunkNo = store.state.chunks + 1
      const logPath = join(spec.outDir, "logs", `chunk-${String(chunkNo).padStart(4, "0")}.log`)
      store.commit({ chunks: chunkNo, current: { unit: id, log: logPath, startedAt: new Date(deps.now()).toISOString() } })
      const argv = [...(spec.runnerCmd ?? defaultRunnerCmd()), ...chunkArgs(spec, unit)]
      const res = await deps.spawnChunk({ argv, env: chunkEnv(spec, unit.arm), logPath })
      const log = readText(logPath)
      const drift = log.split("\n").filter((l) => l.includes("provenance drift") && !store.state.driftWarnings.includes(l.trim())).map((l) => l.trim())
      if (drift.length > 0) store.commit({ driftWarnings: [...store.state.driftWarnings, ...drift] })
      // run-h3's own preflight refused (host got busy between ours and its): same as ours, not a failure.
      if (res.code === 2 && log.includes("PREFLIGHT REFUSED")) {
        if (!(await pause(id, [lastLine(log)]))) {
          store.commit({ status: "failed", lastError: `paused over ${maxPause}s on host contention`, current: null })
          return "failed"
        }
        continue
      }
      const sum = parseChunkSummary(log)
      if (res.code === 0 && sum && sum.remaining === 0) {
        setUnit(id, { status: "done", attempts, wallSec: Math.round((deps.now() - unitStart) / 1000) })
        break
      }
      if (res.code === 0 && sum && sum.ran > 0) continue // budget ended mid-unit with progress: next chunk resumes
      attempts++
      const error = `chunk ${chunkNo} exit ${res.code}: ${lastLine(log)}`.slice(0, 300)
      store.commit({ lastError: error })
      if (attempts >= maxAttempts) {
        setUnit(id, { status: "failed", attempts, error })
        break
      }
      setUnit(id, { status: "pending", attempts, error })
    }
  }

  const failed = Object.values(store.state.units).filter((u) => u.status === "failed").length
  const status: DriveStatus = failed > 0 ? "completed-with-failures" : "completed"
  store.commit({ status, current: null })
  writeFileSync(join(spec.outDir, "summary.json"), JSON.stringify({
    outDir: spec.outDir,
    status,
    finishedAt: new Date(deps.now()).toISOString(),
    results: Object.fromEntries(spec.arms.map((a) => [a.id, armResultsPath(spec.outDir, a.id)])),
    state: statePath(spec.outDir),
    failedUnits: failed,
  }, null, 2), "utf8")
  if (spec.verdict && failed === 0) {
    const v = spec.verdict
    const verdictTs = new URL("../h3/verdict.ts", import.meta.url).pathname
    await deps.spawnChunk({
      argv: ["bun", "run", verdictTs, "--before", armResultsPath(spec.outDir, v.before), "--after", armResultsPath(spec.outDir, v.after),
        "--reason", v.reason, ...(v.mechanism ? ["--mechanism", v.mechanism] : [])],
      env: {},
      logPath: join(spec.outDir, "verdict.txt"),
    })
  }
  return status
}

// ── status ────────────────────────────────────────────────────────────────────

const cellCount = (path: string): number => {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
    return isRecord(raw) && Array.isArray(raw.cells) ? raw.cells.length : 0
  } catch {
    return 0
  }
}

/** Human-readable progress for `bench:drive status`. `alive` = the recorded pid is a live process. */
export function formatStatus(state: DriveState, alive: boolean): string {
  const ids = state.order
  const u = (id: string): UnitState | undefined => state.units[id]
  const done = ids.filter((i) => u(i)?.status === "done").length
  const failed = ids.filter((i) => u(i)?.status === "failed").length
  const pending = ids.length - done - failed
  const walls = ids.map((i) => u(i)?.wallSec).filter((w): w is number => typeof w === "number")
  const avg = walls.length > 0 ? walls.reduce((a, b) => a + b, 0) / walls.length : null
  const eta = avg === null ? "unknown" : `${Math.round((avg * pending) / 60)} min`
  const stale = (state.status === "running" || state.status === "paused" || state.status === "starting") && !alive
  const lines = [
    `status: ${stale ? `${state.status} (supervisor pid ${state.pid ?? "?"} NOT alive: rerun \`bench:drive <spec>\` to resume)` : state.status}${alive ? ` (pid ${state.pid})` : ""}`,
    `cells (units): ${done}/${ids.length} done, ${failed} failed, ${pending} pending`,
    `recorded cells: ${state.spec.arms.map((a) => `${a.id}=${cellCount(armResultsPath(state.spec.outDir, a.id))}`).join(" ")}`,
    `current: ${state.current ? `${state.current.unit} (chunk ${state.chunks}, log ${state.current.log})` : "none"}`,
    `eta: ${eta} (mean ${avg === null ? "-" : Math.round(avg)}s/unit, ${Math.round(state.pausedSec / 60)} min paused)`,
    `interleave: run-major, tier, task, arms [${state.spec.arms.map((a) => a.id).join(", ")}] (state.order)`,
    `last error: ${state.lastError ?? "none"}`,
    `pauses: ${state.pauses.length}${state.pauses.length > 0 ? ` (last: ${state.pauses[state.pauses.length - 1]!.findings.join("; ")})` : ""}`,
  ]
  for (const d of state.driftWarnings) lines.push(`DRIFT: ${d}`)
  return lines.join("\n")
}
