// Detached bench driver: plan/interleave, resume, pause-on-contention, failure
// handling, state atomicity, process-group stop. No live model: the "runner" is a
// tiny bun script that mimics run-h3's results file and closing line.
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  armResultsPath, chunkArgs, chunkEnv, formatStatus, makeStore, newState, parseSpec, planUnits, readState, runDriver, statePath,
  writeState, type DriveSpec, type DriverDeps,
} from "../src/driver/driver.js"
import { pidAlive, realDeps, startDrive, stopDrive } from "../src/driver/cli.js"

const FAKE = `
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs")
const a = process.argv
const get = (n) => a[a.indexOf("--" + n) + 1]
appendFileSync(process.env.FAKE_LOG, [get("out").split("/").pop(), get("tier"), get("task"), get("k"), process.env.RA_FLAG ?? "-"].join(" ") + "\\n")
const mode = process.env.FAKE_MODE ?? "ok"
if (mode === "sleep") {
  writeFileSync(process.env.FAKE_PID, String(process.pid))
  setInterval(() => {}, 1000)
} else if (mode === "fail") {
  console.error("boom"); process.exit(1)
} else if (existsSync(process.env.FAKE_REFUSE ?? "/nonexistent")) {
  console.error("PREFLIGHT REFUSED: host contention detected."); process.exit(2)
} else {
  const out = get("out")
  const r = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : { cells: [] }
  const id = get("tier") + "|" + get("task") + "|" + (Number(get("k")) - 1)
  if (!r.cells.some((c) => c.cellId === id)) r.cells.push({ cellId: id })
  writeFileSync(out, JSON.stringify(r))
  console.error("[h3] ran=1 remaining=0")
}
`

let dir: string
let fake: string
let log: string

const mkSpec = (over: Partial<DriveSpec> = {}): DriveSpec => ({
  outDir: join(dir, "out"),
  tiers: ["qwen3:4b"],
  arms: [{ id: "A", env: { RA_FLAG: "a" } }, { id: "B", env: { RA_FLAG: "b" } }],
  k: 2,
  tasks: ["t1", "t2"],
  contention: "off",
  runnerCmd: ["bun", fake],
  ...over,
})

const okDeps = (over: Partial<DriverDeps> = {}): DriverDeps => ({
  ...realDeps(),
  preflight: async () => ({ ok: true, findings: [] }),
  sleep: async () => {},
  ...over,
})

const calls = (): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [])
const envFor = (mode: string): void => {
  process.env.FAKE_LOG = log
  process.env.FAKE_MODE = mode
  process.env.FAKE_PID = join(dir, "pid")
  process.env.FAKE_REFUSE = join(dir, "refuse")
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drv-"))
  fake = join(dir, "fake.js")
  log = join(dir, "calls.log")
  writeFileSync(fake, FAKE)
  envFor("ok")
})
afterEach(() => {
  for (const k of ["FAKE_LOG", "FAKE_MODE", "FAKE_PID", "FAKE_REFUSE"]) delete process.env[k]
  rmSync(dir, { recursive: true, force: true })
})

describe("plan + spec", () => {
  it("interleaves arms per task, run-major, same order for every arm", () => {
    const ids = planUnits(mkSpec()).map((u) => u.id)
    expect(ids.slice(0, 5)).toEqual(["0|qwen3:4b|t1|A", "0|qwen3:4b|t1|B", "0|qwen3:4b|t2|A", "0|qwen3:4b|t2|B", "1|qwen3:4b|t1|A"])
    expect(ids.length).toBe(8)
  })

  it("records the order in the state file and builds per-arm argv/env", () => {
    const spec = mkSpec({ arms: [{ id: "A" }, { id: "B", noSwitch: true, env: { RA_X: "1" } }], env: { RA_X: "0", RA_Y: "y" } })
    const s = newState(spec)
    expect(s.order).toEqual(planUnits(spec).map((u) => u.id))
    const u = planUnits(spec)[1]!
    const argv = chunkArgs(spec, u)
    expect(argv).toContain("--no-switch")
    expect(argv.slice(argv.indexOf("--k"), argv.indexOf("--k") + 2)).toEqual(["--k", "1"])
    expect(chunkEnv(spec, "B")).toEqual({ RA_X: "1", RA_Y: "y" })
    expect(chunkEnv(spec, "A")).toEqual({ RA_X: "0", RA_Y: "y" })
  })

  it("rejects relative outDir and a chunk budget over 590", () => {
    expect(parseSpec({ outDir: "rel", tiers: ["a"], arms: [{ id: "A" }], k: 1, tasks: ["t"] })).toMatch(/ABSOLUTE/)
    expect(parseSpec({ outDir: "/x", tiers: ["a"], arms: [{ id: "A" }], k: 1, tasks: ["t"], chunkBudgetSec: 600 })).toMatch(/590/)
    const ok = parseSpec({ outDir: "/x", tiers: ["a"], arms: [{ id: "A" }], k: 1 }, () => ["t9"])
    expect(typeof ok === "string" ? ok : ok.tasks).toEqual(["t9"])
  })
})

describe("runDriver", () => {
  it("runs every unit once, per-arm env applied, then marks completed with a summary", async () => {
    const store = makeStore(newState(mkSpec()))
    expect(await runDriver(store, okDeps())).toBe("completed")
    const c = calls()
    expect(c.length).toBe(8)
    expect(c[0]).toBe("A.json qwen3:4b t1 1 a")
    expect(c[1]).toBe("B.json qwen3:4b t1 1 b")
    expect(existsSync(join(dir, "out", "summary.json"))).toBe(true)
    expect(readState(join(dir, "out"))?.status).toBe("completed")
  })

  it("resume skips done units and a finished state never re-runs (no double count)", async () => {
    const spec = mkSpec()
    const first = newState(spec)
    const doneIds = first.order.slice(0, 3)
    const seeded = { ...first, units: { ...first.units, ...Object.fromEntries(doneIds.map((i) => [i, { status: "done" as const, attempts: 0 }])) } }
    writeState(seeded)
    const resumed = readState(spec.outDir)!
    await runDriver(makeStore(resumed), okDeps())
    expect(calls().length).toBe(5)
    await runDriver(makeStore(readState(spec.outDir)!), okDeps())
    expect(calls().length).toBe(5)
    const a = JSON.parse(readFileSync(armResultsPath(spec.outDir, "A"), "utf8")) as { cells: unknown[] }
    expect(a.cells.length).toBe(2) // only A's two undone units (run 1: t1, t2) ran
  })

  it("pauses with doubling backoff on contention instead of running, and records it", async () => {
    let n = 0
    const waits: number[] = []
    const store = makeStore(newState(mkSpec({ contention: "check", k: 1, tasks: ["t1"] })))
    const status = await runDriver(store, okDeps({
      preflight: async () => (n++ < 2 ? { ok: false, findings: ["foreign model loaded"] } : { ok: true, findings: [] }),
      sleep: async (ms) => { waits.push(ms / 1000) },
    }))
    expect(status).toBe("completed")
    expect(waits).toEqual([30, 60])
    expect(store.state.pauses.map((p) => p.findings[0])).toEqual(["foreign model loaded", "foreign model loaded"])
    expect(store.state.pausedSec).toBe(90)
    expect(calls().length).toBe(2)
  })

  it("treats run-h3's own PREFLIGHT REFUSED as a pause, not a failed attempt", async () => {
    writeFileSync(join(dir, "refuse"), "1")
    const waits: number[] = []
    const store = makeStore(newState(mkSpec({ k: 1, tasks: ["t1"], arms: [{ id: "A" }] })))
    const status = await runDriver(store, okDeps({
      sleep: async (ms) => { waits.push(ms); rmSync(join(dir, "refuse"), { force: true }) },
    }))
    expect(status).toBe("completed")
    expect(waits.length).toBe(1)
    expect(Object.values(store.state.units)[0]?.attempts).toBe(0)
  })

  it("gives up when paused past maxPauseTotalSec", async () => {
    const store = makeStore(newState(mkSpec({ contention: "check", maxPauseTotalSec: 50, k: 1, tasks: ["t1"] })))
    const status = await runDriver(store, okDeps({ preflight: async () => ({ ok: false, findings: ["load"] }) }))
    expect(status).toBe("failed")
    expect(calls().length).toBe(0)
  })

  it("marks a unit failed after maxUnitAttempts and finishes completed-with-failures", async () => {
    envFor("fail")
    const store = makeStore(newState(mkSpec({ k: 1, tasks: ["t1"], arms: [{ id: "A" }] })))
    const status = await runDriver(store, okDeps())
    expect(status).toBe("completed-with-failures")
    expect(calls().length).toBe(2)
    expect(store.state.lastError).toMatch(/boom/)
    expect(formatStatus(store.state, false)).toMatch(/1 failed/)
  })
})

describe("state file", () => {
  it("replaces atomically: no tmp left, a stale tmp or torn state.json never poisons a read", () => {
    const spec = mkSpec()
    writeState(newState(spec))
    expect(existsSync(`${statePath(spec.outDir)}.tmp`)).toBe(false)
    writeFileSync(`${statePath(spec.outDir)}.tmp`, "{ torn")
    expect(readState(spec.outDir)?.order.length).toBe(8)
    writeState(newState(spec))
    expect(existsSync(`${statePath(spec.outDir)}.tmp`)).toBe(false)
    writeFileSync(statePath(spec.outDir), "{ torn")
    expect(readState(spec.outDir)).toBeNull()
  })
})

describe("detached supervisor", () => {
  const waitFor = async (p: () => boolean, ms = 15000): Promise<boolean> => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (p()) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }

  it("stop kills the supervisor's whole group (runner child included) and marks stopped; a rerun resumes", async () => {
    envFor("sleep")
    const spec = mkSpec({ k: 1, tasks: ["t1"], arms: [{ id: "A" }] })
    const started = startDrive(spec)
    expect(started.error).toBeUndefined()
    expect(await waitFor(() => existsSync(join(dir, "pid")))).toBe(true)
    const childPid = Number(readFileSync(join(dir, "pid"), "utf8"))
    const state = readState(spec.outDir)!
    const superPid = state.pid!
    expect(pidAlive(superPid)).toBe(true)
    expect(pidAlive(childPid)).toBe(true)
    expect(startDrive(spec).error).toBe(true) // already running
    await stopDrive(spec.outDir, 5000)
    expect(await waitFor(() => !pidAlive(childPid) && !pidAlive(superPid), 5000)).toBe(true)
    expect(readState(spec.outDir)?.status).toBe("stopped")
    // resume from the same dir with a working runner completes the unit
    envFor("ok")
    expect(startDrive(spec).error).toBeUndefined()
    expect(await waitFor(() => readState(spec.outDir)?.status === "completed")).toBe(true)
  })
})
